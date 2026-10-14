'use server';



import { revalidatePath } from 'next/cache';

import { redirect } from 'next/navigation';

import { requireReviewerRole } from '@/lib/demoSession';

import {

  DEMO_REVIEWER_ID,

  DEMO_REVIEWER_NAME,

  type CaseDecision,

  type CaseRecord,

  type DecisionDisposition,

  type ReviewTask,

  type Settlement,

} from '@/domain/contracts';

import { decimalToCents, formatSgd } from '@/domain/money';

import { checkDecisionAmount } from '@/domain/settlement';

import { evaluateCase } from '@/domain/policy';

import { buildIntakeOutcome, type VerificationInput } from '@/agents/evidenceIntake';

import { beginRun } from '@/agents/orchestrator';

import { captureOverrideCandidate } from '@/lib/precedentCurator';

import { orchestratorConfig } from '@/lib/runtime';

import { appendCaseVersion, getPolicyPack } from '@/repositories/cases';

import { selectRunForCase } from '@/repositories/runs';

import {

  StaleRevisionError,

  createEvidenceRequest,

  getReviewTask,

  listEvidenceRequests,

  updateEvidenceRequest,

  updateReviewTask,

} from '@/repositories/reviewTasks';

import { loadReviewerOperation, withCaseOperation } from '@/repositories/reviewOperations';

import {

  chargeRefFor,

  effectiveDecisionForCase,

  postSettlement,

  recordDecision,

} from '@/repositories/ledger';



/**

 * Reviewer actions. Local prototype state only â€” no external support system,

 * payment provider or notification is contacted. Every decision requires a

 * reason, and a departure from the automated recommendation must say why.

 *

 * Each action runs as one serialized operation on the case: validation happens

 * inside the lock, before any write. See `reviewOperations.ts` for why.

 */



function noticeUrl(taskId: string, key: 'notice' | 'error', message: string): string {

  return `/reviews/${taskId}?${key}=${encodeURIComponent(message)}`;

}



function numberField(formData: FormData, name: string): number {

  return Number(formData.get(name) ?? 0);

}



function stringField(formData: FormData, name: string): string {

  return String(formData.get(name) ?? '').trim();

}



function fail(taskId: string, error: unknown): never {

  const message =

    error instanceof StaleRevisionError

      ? error.message

      : error instanceof Error

        ? error.message

        : 'The action could not be completed.';

  redirect(noticeUrl(taskId, 'error', message));

}



/** Reads just enough to find the case the operation must be serialized on. */

async function caseIdForTask(taskId: string): Promise<string> {

  const task = await getReviewTask(taskId);

  if (!task) throw new Error('Unknown review task.');

  return task.caseId;

}



/** Parses a currency field, distinguishing "empty" from "not a number". */

function parseRefundAmount(raw: string): number | null | 'invalid' {

  if (!raw) return null;

  const value = Number(raw);

  if (!Number.isFinite(value)) return 'invalid';

  return decimalToCents(value);

}



export async function assignTask(formData: FormData): Promise<void> {

  await requireReviewerRole();

  const taskId = stringField(formData, 'taskId');

  const revision = numberField(formData, 'revision');



  try {

    const caseId = await caseIdForTask(taskId);

    await withCaseOperation(caseId, async () => {

      await loadReviewerOperation({ taskId, expectedRevision: revision });

      await updateReviewTask(taskId, revision, (task) => ({

        ...task,

        status: task.status === 'queued' ? 'assigned' : task.status,

        assigneeId: DEMO_REVIEWER_ID,

      }));

    });

  } catch (error) {

    fail(taskId, error);

  }



  revalidatePath('/worklist');
  revalidatePath('/review-queue');

  revalidatePath(`/reviews/${taskId}`);

  redirect(noticeUrl(taskId, 'notice', 'Task assigned to you.'));

}



