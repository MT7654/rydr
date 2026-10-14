import type {
  CaseBusinessStatus,
  CaseDecision,
  EvidenceRequest,
  ReviewTask,
  RunState,
  Settlement,
} from './contracts';
import type { DemoRole } from './demoAccess';
import { CASE_STATUS_LABELS } from './caseStatus';
import { primaryReviewTask, reviewTaskLabel } from './navigation';

/**
 * Derived workspace state.
 *
 * A case's overall business status, the selected review task, the displayed
 * historical run and the actionable current state are **four separate
 * dimensions**. This module derives presentation state from authoritative server
 * data; it never stores a second business-status field and never lets one enum
 * overwrite another.
 *
 * Pure by design: no I/O, no environment, no repositories. The caller passes a
 * reduced snapshot of the case so the same derivation can be unit-tested for
 * every overlapping state in the spec's required-state list.
 */

export type WorkspaceSection =
  | 'brief'
  | 'assessment'
  | 'evidence'
  | 'decision'
  | 'outcome'
  | 'appeal'
  | 'history';

/** Server-owned allowlisted action identifiers. The UI never invents one. */
export type WorkspaceActionId =
  | 'run-assessment'
  | 'reassess'
  | 'review-response'
  | 'request-evidence'
  | 'make-decision'
  | 'review-appeal'
  | 'respond-to-request'
  | 'submit-appeal'
  | 'view-outcome'
  | 'view-brief'
  | 'view-payments'
  | 'return-to-current'
  | 'assessment-running'
  | 'await-party'
  | 'await-platform';

export interface WorkspaceAction {
  id: WorkspaceActionId;
  label: string;
  section: WorkspaceSection;
  enabled: boolean;
  disabledReason?: string;
  taskId?: string;
  requestId?: string;
  expectedCaseVersion: number;
  expectedTaskRevision?: number;
}

export type WorkspaceActor = DemoRole | 'platform';

export interface WorkspaceView {
  caseId: string;
  role: DemoRole;
  currentCaseVersion: number;
  displayedCaseVersion: number;
  selectedTaskId: string | null;
  historical: boolean;
  businessStatus: CaseBusinessStatus;
  stageLabel: string;
  nextActor: WorkspaceActor | null;
  nextActionExplanation: string;
  primaryAction: WorkspaceAction | null;
  secondaryActions: WorkspaceAction[];
}

/** Reduced, serializable input. A `CasePacket` maps onto this without copying. */
export interface WorkspaceInput {
  caseId: string;
  role: DemoRole;
  currentCaseVersion: number;
  displayedCaseVersion: number;
  /** True when the displayed version/run is a pinned historical one. */
  historical: boolean;
  status: CaseBusinessStatus;
  runState: RunState | null;
  /** True when a run exists for the displayed version. */
  hasRun: boolean;
  /** True when the displayed run predates the current case version. */
  runStaleAgainstCurrentVersion: boolean;
  /** True when the current case version has no run yet. */
  runMissingForCurrentVersion: boolean;
  tasks: ReviewTask[];
  selectedTaskId?: string | null;
  evidenceRequests: EvidenceRequest[];
  effectiveDecision: CaseDecision | null;
  /** Settlements belonging to the effective decision, newest last. */
  settlements: Settlement[];
  hasOpenAppeal: boolean;
}

export const OPEN_TASK_STATUSES = new Set<ReviewTask['status']>([
  'queued',
  'assigned',
  'awaiting_evidence',
  'ready',
]);

export function isOpenTask(task: ReviewTask): boolean {
  return OPEN_TASK_STATUSES.has(task.status);
}

/* ------------------------------------------------------------------ */
/*  Stage model                                                        */
/* ------------------------------------------------------------------ */

export const WORKSPACE_STAGES = ['Issue', 'Assessment', 'Evidence', 'Decision', 'Outcome'] as const;
export type WorkspaceStage = (typeof WORKSPACE_STAGES)[number];

export type StageState = 'done' | 'current' | 'upcoming' | 'skipped';

export interface StageProgress {
  stage: WorkspaceStage;
  state: StageState;
  detail: string;
}

/**
 * Local orientation, not a second navigation bar. Skipped/not-required stages
 * are shown accurately rather than pretending every case passed through them.
 */
