import { describe, expect, it } from 'vitest';
import { createFixtureProvider } from '../src/providers/fixture';
import { DEFAULT_CONFIG, startRun, type OrchestratorConfig } from '../src/agents/orchestrator';
import type { AgentProvider } from '../src/providers/types';
import { getCase } from '../src/repositories/cases';
import {
  StaleRevisionError,
  createEvidenceRequest,
  listEvidenceRequests,
  listReviewTasksForCase,
  updateReviewTask,
} from '../src/repositories/reviewTasks';
import {
  chargeRefFor,
  effectiveDecisionForCase,
  listReceiptsForDecision,
  listSettlementsForCase,
  postSettlement,
  postedRefundCents,
  recordDecision,
} from '../src/repositories/ledger';
import { deriveCaseStatus } from '../src/domain/caseStatus';

function config(provider: AgentProvider = createFixtureProvider()): OrchestratorConfig {
  return { ...DEFAULT_CONFIG, provider };
}

/** Runs a case to completion, which also applies the completion step. */
async function analyse(caseId: string, key: string) {
  return startRun(caseId, 'fixture', config(), key);
}

describe('journey A — a clear case settles automatically', () => {
  it('records an AI decision and posts a simulated settlement', async () => {
    const run = await analyse('SYN-001', 'wb-clear-1');
    expect(run.state).toBe('completed');

    const decision = await effectiveDecisionForCase('SYN-001');
    expect(decision).not.toBeNull();
    expect(decision?.source).toBe('ai');
    expect(decision?.disposition).toBe('refund');
    expect(decision?.targetRefundCents).toBe(500);

    const settlements = await listSettlementsForCase('SYN-001');
    const posted = settlements.find((settlement) => settlement.status === 'posted');
    expect(posted).toBeDefined();
    expect(posted?.deltaRefundCents).toBe(500);
    expect(posted?.retainedCents).toBe(0);
    expect(posted?.mode).toBe('simulation');
    expect(posted?.postedAt).not.toBeNull();
  });

  it('produces a receipt for each party with identical disposition', async () => {
    await analyse('SYN-001', 'wb-clear-2');
    const decision = await effectiveDecisionForCase('SYN-001');
    expect(decision).not.toBeNull();

    const receipts = await listReceiptsForDecision(decision!.id);
    const rider = receipts.find((receipt) => receipt.recipient === 'rider');
    const driver = receipts.find((receipt) => receipt.recipient === 'driver');

    expect(rider).toBeDefined();
    expect(driver).toBeDefined();
    expect(rider?.mode).toBe('local_preview');
    // Neither receipt may claim real money moved or a message was sent.
    expect(`${rider?.body} ${driver?.body}`).not.toMatch(/sent|email|whatsapp|paid out/i);
  });

  it('posts an auditable zero adjustment when the charge is upheld', async () => {
    await analyse('SYN-005', 'wb-clear-3');
    const decision = await effectiveDecisionForCase('SYN-005');
    expect(decision?.disposition).toBe('uphold');
    expect(decision?.targetRefundCents).toBe(0);

    const settlements = await listSettlementsForCase('SYN-005');
    const posted = settlements.find((settlement) => settlement.status === 'posted');
    expect(posted?.deltaRefundCents).toBe(0);
    expect(posted?.retainedCents).toBe(500);
    // An upheld outcome is a completion event, never a fake refund.
    expect(posted?.ledgerEntryIds.length).toBe(1);
  });
});

describe('journey B — an uncertain case reaches a reviewer', () => {
  it('creates one open review task and no settlement', async () => {
    await analyse('SYN-003', 'wb-uncertain-1');

    const tasks = await listReviewTasksForCase('SYN-003');
    const open = tasks.filter((task) => task.status !== 'decided' && task.status !== 'closed_unresolved');
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(open.some((task) => task.kind === 'automatic_escalation')).toBe(true);

    // Escalation must not settle anything.
    expect(await effectiveDecisionForCase('SYN-003')).toBeNull();
    expect(await listSettlementsForCase('SYN-003')).toHaveLength(0);
  });

  it('does not stack duplicate tasks for repeated escalations', async () => {
    await analyse('SYN-003', 'wb-uncertain-2');
    const before = (await listReviewTasksForCase('SYN-003')).filter(
      (task) => task.kind === 'automatic_escalation',
    ).length;

    await analyse('SYN-003', 'wb-uncertain-3');
    const after = (await listReviewTasksForCase('SYN-003')).filter(
      (task) => task.kind === 'automatic_escalation',
    ).length;

    expect(after).toBe(before);
  });

  it('treats a party statement as a claim, not verified telemetry', async () => {
    const tasks = await listReviewTasksForCase('SYN-003');
    const task = tasks[0]!;

    const request = await createEvidenceRequest({
      taskId: task.id,
      caseId: task.caseId,
      recipient: 'rider',
      question: 'Can you provide GPS accuracy for the recorded samples?',
      evidenceType: 'gps_accuracy',
      whyItMatters: 'Without an accuracy radius the pickup zone cannot be determined.',
    });
    expect(request.status).toBe('open');

    const stored = await listEvidenceRequests(task.id);
    expect(stored.some((entry) => entry.id === request.id)).toBe(true);
    // An open request is a question, never fabricated evidence.
    expect(request.responseEvidenceIds).toHaveLength(0);
  });
});