export async function requestEvidence(formData: FormData): Promise<void> {

  await requireReviewerRole();

  const taskId = stringField(formData, 'taskId');

  const revision = numberField(formData, 'revision');

  const question = stringField(formData, 'question');

  const evidenceType = stringField(formData, 'evidenceType');

  const whyItMatters = stringField(formData, 'whyItMatters');

  const recipient = stringField(formData, 'recipient') || 'platform';



  if (!question || !whyItMatters) {

    redirect(noticeUrl(taskId, 'error', 'An evidence request needs both a question and a reason.'));

  }



  try {

    const caseId = await caseIdForTask(taskId);

    await withCaseOperation(caseId, async () => {

      // Validate first: a stale submission must not leave an orphan request.

      const { task } = await loadReviewerOperation({

        taskId,

        expectedRevision: revision,

        requireOpen: true,

      });



      await createEvidenceRequest({

        taskId,

        caseId: task.caseId,

        recipient: recipient === 'rider' || recipient === 'driver' ? recipient : 'platform',

        question,

        evidenceType: evidenceType || 'unspecified',

        whyItMatters,

      });



      await updateReviewTask(taskId, revision, (current) => ({

        ...current,

        status: 'awaiting_evidence',

        assigneeId: current.assigneeId ?? DEMO_REVIEWER_ID,

      }));

    });

  } catch (error) {

    fail(taskId, error);

  }



  revalidatePath('/worklist');
  revalidatePath('/review-queue');

  revalidatePath(`/reviews/${taskId}`);

  redirect(noticeUrl(taskId, 'notice', 'Evidence requested. The case now waits on that response.'));

}



/**

 * Accepts a party's structured response into the case.

 *

 * This is the only path by which a party-supplied value becomes case evidence.

 * It creates a new immutable case version, so the version the original decision

 * was made against stays intact for history and can be compared against.

 *

 * Acceptance is not verification. The supplied value is always recorded as a

 * claim; only a reviewer who states a supporting source marks it verified, and

 * only a verified claim replaces the authoritative measurement.

 */

export async function acceptEvidenceResponse(formData: FormData): Promise<void> {

  await requireReviewerRole();

  const taskId = stringField(formData, 'taskId');

  const requestId = stringField(formData, 'requestId');

  const revision = numberField(formData, 'revision');

  const verificationStatus =

    stringField(formData, 'verificationStatus') === 'verified' ? 'verified' : 'unverified_claim';

  const verificationSource = stringField(formData, 'verificationSource');

  let caseId = '';



  if (verificationStatus === 'verified' && !verificationSource) {

    redirect(

      noticeUrl(

        taskId,

        'error',

        'Marking a supplied value as verified requires the source you checked it against.',

      ),

    );

  }



  try {

    caseId = await caseIdForTask(taskId);

    await withCaseOperation(caseId, async () => {

      // Validate before any write, so a stale form cannot append a case version.

      const { task, caseRecord } = await loadReviewerOperation({

        taskId,

        expectedRevision: revision,

        requireOpen: true,

      });



      const requests = await listEvidenceRequests(taskId);

      const target = requests.find((request) => request.id === requestId);

      if (!target) throw new Error('Unknown evidence request.');

      if (target.taskId !== taskId || target.caseId !== task.caseId) {

        throw new Error('That evidence request does not belong to this task.');

      }

      if (target.status !== 'submitted') {

        throw new Error('Only a submitted response can be accepted.');

      }

      if (!target.structuredResponse) {

        throw new Error(

          'That response is a written statement only. It cannot become case evidence, so record a decision instead.',

        );

      }



      const acceptedAt = new Date().toISOString();

      const verification: VerificationInput =

        verificationStatus === 'verified'

          ? {

              status: 'verified',

              source: verificationSource,

              verifiedBy: `${DEMO_REVIEWER_NAME} (${DEMO_REVIEWER_ID})`,

              verifiedAt: acceptedAt,

            }

          : {

              status: 'unverified_claim',

              source: null,

              verifiedBy: null,

              verifiedAt: null,

            };



      const outcome = buildIntakeOutcome(caseRecord, target.structuredResponse, {

        suppliedBy: target.recipient,

        requestId: target.id,

        acceptedBy: `${DEMO_REVIEWER_NAME} (${DEMO_REVIEWER_ID})`,

        acceptedAt,

        verification,

      });



      if (!outcome.ok) throw new Error(outcome.reason);



      const next = await appendCaseVersion(

        task.caseId,

        outcome.apply,

        `Accepted ${target.recipient} response to ${target.id}: ${outcome.changeSummary}`,

      );



      await updateEvidenceRequest(taskId, requestId, (request) => ({

        ...request,

        status: 'accepted',

        acceptedIntoCaseVersion: next.version,

        responseEvidenceIds: outcome.affectedEvidenceIds,

        responseVerification: outcome.verificationRecord,

      }));



      // The case has moved on. The task keeps pointing at the run it was raised

      // against, and the reviewer is offered an explicit re-run against v(next).

      await updateReviewTask(taskId, revision, (current) => ({

        ...current,

        status: 'ready',

      }));

    });

  } catch (error) {

    fail(taskId, error);

  }



  revalidatePath('/worklist');
  revalidatePath('/review-queue');

  revalidatePath(`/reviews/${taskId}`);

  if (caseId) revalidatePath(`/cases/${caseId}/outcome`);
  revalidatePath(`/rides?case=${caseId}`);
  revalidatePath('/rides');

  redirect(

    noticeUrl(

      taskId,

      'notice',

      verificationStatus === 'verified'

        ? 'Response accepted and marked verified. A new case version was created, and the review must be re-run against it.'

        : 'Response accepted as an unverified claim. A new case version was created, but the claim does not change the authoritative measurement until someone verifies it against a source.',

    ),

  );

}



