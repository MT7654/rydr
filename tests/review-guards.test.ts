import { describe, expect, it, vi } from 'vitest';

/**
 * Reviewer-operation guards.
 *
 * These exercise the server actions directly. Next's `redirect` is replaced with
 * a throw so the action's user-facing outcome can be asserted, and `revalidatePath`
 * is stubbed. Nothing else is mocked: the repositories, the lock and the
 * settlement service are the real ones, because the point of these tests is that
 * a rejected operation leaves no trace anywhere.
 */

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => ({ value: name === 'rydr-demo-role' ? 'reviewer' : '11111111-1111-4111-8111-111111111111' }) }) }));

const {
  acceptEvidenceResponse,
  closeUnresolved,
  decideTask,
  requestEvidence,
  rerunTaskReview,
} = await import('../src/app/reviews/actions');

const { appendCaseVersion, getCase } = await import('../src/repositories/cases');
const { ensureReviewTask, getReviewTask, listEvidenceRequests, updateReviewTask } = await import(
  '../src/repositories/reviewTasks'
);
const { listRuns } = await import('../src/repositories/runs');
const {
  chargeRefFor,
  effectiveDecisionForCase,
  listReceiptsForDecision,
  listSettlementsForCase,
  postSettlement,
  postedRefundCents,
  recordDecision,
} = await import('../src/repositories/ledger');
const { checkDecisionAmount } = await import('../src/domain/settlement');

/** Runs an action and returns the redirect URL it ended on. */
async function runAction(
  action: (formData: FormData) => Promise<void>,
  fields: Record<string, string>,
): Promise<string> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  try {
    await action(formData);
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error('The action completed without redirecting.');
}

function errorMessage(url: string): string | null {
  const match = /[?&]error=([^&]*)/.exec(url);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function seedTask(caseId: string, caseVersion = 1) {
  const { task } = await ensureReviewTask({
    caseId,
    caseVersion,
    runId: null,
    kind: 'automatic_escalation',
    reasonCodes: ['test_seed'],
    reasonSummary: 'Seeded for a guard test.',
    openQuestions: [],
  });
  return task;
}

describe('the amount rule itself', () => {
  const charge = 500;

  it('allows exactly the outcomes a dispute can have', () => {
    expect(checkDecisionAmount({ disposition: 'uphold', targetRefundCents: 0, chargeCents: charge }).ok).toBe(true);
    expect(checkDecisionAmount({ disposition: 'refund', targetRefundCents: 500, chargeCents: charge }).ok).toBe(true);
    expect(checkDecisionAmount({ disposition: 'partial_refund', targetRefundCents: 200, chargeCents: charge }).ok).toBe(true);
    expect(checkDecisionAmount({ disposition: 'insufficient_evidence', targetRefundCents: null, chargeCents: charge }).ok).toBe(true);
  });

  it('rejects a refund above the disputed charge', () => {
    const result = checkDecisionAmount({ disposition: 'refund', targetRefundCents: 700, chargeCents: charge });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('cannot exceed');
  });

  it('rejects non-finite and fractional amounts', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 200.5]) {
      const result = checkDecisionAmount({
        disposition: 'partial_refund',
        targetRefundCents: value,
        chargeCents: charge,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a full refund that is not the whole charge, and a partial that is', () => {
    expect(checkDecisionAmount({ disposition: 'refund', targetRefundCents: 300, chargeCents: charge }).ok).toBe(false);
    expect(checkDecisionAmount({ disposition: 'partial_refund', targetRefundCents: 500, chargeCents: charge }).ok).toBe(false);
    expect(checkDecisionAmount({ disposition: 'partial_refund', targetRefundCents: 0, chargeCents: charge }).ok).toBe(false);
  });

  it('rejects an uphold that refunds anything', () => {
    const result = checkDecisionAmount({ disposition: 'uphold', targetRefundCents: 100, chargeCents: charge });
    expect(result.ok).toBe(false);
  });
});

describe('the settlement service enforces the amount rule too', () => {
  it('refuses an overrefund and writes no settlement, entry or receipt', async () => {
    const caseRecord = (await getCase('SYN-001'))!;
    expect(caseRecord.disputedCents).toBe(500);
    const chargeRef = chargeRefFor(caseRecord);

    const decision = await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'refund',
      targetRefundCents: 700,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Overrefund attempt.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: null,
      chargeRef,
    });

    await expect(postSettlement({ caseRecord, decision })).rejects.toThrow(/cannot exceed/);

    expect(await listSettlementsForCase(caseRecord.id)).toHaveLength(0);
    expect(await postedRefundCents(chargeRef)).toBe(0);
    expect(await listReceiptsForDecision(decision.id)).toHaveLength(0);
  });
});

