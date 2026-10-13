import { describe, expect, it } from 'vitest';
import { createFixtureProvider } from '../src/providers/fixture';
import type { AgentProvider } from '../src/providers/types';
import { DEFAULT_CONFIG, beginRun, startRun, type OrchestratorConfig } from '../src/agents/orchestrator';
import { getCase } from '../src/repositories/cases';
import { getRun } from '../src/repositories/runs';
import {
  chargeRefFor,
  listReceiptsForDecision,
  listSettlementsForCase,
  postedRefundCents,
  postSettlement,
  recordDecision,
} from '../src/repositories/ledger';

function config(provider: AgentProvider = createFixtureProvider()): OrchestratorConfig {
  return { ...DEFAULT_CONFIG, provider };
}

/**
 * A provider that produces valid fixture output but identifies itself as
 * something else. Used to prove that run reuse is keyed on how a run was
 * executed, not merely on the key the caller passed. No external call is made.
 */
function stubProvider(id: string): AgentProvider {
  const fixture = createFixtureProvider();
  return { ...fixture, id, external: true };
}

async function decide(input: {
  caseId: string;
  disposition: 'refund' | 'uphold' | 'partial_refund';
  targetRefundCents: number;
  supersedes?: string | null;
}) {
  const caseRecord = (await getCase(input.caseId))!;
  const decision = await recordDecision({
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    runId: null,
    taskId: null,
    source: 'reviewer',
    disposition: input.disposition,
    targetRefundCents: input.targetRefundCents,
    evidenceIds: [],
    policyIds: [],
    policyVersion: caseRecord.policyVersion,
    explanation: `Test decision: ${input.disposition} ${input.targetRefundCents}.`,
    differenceFromRecommendation: null,
    reviewerId: 'reviewer_demo_01',
    supersedesDecisionId: input.supersedes ?? null,
    chargeRef: chargeRefFor(caseRecord),
  });
  const { settlement } = await postSettlement({ caseRecord, decision });
  return { decision, settlement, caseRecord };
}

describe('receipts report the cumulative position, not the increment', () => {
  it('confirms an existing refund without claiming the fee stands', async () => {
    const first = await decide({ caseId: 'SYN-002', disposition: 'refund', targetRefundCents: 500 });
    expect(first.settlement.deltaRefundCents).toBe(500);

    // An appeal that confirms the same outcome adds nothing.
    const confirmed = await decide({
      caseId: 'SYN-002',
      disposition: 'refund',
      targetRefundCents: 500,
      supersedes: first.decision.id,
    });
    expect(confirmed.settlement.deltaRefundCents).toBe(0);
    expect(confirmed.settlement.retainedCents).toBe(0);

    const receipts = await listReceiptsForDecision(confirmed.decision.id);
    const rider = receipts.find((receipt) => receipt.recipient === 'rider')!;
    const driver = receipts.find((receipt) => receipt.recipient === 'driver')!;

    // The trap: a zero increment is the refund continuing, not the fee standing.
    expect(rider.headline).not.toMatch(/disputed fee stands|fee upheld/i);
    expect(driver.headline).not.toMatch(/disputed fee stands|fee upheld/i);
    expect(rider.headline).toContain('SGD 5.00');
    expect(rider.body).toContain('Total refunded to date: SGD 5.00');
    expect(rider.body).toContain('Retained: SGD 0.00');
    expect(driver.body).toContain('Total simulated refund against');

    // Both parties agree on the money.
    expect(rider.body).toMatch(/already recorded before this decision/);
    expect(driver.body).toMatch(/already recorded before this decision/);

    expect(await postedRefundCents(chargeRefFor(first.caseRecord))).toBe(500);
  });

  it('shows both the increment and the total when a partial refund is raised', async () => {
    const partial = await decide({ caseId: 'SYN-005', disposition: 'partial_refund', targetRefundCents: 200 });
    expect(partial.settlement.deltaRefundCents).toBe(200);

    const raised = await decide({
      caseId: 'SYN-005',
      disposition: 'refund',
      targetRefundCents: 500,
      supersedes: partial.decision.id,
    });
    expect(raised.settlement.deltaRefundCents).toBe(300);
    expect(raised.settlement.retainedCents).toBe(0);

    const receipts = await listReceiptsForDecision(raised.decision.id);
    const rider = receipts.find((receipt) => receipt.recipient === 'rider')!;

    expect(rider.headline).toContain('SGD 3.00');
    expect(rider.body).toContain('was already recorded before this decision');
    expect(rider.body).toContain('SGD 2.00');
    expect(rider.body).toContain('Total refunded to date: SGD 5.00');
    expect(rider.body).toContain('Retained: SGD 0.00');
  });

  it('says the fee stands only when nothing was refunded', async () => {
    const upheld = await decide({ caseId: 'SYN-001', disposition: 'uphold', targetRefundCents: 0 });
    expect(upheld.settlement.deltaRefundCents).toBe(0);
    expect(upheld.settlement.retainedCents).toBe(500);

    const receipts = await listReceiptsForDecision(upheld.decision.id);
    const rider = receipts.find((receipt) => receipt.recipient === 'rider')!;
    expect(rider.headline).toMatch(/stands/i);
    expect(rider.body).toContain('SGD 5.00');
  });

  it('issues no party receipt at all for an unresolved closure', async () => {
    const caseRecord = (await getCase('SYN-003'))!;
    const decision = await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'insufficient_evidence',
      targetRefundCents: null,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'The evidence cannot settle who was responsible.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: null,
      chargeRef: chargeRefFor(caseRecord),
    });

    // A closure without a ruling cannot settle, so there is nothing to tell a
    // party about money — and in particular no driver-facing refund headline.
    await expect(postSettlement({ caseRecord, decision })).rejects.toThrow(/no financial ruling/);
    expect(await listReceiptsForDecision(decision.id)).toHaveLength(0);
    expect(await listSettlementsForCase(caseRecord.id)).toHaveLength(0);
  });
});

describe('re-run keys distinguish execution modes', () => {
  it('does not let a fixture run satisfy a requested live re-run', async () => {
    const key = 'task-rerun:task_test:v1';

    const live = await beginRun('SYN-004', 'live', config(stubProvider('live-stub')), key);
    const fixture = await beginRun('SYN-004', 'fixture', config(), key);

    expect(fixture.id).not.toBe(live.id);
    expect((await getRun(live.id))?.mode).toBe('live');
    expect((await getRun(fixture.id))?.mode).toBe('fixture');
    // The requested live execution really is a distinct run, correctly labelled.
    expect((await getRun(live.id))?.provider).toBe('live-stub');

    // Asking again for the same mode and version reuses one run.
    const fixtureAgain = await beginRun('SYN-004', 'fixture', config(), key);
    expect(fixtureAgain.id).toBe(fixture.id);
  });

  it('keeps the existing duplicate-start protection for the default key', async () => {
    const first = await startRun('SYN-005', 'fixture', config(), 'dup-key-test');
    const second = await startRun('SYN-005', 'fixture', config(), 'dup-key-test');
    expect(second.id).toBe(first.id);
  });
});
