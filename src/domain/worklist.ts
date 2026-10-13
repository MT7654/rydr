import type {
  CaseBusinessStatus,
  Category,
  Provenance,
  ReviewTaskKind,
} from './contracts';
import type { CasePacket } from '@/lib/casePacket';
import { compareQueueEntries, type QueueLane } from './routing';
import { isOpenTask, selectWorkspaceTask, type WorkspaceActor } from './workspace';
import { deriveWorkspaceView } from './workspace';

/**
 * Reviewer Worklist.
 *
 * One case-oriented list that unifies the case catalogue and the review-task
 * queue. A case with several open tasks appears **once**; the extra tasks are
 * reachable from a task selector inside the case. Filters are defined from
 * domain state and may overlap (a case can have both an appeal and financial
 * attention). Counts are of cases, not tasks.
 */

export type WorklistFilter =
  | 'all'
  | 'needs_assessment'
  | 'needs_decision'
  | 'waiting_evidence'
  | 'appeals'
  | 'payment_attention'
  | 'closed';

export const WORKLIST_FILTERS: readonly {
  key: WorklistFilter;
  label: string;
  description: string;
}[] = [
  { key: 'all', label: 'All', description: 'Every case in this session.' },
  {
    key: 'needs_assessment',
    label: 'Needs assessment',
    description: 'Cases with no assessment recorded for the current case version.',
  },
  {
    key: 'needs_decision',
    label: 'Needs decision',
    description: 'A reviewer can record a decision — an open task is ready, or a case is unassessed.',
  },
  {
    key: 'waiting_evidence',
    label: 'Waiting for evidence',
    description: 'A party or platform record has been requested and has not arrived.',
  },
  { key: 'appeals', label: 'Appeals', description: 'An appeal is open and awaiting a reviewer.' },
  {
    key: 'payment_attention',
    label: 'Payment attention',
    description: 'The simulated settlement failed or needs a manual adjustment.',
  },
  {
    key: 'closed',
    label: 'Closed',
    description: 'Settled, or closed without a ruling.',
  },
] as const;

export function parseWorklistFilter(value: string | undefined): WorklistFilter {
  return WORKLIST_FILTERS.some((entry) => entry.key === value)
    ? (value as WorklistFilter)
    : 'all';
}

export interface WorklistSummary {
  caseId: string;
  caseVersion: number;
  category: Category;
  disputedCents: number;
  provenance: Provenance;
  status: CaseBusinessStatus;
  /** Human-readable issue label, not a backend id. */
  issueLabel: string;
  nextActor: WorkspaceActor | null;
  stageLabel: string;
  primaryActionLabel: string;
  openTaskCount: number;
  openTaskKinds: ReviewTaskKind[];
  selectedTaskId: string | null;
  hasAppeal: boolean;
  settlementNeedsAttention: boolean;
  needsAssessment: boolean;
  needsDecision: boolean;
  waitingEvidence: boolean;
  closed: boolean;
  lane: QueueLane | null;
  dueAt: string | null;
  /** Number of task lanes the case sits in, for the multi-task indicator. */
  provenanceNote: string;
}

const CATEGORY_LABELS: Record<Category, string> = {
  no_show_charge: 'No-show / cancellation charge',
  route_overcharge: 'Route deviation / overcharge',
  fare_dispute: 'Fare / surge-price dispute',
  damage: 'Damage charge',
};

export function issueLabelFor(category: Category): string {
  return CATEGORY_LABELS[category];
}

export function provenanceLabel(provenance: Provenance): string {
  return provenance === 'supplied_sample' ? 'Supplied sample' : 'Synthetic sample';
}

