import type { EvidenceRequest, ReviewTask } from './contracts';
import type { DemoRole } from './demoAccess';
import { isOpenTask, type WorkspaceView } from './workspace';

/**
 * Server-owned action registry.
 *
 * The Case Navigator selects an action **ID**; the application resolves that ID
 * to a UI target. The model never generates routes, JavaScript actions, amounts
 * or mutation requests. Only eligible targets are registered.
 *
 * Legacy `href` values are retained during migration so a v1 Navigator response
 * (which carries an action id, not a target) still resolves to a working link.
 */

export type ActionTarget =
  | { kind: 'source'; evidenceId: string }
  | { kind: 'policy'; policyId: string }
  | { kind: 'request-form'; taskId: string }
  | { kind: 'respond-form'; taskId: string; requestId: string }
  | { kind: 'response-review'; taskId: string; requestId: string }
  | { kind: 'decision-form'; taskId: string }
  | { kind: 'appeal-review'; taskId: string }
  | { kind: 'appeal-form' }
  | { kind: 'outcome' };

export type ActionSourceOwner = 'platform' | 'rider' | 'driver' | 'policy_owner' | 'reviewer';

export interface RegisteredAction {
  id: string;
  label: string;
  sourceOwner: ActionSourceOwner | null;
  findingIds: string[];
  target: ActionTarget;
  /** Kept for v1 compatibility and for plain server-rendered links. */
  href: string;
}

export interface RegistryInput {
  view: WorkspaceView;
  caseId: string;
  findings: { id: string; text: string; material?: boolean }[];
  evidenceIds: string[];
  policyIds: string[];
  tasks: ReviewTask[];
  evidenceRequests: EvidenceRequest[];
  /** Recipients a request-form action may target, from server rules. */
  permittedRecipients?: ('rider' | 'driver' | 'platform')[];
}

/** The section a target opens in, so a drawer/form can be deep-linked. */
export function targetSection(target: ActionTarget): string {
  switch (target.kind) {
    case 'source':
    case 'policy':
      return 'evidence';
    case 'request-form':
    case 'respond-form':
    case 'response-review':
      return 'evidence';
    case 'decision-form':
    case 'appeal-review':
      return 'decision';
    case 'appeal-form':
      return 'appeal';
    case 'outcome':
      return 'outcome';
  }
}

/** A hash fragment that scrolls to the mounted control for a target. */
export function targetAnchor(target: ActionTarget): string {
  switch (target.kind) {
    case 'source':
      return `#evidence-${target.evidenceId}`;
    case 'policy':
      return `#policy-${target.policyId}`;
    case 'request-form':
      return '#request-form';
    case 'respond-form':
      return '#respond-form';
    case 'response-review':
      return '#response-review';
    case 'decision-form':
      return '#decision-form';
    case 'appeal-review':
      return '#appeal-review';
    case 'appeal-form':
      return '#appeal-form';
    case 'outcome':
      return '#outcome';
  }
}

/** A hash fragment that scrolls to the mounted control for a workspace action. */
export function actionAnchor(actionId: string): string {
  switch (actionId) {
    case 'respond-to-request':
      return '#respond-form';
    case 'submit-appeal':
      return '#appeal-form';
    case 'review-appeal':
      return '#appeal-review';
    case 'make-decision':
      return '#decision-form';
    case 'review-response':
      return '#response-review';
    case 'run-assessment':
    case 'reassess':
      return '#assessment';
    case 'view-outcome':
      return '#outcome';
    case 'request-evidence':
      return '#request-form';
    default:
      return '';
  }
}

/** Canonical workspace href for a target, for the viewer role. */
export function targetHref(caseId: string, role: DemoRole, target: ActionTarget): string {
  const base = role === 'reviewer' ? `/cases/${caseId}` : `/rides?case=${caseId}`;
  const join = base.includes('?') ? '&' : '?';
  const task = 'taskId' in target ? '&task='+encodeURIComponent(target.taskId) : '';
  return `${base}${join}section=${targetSection(target)}${task}${targetAnchor(target)}`;
}

/**
 * Builds the allowlisted actions for the current workspace. The caller passes
 * only the context the viewer is authorized to see, so a party never receives a
 * reviewer action and never receives another party's private text.
 */
