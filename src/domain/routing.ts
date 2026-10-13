import type { CaseRecord, ReviewTask } from './contracts';
import type { DeterministicEvaluation } from './policy';
import { screenHistoryRisk, screenSafetyAllegations } from './policy';

/**
 * SLA, routing and aging.
 *
 * Priority is deliberately kept separate from liability. Routing decides *who
 * looks next and by when*; it never changes a refund amount, and it never makes
 * a repeat complainant presumptively wrong. A case routed to the safety lane
 * receives exactly the same financial treatment as the same case routed to the
 * standard lane.
 *
 * The deadlines below are **demo service targets** for this prototype. They are
 * not contractual Ryde SLAs and are labelled as such everywhere they surface.
 */

export const SERVICE_TARGET_LABEL = 'Prototype service target — not a contractual SLA';

/** Demo service targets, in milliseconds. */
export const DEMO_SERVICE_TARGETS = {
  safety: 15 * 60_000,
  elevated: 120 * 60_000,
  standard: 24 * 60 * 60_000,
} as const;

export const QUEUE_LANES = ['safety', 'integrity', 'high_value', 'standard'] as const;
export type QueueLane = (typeof QUEUE_LANES)[number];

export const LANE_LABELS: Record<QueueLane, string> = {
  safety: 'Safety',
  integrity: 'Integrity',
  high_value: 'High value',
  standard: 'Standard',
};

export const LANE_DESCRIPTIONS: Record<QueueLane, string> = {
  safety: 'Routed to a human before any ordinary monetary resolution is considered.',
  integrity: 'An evidence-integrity signal needs a look before the case is settled.',
  high_value: 'The disputed amount is above the demo high-value threshold.',
  standard: 'Ordinary unresolved review, ordered by deadline and age.',
};

export type Urgency = 'immediate' | 'elevated' | 'normal';

export interface RoutingDecision {
  lane: QueueLane;
  urgency: Urgency;
  /** Why this case sits where it does, in the reviewer's words. */
  reason: string;
  /** Machine-readable codes, so the UI and tests do not parse prose. */
  codes: string[];
  serviceTargetMs: number;
  serviceTargetLabel: string;
  /** Deadline computed from the opened time and the target. */
  dueAt: string;
  lastActivityAt: string;
}

/* ------------------------------------------------------------------ */
/*  Escalation kinds                                                   */
/* ------------------------------------------------------------------ */

export const ESCALATION_KINDS = [
  'evidence_gap',
  'policy_ambiguity',
  'integrity',
  'runtime_failure',
  'safety',
] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

export const ESCALATION_LABELS: Record<EscalationKind, string> = {
  evidence_gap: 'Evidence gap',
  policy_ambiguity: 'Unresolved policy',
  integrity: 'Integrity concern',
  runtime_failure: 'Runtime failure',
  safety: 'Safety',
};

/**
 * What the reviewer should do next, per escalation kind. The point of the
 * distinction is that "wait for more data" and "get a policy owner" are
 * different jobs, and a runtime failure is neither.
 */
export const ESCALATION_NEXT_ACTIONS: Record<EscalationKind, string> = {
  evidence_gap: 'Request or retrieve the missing record, then re-run against the new version.',
  policy_ambiguity: 'Escalate to a policy owner. More evidence cannot settle this.',
  integrity: 'Review the integrity signals and their benign explanations before deciding.',
  runtime_failure: 'Re-run the review. No recommendation was produced.',
  safety: 'Hand to the safety reviewer immediately. Never resolved by the model or by a fee.',
};

const CODE_TO_KIND: { pattern: RegExp; kind: EscalationKind }[] = [
  { pattern: /safety|unsafe|assault|threat|harass|weapon|injur|accident/i, kind: 'safety' },
  { pattern: /policy_ambiguity|policy_clarification|governing_clock|undefined_clock/i, kind: 'policy_ambiguity' },
  { pattern: /integrity|duplicate|reused|impossible|inconsistent_source/i, kind: 'integrity' },
  { pattern: /runtime|provider|timeout|cap_exhausted|invalid_output|run_failed|transport/i, kind: 'runtime_failure' },
  { pattern: /evidence|missing|unavailable|insufficient|conflict|case_version_changed|quality/i, kind: 'evidence_gap' },
];