export function stageProgress(input: {
  status: CaseBusinessStatus;
  hasDecision: boolean;
  hasAppeal: boolean;
  hasOpenEvidenceRequest: boolean;
}): StageProgress[] {
  const { status, hasAppeal, hasOpenEvidenceRequest } = input;
  const current: WorkspaceStage = (() => {
    switch (status) {
      case 'open':
        return 'Issue';
      case 'analyzing':
        return 'Assessment';
      case 'awaiting_evidence':
        return 'Evidence';
      case 'needs_review':
      case 'ready_for_decision':
        return hasOpenEvidenceRequest ? 'Evidence' : 'Decision';
      case 'appeal_pending':
        return 'Decision';
      case 'settlement_pending':
      case 'settled':
      case 'settlement_failed':
      case 'closed_unresolved':
        return 'Outcome';
      default:
        return 'Issue';
    }
  })();

  const order: WorkspaceStage[] = [...WORKSPACE_STAGES];
  const currentIndex = order.indexOf(current);

  return order.map((stage, index) => {
    if (stage === 'Evidence' && !hasOpenEvidenceRequest && index !== currentIndex) {
      // Evidence is genuinely not required for many cases; say so.
      return currentIndex < 2 ? { stage, state: 'upcoming' as StageState, detail: 'Not requested yet' } : { stage, state: 'skipped' as StageState, detail: 'Not needed for this decision' };
    }
    if (stage === 'Assessment' && index !== currentIndex && currentIndex > 1) {
      return { stage, state: 'done' as StageState, detail: 'Assessment recorded' };
    }
    if (index < currentIndex) return { stage, state: 'done' as StageState, detail: 'Complete' };
    if (index === currentIndex) {
      return {
        stage,
        state: 'current' as StageState,
        detail: stage === 'Decision' && hasAppeal ? 'Appeal review open' : 'In progress',
      };
    }
    return { stage, state: 'upcoming' as StageState, detail: 'Not yet reached' };
  });
}

export function stageLabelFor(status: CaseBusinessStatus, hasAppeal: boolean): string {
  if (hasAppeal && status === 'appeal_pending') return 'Appeal review';
  switch (status) {
    case 'open':
      return 'Issue reported';
    case 'analyzing':
      return 'Assessment running';
    case 'needs_review':
      return 'Needs review';
    case 'awaiting_evidence':
      return 'Waiting for evidence';
    case 'ready_for_decision':
      return 'Ready for decision';
    case 'settlement_pending':
      return 'Settlement pending';
    case 'settled':
      return 'Outcome recorded';
    case 'settlement_failed':
      return 'Settlement needs attention';
    case 'closed_unresolved':
      return 'Closed — unresolved';
    default:
      return CASE_STATUS_LABELS[status];
  }
}

/* ------------------------------------------------------------------ */
/*  Task selection                                                     */
/* ------------------------------------------------------------------ */

/**
 * One task selected for the header, the form and the Navigator. Reconciles the
 * `primaryReviewTask` priority ordering with the fact that `CasePacket.openTask`
 * picks the *last* open task, so the three can no longer disagree.
 *
 * An explicit, still-valid task id wins. Otherwise the highest-priority open
 * task is chosen — an active appeal ranks first.
 */
export function selectWorkspaceTask(
  tasks: ReviewTask[],
  explicitTaskId?: string | null,
): ReviewTask | null {
  if (explicitTaskId) {
    const explicit = tasks.find((task) => task.id === explicitTaskId);
    if (explicit) return explicit;
  }
  const open = tasks.filter(isOpenTask);
  if (open.length === 0) return null;
  return primaryReviewTask(open);
}

/** Every open task other than the selected one, for a task selector. */
export function otherOpenTasks(tasks: ReviewTask[], selectedTaskId: string | null): ReviewTask[] {
  return tasks.filter((task) => isOpenTask(task) && task.id !== selectedTaskId);
}

export function taskLabel(task: ReviewTask): string {
  return reviewTaskLabel(task.kind);
}

/* ------------------------------------------------------------------ */
/*  Derivation                                                         */
/* ------------------------------------------------------------------ */

function action(
  partial: Omit<WorkspaceAction, 'expectedCaseVersion'> & { expectedCaseVersion?: number },
  caseVersion: number,
): WorkspaceAction {
  return { ...partial, expectedCaseVersion: partial.expectedCaseVersion ?? caseVersion };
}

