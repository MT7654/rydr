import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectForCase } from '../src/agents/collector';
import { DEFAULT_CONFIG, beginRun } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { getCase, getPolicyPack } from '../src/repositories/cases';
import { getRunSnapshot } from '../src/repositories/snapshots';
import { evaluateCase } from '../src/domain/policy';
import { buildEvidencePlan } from '../src/domain/evidencePlan';
import { buildSensitivityScenarios } from '../src/domain/sensitivity';
import { listCollectionJobsForCase } from '../src/repositories/collectionJobs';
import { sourceFixturePath } from '../src/tools/sourceTools';
import { MAX_SOURCE_CALLS_PER_CYCLE } from '../src/domain/collection';
import type { CaseRecord } from '../src/domain/contracts';

/**
 * Evidence collection.
 *
 * The cycle runs before a run exists, consults only allowlisted simulated
 * sources, and applies what it actually retrieved as one new case version.
 * These tests pin the four behaviours the spec cares about: it resolves what it
 * can, it escalates a policy gap instead of fetching more data, it reports an
 * unavailable source honestly, and a duplicate click reuses the job.
 */

/**
 * Reads the case from its fixture. Planning and sensitivity are pure functions
 * of the case record, so they are tested against the immutable fixture rather
 * than the runtime copy that the collection tests deliberately mutate.
 */
async function evaluateFixture(caseId: string) {
  const raw = await fs.readFile(path.join('fixtures', 'cases', `${caseId}.json`), 'utf8');
  const caseRecord = JSON.parse(raw) as CaseRecord;
  const pack = await getPolicyPack(caseRecord.policyVersion);
  return { caseRecord, pack, evaluation: evaluateCase(caseRecord, pack) };
}

/** Reads the case from the runtime store, which the collection tests mutate. */
async function evaluate(caseId: string) {
  const caseRecord = (await getCase(caseId))!;
  const pack = await getPolicyPack(caseRecord.policyVersion);
  const evaluation = evaluateCase(caseRecord, pack);
  return { caseRecord, pack, evaluation };
}

describe('evidence collection: the plan names the right source', () => {
  it('asks trip telemetry for the missing accuracy radius', async () => {
    const { caseRecord, evaluation } = await evaluateFixture('SYN-006');
    const plan = buildEvidencePlan(caseRecord, evaluation);

    expect(plan.hasWork).toBe(true);
    expect(plan.requests.map((request) => request.tool)).toEqual(['trip_telemetry']);
    expect(plan.requests[0]!.conditionId).toBe('C-ACCURACY');
    // The gap is stated as a data gap, not as a policy question.
    expect(plan.conditions.find((condition) => condition.id === 'C-ACCURACY')!.kind).toBe(
      'evidence_gap',
    );
  });

  it('asks for a policy clarification — not more GPS — when the clock is undefined', async () => {
    const { caseRecord, evaluation } = await evaluateFixture('SYN-007');
    const plan = buildEvidencePlan(caseRecord, evaluation);

    const tools = plan.requests.map((request) => request.tool);
    expect(tools).toEqual(['effective_policy']);
    expect(tools).not.toContain('trip_telemetry');

    const clock = plan.conditions.find((condition) => condition.id === 'C-CLOCK')!;
    expect(clock.kind).toBe('policy_ambiguity');
    expect(plan.needsHumanInput).toContain(clock.summary);
  });

  it('never exceeds the per-cycle source budget', async () => {
    const { caseRecord, evaluation } = await evaluateFixture('SYN-006');
    const plan = buildEvidencePlan(caseRecord, evaluation);
    expect(plan.requests.length).toBeLessThanOrEqual(MAX_SOURCE_CALLS_PER_CYCLE);
  });
});

describe('evidence collection: the cycle applies what it actually retrieved', () => {
  it('resolves a recoverable case by applying the retrieved accuracy as one new version', async () => {
    const before = (await getCase('SYN-006'))!;
    expect(before.version).toBe(1);
    // Unresolved without an accuracy radius.
    const { pack } = await evaluate('SYN-006');
    expect(evaluateCase(before, pack).noShow!.arrivalZone).toBe('indeterminate');

    const job = await collectForCase('SYN-006');

    expect(job.status).toBe('completed');
    expect(job.stopReason).toBe('resolved');
    expect(job.resultingVersion).toBe(2);
    expect(job.toolCallCount).toBe(1);
    expect(job.results[0]!.sourceType).toBe('simulated');
    expect(job.results[0]!.status).toBe('found');

    // Exactly one new version, and the original is untouched.
    const after = (await getCase('SYN-006'))!;
    expect(after.version).toBe(2);
    expect(before.evidence.every((item) => item.kind !== 'gps' || item.payload.accuracyMeters === null)).toBe(true);

    const original = after.evidence.find((item) => item.id === 'SYN006-GPS-01')!;
    expect(original.kind === 'gps' && original.payload.accuracyMeters).toBe(8);
    // The fix coordinates are unchanged — only the accuracy was supplied.
    expect(original.kind === 'gps' && original.payload.lat).toBe(1.2848);

    // And the case is now determinate.
    const resolved = evaluateCase(after, pack);
    expect(resolved.noShow!.arrivalZone).toBe('inside');
    expect(resolved.disposition).not.toBe('human_review');
  });

  it('reuses the same job when the same version is collected twice', async () => {
    const first = await collectForCase('SYN-006');
    const second = await collectForCase('SYN-006');

    expect(second.id).toBe(first.id);
    expect(second.resultingVersion).toBe(first.resultingVersion);
    // One job, one version — a duplicate click is not a second cycle.
    const jobs = await listCollectionJobsForCase('SYN-006');
    expect(jobs).toHaveLength(1);
    expect((await getCase('SYN-006'))!.version).toBe(2);
  });

  it('escalates a policy gap and creates no version', async () => {
    const before = (await getCase('SYN-007'))!;
    const job = await collectForCase('SYN-007');

    expect(job.status).toBe('blocked');
    expect(job.stopReason).toBe('policy_ambiguity');
    expect(job.resultingVersion).toBeNull();
    expect((await getCase('SYN-007'))!.version).toBe(before.version);
  });

  it('reports an unavailable source honestly and fabricates nothing', async () => {
    const before = (await getCase('SYN-008'))!;
    const job = await collectForCase('SYN-008');

    expect(job.status).toBe('blocked');
    expect(job.stopReason).toBe('unavailable');
    expect(job.resultingVersion).toBeNull();
    expect(job.results.every((result) => result.status === 'unavailable')).toBe(true);
    // Nothing was invented: same version, same evidence count.
    const after = (await getCase('SYN-008'))!;
    expect(after.version).toBe(before.version);
    expect(after.evidence).toHaveLength(before.evidence.length);
  });

  it('routes a safety allegation without collecting anything', async () => {
    // A case whose statement raises safety must be routed, not investigated.
    const base = (await getCase('SYN-008'))!;
    const withSafety = {
      ...base,
      id: 'SYN-009-SAFETY',
      trip: { ...base.trip, id: 'TRIP-SYN-009-SAFETY' },
      riderStatement: 'The driver threatened me and I felt unsafe during the pickup.',
    };
    const pack = await getPolicyPack(withSafety.policyVersion);
    const plan = buildEvidencePlan(withSafety, evaluateCase(withSafety, pack));

    expect(plan.conditions[0]!.kind).toBe('safety');
    expect(plan.hasWork).toBe(false);
    expect(plan.requests).toHaveLength(0);
  });
});

