import { describe, expect, it } from 'vitest';
import type { AgentInvocation, AgentProvider, AgentResult } from '../src/providers/types';
import type { RunRecord } from '../src/domain/contracts';
import { createFixtureProvider } from '../src/providers/fixture';
import {
  DEFAULT_CONFIG,
  beginRun,
  startRun,
  type OrchestratorConfig,
} from '../src/agents/orchestrator';
import { getRun, selectRunForCase } from '../src/repositories/runs';
import { isRunInFlight, runSourceKind, runSourceLabel } from '../src/lib/runPresentation';

function config(
  provider: AgentProvider,
  overrides: Partial<OrchestratorConfig> = {},
): OrchestratorConfig {
  return { ...DEFAULT_CONFIG, provider, ...overrides };
}

/** Adds latency to every provider call so in-flight states are observable. */
function delayed(provider: AgentProvider, ms: number): AgentProvider {
  return {
    ...provider,
    async invoke(request: AgentInvocation): Promise<AgentResult> {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return provider.invoke(request);
    },
  };
}

async function waitForTerminal(runId: string, timeoutMs = 8_000): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await getRun(runId);
    if (run && !isRunInFlight(run)) return run;
    if (Date.now() > deadline) throw new Error(`Run ${runId} did not reach a terminal state`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('run source labelling', () => {
  it('never labels a fixture run as live', async () => {
    const run = await startRun('SYN-001', 'fixture', config(createFixtureProvider()), 'lbl-fix-1');

    expect(run.mode).toBe('fixture');
    expect(runSourceKind(run)).toBe('fixture');
    expect(runSourceLabel(run)).toBe('Fixture simulation');
    expect(runSourceLabel(run)).not.toMatch(/live/i);
  });

  it('distinguishes an in-flight live run from a saved live result', async () => {
    const inFlight = { ...(await startRun('SYN-002', 'fixture', config(createFixtureProvider()), 'lbl-live-1')) };
    const liveInFlight: RunRecord = { ...inFlight, mode: 'live', state: 'advocates_running' };
    const liveSaved: RunRecord = { ...inFlight, mode: 'live', state: 'completed' };

    expect(runSourceKind(liveInFlight)).toBe('live_in_flight');
    expect(runSourceLabel(liveInFlight)).toBe('Live run in progress');
    expect(runSourceKind(liveSaved)).toBe('live_saved');
    expect(runSourceLabel(liveSaved)).toBe('Saved live result');
  });

  it('labels a replay as recorded playback rather than live', async () => {
    const base = await startRun('SYN-004', 'fixture', config(createFixtureProvider()), 'lbl-rep-1');
    const replay: RunRecord = { ...base, mode: 'replay' };
    expect(runSourceKind(replay)).toBe('replay');
    expect(runSourceLabel(replay)).toBe('Recorded playback');
  });
});

describe('run selection honours the requested mode and version', () => {
  it('flags a fixture result as not matching a requested live review', async () => {
    await startRun('SYN-001', 'fixture', config(createFixtureProvider()), 'sel-fix-1');

    const selection = await selectRunForCase('SYN-001', { mode: 'live' });

    // The fixture run is still shown so the page is not blank...
    expect(selection.run).not.toBeNull();
    expect(selection.run?.mode).toBe('fixture');
    // ...but it is explicitly flagged, so the UI keeps a fresh-run action.
    expect(selection.matchesRequestedMode).toBe(false);
  });

  it('reports a match when the requested mode is the recorded mode', async () => {
    await startRun('SYN-002', 'fixture', config(createFixtureProvider()), 'sel-fix-2');
    const selection = await selectRunForCase('SYN-002', { mode: 'fixture' });
    expect(selection.run?.mode).toBe('fixture');
    expect(selection.matchesRequestedMode).toBe(true);
  });

  it('refuses a run id that belongs to a different case', async () => {
    const foreign = await startRun('SYN-004', 'fixture', config(createFixtureProvider()), 'sel-foreign-1');

    const selection = await selectRunForCase('SYN-001', { runId: foreign.id });

    expect(selection.run).toBeNull();
    expect(selection.requestedRunUnavailable).toBe(true);
  });

  it('honours an explicit run id for the correct case', async () => {
    const target = await startRun('SYN-005', 'fixture', config(createFixtureProvider()), 'sel-explicit-1');
    const selection = await selectRunForCase('SYN-005', { runId: target.id });
    expect(selection.run?.id).toBe(target.id);
    expect(selection.requestedRunUnavailable).toBe(false);
  });

  it('does not return a run recorded against a different case version', async () => {
    const run = await startRun('SYN-001', 'fixture', config(createFixtureProvider()), 'sel-ver-1');

    const mismatched = await selectRunForCase('SYN-001', { caseVersion: run.caseVersion + 1 });
    expect(mismatched.run?.caseVersion).not.toBe(run.caseVersion + 1);

    const matched = await selectRunForCase('SYN-001', { caseVersion: run.caseVersion });
    expect(matched.run?.caseVersion).toBe(run.caseVersion);
  });
});

describe('run start returns before execution finishes', () => {
  it('returns a persisted non-terminal run id immediately', async () => {
    const run = await beginRun(
      'SYN-001',
      'fixture',
      config(delayed(createFixtureProvider(), 40)),
      'async-start-1',
    );

    // The caller gets an id straight away, so the monitor can open and poll.
    expect(run.id).toBeTruthy();
    expect(run.state).toBe('created');
    expect(isRunInFlight(run)).toBe(true);

    const finished = await waitForTerminal(run.id);
    expect(finished.state).toBe('completed');
    expect(finished.resolution?.disposition).toBe('refund');
  });

  it('shares one run for a duplicate start and starts a new one only on intent', async () => {
    const provider = createFixtureProvider();

    const first = await beginRun('SYN-002', 'fixture', config(provider), 'dup-key-1');
    const duplicate = await beginRun('SYN-002', 'fixture', config(provider), 'dup-key-1');
    expect(duplicate.id).toBe(first.id);

    const intentional = await beginRun('SYN-002', 'fixture', config(provider), 'dup-key-2');
    expect(intentional.id).not.toBe(first.id);

    await waitForTerminal(first.id);
    await waitForTerminal(intentional.id);
  });

  it('does not reuse a failed run when retrying the same intent', async () => {
    const failing: AgentProvider = {
      ...createFixtureProvider(),
      async invoke() {
        throw new Error('simulated transport failure');
      },
    };
    const failed = await beginRun('SYN-004', 'fixture', config(failing), 'retry-key-1');
    const settled = await waitForTerminal(failed.id);
    expect(settled.state).toBe('failed');

    const retried = await beginRun('SYN-004', 'fixture', config(createFixtureProvider()), 'retry-key-1');
    expect(retried.id).not.toBe(failed.id);
    await waitForTerminal(retried.id);
  });
});
