import type { CaseRecord } from './contracts';
import type { DeterministicEvaluation } from './policy';
import { screenSafetyAllegations } from './policy';
import {
  MAX_SOURCE_CALLS_PER_CYCLE,
  type DisputedCondition,
  type EvidencePlan,
  type SourceRequest,
  type SourceToolId,
} from './collection';

/**
 * Turns the deterministic blockers into an evidence plan.
 *
 * Deliberately rules, not another model call: the same case must produce the
 * same plan every time, and a reviewer must be able to read exactly why each
 * source is being consulted. An LLM planner could be added later, but it would
 * still only be allowed to choose from the same allowlist.
 *
 * A condition is only given a tool when that tool could actually change the
 * result. "No GPS accuracy is recorded" is worth a telemetry read; "the
 * governing clock is undefined" is not a data gap at all and cannot be fixed by
 * fetching more GPS — it needs a policy owner.
 */

interface ConditionDraft {
  id: string;
  kind: DisputedCondition['kind'];
  summary: string;
  policyIds: string[];
  tool: SourceToolId | null;
  whyItMatters: string;
  fields: string[];
}

function noShowConditions(evaluation: DeterministicEvaluation): ConditionDraft[] {
  const noShow = evaluation.noShow;
  if (!noShow) return [];
  const drafts: ConditionDraft[] = [];

  // A missing or over-wide accuracy radius is a data gap: telemetry can settle it.
  if (!noShow.accuracyPresent) {
    drafts.push({
      id: 'C-ACCURACY',
      kind: 'evidence_gap',
      summary:
        'No GPS accuracy radius is recorded, so the pickup-zone determination cannot be made automatically.',
      policyIds: ['NS-01'],
      tool: 'trip_telemetry',
      whyItMatters:
        'The zone rule needs a distance and an accuracy radius. With the radius missing, the engine can only return indeterminate.',
      fields: ['accuracyMeters'],
    });
  } else if (noShow.arrivalZone === 'indeterminate') {
    drafts.push({
      id: 'C-ACCURACY',
      kind: 'evidence_gap',
      summary:
        'The recorded accuracy radius is too wide to place the vehicle inside or outside the pickup zone.',
      policyIds: ['NS-01'],
      tool: 'trip_telemetry',
      whyItMatters:
        'A tighter, source-reported accuracy radius can move the sample from indeterminate to a determinate zone.',
      fields: ['accuracyMeters'],
    });
  }

  // Waiting continuity is a telemetry question too.
  if (!noShow.continuityOk) {
    drafts.push({
      id: 'C-CONTINUITY',
      kind: 'evidence_gap',
      summary: `Stationary sampling gap of ${noShow.maxGapSeconds} s exceeds the continuity limit, so continuous presence is not established.`,
      policyIds: ['NS-02'],
      tool: 'trip_telemetry',
      whyItMatters:
        'A denser telemetry read inside the gap could establish continuous presence, or confirm the gap is real.',
      fields: ['samples'],
    });
  }

  // An absent contact log is a communications question.
  if (noShow.contactAttempts === 0) {
    drafts.push({
      id: 'C-CONTACT',
      kind: 'evidence_gap',
      summary:
        'No evidenced contact attempt is recorded, which the demo policy requires before a no-show fee is charged.',
      policyIds: ['NS-05'],
      tool: 'communications',
      whyItMatters:
        'The platform owns the delivery log. A source record showing attempts were made changes the fee eligibility.',
      fields: ['attempts', 'deliveryStatus'],
    });
  }

  // The governing clock is NOT a data gap — a policy owner has to say which
  // clock applies. Requesting more GPS here would be busywork.
  if (noShow.materialStartConflict || noShow.policyAmbiguity) {
    drafts.push({
      id: 'C-CLOCK',
      kind: 'policy_ambiguity',
      summary: noShow.materialStartConflict
        ? 'The choice of governing waiting clock changes the outcome, and no attached policy says which clock applies.'
        : 'A supplied sample policy is attached but does not define which clock governs the waiting period.',
      policyIds: ['NS-06'],
      tool: 'effective_policy',
      whyItMatters:
        'This is a policy gap, not a missing measurement. Only an effective-dated policy clarification can settle it; more telemetry cannot.',
      fields: ['effectivePolicyClarification'],
    });
  }

  return drafts;
}