export function buildActionRegistry(input: RegistryInput): {
  actions: RegisteredAction[];
  byId: Record<string, RegisteredAction>;
} {
  const { view, caseId } = input;
  if (view.historical) return {actions:[],byId:{}};
  const actions: RegisteredAction[] = [];
  const findingIds = input.findings.map((finding) => finding.id);
  const permittedRecipients = input.permittedRecipients ?? ['rider', 'driver', 'platform'];

  const push = (action: RegisteredAction) => {
    if (!actions.some((existing) => existing.id === action.id)) actions.push(action);
  };

  const selected = input.tasks.find((task) => task.id === view.selectedTaskId) ?? null;

  if (view.role === 'reviewer') {
    // Evidence inspection is always allowed for a reviewer.
    for (const evidenceId of input.evidenceIds.slice(0, 15)) {
      push({
        id: `view-source:${evidenceId}`,
        label: 'Inspect this source record',
        sourceOwner: 'platform',
        findingIds,
        target: { kind: 'source', evidenceId },
        href: targetHref(caseId, view.role, { kind: 'source', evidenceId }),
      });
    }
    for (const policyId of input.policyIds.slice(0, 15)) {
      push({
        id: `view-policy:${policyId}`,
        label: 'Read the applicable rule',
        sourceOwner: 'policy_owner',
        findingIds,
        target: { kind: 'policy', policyId },
        href: targetHref(caseId, view.role, { kind: 'policy', policyId }),
      });
    }

    if (selected && isOpenTask(selected)) {
      if (selected.kind === 'appeal') {
        push({
          id: 'review-appeal',
          label: 'Review the appeal',
          sourceOwner: 'reviewer',
          findingIds,
          target: { kind: 'appeal-review', taskId: selected.id },
          href: targetHref(caseId, view.role, { kind: 'appeal-review', taskId: selected.id }),
        });
      } else {
        const submitted = input.evidenceRequests.find(
          (request) => request.taskId === selected.id && request.status === 'submitted',
        );
        if (submitted) {
          push({
            id: 'review-response',
            label: 'Review the submitted response',
            sourceOwner: 'reviewer',
            findingIds,
            target: {
              kind: 'response-review',
              taskId: selected.id,
              requestId: submitted.id,
            },
            href: targetHref(caseId, view.role, {
              kind: 'response-review',
              taskId: selected.id,
              requestId: submitted.id,
            }),
          });
        } else if (permittedRecipients.length > 0) {
          push({
            id: 'draft-request',
            label: 'Draft a targeted request',
            sourceOwner: 'reviewer',
            findingIds,
            target: { kind: 'request-form', taskId: selected.id },
            href: targetHref(caseId, view.role, { kind: 'request-form', taskId: selected.id }),
          });
        }
        push({
          id: 'make-decision',
          label: 'Record a decision',
          sourceOwner: 'reviewer',
          findingIds,
          target: { kind: 'decision-form', taskId: selected.id },
          href: targetHref(caseId, view.role, { kind: 'decision-form', taskId: selected.id }),
        });
      }
    }

    push({
      id: 'view-outcome',
      label: 'View the recorded outcome',
      sourceOwner: null,
      findingIds: [],
      target: { kind: 'outcome' },
      href: targetHref(caseId, view.role, { kind: 'outcome' }),
    });
  } else {
    const openRequest = input.evidenceRequests.find(
      (request) => request.status === 'open' && request.recipient === view.role,
    );
    if (openRequest) {
      push({
        id: 'respond-to-request',
        label: 'Open the response form',
        sourceOwner: view.role,
        findingIds,
        target: {
          kind: 'respond-form',
          taskId: openRequest.taskId,
          requestId: openRequest.id,
        },
        href: targetHref(caseId, view.role, {
          kind: 'respond-form',
          taskId: openRequest.taskId,
          requestId: openRequest.id,
        }),
      });
    }
    // A party may inspect sources visible to them, never a private record.
    for (const evidenceId of input.evidenceIds.slice(0, 15)) {
      push({
        id: `view-source:${evidenceId}`,
        label: 'Inspect this record',
        sourceOwner: 'platform',
        findingIds,
        target: { kind: 'source', evidenceId },
        href: targetHref(caseId, view.role, { kind: 'source', evidenceId }),
      });
    }
    push({
      id: 'view-outcome',
      label: 'View your outcome',
      sourceOwner: null,
      findingIds: [],
      target: { kind: 'outcome' },
      href: targetHref(caseId, view.role, { kind: 'outcome' }),
    });
    if (view.businessStatus === 'settled' || view.businessStatus === 'closed_unresolved') {
      push({
        id: 'start-appeal',
        label: 'Start an appeal',
        sourceOwner: view.role,
        findingIds,
        target: { kind: 'appeal-form' },
        href: targetHref(caseId, view.role, { kind: 'appeal-form' }),
      });
    }
  }

  const byId: Record<string, RegisteredAction> = {};
  for (const action of actions) byId[action.id] = action;
  return { actions, byId };
}

/**
 * State-specific starter prompts. Only prompts supported by the current context
 * are returned, and never more than three — no wall of generic suggestions.
 */
export function starterPrompts(input: {
  view: WorkspaceView;
  findings: { id: string; text: string; material?: boolean }[];
  tasks: ReviewTask[];
  evidenceRequests: EvidenceRequest[];
}): string[] {
  const { view } = input;
  const prompts: string[] = [];
  if (view.historical) return prompts;
  const selected = input.tasks.find((task) => task.id === view.selectedTaskId) ?? null;
  const hasUnresolved = input.findings.some((finding) => finding.material);

  if (selected?.kind === 'appeal' && (view.role==='reviewer' || selected.submittedBy===view.role)) {
    prompts.push('Compare the appeal with the original decision');
  }
  if (hasUnresolved) {
    prompts.push('Explain the main conflict');
  }
  if (input.evidenceRequests.some((request) => request.status === 'submitted')) {
    prompts.push('Explain what this response establishes');
  }
  if (view.role==='reviewer' && selected && isOpenTask(selected) && selected.status !== 'awaiting_evidence') {
    prompts.push('Draft a targeted request');
  }
  if (view.businessStatus === 'awaiting_evidence' || view.nextActor === 'platform') {
    prompts.push('What evidence would help?');
  }
  if (view.businessStatus === 'ready_for_decision' || view.businessStatus === 'needs_review') {
    prompts.push('Explain the relevant policy');
  }
  if (view.role !== 'reviewer' && (view.businessStatus === 'settled' || view.businessStatus === 'closed_unresolved')) {
    prompts.push('What can I do next?');
  }
  return prompts.slice(0, 3);
}
