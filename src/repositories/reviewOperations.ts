import type { CaseRecord, ReviewTask } from '../domain/contracts';
import { getCase } from './cases';
import { StaleRevisionError, getReviewTask, isOpenTask } from './reviewTasks';
import { withLock } from './store';

/**
 * Reviewer operations.
 *
 * Every reviewer action is a small transaction: validate, then write to several
 * stores (evidence requests, case versions, review tasks, decisions, ledger,
 * receipts). Those stores each have their own lock, but taking them one at a
 * time is not enough — a check performed outside a lock can be invalidated
 * before the write it guards, which is how a rejected stale submission could
 * still leave an evidence request behind.
 *
 * So a reviewer action takes one lock for its whole duration, keyed on the case.
 * Everything it reads and writes happens inside it.
 *
 * Lock ordering, to avoid deadlock:
 *
 *   review-operation:<caseId>   ← taken first, by reviewer actions only
 *     case:<caseId>
 *     review-task:<taskId>
 *     evidence-requests:<taskId>
 *     charge-settlement:<chargeRef>
 *     decision:<decisionId>
 *     ledger-charges
 *
 * Reviewer actions acquire the case operation lock before any of the others, and
 * no other code path acquires a store lock and then reaches back for the case
 * operation lock. The automatic completion path takes `charge-settlement`
 * directly without holding the case operation lock, which is a single edge in
 * one direction and cannot form a cycle.
 *
 * This is an in-process lock for one local demo process. It is not a distributed
 * lock and is not presented as one.
 */

export function withCaseOperation<T>(caseId: string, task: () => Promise<T>): Promise<T> {
  return withLock(`review-operation:${caseId}`, task);
}

export interface ReviewerOperation {
  task: ReviewTask;
  caseRecord: CaseRecord;
}

export interface LoadOperationInput {
  taskId: string;
  /** Revision the form was rendered with. Any change since then is stale. */
  expectedRevision: number;
  /** Reject when the task is already decided or closed unresolved. */
  requireOpen?: boolean;
  /**
   * Reject when the task's case version is not the case's current version.
   * Set for anything that decides liability or writes to the ledger.
   */
  requireCurrentCaseVersion?: boolean;
}

/**
 * Loads and validates everything a reviewer action depends on. Throws before the
 * caller has written anything, so a rejected action leaves no trace.
 */
export async function loadReviewerOperation(
  input: LoadOperationInput,
): Promise<ReviewerOperation> {
  const task = await getReviewTask(input.taskId);
  if (!task) throw new Error('Unknown review task.');

  if (task.revision !== input.expectedRevision) throw new StaleRevisionError(task.id);

  if (input.requireOpen && !isOpenTask(task)) {
    throw new Error(
      `This task is already ${task.status.replace(/_/g, ' ')} and cannot be actioned again. Reload the review queue.`,
    );
  }

  const caseRecord = await getCase(task.caseId);
  if (!caseRecord) throw new Error(`Unknown case ${task.caseId}.`);

  if (input.requireCurrentCaseVersion && task.caseVersion !== caseRecord.version) {
    throw new Error(
      `This task was raised against case v${task.caseVersion}, but the case is now v${caseRecord.version}. ` +
        'Re-run the review against the current version before deciding, so the decision cites the evidence it was actually made on.',
    );
  }

  return { task, caseRecord };
}