/**

 * Explicitly re-runs the three-role review against the case's current version.

 *

 * Never triggered automatically: every accepted upload or edit leaves this to a

 * person, so a run is only billed when someone asks for it. Uses the same

 * configured per-run and per-session call caps as any other run.

 */

export async function rerunTaskReview(formData: FormData): Promise<void> {

  await requireReviewerRole();

  const taskId = stringField(formData, 'taskId');

  const revision = numberField(formData, 'revision');

  const mode = stringField(formData, 'mode') === 'live' ? 'live' : 'fixture';



  let runId: string | null = null;

  try {

    const caseId = await caseIdForTask(taskId);

    await withCaseOperation(caseId, async () => {

      // Validated inside the lock and before `beginRun`, so a stale re-run

      // button consumes no provider call.

      const { task, caseRecord } = await loadReviewerOperation({

        taskId,

        expectedRevision: revision,

        requireOpen: true,

      });



      // Explicit key per task, case version and mode: asking twice for the same

      // version and mode resolves to the same run instead of paying twice, while

      // a requested live run is never satisfied by an existing fixture run.

      const run = await beginRun(

        task.caseId,

        mode,

        orchestratorConfig(mode),

        `task-rerun:${taskId}:v${caseRecord.version}:${mode}`,

      );

      runId = run.id;



      await updateReviewTask(taskId, revision, (current) => ({

        ...current,

        caseVersion: caseRecord.version,

        runId: run.id,

        status: 'ready',

      }));

    });

  } catch (error) {

    fail(taskId, error);

  }



  revalidatePath('/worklist');
  revalidatePath('/review-queue');

  revalidatePath(`/reviews/${taskId}`);

  redirect(

    noticeUrl(taskId, 'notice', `Re-review started against the current case version (run ${runId}).`),

  );

}



export async function closeUnresolved(formData: FormData): Promise<void> {

  await requireReviewerRole();

  const taskId = stringField(formData, 'taskId');

  const revision = numberField(formData, 'revision');

  const reason = stringField(formData, 'reason');



  if (!reason) {

    redirect(

      noticeUrl(taskId, 'error', 'Closing without a ruling still requires a written explanation.'),

    );

  }



  const notice = 'Closed as unresolved. No liability ruling and no settlement.';

  try {

    const caseId = await caseIdForTask(taskId);

    await withCaseOperation(caseId, async () => {

      const { task, caseRecord } = await loadReviewerOperation({

        taskId,

        expectedRevision: revision,

        requireOpen: true,

        requireCurrentCaseVersion: true,

      });



      await commitDecision({

        task,

        caseRecord,

        disposition: 'insufficient_evidence',

        targetRefundCents: null,

        reason,

        differenceFromRecommendation: null,

      });

    });

  } catch (error) {

    fail(taskId, error);

  }



  revalidatePath('/worklist');
  revalidatePath('/review-queue');

  revalidatePath(`/reviews/${taskId}`);

  redirect(noticeUrl(taskId, 'notice', notice));

}



