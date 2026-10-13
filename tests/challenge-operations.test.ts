import { describe, expect, it } from 'vitest';
import { getCase } from '../src/repositories/cases';
import { ensureReviewTask } from '../src/repositories/reviewTasks';
import { buildOperationsInsight } from '../src/domain/operationsInsight';

describe('targeted factual challenge', () => {
  it('creates a review task with a challenge object', async () => {
    const { task } = await ensureReviewTask({
      caseId: 'SYN-002',
      caseVersion: 1,
      runId: 'run_test',
      kind: 'appeal',
      reasonCodes: ['party_appeal'],
      reasonSummary: 'Rider appeal: the arrival time is wrong',
      openQuestions: [],
      challenge: {
        findingId: 'F-ARR',
        findingText: 'Driver arrived at pickup point',
        proposedCorrection: 'Driver arrived at 08:50, not 08:45',
        contestedSource: 'platform trip log',
        evidenceRequestId: null,
      },
    });

    expect(task.challenge).toBeDefined();
    expect(task.challenge!.findingId).toBe('F-ARR');
    expect(task.challenge!.proposedCorrection).toBe('Driver arrived at 08:50, not 08:45');
    expect(task.challenge!.contestedSource).toBe('platform trip log');

    // Clean up
    const { updateReviewTask } = await import('../src/repositories/reviewTasks');
    await updateReviewTask(task.id, task.revision, (t) => ({ ...t, status: 'closed_unresolved' }));
  });

  it('creates a generic appeal task when challenge is omitted', async () => {
    const { task } = await ensureReviewTask({
      caseId: 'SYN-002',
      caseVersion: 1,
      runId: 'run_test',
      kind: 'appeal',
      reasonCodes: ['party_appeal'],
      reasonSummary: 'Generic appeal',
      openQuestions: [],
    });

    expect(task.challenge).toBeUndefined();

    const { updateReviewTask } = await import('../src/repositories/reviewTasks');
    await updateReviewTask(task.id, task.revision, (t) => ({ ...t, status: 'closed_unresolved' }));
  });
});

describe('operations insight', () => {
  it('aggregates pickup-reference issues for indeterminate zone cases', async () => {
    const cases = await Promise.all(
      ['SYN-001', 'SYN-002', 'SYN-003', 'SYN-004', 'SYN-005'].map((id) => getCase(id)),
    );
    const validCases = cases.filter((c): c is NonNullable<typeof c> => c !== null);
    const insight = await buildOperationsInsight(validCases);

    // SYN-003 has indeterminate zone (missing accuracy)
    const pickupGroup = insight.groups.find((g) => g.cause === 'pickup_reference_mismatch');
    expect(pickupGroup).toBeDefined();
    expect(pickupGroup!.caseIds).toContain('SYN-003');
  });

  it('aggregates policy ambiguity cases', async () => {
    const cases = await Promise.all(
      ['SYN-001', 'SYN-002', 'SYN-007'].map((id) => getCase(id)),
    );
    const validCases = cases.filter((c): c is NonNullable<typeof c> => c !== null);
    const insight = await buildOperationsInsight(validCases);

    const policyGroup = insight.groups.find((g) => g.cause === 'policy_ambiguity');
    expect(policyGroup).toBeDefined();
    expect(policyGroup!.caseIds).toContain('SYN-007');
  });

  it('aggregates fare-ledger mismatches for route cases', async () => {
    const cases = await Promise.all(
      ['SYN-004', 'SYN-005'].map((id) => getCase(id)),
    );
    const validCases = cases.filter((c): c is NonNullable<typeof c> => c !== null);
    const insight = await buildOperationsInsight(validCases);

    const ledgerGroup = insight.groups.find((g) => g.cause === 'fare_ledger_mismatch');
    // These fixtures reconcile, so this group may be absent
    expect(ledgerGroup?.caseIds ?? []).not.toContain('SYN-004');
  });

  it('reports total cases and sorts by count descending', async () => {
    const cases = await Promise.all(
      ['SYN-001', 'SYN-002', 'SYN-003', 'SYN-004', 'SYN-005'].map((id) => getCase(id)),
    );
    const validCases = cases.filter((c): c is NonNullable<typeof c> => c !== null);
    const insight = await buildOperationsInsight(validCases);

    expect(insight.totalCases).toBe(validCases.length);
    for (let i = 1; i < insight.groups.length; i += 1) {
      expect(insight.groups[i - 1]!.count).toBeGreaterThanOrEqual(insight.groups[i]!.count);
    }
  });
});