describe('settlement correctness', () => {
  it('never credits the same charge twice for a repeated decision', async () => {
    const run = await analyse('SYN-001', 'wb-settle-1');
    const decision = await effectiveDecisionForCase('SYN-001');
    expect(decision).not.toBeNull();

    const caseRecord = (await getCase('SYN-001'))!;
    const chargeRef = chargeRefFor(caseRecord);

    const first = await postSettlement({ caseRecord, decision: decision! });
    const second = await postSettlement({ caseRecord, decision: decision! });

    expect(second.replayed).toBe(true);
    expect(second.settlement.id).toBe(first.settlement.id);

    const total = await postedRefundCents(chargeRef);
    // The disputed amount is 500 cents; a double post would show 1000.
    expect(total).toBeLessThanOrEqual(500);
    expect(run.state).toBe('completed');
  });

  it('posts only the difference when a superseding decision raises the target', async () => {
    // SYN-005 is upheld by the automated pass, so nothing has been refunded yet
    // and there is room to raise the target.
    await analyse('SYN-005', 'wb-settle-2');
    const caseRecord = (await getCase('SYN-005'))!;
    const chargeRef = chargeRefFor(caseRecord);
    expect(await postedRefundCents(chargeRef)).toBe(0);

    const prior = await effectiveDecisionForCase('SYN-005');
    expect(prior?.disposition).toBe('uphold');

    const partial = await recordDecision({
      caseId: 'SYN-005',
      caseVersion: caseRecord.version,
      runId: prior?.runId ?? null,
      taskId: null,
      source: 'reviewer',
      disposition: 'partial_refund',
      targetRefundCents: 200,
      evidenceIds: [],
      policyIds: [],
      policyVersion: '1.0.0',
      explanation: 'Reviewer recorded a partial refund on review.',
      differenceFromRecommendation: 'Part of the surcharge was not justified.',
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: prior?.id ?? null,
      chargeRef,
    });
    const { settlement: partialSettlement } = await postSettlement({ caseRecord, decision: partial });
    expect(partialSettlement.deltaRefundCents).toBe(200);
    expect(await postedRefundCents(chargeRef)).toBe(200);

    // Raising a partial refund to the full charge posts only the extra 300.
    const raised = await recordDecision({
      caseId: 'SYN-005',
      caseVersion: caseRecord.version,
      runId: prior?.runId ?? null,
      taskId: null,
      source: 'reviewer',
      disposition: 'refund',
      targetRefundCents: 500,
      evidenceIds: [],
      policyIds: [],
      policyVersion: '1.0.0',
      explanation: 'On appeal the reviewer refunded the whole disputed fare.',
      differenceFromRecommendation: 'The full fare was refunded instead of part of it.',
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: partial.id,
      chargeRef,
    });
    const { settlement: raisedSettlement } = await postSettlement({ caseRecord, decision: raised });

    expect(raisedSettlement.deltaRefundCents).toBe(300);
    expect(raisedSettlement.retainedCents).toBe(0);
    expect(await postedRefundCents(chargeRef)).toBe(500);

    const effective = await effectiveDecisionForCase('SYN-005');
    expect(effective?.id).toBe(raised.id);
    // The original decision is preserved, not deleted.
    expect(effective?.supersedesDecisionId).toBe(partial.id);
  });

  it('finishes a settlement left unfinished for an existing decision', async () => {
    const caseRecord = (await getCase('SYN-004'))!;
    const chargeRef = chargeRefFor(caseRecord);

    // A decision recorded without a settlement, which is what a posting
    // interrupted before its record was written would leave behind.
    await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'refund',
      targetRefundCents: caseRecord.disputedCents,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Recorded before the settlement could be posted.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: null,
      chargeRef,
    });
    expect(await listSettlementsForCase('SYN-004')).toHaveLength(0);

    const run = await analyse('SYN-004', 'wb-recover-1');
    expect(run.state).toBe('completed');

    // Completion repairs the posting rather than stopping at "a decision exists".
    const settlements = await listSettlementsForCase('SYN-004');
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.status).toBe('posted');
    expect(await postedRefundCents(chargeRef)).toBe(caseRecord.disputedCents);
  });

  it('flags a negative adjustment instead of silently recharging', async () => {
    const caseRecord = (await getCase('SYN-001'))!;
    const chargeRef = chargeRefFor(caseRecord);
    const prior = await effectiveDecisionForCase('SYN-001');

    const lower = await recordDecision({
      caseId: 'SYN-001',
      caseVersion: 1,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'partial_refund',
      targetRefundCents: 100,
      evidenceIds: [],
      policyIds: [],
      policyVersion: '1.0.0',
      explanation: 'Reviewer reduced the refund below what was already posted.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: prior?.id ?? null,
      chargeRef,
    });

    const { settlement } = await postSettlement({ caseRecord, decision: lower });

    expect(settlement.status).toBe('manual_adjustment_required');
    expect(settlement.ledgerEntryIds).toHaveLength(0);
    expect(settlement.deltaRefundCents).toBe(0);
    expect(settlement.failureReason).toBeTruthy();
  });

  it('refuses to settle a closure made without a liability ruling', async () => {
    const caseRecord = (await getCase('DISP-002'))!;
    const decision = await recordDecision({
      caseId: 'DISP-002',
      caseVersion: 1,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'insufficient_evidence',
      targetRefundCents: null,
      evidenceIds: [],
      policyIds: [],
      policyVersion: '1.0.0',
      explanation: 'The evidence cannot establish which waiting clock governs.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: null,
      chargeRef: chargeRefFor(caseRecord),
    });

    await expect(postSettlement({ caseRecord, decision })).rejects.toThrow(/no financial ruling/i);
  });
});