describe('evidence collection: fixtures cannot leak an expected ruling', () => {
  it('keeps only measurements and source status in the source fixtures', async () => {
    const forbidden = /^(disposition|ruling|expected|outcome|refundCents|decision)$/i;
    const seen: string[] = [];

    function walk(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          expect(forbidden.test(key), `source fixture leaked a ruling key: ${key}`).toBe(false);
          seen.push(key);
          walk(nested);
        }
      }
    }

    for (const tripId of ['TRIP-SYN-006', 'TRIP-SYN-007']) {
      const raw = await fs.readFile(sourceFixturePath(tripId), 'utf8');
      walk(JSON.parse(raw));
    }
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('collection freezes the run against the collected version', () => {
  it('starts the run on the version collection produced, and reuses it on a second click', async () => {
    // Collection first, exactly as the start path does it.
    const job = await collectForCase('SYN-006');
    expect(job.resultingVersion).toBe(2);
    const collected = (await getCase('SYN-006'))!;
    expect(collected.version).toBe(2);

    const run = await beginRun(
      'SYN-006',
      'fixture',
      { ...DEFAULT_CONFIG, provider: createFixtureProvider() },
      'freeze-key-1',
    );
    expect(run.caseVersion).toBe(2);

    // The snapshot is frozen against the collected version, not the fixture's
    // original one — the accuracy collection supplied is what the run judged.
    const snapshot = await getRunSnapshot(run.id);
    if (!snapshot) throw new Error(`Run ${run.id} has no frozen snapshot`);
    expect(snapshot.caseVersion).toBe(2);
    const fix = snapshot.caseRecord.evidence.find((item) => item.id === 'SYN006-GPS-01');
    expect(fix?.kind).toBe('gps');
    expect(fix?.kind === 'gps' ? fix.payload.accuracyMeters : null).toBe(8);

    // A duplicate click collects nothing new and lands on the same run, so the
    // reviewer never gets two runs adjudicating the same case version.
    const again = await collectForCase('SYN-006');
    expect(again.id).toBe(job.id);
    expect((await getCase('SYN-006'))!.version).toBe(2);

    const duplicate = await beginRun(
      'SYN-006',
      'fixture',
      { ...DEFAULT_CONFIG, provider: createFixtureProvider() },
      'freeze-key-1',
    );
    expect(duplicate.id).toBe(run.id);
  });
});

describe('sensitivity view: bounded, read-only and honest', () => {
  it('shows that a tighter accuracy radius would change the outcome', async () => {
    const { caseRecord, pack, evaluation } = await evaluateFixture('SYN-006');
    const scenarios = buildSensitivityScenarios(caseRecord, pack, evaluation);

    const accuracy = scenarios.find((scenario) => scenario.id === 'S-ACCURACY')!;
    expect(accuracy).toBeDefined();
    expect(accuracy.changesDecision).toBe(true);
    expect(accuracy.baselineOutcome).toContain('Human review');
    expect(accuracy.outcome).not.toContain('Human review');
    // A hypothetical is labelled as one, and names the source that would settle it.
    expect(accuracy.missingSource).toBeTruthy();
  });

  it('shows that the governing clock is what decides the wait', async () => {
    const { caseRecord, pack, evaluation } = await evaluateFixture('SYN-007');
    const scenarios = buildSensitivityScenarios(caseRecord, pack, evaluation);

    const clock = scenarios.find((scenario) => scenario.id === 'S-CLOCK')!;
    expect(clock).toBeDefined();
    expect(clock.changesDecision).toBe(true);
    expect(clock.outcome).toMatch(/at or above/);
    expect(clock.outcome).toMatch(/below/);
  });

  it('offers no scenario for a case that is already determinate', async () => {
    const { caseRecord, pack, evaluation } = await evaluateFixture('SYN-002');
    const scenarios = buildSensitivityScenarios(caseRecord, pack, evaluation);
    // Nothing unresolved to vary, so nothing is invented.
    expect(scenarios).toHaveLength(0);
  });
});