export async function decideTask(formData: FormData): Promise<void> {

  await requireReviewerRole();

  const taskId = stringField(formData, 'taskId');

  const revision = numberField(formData, 'revision');

  let disposition = stringField(formData, 'disposition') as DecisionDisposition;

  const appealOutcome = stringField(formData, 'appealOutcome');

  const reason = stringField(formData, 'reason');

  const difference = stringField(formData, 'differenceFromRecommendation');

  const amountRaw = stringField(formData, 'targetRefund');



  const allowed: DecisionDisposition[] = ['refund', 'uphold', 'partial_refund'];

  if (appealOutcome !== 'reject' && !allowed.includes(disposition)) {

    redirect(noticeUrl(taskId, 'error', 'Choose a valid outcome.'));

  }

  if (!reason) {

    redirect(noticeUrl(taskId, 'error', 'A reviewer decision requires a written reason.'));

  }



  let parsedAmount = disposition === 'uphold' ? 0 : parseRefundAmount(amountRaw);

  if (appealOutcome !== 'reject' && parsedAmount === 'invalid') {

    redirect(noticeUrl(taskId, 'error', 'Enter the refund amount as a number, for example 5.00.'));

  }



  let notice = 'Decision recorded.';

  try {

    const caseId = await caseIdForTask(taskId);

    await withCaseOperation(caseId, async () => {

      const { task, caseRecord } = await loadReviewerOperation({

        taskId,

        expectedRevision: revision,

        requireOpen: true,

        requireCurrentCaseVersion: true,

      });



      if (appealOutcome && task.kind !== 'appeal') throw new Error('This is not an appeal task.');

      if (task.kind === 'appeal' && !['accept','reject'].includes(appealOutcome)) throw new Error('Choose whether to accept or reject the appeal.');

      if (appealOutcome === 'reject') {

        const prior = await effectiveDecisionForCase(task.caseId);

        if (!prior || prior.disposition === 'insufficient_evidence') throw new Error('There is no financial decision to confirm.');

        disposition = prior.disposition;

        parsedAmount = prior.targetRefundCents;

      }

      const selected = await selectRunForCase(task.caseId, {runId:task.runId, caseVersion:task.caseVersion});

      const recommended = selected.run?.resolution?.disposition;

      if (task.kind !== 'appeal' && recommended && ['refund','partial_refund','uphold'].includes(recommended) && disposition !== recommended && !difference) {

        throw new Error('You are departing from the automated recommendation, so record why.');

      }

      if (disposition === 'refund' && parsedAmount === null && appealOutcome !== 'reject') parsedAmount = caseRecord.disputedCents;
      if (parsedAmount === 'invalid') throw new Error('Enter a valid refund amount.');



      // The canonical charge is the case's disputed amount. The amount rule is

      // checked here and again inside the settlement service.

      const checked = checkDecisionAmount({

        disposition,

        targetRefundCents: parsedAmount,

        chargeCents: caseRecord.disputedCents,

      });

      if (!checked.ok) throw new Error(checked.reason);



      const result = await commitDecision({

        task,

        caseRecord,

        disposition,

        targetRefundCents: checked.targetRefundCents,

        reason: task.kind === 'appeal' ? `Appeal ${appealOutcome === 'reject' ? 'rejected' : 'accepted'}: ${reason}` : reason,

        differenceFromRecommendation: difference || null,

      });

      notice = settlementNotice(result.settlement);

      if (result.precedentNote) notice = `${notice} ${result.precedentNote}`;

    });

  } catch (error) {

    fail(taskId, error);

  }



  revalidatePath('/worklist');
  revalidatePath('/review-queue');

  revalidatePath(`/reviews/${taskId}`);

  revalidatePath('/');

  redirect(noticeUrl(taskId, 'notice', notice));

}



/** States what actually happened to the money, rather than assuming success. */

function settlementNotice(settlement: Settlement | null): string {

  if (!settlement) {

    return 'Decision recorded. No financial ruling was made, so no settlement was posted.';

  }

  switch (settlement.status) {

    case 'posted':

      return settlement.deltaRefundCents > 0

        ? `Decision recorded. Simulated refund of ${formatSgd(settlement.deltaRefundCents)} posted to the test ledger.`

        : 'Decision recorded. No further adjustment was owed, so the existing settlement stands unchanged.';

    case 'manual_adjustment_required':

      return `Decision recorded, but the settlement needs manual adjustment: ${settlement.failureReason ?? 'the target is below what was already posted.'}`;

    case 'pending':

      return 'Decision recorded. The simulated settlement is still being posted.';

    case 'failed':

      return `Decision recorded, but the simulated settlement failed: ${settlement.failureReason ?? 'unknown reason.'}`;

  }

}



/**

 * Re-posts the settlement for a decision that has none, or whose posting was

 * interrupted.

 *

 * This is the explicit recovery path the review asked for: a decision whose

 * settlement is `pending` or `failed` would otherwise sit half-finished with no

 * screen able to complete it. Safe to press repeatedly â€” `postSettlement` is

 * idempotent and resumes from the same stable entry and receipt ids.

 */

