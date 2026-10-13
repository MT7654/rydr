'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePartyRole, getDemoRole } from '@/lib/demoSession';
import type { StructuredEvidenceResponse } from '@/domain/contracts';
import { decimalToCents } from '@/domain/money';
import { getCase } from '@/repositories/cases';
import { effectiveDecisionForCase } from '@/repositories/ledger';
import {
  createEvidenceRequest,
  ensureReviewTask,
  findOpenTask,
  getReviewTask,
  listEvidenceRequests,
  updateEvidenceRequest,
  updateReviewTask,
} from '@/repositories/reviewTasks';

/**
 * Party actions. These record local prototype state only: no email, SMS,
 * WhatsApp or push notification is sent, and no payment provider is contacted.
 */

function back(caseId: string, key: 'notice' | 'error', message: string, as?: string): string {
  const params = new URLSearchParams({ [key]: message });
  if (as) params.set('as', as);
  return `/cases/${caseId}/outcome?${params.toString()}`;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

export async function submitAppeal(formData: FormData): Promise<void> {
  const caseId = field(formData, 'caseId');
  const as = await requirePartyRole();
  const reason = field(formData, 'reason');
  const newEvidence = field(formData, 'newEvidence');
  const findingId = field(formData, 'findingId');
  const proposedCorrection = field(formData, 'proposedCorrection');
  const contestedSource = field(formData, 'contestedSource') || null;

  if (!reason) {
    redirect(back(caseId, 'error', 'An appeal needs a reason.', as));
  }

  const caseRecord = await getCase(caseId);
  if (!caseRecord) redirect(back(caseId, 'error', 'Unknown case.', as));

  const decision = await effectiveDecisionForCase(caseId);
  if (!decision) {
    redirect(back(caseId, 'error', 'There is no final decision to appeal yet.', as));
  }

  // One open appeal per case, so retrying the request returns the same task
  // rather than stacking duplicates.
  const existing = await findOpenTask(caseId, 'appeal');
  if (existing) {
    redirect(
      back(caseId, 'notice', 'An appeal is already open for this decision and is with a reviewer.', as),
    );
  }

    const matchedEvidence = findingId ? caseRecord.evidence.find((e) => e.id === findingId) : undefined;
    const findingText =
      matchedEvidence?.kind === 'trip_event'
        ? matchedEvidence.payload.details
        : matchedEvidence?.kind === 'chat' || matchedEvidence?.kind === 'call'
          ? matchedEvidence.payload.content
          : findingId;

    const challenge = findingId
    ? {
        findingId,
        findingText,
        proposedCorrection: proposedCorrection || reason,
        contestedSource,
        evidenceRequestId: null,
      }
    : undefined;

  await ensureReviewTask({
    caseId,
    caseVersion: decision.caseVersion,
    runId: decision.runId,
    kind: 'appeal',
    submittedBy: as,
    reasonCodes: ['party_appeal'],
    reasonSummary: `${as === 'driver' ? 'Driver' : 'Rider'} appeal against ${decision.id}: ${reason}`,
    openQuestions: newEvidence ? [`New evidence offered: ${newEvidence}`] : [],
    ...(challenge ? { challenge } : {}),
  });

  revalidatePath('/worklist');
  revalidatePath('/review-queue');
  revalidatePath(`/cases/${caseId}/outcome`);
  revalidatePath(`/rides?case=${caseId}`);
  revalidatePath('/rides');
  redirect(back(caseId, 'notice', 'Your appeal has been sent for review. Your current decision still applies.', as));
}

/**
 * Builds the optional structured part of a party response. Returns null when the
 * party only wrote a statement, which stays a claim.
 */
function structuredResponseFrom(
  formData: FormData,
  role: string,
  response: string,
): StructuredEvidenceResponse | null {
  const kind = field(formData, 'responseKind');

  if (kind === 'gps_accuracy') {
    const accuracy = Number(field(formData, 'accuracyMeters'));
    const sampleIds = formData
      .getAll('sampleIds')
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (!Number.isFinite(accuracy) || accuracy < 0) {
      redirect(
        back(
          field(formData, 'caseId'),
          'error',
          'Enter the accuracy radius in metres as a number of 0 or more.',
          role,
        ),
      );
    }
    if (sampleIds.length === 0) {
      redirect(
        back(field(formData, 'caseId'), 'error', 'Select at least one GPS sample to correct.', role),
      );
    }
    return {
      kind: 'gps_accuracy',
      sampleIds,
      accuracyMeters: accuracy,
      provenanceNote: response,
    };
  }

  if (kind === 'fare_ledger') {
    const components: { component: string; amountCents: number }[] = [];
    for (let index = 1; index <= 4; index += 1) {
      const name = field(formData, `ledgerComponent${index}`);
      const amount = field(formData, `ledgerAmount${index}`);
      if (!name || !amount) continue;
      const cents = decimalToCents(Number(amount));
      if (Number.isNaN(cents)) {
        redirect(
          back(
            field(formData, 'caseId'),
            'error',
            `Ledger line ${index} is not a valid amount.`,
            role,
          ),
        );
      }
      components.push({ component: name, amountCents: cents });
    }
    if (components.length === 0) {
      redirect(
        back(field(formData, 'caseId'), 'error', 'Add at least one ledger line with an amount.', role),
      );
    }
    return { kind: 'fare_ledger', components, provenanceNote: response };
  }

  return null;
}

export async function respondToEvidenceRequest(formData: FormData): Promise<void> {
  const caseId = field(formData, 'caseId');
  const taskId = field(formData, 'taskId');
  const requestId = field(formData, 'requestId');
  const as = await requirePartyRole();
  const role = as === 'driver' ? 'driver' : 'rider';
  const response = field(formData, 'response');

  if (!response) {
    redirect(back(caseId, 'error', 'Enter a response before submitting.', as));
  }

  const task = await getReviewTask(taskId);
  if (!task) redirect(back(caseId, 'error', 'Unknown review task.', as));

  const requests = await listEvidenceRequests(taskId);
  const target = requests.find((request) => request.id === requestId);
  if (!target || task.caseId !== caseId || target.caseId !== caseId || target.recipient !== role || target.status !== 'open') redirect(back(caseId, 'error', 'This request is not open for your role.', as));

  const structured = structuredResponseFrom(formData, role, response);

  // The written account is a claim; the structured part is a proposal that only
  // becomes case evidence when a reviewer accepts it.
  await updateEvidenceRequest(taskId, requestId, (request) => ({
    ...request,
    status: 'submitted',
    responseNote: response,
    structuredResponse: structured,
  }));

  if (task.status === 'awaiting_evidence') {
    await updateReviewTask(task.id, task.revision, (current) => ({ ...current, status: 'ready' }));
  }

  revalidatePath('/worklist');
  revalidatePath('/review-queue');
  revalidatePath(`/reviews/${taskId}`);
  revalidatePath(`/cases/${caseId}/outcome`);
  revalidatePath(`/rides?case=${caseId}`);
  revalidatePath('/rides');
  redirect(
    back(
      caseId,
      'notice',
      structured
        ? 'Response recorded. It stays a party statement until a reviewer accepts it into the case.'
        : 'Statement received. It is available to the reviewer but cannot replace verified telemetry or create an evidence version.',
      as,
    ),
  );
}

/** Used by the reviewer workspace to offer a platform-owned clarification. */
export async function offerPolicyClarification(formData: FormData): Promise<void> {
  if (await getDemoRole() !== 'reviewer') redirect('/');
  const taskId = field(formData, 'taskId');
  const caseId = field(formData, 'caseId');
  const note = field(formData, 'note');
  if (!note) redirect(`/reviews/${taskId}?error=${encodeURIComponent('A clarification needs text.')}`);

  await createEvidenceRequest({
    taskId,
    caseId,
    recipient: 'platform',
    question: 'Which rule governs this case?',
    evidenceType: 'policy_clarification',
    whyItMatters: note,
  });

  revalidatePath(`/reviews/${taskId}`);
  redirect(`/reviews/${taskId}?notice=${encodeURIComponent('Policy clarification recorded.')}`);
}