/**
 * Maps reason codes to one escalation kind. Safety and policy ambiguity are
 * matched first: a case that is both a safety matter and an evidence gap is a
 * safety matter.
 */
export function classifyEscalation(reasonCodes: string[]): {
  kind: EscalationKind;
  label: string;
  nextAction: string;
} {
  const joined = reasonCodes.join(' ');
  for (const entry of CODE_TO_KIND) {
    if (entry.pattern.test(joined)) {
      return {
        kind: entry.kind,
        label: ESCALATION_LABELS[entry.kind],
        nextAction: ESCALATION_NEXT_ACTIONS[entry.kind],
      };
    }
  }
  return {
    kind: 'evidence_gap',
    label: ESCALATION_LABELS.evidence_gap,
    nextAction: ESCALATION_NEXT_ACTIONS.evidence_gap,
  };
}

/* ------------------------------------------------------------------ */
/*  Classification                                                     */
/* ------------------------------------------------------------------ */

export interface IntegritySeverityInput {
  /** Highest severity reported by the integrity assessment, if one ran. */
  severity?: 'none' | 'low' | 'medium' | 'high';
}

/**
 * Decides the lane, urgency and deadline for a task.
 *
 * Safety is decided from explicit safety language in the statements only —
 * never from tone. An angry message about a fare is a fare dispute, and a calm
 * message describing an assault is a safety matter.
 */
export function classifyRouting(input: {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  highValueCents: number;
  openedAt: string;
  integrity?: IntegritySeverityInput;
  /** Reason codes already attached to the task, if any. */
  reasonCodes?: string[];
}): RoutingDecision {
  const { caseRecord, evaluation, highValueCents, openedAt } = input;
  const codes: string[] = [];

  const safetyMarkers = screenSafetyAllegations(caseRecord);
  if (safetyMarkers.length > 0) {
    codes.push('safety_language');
    return build('safety', 'immediate', codes, {
      openedAt,
      reason: `Explicit safety language is present in the statements (${safetyMarkers.join(', ')}), so this goes to the safety lane before any monetary resolution.`,
    });
  }

  const integritySeverity = input.integrity?.severity ?? 'none';
  const integrityByCode = (input.reasonCodes ?? []).some((code) => /integrity/i.test(code));

  if (integritySeverity === 'high') {
    codes.push('integrity_high');
    return build('safety', 'immediate', codes, {
      openedAt,
      reason: `A high-severity evidence-integrity signal was raised on this case. It is routed to the safety lane for immediate human review before any monetary resolution is considered.`,
    });
  }

  if (integritySeverity === 'medium' || integrityByCode) {
    codes.push(
      integritySeverity === 'none' ? 'integrity_flagged' : `integrity_${integritySeverity}`,
    );
    return build('integrity', 'elevated', codes, {
      openedAt,
      reason:
        integritySeverity === 'none'
          ? 'An evidence-integrity signal was raised on this case. This is a review priority, not a finding of fault.'
          : `An evidence-integrity signal of severity "${integritySeverity}" was raised. This is a review priority, not a finding of fault.`,
    });
  }

  if (caseRecord.disputedCents >= highValueCents) {
    codes.push('high_value');
    return build('high_value', 'elevated', codes, {
      openedAt,
      reason: `The disputed amount is at or above the demo high-value threshold, so it is reviewed ahead of standard cases.`,
    });
  }

  // History is routing context only. It raises the priority of a look; it can
  // never reduce an entitlement or make a complainant presumptively wrong.
  const historyReasons = screenHistoryRisk(caseRecord);
  if (historyReasons.length > 0) {
    codes.push('history_context');
  }
  if (evaluation.disposition === 'human_review' && evaluation.issues.length > 0) {
    codes.push('unresolved_material_fact');
  }

  return build('standard', 'normal', codes, {
    openedAt,
    reason:
      historyReasons.length > 0
        ? `Standard review. ${historyReasons.join(' ')} This affects ordering only and cannot change the outcome or the refund amount.`
        : 'Standard unresolved review, ordered by deadline and age.',
  });
}

