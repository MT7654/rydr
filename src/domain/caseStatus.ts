import type {
  CaseBusinessStatus,
  CaseDecision,
  ReviewTask,
  RunState,
  Settlement,
} from './contracts';

/**
 * Business status is derived, never stored on the run. `run.completed` means the
 * three-agent analysis finished — it says nothing about whether the case was
 * settled, is waiting on a reviewer, or was closed unresolved.
 */
export interface CaseStatusInput {
  runState: RunState | null;
  tasks: ReviewTask[];
  effectiveDecision: CaseDecision | null;
  /** Settlements belonging to the effective decision, newest last. */
  settlements: Settlement[];
  hasOpenAppeal: boolean;
}

const OPEN_TASK_STATUSES = new Set(['queued', 'assigned', 'awaiting_evidence', 'ready']);

export function deriveCaseStatus(input: CaseStatusInput): CaseBusinessStatus {
  const { runState, tasks, effectiveDecision, settlements, hasOpenAppeal } = input;

  // An appeal sits on top of an already-decided case without erasing it.
  if (hasOpenAppeal) return 'appeal_pending';

  if (effectiveDecision) {
    if (effectiveDecision.disposition === 'insufficient_evidence') return 'closed_unresolved';

    const latest = settlements[settlements.length - 1];
    if (!latest) return 'settlement_pending';
    if (latest.status === 'posted') return 'settled';
    if (latest.status === 'failed' || latest.status === 'manual_adjustment_required') {
      return 'settlement_failed';
    }
    return 'settlement_pending';
  }

  const open = tasks.filter((task) => OPEN_TASK_STATUSES.has(task.status));
  const active = open[open.length - 1];
  if (active) {
    if (active.status === 'awaiting_evidence') return 'awaiting_evidence';
    if (active.status === 'ready') return 'ready_for_decision';
    return 'needs_review';
  }

  if (runState && runState !== 'completed' && runState !== 'escalated' && runState !== 'failed') {
    return 'analyzing';
  }
  if (runState === 'escalated') return 'needs_review';

  return 'open';
}

export const CASE_STATUS_LABELS: Record<CaseBusinessStatus, string> = {
  open: 'Open',
  analyzing: 'Analyzing',
  needs_review: 'Needs review',
  awaiting_evidence: 'Awaiting evidence',
  ready_for_decision: 'Ready for decision',
  settlement_pending: 'Settlement pending',
  settled: 'Settled (simulation)',
  settlement_failed: 'Settlement needs attention',
  appeal_pending: 'Appeal pending',
  closed_unresolved: 'Closed — unresolved',
};

/** Badge tone for the queue and case header. */
export function caseStatusTone(status: CaseBusinessStatus): 'success' | 'review' | 'danger' | 'neutral' {
  switch (status) {
    case 'settled':
      return 'success';
    case 'needs_review':
    case 'awaiting_evidence':
    case 'ready_for_decision':
    case 'appeal_pending':
      return 'review';
    case 'settlement_failed':
      return 'danger';
    default:
      return 'neutral';
  }
}