export async function retrySettlement(formData: FormData): Promise<void> {

  await requireReviewerRole();

  const taskId = stringField(formData, 'taskId');

  const revision = numberField(formData, 'revision');



  let notice = 'Nothing to do: this task has no decision that needs settling.';

  try {

    const caseId = await caseIdForTask(taskId);

    await withCaseOperation(caseId, async () => {

      // Deliberately not `requireOpen`: recovery applies to a decided task.

      const { task, caseRecord } = await loadReviewerOperation({

        taskId,

        expectedRevision: revision,

      });



      const decision = await effectiveDecisionForCase(task.caseId);

      if (!decision || decision.disposition === 'insufficient_evidence') return;



      const { settlement, recovered } = await postSettlement({ caseRecord, decision });

      notice =

        settlementNotice(settlement) +

        (recovered ? ' A previously unfinished posting was completed.' : '');

    });

  } catch (error) {

    fail(taskId, error);

  }



  revalidatePath('/worklist');
  revalidatePath('/review-queue');

  revalidatePath(`/reviews/${taskId}`);

  redirect(noticeUrl(taskId, 'notice', notice));

}



async function commitDecision(input: {

  task: ReviewTask;

  caseRecord: CaseRecord;

  disposition: DecisionDisposition;

  targetRefundCents: number | null;

  reason: string;

  differenceFromRecommendation: string | null;

}): Promise<{ decisionId: string; settlement: Settlement | null; precedentNote: string | null }> {

  const { task, caseRecord } = input;



  const selection = await selectRunForCase(task.caseId, {

    runId: task.runId,

    caseVersion: task.caseVersion,

  });

  const run = selection.run;

  const judge = run?.judge ?? null;

  const prior = await effectiveDecisionForCase(task.caseId);



  const decision = await recordDecision({

    caseId: task.caseId,

    caseVersion: task.caseVersion,

    runId: run?.id ?? null,

    taskId: task.id,

    source: 'reviewer',

    disposition: input.disposition,

    targetRefundCents: input.targetRefundCents,

    evidenceIds: judge?.materialEvidenceIds ?? [],

    policyIds: judge?.policyIds ?? [],

    policyVersion: run?.policyVersion ?? caseRecord.policyVersion,

    explanation: input.reason,

    differenceFromRecommendation: input.differenceFromRecommendation,

    reviewerId: DEMO_REVIEWER_ID,

    supersedesDecisionId: prior?.id ?? null,

    chargeRef: chargeRefFor(caseRecord),

  });



  // A closure without a liability ruling deliberately posts no settlement.

  const settlement =

    input.disposition === 'insufficient_evidence'

      ? null

      : (await postSettlement({ caseRecord, decision })).settlement;



  await updateReviewTask(task.id, task.revision, (current) => ({

    ...current,

    status: input.disposition === 'insufficient_evidence' ? 'closed_unresolved' : 'decided',

    linkedDecisionId: decision.id,

  }));



  const precedentNote = await capturePrecedent({

    caseRecord,

    decision,

    recommendation: run?.resolution ?? null,

    correctionReason: input.differenceFromRecommendation,

  });



  return { decisionId: decision.id, settlement, precedentNote };

}



/**

 * Turns a departure from the automated recommendation into an inert candidate.

 *

 * Deliberately best-effort and never fatal: the reviewer's decision has already

 * been recorded and settled, and a failure to file the learning must not make a

 * completed ruling look like it failed. The outcome is stated either way, so a

 * silent loss is impossible.

 */

async function capturePrecedent(input: {

  caseRecord: CaseRecord;

  decision: CaseDecision;

  recommendation: { disposition: string; recommendedRefundCents: number | null } | null;

  correctionReason: string | null;

}): Promise<string | null> {

  if (!input.correctionReason) return null;

  try {

    const pack = await getPolicyPack(input.caseRecord.policyVersion);

    const evaluation = evaluateCase(input.caseRecord, pack);

    const outcome = await captureOverrideCandidate({

      caseRecord: input.caseRecord,

      pack,

      evaluation,

      decision: input.decision,

      priorRecommendation: input.recommendation

        ? {

            disposition: input.recommendation.disposition,

            refundCents: input.recommendation.recommendedRefundCents,

          }

        : null,

      correctionReason: input.correctionReason,

      reviewerId: DEMO_REVIEWER_ID,

    });

    return outcome.candidate

      ? `${outcome.reason} Curate it under Precedents.`

      : outcome.reason;

  } catch (error) {

    return `The decision was recorded, but capturing a precedent candidate failed: ${

      error instanceof Error ? error.message : String(error)

    }`;

  }

}