/**
 * Derives the workspace view for one viewer role.
 *
 * Role filtering happens here, before data reaches a client component: a party's
 * submitted response never grants that party a reviewer action, and a reviewer's
 * assessment/decision actions are never produced for a party.
 */
export function deriveWorkspaceView(input: WorkspaceInput): WorkspaceView {
  const {
    caseId,
    role,
    currentCaseVersion,
    displayedCaseVersion,
    historical,
    status,
    runState,
    hasRun,
    runStaleAgainstCurrentVersion,
    runMissingForCurrentVersion,
    tasks,
    evidenceRequests,
    effectiveDecision,
    settlements,
    hasOpenAppeal,
  } = input;

  const selected = selectWorkspaceTask(tasks, input.selectedTaskId);
  const selectedTaskId = selected?.id ?? null;
  const isReviewer = role === 'reviewer';
  const isParty = !isReviewer;
  const revision = selected?.revision;

  const openRequestForMe =
    isParty
      ? evidenceRequests.find(
          (request) => request.status === 'open' && request.recipient === role && tasks.some(t=>t.id===request.taskId&&isOpenTask(t)),
        ) ?? null
      : null;
  const openPlatformRequest =
    evidenceRequests.find((request) => request.status === 'open' && request.recipient === 'platform') ??
    null;
  const submittedResponse =
    evidenceRequests.find(
      (request) => request.status === 'submitted' && request.structuredResponse !== null,
    ) ??
    evidenceRequests.find((request) => request.status === 'submitted') ??
    null;

  const latestSettlement = settlements[settlements.length - 1] ?? null;
  const settlementNeedsAttention =
    latestSettlement?.status === 'failed' ||
    latestSettlement?.status === 'manual_adjustment_required' ||
    status === 'settlement_failed';

  const stageLabel = stageLabelFor(status, hasOpenAppeal);
  const primary: WorkspaceAction | null = (() => {
    // A pinned historical version is read-only. No mutation form targets it.
    if (historical) {
      return action(
        {
          id: 'return-to-current',
          label: `Return to current case (v${currentCaseVersion})`,
          section: 'brief',
          enabled: true,
        },
        currentCaseVersion,
      );
    }

    if (isParty) {
      if (openRequestForMe) {
        return action(
          {
            id: 'respond-to-request',
            label: 'Respond to request',
            section: 'evidence',
            enabled: true,
            taskId: openRequestForMe.taskId,
            requestId: openRequestForMe.id,
          },
          currentCaseVersion,
        );
      }
      if (effectiveDecision) {
        return action(
          { id: 'view-outcome', label: 'View your outcome', section: 'outcome', enabled: true },
          currentCaseVersion,
        );
      }
      return action(
        { id: 'view-brief', label: 'Track this case', section: 'brief', enabled: true },
        currentCaseVersion,
      );
    }

    // Reviewer. Running and stale assessments precede decision actions.
    if (runState && !['completed','escalated','failed'].includes(runState)) return action({id:'assessment-running',label:'Assessment in progress',section:'assessment',enabled:false,disabledReason:'Wait for the advocates and judge to finish.'}, currentCaseVersion);
    if (selected && isOpenTask(selected) && (runStaleAgainstCurrentVersion || runMissingForCurrentVersion)) return action({id:'reassess',label:'Assess updated evidence',section:'assessment',enabled:true,taskId:selected.id,expectedTaskRevision:revision}, currentCaseVersion);
    if (selected && isOpenTask(selected)) {
      if (selected.kind === 'appeal') {
        return action(
          {
            id: 'review-appeal',
            label: 'Review appeal',
            section: 'appeal',
            enabled: true,
            taskId: selected.id,
            expectedTaskRevision: revision,
          },
          currentCaseVersion,
        );
      }
      if (selected.status === 'awaiting_evidence') {
        const submitted = evidenceRequests.find(
          (request) => request.taskId === selected.id && request.status === 'submitted',
        );
        if (submitted) {
          return action(
            {
              id: 'review-response',
              label: 'Review the submitted response',
              section: 'evidence',
              enabled: true,
              taskId: selected.id,
              requestId: submitted.id,
              expectedTaskRevision: revision,
            },
            currentCaseVersion,
          );
        }
        return action(
          {
            id: 'await-party',
            label: 'Waiting for the requested record',
            section: 'evidence',
            enabled: false,
            disabledReason: 'Waiting for the requested source or party response.',
            taskId: selected.id,
            expectedTaskRevision: revision,
          },
          currentCaseVersion,
        );
      }
      if (selected.status === 'ready') {
        return action(
          {
            id: 'make-decision',
            label: 'Record a decision',
            section: 'decision',
            enabled: true,
            taskId: selected.id,
            expectedTaskRevision: revision,
          },
          currentCaseVersion,
        );
      }
      // queued / assigned
      return action(
        {
          id: 'make-decision',
          label: 'Assess and decide',
          section: 'decision',
          enabled: true,
          taskId: selected.id,
          expectedTaskRevision: revision,
        },
        currentCaseVersion,
      );
    }

    if (effectiveDecision) {
      // A recorded decision is the current state; re-assessing it is not the
      // next action unless the evidence has since changed.
      return action(
        { id: 'view-outcome', label: 'View recorded outcome', section: 'outcome', enabled: true },
        currentCaseVersion,
      );
    }
    if (runMissingForCurrentVersion || !hasRun) {
      return action(
        { id: 'run-assessment', label: 'Run assessment', section: 'assessment', enabled: true },
        currentCaseVersion,
      );
    }
    if (runStaleAgainstCurrentVersion) {
      return action(
        { id: 'reassess', label: 'Assess updated evidence', section: 'assessment', enabled: true },
        currentCaseVersion,
      );
    }
    return action(
      { id: 'run-assessment', label: 'Run assessment', section: 'assessment', enabled: true },
      currentCaseVersion,
    );
  })();

  const secondary: WorkspaceAction[] = [];
  if (isReviewer && !historical) {
    if (settlementNeedsAttention) {
      secondary.push(
        action(
          {
            id: 'view-payments',
            label: 'Settlement needs attention',
            section: 'outcome',
            enabled: true,
          },
          currentCaseVersion,
        ),
      );
    }
    if (openPlatformRequest) {
      secondary.push(
        action(
          {
            id: 'await-platform',
            label: 'Waiting on a platform record',
            section: 'evidence',
            enabled: false,
            disabledReason: 'A platform-owned record has been requested.',
            taskId: openPlatformRequest.taskId,
            requestId: openPlatformRequest.id,
          },
          currentCaseVersion,
        ),
      );
    }
    if (selected && !isOpenTask(selected)) {
      secondary.push(
        action(
          { id: 'view-brief', label: 'View case history', section: 'history', enabled: true },
          currentCaseVersion,
        ),
      );
    }
  } else if (isParty && !historical) {
    if (effectiveDecision && !hasOpenAppeal) secondary.push(action({id:'submit-appeal',label:'Appeal this decision',section:'appeal',enabled:true},currentCaseVersion));
    if (effectiveDecision) {
      secondary.push(
        action(
          { id: 'view-outcome', label: 'Your outcome', section: 'outcome', enabled: true },
          currentCaseVersion,
        ),
      );
    }
    secondary.push(
      action(
        { id: 'view-payments', label: 'Payments and recovery', section: 'outcome', enabled: true },
        currentCaseVersion,
      ),
    );
  }

  const { nextActor, explanation } = nextActorFor({
    evidenceRequests,
    role,
    historical,
    status,
    runState,
    hasRun,
    runMissingForCurrentVersion,
    runStaleAgainstCurrentVersion,
    selected,
    openRequestForMe,
    openPlatformRequest,
    submittedResponse,
    effectiveDecision,
    hasOpenAppeal,
    settlementNeedsAttention,
  });

  return {
    caseId,
    role,
    currentCaseVersion,
    displayedCaseVersion,
    selectedTaskId,
    historical,
    businessStatus: status,
    stageLabel,
    nextActor,
    nextActionExplanation: explanation,
    primaryAction: primary,
    secondaryActions: secondary,
  };
}