describe('stale submissions change nothing', () => {
  it('leaves no evidence request behind when the form is stale', async () => {
    const task = await seedTask('SYN-004');
    // Someone else moves the task on before this form is submitted.
    await updateReviewTask(task.id, task.revision, (current) => ({
      ...current,
      status: 'assigned',
      assigneeId: 'reviewer_demo_01',
    }));

    const url = await runAction(requestEvidence, {
      taskId: task.id,
      revision: String(task.revision),
      question: 'Was the detour approved?',
      evidenceType: 'detour_approval',
      whyItMatters: 'Approval would justify the deviation.',
      recipient: 'driver',
    });

    expect(errorMessage(url)).toMatch(/changed since it was loaded/);
    expect(await listEvidenceRequests(task.id)).toHaveLength(0);
  });

  it('leaves no case version behind when acceptance is stale', async () => {
    const task = await seedTask('SYN-004');
    const { createEvidenceRequest } = await import('../src/repositories/reviewTasks');
    const request = await createEvidenceRequest({
      taskId: task.id,
      caseId: task.caseId,
      recipient: 'driver',
      question: 'Provide the detour approval.',
      evidenceType: 'detour_approval',
      whyItMatters: 'It would justify the deviation.',
    });
    const { updateEvidenceRequest } = await import('../src/repositories/reviewTasks');
    await updateEvidenceRequest(task.id, request.id, (current) => ({
      ...current,
      status: 'submitted',
      structuredResponse: {
        kind: 'fare_ledger',
        components: [{ component: 'base_fare', amountCents: 100 }],
        provenanceNote: 'Supplied.',
      },
    }));

    const before = (await getCase('SYN-004'))!.version;
    await updateReviewTask(task.id, task.revision, (current) => ({
      ...current,
      status: 'assigned',
      assigneeId: 'reviewer_demo_01',
    }));

    const url = await runAction(acceptEvidenceResponse, {
      taskId: task.id,
      requestId: request.id,
      revision: String(task.revision),
      verificationStatus: 'verified',
      verificationSource: 'Ops export',
    });

    expect(errorMessage(url)).toMatch(/changed since it was loaded/);
    expect((await getCase('SYN-004'))!.version).toBe(before);
    const stored = (await listEvidenceRequests(task.id)).find((entry) => entry.id === request.id);
    expect(stored?.status).toBe('submitted');
  });

  it('consumes no provider call when a re-run is stale', async () => {
    const task = await seedTask('SYN-002');
    const before = (await listRuns('SYN-002')).length;

    await updateReviewTask(task.id, task.revision, (current) => ({
      ...current,
      status: 'assigned',
      assigneeId: 'reviewer_demo_01',
    }));

    const url = await runAction(rerunTaskReview, {
      taskId: task.id,
      revision: String(task.revision),
      mode: 'fixture',
    });

    expect(errorMessage(url)).toMatch(/changed since it was loaded/);
    expect((await listRuns('SYN-002')).length).toBe(before);
  });
});

describe('a task cannot decide a case that has moved on', () => {
  it('blocks a v1 decision against a v2 case and records nothing', async () => {
    const task = await seedTask('SYN-003', 1);
    expect(task.caseVersion).toBe(1);

    // Accepting evidence advances the case while the task stays on v1.
    const advanced = await appendCaseVersion(
      'SYN-003',
      (current) => ({ ...current, riderStatement: `${current.riderStatement} Late detail.` }),
      'Test: case advanced past the task.',
    );
    expect(advanced.version).toBe(2);

    const url = await runAction(decideTask, {
      taskId: task.id,
      revision: String(task.revision),
      disposition: 'refund',
      reason: 'Deciding on the stale form.',
      targetRefund: '5.00',
    });

    const message = errorMessage(url);
    expect(message).toMatch(/raised against case v1/);
    expect(message).toMatch(/now v2/);

    // No decision, no settlement, and the task is still open.
    expect(await effectiveDecisionForCase('SYN-003')).toBeNull();
    expect(await listSettlementsForCase('SYN-003')).toHaveLength(0);
    expect((await getReviewTask(task.id))?.status).toBe('queued');
  });

  it('refuses to close an already-decided task', async () => {
    const task = await seedTask('SYN-001');
    const decided = await runAction(decideTask, {
      taskId: task.id,
      revision: String(task.revision),
      disposition: 'uphold',
      reason: 'No refund is owed.',
    });
    expect(errorMessage(decided)).toBeNull();

    const after = await getReviewTask(task.id);
    expect(after?.status).toBe('decided');

    const url = await runAction(closeUnresolved, {
      taskId: task.id,
      revision: String(after!.revision),
      reason: 'Trying again.',
    });
    expect(errorMessage(url)).toMatch(/already decided/);
  });
});

