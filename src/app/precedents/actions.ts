'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireReviewerRole } from '@/lib/demoSession';
import {
  DEMO_CURATOR_ID,
  approveCandidate,
  authorExample,
  rejectCandidate,
  rollbackPrecedent,
} from '@/lib/precedentCurator';

/**
 * Curator actions.
 *
 * These are the only paths by which a precedent changes status. Nothing here
 * runs automatically, and no action can make a correction retrievable without
 * the shadow-replay gate passing first — `approveCandidate` refuses on its own,
 * so the guard does not depend on this form doing the right thing.
 */

function stringField(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function notice(key: 'notice' | 'error', message: string): string {
  return `/precedents?${key}=${encodeURIComponent(message)}`;
}

export async function approvePrecedentAction(formData: FormData): Promise<void> {
  await requireReviewerRole();
  const precedentId = stringField(formData, 'precedentId');
  const note = stringField(formData, 'note');

  if (!note) {
    redirect(notice('error', 'Approving an example requires a note saying why it is sound.'));
  }

  let message = '';
  try {
    const result = await approveCandidate({ precedentId, curatorId: DEMO_CURATOR_ID, note });
    message = result.message;
  } catch (error) {
    redirect(notice('error', error instanceof Error ? error.message : 'The approval failed.'));
  }

  revalidatePath('/precedents');
  redirect(notice('notice', message));
}

export async function rejectPrecedentAction(formData: FormData): Promise<void> {
  await requireReviewerRole();
  const precedentId = stringField(formData, 'precedentId');
  const reason = stringField(formData, 'reason');

  if (!reason) {
    redirect(notice('error', 'Rejecting a candidate requires a reason.'));
  }

  let message = '';
  try {
    const result = await rejectCandidate({ precedentId, curatorId: DEMO_CURATOR_ID, reason });
    message = result.message;
  } catch (error) {
    redirect(notice('error', error instanceof Error ? error.message : 'The rejection failed.'));
  }

  revalidatePath('/precedents');
  redirect(notice('notice', message));
}

export async function rollbackPrecedentAction(formData: FormData): Promise<void> {
  await requireReviewerRole();
  const precedentId = stringField(formData, 'precedentId');
  const reason = stringField(formData, 'reason');

  if (!reason) {
    redirect(notice('error', 'A rollback requires a written reason.'));
  }

  let message = '';
  try {
    const result = await rollbackPrecedent({ precedentId, curatorId: DEMO_CURATOR_ID, reason });
    message = result.message;
  } catch (error) {
    redirect(notice('error', error instanceof Error ? error.message : 'The rollback failed.'));
  }

  revalidatePath('/precedents');
  redirect(notice('notice', message));
}

/**
 * Promotes a resolved case version into an example.
 *
 * The outcome is read from the engine's reading of that version, so this cannot
 * be used to publish an outcome the policy does not support. The new record
 * still has to clear the shadow-replay gate.
 */
export async function authorExampleAction(formData: FormData): Promise<void> {
  await requireReviewerRole();
  const caseId = stringField(formData, 'caseId');
  const caseVersion = Number(formData.get('caseVersion') ?? 0);
  const note = stringField(formData, 'note');

  if (!caseId || !Number.isInteger(caseVersion) || caseVersion < 1) {
    redirect(notice('error', 'Choose a case version to promote.'));
  }
  if (!note) {
    redirect(notice('error', 'Promoting a case as an example requires a note saying why.'));
  }

  let message = '';
  try {
    const result = await authorExample({
      caseId,
      caseVersion,
      note,
      curatorId: DEMO_CURATOR_ID,
    });
    message = result.message;
  } catch (error) {
    redirect(notice('error', error instanceof Error ? error.message : 'The promotion failed.'));
  }

  revalidatePath('/precedents');
  redirect(notice('notice', message));
}