describe('review task concurrency and status', () => {
  it('rejects a stale task revision', async () => {
    const tasks = await listReviewTasksForCase('SYN-003');
    const task = tasks.find((entry) => entry.status !== 'decided')!;

    const updated = await updateReviewTask(task.id, task.revision, (current) => ({
      ...current,
      status: 'assigned',
      assigneeId: 'reviewer_demo_01',
    }));
    expect(updated.revision).toBe(task.revision + 1);

    await expect(
      updateReviewTask(task.id, task.revision, (current) => ({ ...current, status: 'ready' })),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it('derives business status from the decision, not the run state', () => {
    // A completed analysis with no decision is not "settled".
    expect(
      deriveCaseStatus({
        runState: 'completed',
        tasks: [],
        effectiveDecision: null,
        settlements: [],
        hasOpenAppeal: false,
      }),
    ).toBe('open');

    expect(
      deriveCaseStatus({
        runState: 'completed',
        tasks: [],
        effectiveDecision: { disposition: 'refund' } as never,
        settlements: [{ status: 'posted' } as never],
        hasOpenAppeal: false,
      }),
    ).toBe('settled');

    expect(
      deriveCaseStatus({
        runState: 'completed',
        tasks: [],
        effectiveDecision: { disposition: 'refund' } as never,
        settlements: [{ status: 'manual_adjustment_required' } as never],
        hasOpenAppeal: false,
      }),
    ).toBe('settlement_failed');

    expect(
      deriveCaseStatus({
        runState: 'completed',
        tasks: [{ status: 'awaiting_evidence' } as never],
        effectiveDecision: null,
        settlements: [],
        hasOpenAppeal: false,
      }),
    ).toBe('awaiting_evidence');

    expect(
      deriveCaseStatus({
        runState: 'completed',
        tasks: [{ status: 'queued' } as never],
        effectiveDecision: { disposition: 'refund' } as never,
        settlements: [{ status: 'posted' } as never],
        hasOpenAppeal: true,
      }),
    ).toBe('appeal_pending');

    expect(
      deriveCaseStatus({
        runState: 'completed',
        tasks: [],
        effectiveDecision: { disposition: 'insufficient_evidence' } as never,
        settlements: [],
        hasOpenAppeal: false,
      }),
    ).toBe('closed_unresolved');
  });
});