interface NextActorInput {
  evidenceRequests: EvidenceRequest[];
  role: DemoRole;
  historical: boolean;
  status: CaseBusinessStatus;
  runState: RunState | null;
  hasRun: boolean;
  runMissingForCurrentVersion: boolean;
  runStaleAgainstCurrentVersion: boolean;
  selected: ReviewTask | null;
  openRequestForMe: EvidenceRequest | null;
  openPlatformRequest: EvidenceRequest | null;
  submittedResponse: EvidenceRequest | null;
  effectiveDecision: CaseDecision | null;
  hasOpenAppeal: boolean;
  settlementNeedsAttention: boolean;
}

/**
 * Who acts next, and why. Waiting-for-source and waiting-for-party are modelled
 * distinctly: the rider is never shown as responsible for a platform record, and
 * a party assertion is never described as retrieved telemetry.
 */
function nextActorFor(input: NextActorInput): { nextActor: WorkspaceActor | null; explanation: string } {
  if (input.historical) {
    return {
      nextActor: null,
      explanation: 'This is a recorded historical version. Return to the current case to act.',
    };
  }
  if (input.runState && !['completed','escalated','failed'].includes(input.runState)) return {nextActor:'platform',explanation:'The assessment is running.'};
  if (input.openRequestForMe) return {nextActor:input.role,explanation:'A reviewer has requested your response.'};
  const pending = input.selected && isOpenTask(input.selected) ? input.evidenceRequests?.find(r=>r.taskId===input.selected!.id && r.status==='open') : null;
  const received = input.selected && isOpenTask(input.selected) ? input.evidenceRequests?.find(r=>r.taskId===input.selected!.id && r.status==='submitted') : null;
  if (received) return {nextActor:'reviewer',explanation:'A response has arrived. The reviewer must inspect it before deciding.'};
  if (pending) return {nextActor:pending.recipient,explanation:'Waiting for the requested ' + (pending.recipient==='platform' ? 'platform record.' : pending.recipient+' response.')};
  if (input.runStaleAgainstCurrentVersion || input.runMissingForCurrentVersion && input.hasRun) return {nextActor:'reviewer',explanation:'The case evidence changed. Assess the current version before recording a decision.'};
  if (input.hasOpenAppeal) {
    return { nextActor: 'reviewer', explanation: 'A reviewer is considering the open appeal. The current decision still applies.' };
  }
  if (input.openRequestForMe) {
    return {
      nextActor: input.role,
      explanation: 'A reviewer has asked you for a record. Your response is needed before the review can continue.',
    };
  }
  if (input.selected && isOpenTask(input.selected)) {
    if (input.selected.status === 'awaiting_evidence') {
      const recipient = input.selected.kind === 'appeal' ? 'the appealing party' : 'a party';
      return {
        nextActor: input.openPlatformRequest ? 'platform' : 'rider',
        explanation: input.openPlatformRequest
          ? 'A platform-owned record has been requested. The reviewer cannot decide until it arrives.'
          : `Waiting for ${recipient} to supply the requested record.`,
      };
    }
    if (input.selected.status === 'ready') {
      return { nextActor: 'reviewer', explanation: 'The requested evidence is in. A reviewer can record a decision.' };
    }
    return {
      nextActor: 'reviewer',
      explanation: `${taskLabel(input.selected)} is queued for a reviewer.`,
    };
  }
  if (input.effectiveDecision) {
    if (input.status === 'closed_unresolved') {
      return {
        nextActor: null,
        explanation: 'This case is closed without a ruling. No financial liability was determined by this ruling.',
      };
    }
    if (input.settlementNeedsAttention) {
      return {
        nextActor: 'platform',
        explanation: 'The decision is recorded but the simulated settlement needs attention.',
      };
    }
    return {
      nextActor: input.status === 'settlement_pending' ? 'platform' : null,
      explanation: input.status === 'settlement_pending' ? 'The decision is recorded. Settlement is pending; no completed payment is confirmed.' : 'A decision is recorded and the simulated settlement has been applied.',
    };
  }
  if (input.runMissingForCurrentVersion || !input.hasRun) {
    return { nextActor: 'reviewer', explanation: 'This case has not been assessed yet. A reviewer can start the assessment.' };
  }
  if (input.runStaleAgainstCurrentVersion) {
    return { nextActor: 'reviewer', explanation: 'The evidence changed after the last assessment. A reviewer can assess the updated version.' };
  }
  if (input.runState && !['completed', 'escalated', 'failed'].includes(input.runState)) {
    return { nextActor: 'platform', explanation: 'The assessment is running.' };
  }
  return { nextActor: 'reviewer', explanation: 'This case is waiting for a reviewer.' };
}
