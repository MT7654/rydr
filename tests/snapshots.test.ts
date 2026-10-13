import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, startRun, type OrchestratorConfig } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import {
  appendCaseVersion,
  getCase,
  getCaseVersion,
  listCaseVersions,
  saveRuntimeCase,
} from '../src/repositories/cases';
import { getRunSnapshot, snapshotPolicyIntact } from '../src/repositories/snapshots';
import { listProviderCalls, summarizeProviderCalls } from '../src/repositories/providerCalls';
import { loadCasePacket } from '../src/lib/casePacket';
import { clone, loadCase } from './helpers';

function config(): OrchestratorConfig {
  return { ...DEFAULT_CONFIG, provider: createFixtureProvider() };
}

describe('immutable case versions', () => {
  it('assigns the version number on the server and never overwrites a version', async () => {
    const base = await loadCase('SYN-001');
    const v2 = await appendCaseVersion('SYN-001', (current) => ({
      ...clone(current),
      riderStatement: `${current.riderStatement} Additional detail supplied later.`,
    }));

    expect(v2.version).toBe(base.version + 1);
    expect(v2.changeLog.length).toBeGreaterThan(base.changeLog.length);

    // The original version is still readable and unchanged.
    const original = await getCaseVersion('SYN-001', 1);
    expect(original?.riderStatement).toBe(base.riderStatement);

    // Writing the same version twice is refused rather than silently overwriting.
    await expect(saveRuntimeCase(v2)).rejects.toThrow(/already exists and is immutable/);
  });

  it('reports the newest version as current and keeps full history', async () => {
    await appendCaseVersion('SYN-004', (current) => clone(current));
    await appendCaseVersion('SYN-004', (current) => clone(current));

    const current = await getCase('SYN-004');
    const history = await listCaseVersions('SYN-004');
    expect(current?.version).toBe(3);
    expect(history.map((record) => record.version)).toEqual([1, 2, 3]);
  });
});

describe('frozen run snapshots', () => {
  it('captures the case version, policy pack and findings the run evaluated', async () => {
    const run = await startRun('SYN-002', 'fixture', config(), 'snap-1');
    const snapshot = await getRunSnapshot(run.id);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.caseVersion).toBe(run.caseVersion);
    expect(snapshot?.policyVersion).toBe(run.policyVersion);
    expect(snapshot?.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot?.evaluation.caseVersion).toBe(run.caseVersion);
    expect(snapshot?.catalog.length).toBeGreaterThan(0);
    expect(snapshot?.quality.total).toBeGreaterThan(0);
  });

  it('never rewrites a snapshot once written', async () => {
    const run = await startRun('SYN-005', 'fixture', config(), 'snap-2');
    const first = await getRunSnapshot(run.id);
    const again = await getRunSnapshot(run.id);
    expect(again?.capturedAt).toBe(first?.capturedAt);
    expect(again?.inputHash).toBe(first?.inputHash);
  });

  it('keeps an old report faithful after the case is edited', async () => {
    const run = await startRun('SYN-003', 'fixture', config(), 'snap-3');
    const before = await loadCasePacket('SYN-003', { runId: run.id });
    expect(before?.renderedFromSnapshot).toBe(true);

    const originalStatement = before?.caseRecord.riderStatement;
    const versionAtRun = before?.caseRecord.version ?? 1;

    // Edit the case: append a new immutable version with an extra evidence item.
    await appendCaseVersion('SYN-003', (current) => {
      const next = clone(current);
      next.riderStatement = 'Rewritten statement that must not appear in the old run.';
      const template = current.evidence.find((item) => item.kind === 'trip_event');
      if (!template) throw new Error('fixture has no trip event to clone');
      next.evidence.push({
        ...clone(template),
        id: 'SYN003-EVT-99',
        source: { ...template.source, jsonPointer: '/evidence/99' },
      });
      return next;
    });

    const after = await loadCasePacket('SYN-003', { runId: run.id });
    // The pinned view is unchanged...
    expect(after?.caseRecord.riderStatement).toBe(originalStatement);
    expect(after?.caseRecord.version).toBe(versionAtRun);
    expect(after?.caseRecord.evidence.some((item) => item.id === 'SYN003-EVT-99')).toBe(false);
    expect(after?.supersededByNewerCase).toBe(true);
    expect(after?.currentCaseVersion).toBe(versionAtRun + 1);

    // ...while the current view does include the new version.
    const current = await loadCasePacket('SYN-003');
    expect(current?.renderedFromSnapshot).toBe(false);
    expect(current?.caseRecord.version).toBe(versionAtRun + 1);
    expect(current?.caseRecord.evidence.some((item) => item.id === 'SYN003-EVT-99')).toBe(true);
  });

  it('detects a policy pack edited without a version bump', async () => {
    const run = await startRun('SYN-002', 'fixture', config(), 'snap-4');
    const snapshot = await getRunSnapshot(run.id);
    if (!snapshot) throw new Error('missing snapshot');

    const intact = await loadCasePacket('SYN-002', { runId: run.id });
    expect(intact?.policyChangedSinceRun).toBe(false);
    expect(snapshotPolicyIntact(snapshot, snapshot.policyPack)).toBe(true);
  });
});

describe('provider call telemetry', () => {
  it('records one entry per invocation with role, stage and latency', async () => {
    const run = await startRun('SYN-001', 'fixture', config(), 'telemetry-1');
    const calls = await listProviderCalls(run.id);

    expect(calls.length).toBe(run.callCount);
    expect(calls.map((call) => call.role).sort()).toEqual(
      expect.arrayContaining(['driver', 'judge', 'rider']),
    );
    for (const call of calls) {
      expect(call.seq).toBeGreaterThanOrEqual(0);
      expect(call.latencyMs).toBeGreaterThanOrEqual(0);
      expect(call.ok).toBe(true);
      expect(call.stage.length).toBeGreaterThan(0);
    }
  });

  it('leaves unreported token usage null instead of estimating it', async () => {
    const run = await startRun('SYN-002', 'fixture', config(), 'telemetry-2');
    const calls = await listProviderCalls(run.id);
    const summary = summarizeProviderCalls(calls);

    // The fixture provider reports no usage, so nothing may be invented.
    expect(calls.every((call) => call.inputTokens === null)).toBe(true);
    expect(summary.reportedInputTokens).toBeNull();
    expect(summary.reportedOutputTokens).toBeNull();
    expect(summary.usageIncomplete).toBe(true);
    expect(summary.totalCalls).toBe(calls.length);
    expect(summary.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failed call without storing provider reasoning', async () => {
    const provider = createFixtureProvider();
    const failing: OrchestratorConfig = {
      ...DEFAULT_CONFIG,
      provider: {
        ...provider,
        invoke: async () => {
          throw new Error('simulated transport failure');
        },
      },
    };

    const run = await startRun('SYN-005', 'fixture', failing, 'telemetry-3');
    expect(run.state).toBe('failed');

    const calls = await listProviderCalls(run.id);
    expect(calls.length).toBeGreaterThan(0);
    const failed = calls.filter((call) => !call.ok);
    expect(failed.length).toBe(calls.length);
    expect(failed[0]?.errorMessage).toContain('simulated transport failure');
    // No hidden reasoning or raw prompt content is persisted.
    const serialised = JSON.stringify(calls);
    expect(serialised).not.toContain('<think');
    expect(serialised).not.toContain('systemInstruction');
  });
});