function build(
  lane: QueueLane,
  urgency: Urgency,
  codes: string[],
  rest: { openedAt: string; reason: string },
): RoutingDecision {
  const serviceTargetMs =
    lane === 'safety'
      ? DEMO_SERVICE_TARGETS.safety
      : lane === 'standard'
        ? DEMO_SERVICE_TARGETS.standard
        : DEMO_SERVICE_TARGETS.elevated;

  return {
    lane,
    urgency,
    reason: rest.reason,
    codes,
    serviceTargetMs,
    serviceTargetLabel: SERVICE_TARGET_LABEL,
    dueAt: new Date(Date.parse(rest.openedAt) + serviceTargetMs).toISOString(),
    lastActivityAt: rest.openedAt,
  };
}

/* ------------------------------------------------------------------ */
/*  Overdue and ordering                                               */
/* ------------------------------------------------------------------ */

export interface QueueEntry {
  task: ReviewTask;
  caseRecord: CaseRecord | null;
}

/**
 * Overdue state is always recomputed from server time, never stored. That is
 * what makes it survive a restart: the deadline is persisted, the lateness is
 * derived.
 */
export function overdueMs(dueAt: string, now: number): number {
  return Math.max(0, now - Date.parse(dueAt));
}

export function isOverdue(dueAt: string, now: number): boolean {
  return Date.parse(dueAt) <= now;
}

function laneRank(lane: QueueLane): number {
  return QUEUE_LANES.indexOf(lane);
}

/**
 * Queue ordering.
 *
 *  1. Safety is never behind anything, overdue or not.
 *  2. Among the rest, an **overdue** case outranks a not-yet-due one, whatever
 *     lane it is in. This is the aging rule: a small charge that has waited past
 *     its target moves ahead of a fresher high-value case rather than being
 *     starved behind it forever.
 *  3. Overdue cases order by how overdue they are; the rest by lane, then by
 *     nearest deadline.
 *
 * `now` is passed in so the ordering is testable without freezing the clock.
 */
export function compareQueueEntries(a: QueueEntry, b: QueueEntry, now: number): number {
  const aRouting = a.task.routing;
  const bRouting = b.task.routing;

  // Tasks written before routing existed fall back to their created time and
  // the standard target, so an old task is never stranded at the bottom.
  const aLane = aRouting?.lane ?? 'standard';
  const bLane = bRouting?.lane ?? 'standard';
  const aDue = aRouting?.dueAt ?? a.task.createdAt;
  const bDue = bRouting?.dueAt ?? b.task.createdAt;

  const aSafety = aLane === 'safety';
  const bSafety = bLane === 'safety';
  if (aSafety !== bSafety) return aSafety ? -1 : 1;

  const aOver = isOverdue(aDue, now);
  const bOver = isOverdue(bDue, now);
  if (aOver !== bOver) return aOver ? -1 : 1;

  if (aOver && bOver) {
    const diff = overdueMs(bDue, now) - overdueMs(aDue, now);
    if (diff !== 0) return diff;
  }

  const rank = laneRank(aLane) - laneRank(bLane);
  if (rank !== 0) return rank;

  const due = Date.parse(aDue) - Date.parse(bDue);
  if (due !== 0) return due;

  // Final tiebreak: the case that has waited longer overall.
  return Date.parse(a.task.createdAt) - Date.parse(b.task.createdAt);
}

/** Human-readable lateness, e.g. `3h overdue` or `due in 45m`. */
export function deadlineLabel(dueAt: string, now: number): string {
  const delta = Date.parse(dueAt) - now;
  const minutes = Math.round(Math.abs(delta) / 60_000);
  const magnitude =
    minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return delta <= 0 ? `${magnitude} overdue` : `due in ${magnitude}`;
}