/** Builds one worklist row from a loaded case packet. */
export function summarizeCase(packet: CasePacket): WorklistSummary {
  const openTasks = packet.tasks.filter(isOpenTask);
  const selected = selectWorkspaceTask(packet.tasks, null);

  const view = deriveWorkspaceView({
    caseId: packet.caseRecord.id,
    role: 'reviewer',
    currentCaseVersion: packet.currentCaseVersion,
    displayedCaseVersion: packet.caseRecord.version,
    historical: false,
    status: packet.status,
    runState: packet.run?.state ?? null,
    hasRun: Boolean(packet.run),
    runStaleAgainstCurrentVersion: packet.runStaleAgainstCurrentVersion,
    runMissingForCurrentVersion: packet.runStaleAgainstCurrentVersion,
    tasks: packet.tasks,
    selectedTaskId: selected?.id ?? null,
    evidenceRequests: packet.evidenceRequests,
    effectiveDecision: packet.effectiveDecision,
    settlements: packet.settlements,
    hasOpenAppeal: packet.hasOpenAppeal,
  });

  const latestSettlement = packet.settlements[packet.settlements.length - 1] ?? null;
  const settlementNeedsAttention =
    latestSettlement?.status === 'failed' ||
    latestSettlement?.status === 'manual_adjustment_required' ||
    packet.status === 'settlement_failed';

  const needsAssessment = !packet.effectiveDecision && (packet.runStaleAgainstCurrentVersion || !packet.run);
  const waitingEvidence =
    packet.status === 'awaiting_evidence' ||
    packet.evidenceRequests.some((request) => request.status === 'open');
  const needsDecision =
    !needsAssessment && packet.status !== 'analyzing' && openTasks.some(task => task.status === 'ready' || task.status === 'queued' || task.status === 'assigned') && !waitingEvidence;
  const closed =
    packet.status === 'settled' ||
    packet.status === 'closed_unresolved' ||
    false;

  const routing = selected?.routing;
  const dueAt =
    routing?.dueAt ??
    (openTasks.length > 0
      ? openTasks[0]?.createdAt ?? null
      : null);

  return {
    caseId: packet.caseRecord.id,
    caseVersion: packet.caseRecord.version,
    category: packet.caseRecord.category,
    disputedCents: packet.caseRecord.disputedCents,
    provenance: packet.caseRecord.provenance,
    status: packet.status,
    issueLabel: CATEGORY_LABELS[packet.caseRecord.category],
    nextActor: view.nextActor,
    stageLabel: view.stageLabel,
    primaryActionLabel: view.primaryAction?.label ?? 'Open case',
    openTaskCount: openTasks.length,
    openTaskKinds: openTasks.map((task) => task.kind),
    selectedTaskId: selected?.id ?? null,
    hasAppeal: packet.hasOpenAppeal,
    settlementNeedsAttention,
    needsAssessment,
    needsDecision,
    waitingEvidence,
    closed,
    lane: routing?.lane ?? null,
    dueAt,
    provenanceNote: provenanceLabel(packet.caseRecord.provenance),
  };
}

export function matchesWorklistFilter(summary: WorklistSummary, filter: WorklistFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_assessment':
      return summary.needsAssessment;
    case 'needs_decision':
      return summary.needsDecision;
    case 'waiting_evidence':
      return summary.waitingEvidence;
    case 'appeals':
      return summary.hasAppeal;
    case 'payment_attention':
      return summary.settlementNeedsAttention;
    case 'closed':
      return summary.closed;
  }
}

export function worklistCounts(summaries: WorklistSummary[]): Record<WorklistFilter, number> {
  const counts = {} as Record<WorklistFilter, number>;
  for (const { key } of WORKLIST_FILTERS) {
    counts[key] = summaries.filter((summary) => matchesWorklistFilter(summary, key)).length;
  }
  return counts;
}

const LANE_RANK: Record<QueueLane, number> = {
  safety: 0,
  integrity: 1,
  high_value: 2,
  standard: 3,
};

/**
 * Operational ordering. Safety is never behind anything. Within that, overdue
 * work outranks fresh work, then lanes order, then the nearest deadline. Cases
 * with no task yet sit after queued work but stay visible.
 */
export function compareWorklistSummaries(
  a: WorklistSummary,
  b: WorklistSummary,
  now: number,
): number {
  if ((a.lane==='safety') !== (b.lane==='safety')) return a.lane==='safety' ? -1 : 1;
  const aOverdue = a.dueAt ? Date.parse(a.dueAt) <= now : false;
  const bOverdue = b.dueAt ? Date.parse(b.dueAt) <= now : false;
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  if(aOverdue&&bOverdue){const age=Date.parse(a.dueAt!)-Date.parse(b.dueAt!);if(age)return age;}

  const aLane = a.lane ? LANE_RANK[a.lane] : 4;
  const bLane = b.lane ? LANE_RANK[b.lane] : 4;
  if (aLane !== bLane) return aLane - bLane;

  const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;

  return a.caseId.localeCompare(b.caseId);
}

/** Re-exported so the Worklist and the review queue order tasks identically. */
export { compareQueueEntries };