describe('an unsettled decision has an explicit recovery path', () => {
  it('posts the missing settlement when the reviewer retries', async () => {
    const task = await seedTask('SYN-002');
    const caseRecord = (await getCase('SYN-002'))!;

    // A decision recorded but never settled â€” what a crashed posting leaves.
    await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: task.id,
      source: 'reviewer',
      disposition: 'refund',
      targetRefundCents: caseRecord.disputedCents,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Decision recorded without a settlement.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: null,
      chargeRef: chargeRefFor(caseRecord),
    });
    expect(await listSettlementsForCase('SYN-002')).toHaveLength(0);

    const { retrySettlement } = await import('../src/app/reviews/actions');
    const url = await runAction(retrySettlement, {
      taskId: task.id,
      revision: String(task.revision),
    });

    expect(errorMessage(url)).toBeNull();
    expect(url).toContain('posted');

    const settlements = await listSettlementsForCase('SYN-002');
    expect(settlements).toHaveLength(1);
    expect(settlements[0]!.status).toBe('posted');
    expect(await postedRefundCents(chargeRefFor(caseRecord))).toBe(caseRecord.disputedCents);
  });
});

describe('concurrent submissions produce one outcome', () => {
  it('records one decision and one settlement when the same form is submitted twice', async () => {
    const task = await seedTask('SYN-005');
    const chargeRef = chargeRefFor((await getCase('SYN-005'))!);

    const fields = {
      taskId: task.id,
      revision: String(task.revision),
      disposition: 'uphold',
      reason: 'The surcharge was justified.',
    };

    const [first, second] = await Promise.all([
      runAction(decideTask, fields),
      runAction(decideTask, fields),
    ]);

    const errors = [first, second].map(errorMessage);
    expect(errors.filter((message) => message === null)).toHaveLength(1);
    expect(errors.filter((message) => message !== null)).toHaveLength(1);
    expect(errors.find((message) => message !== null)).toMatch(/changed since it was loaded/);

    const decisions = await listSettlementsForCase('SYN-005');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.idempotencyKey).toBe(
      `${chargeRef}:${(await effectiveDecisionForCase('SYN-005'))!.id}`,
    );
    expect(await postedRefundCents(chargeRef)).toBe(0);
  });
});


describe('human handoff and party appeal completion', () => {
  it('does not treat a human-review handoff as a financial recommendation', async () => {
    const { withStorageSession } = await import('../src/repositories/store');
    const { randomUUID } = await import('node:crypto');
    const { startRun, DEFAULT_CONFIG } = await import('../src/agents/orchestrator');
    const { createFixtureProvider } = await import('../src/providers/fixture');
    const { listReviewTasksForCase } = await import('../src/repositories/reviewTasks');
    await withStorageSession(randomUUID(), async () => {
      await startRun('DISP-002','fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider()},randomUUID());
      const task=(await listReviewTasksForCase('DISP-002'))[0]!;
      const url=await runAction(decideTask,{taskId:task.id,revision:String(task.revision),disposition:'refund',targetRefund:'5.00',reason:'The waiting threshold was not established.',recommendedDisposition:'human_review'});
      expect(errorMessage(url)).toBeNull();
      expect((await effectiveDecisionForCase('DISP-002'))?.disposition).toBe('refund');
    });
  });
  it.each(['rider','driver'] as const)('resolves %s appeals by rejecting or accepting with one reason', async party => {
    const { withStorageSession } = await import('../src/repositories/store');
    const { randomUUID } = await import('node:crypto');
    for (const outcome of ['accept','reject']) await withStorageSession(randomUUID(),async()=>{
      const c=(await getCase('SYN-001'))!;
      const initial=await recordDecision({caseId:c.id,caseVersion:c.version,runId:null,taskId:null,source:'ai',disposition:'uphold',targetRefundCents:0,evidenceIds:[],policyIds:[],policyVersion:c.policyVersion,explanation:'Original decision',differenceFromRecommendation:null,reviewerId:null,supersedesDecisionId:null,chargeRef:chargeRefFor(c)});
      await postSettlement({caseRecord:c,decision:initial});
      const {task}=await ensureReviewTask({caseId:c.id,caseVersion:c.version,runId:null,kind:'appeal',submittedBy:party,reasonCodes:['party_appeal'],reasonSummary:`${party} appeal: reconsider the record.`});
      const url=await runAction(decideTask,{taskId:task.id,revision:String(task.revision),appealOutcome:outcome,disposition:'refund',targetRefund:'5.00',reason:'Evidence reviewed for the appeal.'});
      expect(errorMessage(url)).toBeNull();
      const decision=await effectiveDecisionForCase(c.id);
      expect(decision?.disposition).toBe(outcome==='accept'?'refund':'uphold');
      expect(decision?.explanation).toContain(`Appeal ${outcome==='accept'?'accepted':'rejected'}`);
      expect((await getReviewTask(task.id))?.status).toBe('decided');
      expect(decision?.supersedesDecisionId).toBe(initial.id);
      expect(await postedRefundCents(chargeRefFor(c))).toBe(outcome==='accept'?500:0);
    });
  });
});