function routeConditions(evaluation: DeterministicEvaluation): ConditionDraft[] {
  const route = evaluation.route;
  if (!route) return [];
  const drafts: ConditionDraft[] = [];

  if (!route.comparison.measurable) {
    drafts.push({
      id: 'C-ROUTE-LENGTH',
      kind: 'evidence_gap',
      summary: 'Planned or actual route length is missing, so route deviation cannot be measured.',
      policyIds: ['RT-01', 'RT-02'],
      tool: 'trip_telemetry',
      whyItMatters:
        'Both lengths are needed before the deviation thresholds can be applied at all.',
      fields: ['plannedDistanceM', 'actualDistanceM'],
    });
  }

  if (!route.ledgerReconciled) {
    drafts.push({
      id: 'C-LEDGER',
      kind: 'evidence_gap',
      summary: `Fare ledger components differ from the declared final fare by ${route.ledgerDifferenceCents} cents.`,
      policyIds: ['RT-05'],
      tool: 'fare_ledger',
      whyItMatters:
        'The authoritative fare ledger either confirms the declared total or shows which component is wrong.',
      fields: ['components', 'finalFareCents'],
    });
  }

  if (route.comparison.measurable && route.comparison.deviationFlagged && route.justification === 'unknown') {
    drafts.push({
      id: 'C-JUSTIFICATION',
      kind: 'evidence_gap',
      summary:
        'Deviation exceeds thresholds but the trip-linked justification status is unknown.',
      policyIds: ['RT-03', 'RT-04'],
      tool: 'trip_telemetry',
      whyItMatters:
        'A detour approval or road-closure record would establish whether the deviation was justified.',
      fields: ['justification', 'justificationNote'],
    });
  }

  return drafts;
}

export function buildEvidencePlan(
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
): EvidencePlan {
  const safety = screenSafetyAllegations(caseRecord);

  const drafts =
    caseRecord.category === 'no_show_charge'
      ? noShowConditions(evaluation)
      : routeConditions(evaluation);

  const conditions: DisputedCondition[] = drafts.map((draft) => ({
    id: draft.id,
    kind: draft.kind,
    summary: draft.summary,
    policyIds: draft.policyIds,
    material: true,
    tool: draft.tool,
    whyItMatters: draft.whyItMatters,
  }));

  // Safety outranks everything: it routes to a person and collection stops.
  if (safety.length > 0) {
    conditions.unshift({
      id: 'C-SAFETY',
      kind: 'safety',
      summary: `Safety-related language is present in the statements (${safety.join(', ')}).`,
      policyIds: ['GN-03'],
      material: true,
      tool: null,
      whyItMatters:
        'Safety is never resolved by evidence collection or by the model. It goes to a human immediately.',
    });
  }

  // A condition a person has to resolve: no tool can settle it, or it is a
  // policy question only a policy owner can answer. Either way it is reported as
  // needing human input rather than being silently retried against a source.
  const needsHumanInput = conditions
    .filter((condition) => condition.tool === null || condition.kind === 'policy_ambiguity')
    .map((condition) => condition.summary);

  const hasPolicyAmbiguity = conditions.some(
    (condition) => condition.kind === 'policy_ambiguity',
  );

  // When the governing rule itself is undecided the data gaps are downstream:
  // we do not yet know whether they matter. The wait may not even have started,
  // so a telemetry read could settle a question that turns out to be irrelevant.
  // The cycle therefore asks only the effective-policy source and escalates,
  // rather than spending a source call on a measurement that cannot decide.
  const collectableDrafts = hasPolicyAmbiguity
    ? drafts.filter((draft) => draft.kind === 'policy_ambiguity')
    : drafts;

  const requests: SourceRequest[] = [];
  const seen = new Set<SourceToolId>();

  // One request per tool per cycle: asking the same source twice in one pass is
  // the loop-until-favourable behaviour the spec rules out.
  for (const draft of collectableDrafts) {
    if (!draft.tool) continue;
    if (seen.has(draft.tool)) continue;
    seen.add(draft.tool);
    requests.push({
      id: `req_${caseRecord.id}_${draft.id}`,
      conditionId: draft.id,
      tool: draft.tool,
      caseId: caseRecord.id,
      tripId: caseRecord.trip.id,
      windowFrom: null,
      windowTo: null,
      fields: draft.fields,
      reason: draft.whyItMatters,
    });
    if (requests.length >= MAX_SOURCE_CALLS_PER_CYCLE) break;
  }

  // A safety case is routed, not collected.
  const collectable = safety.length === 0 ? requests : [];

  return {
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    conditions,
    requests: collectable,
    needsHumanInput,
    hasWork: collectable.length > 0,
  };
}
