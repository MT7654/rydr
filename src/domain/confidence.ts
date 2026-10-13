import type { CaseRecord, Disposition, PolicyThresholds } from './contracts';
import { evidenceOfKind, findTripEvent, collectGpsSamples } from './evidence';
import { screenHistoryRisk, screenSafetyAllegations, type DeterministicEvaluation } from './policy';

/**
 * Prototype evidence-quality score and escalation gate.
 *
 * The score is an explicit checklist, not a calibrated probability. Every check is
 * yes/no and the breakdown is retained for display.
 */

export interface Check {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
}

export interface Dimension {
  key: 'completeness' | 'traceability' | 'consistency' | 'measurement';
  max: number;
  score: number;
  checks: Check[];
}

export interface QualityScore {
  total: number;
  band: 'high' | 'moderate' | 'low';
  dimensions: Dimension[];
}

const FIVE = 5;

export function bandFor(total: number, thresholds: PolicyThresholds): QualityScore['band'] {
  if (total >= 0.85) return 'high';
  if (total >= thresholds.qualityReviewFloor) return 'moderate';
  return 'low';
}

export function scoreEvidence(
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
  thresholds: PolicyThresholds,
): QualityScore {
  const kinds = new Set(caseRecord.evidence.map((item) => item.kind));
  const stationarySamples = collectGpsSamples(caseRecord.evidence).filter((s) =>
    ['arrived', 'waiting', 'cancelled'].includes(s.status),
  );
  const arrival = findTripEvent(caseRecord.evidence, 'driver_arrived');
  const routeItems = evidenceOfKind(caseRecord.evidence, 'route');
  const primaryRoute = routeItems[0] ?? null;
  const isNoShow = caseRecord.category === 'no_show_charge';
  const isDamage = caseRecord.category === 'damage';
  const images = evidenceOfKind(caseRecord.evidence, 'image');

  const completeness: Check[] = [
    { id: 'rider_statement', label: 'Rider statement present', weight: FIVE, passed: caseRecord.riderStatement.trim().length > 0 },
    { id: 'driver_statement', label: 'Driver statement present', weight: FIVE, passed: (caseRecord.driverStatement ?? '').trim().length > 0 },
    { id: 'gps', label: 'GPS telemetry present', weight: FIVE, passed: kinds.has('gps') },
    { id: 'contact', label: 'Contact or message record present', weight: FIVE, passed: kinds.has('chat') || kinds.has('call') },
    { id: 'events', label: 'Trip event log present', weight: FIVE, passed: kinds.has('trip_event') },
    { id: 'payment', label: 'Payment record present', weight: FIVE, passed: kinds.has('payment') },
    { id: 'scheduled', label: 'Scheduled pickup time present', weight: FIVE, passed: caseRecord.trip.scheduledAt !== null },
    {
      id: 'category_core',
      label: isDamage ? 'Image evidence present' : isNoShow ? 'Arrival event present' : 'Route evidence present',
      weight: FIVE,
      passed: isDamage ? images.length > 0 : isNoShow ? arrival !== null : primaryRoute !== null,
    },
  ];

  const traceability: Check[] = [
    { id: 'dataset', label: 'Every item names its source dataset', weight: FIVE, passed: caseRecord.evidence.every((i) => i.source.dataset.length > 0) },
    { id: 'pointer', label: 'Every item carries an original JSON pointer', weight: FIVE, passed: caseRecord.evidence.every((i) => i.source.jsonPointer.length > 0) },
    { id: 'provenance', label: 'Every item declares provenance', weight: FIVE, passed: caseRecord.evidence.every((i) => Boolean(i.source.provenance)) },
    { id: 'policy_version', label: 'Governing policy version recorded', weight: FIVE, passed: caseRecord.policyVersion.length > 0 },
  ];

  const duplicateIds =
    new Set(caseRecord.evidence.map((i) => i.id)).size !== caseRecord.evidence.length;
  const gapOverLimit =
    evaluation.noShow?.maxGapSeconds !== null &&
    evaluation.noShow?.maxGapSeconds !== undefined &&
    evaluation.noShow.maxGapSeconds > thresholds.continuityLimitSeconds;

  const consistency: Check[] = [
    { id: 'no_clock_conflict', label: 'No material timestamp conflict', weight: FIVE, passed: evaluation.noShow?.materialStartConflict !== true },
    { id: 'continuity', label: 'Sampling continuity within limit', weight: FIVE, passed: !gapOverLimit },
    { id: 'ledger', label: 'No fare ledger inconsistency', weight: FIVE, passed: evaluation.route?.ledgerReconciled !== false },
    { id: 'unique_ids', label: 'Evidence IDs are unique', weight: FIVE, passed: !duplicateIds },
  ];

  const measurement: Check[] = isDamage ? [
    { id: 'image_hashes', label: 'Image content hashes recorded (file identity only)', weight: FIVE, passed: images.length > 0 && images.every(i => /^[a-f0-9]{64}$/.test(i.payload.hash)) },
    { id: 'multi_angle', label: 'At least three distinct submitted views', weight: FIVE, passed: new Set(images.flatMap(i => i.payload.angles)).size >= 3 },
    { id: 'image_context', label: 'Context sufficiency recorded as adequate', weight: FIVE, passed: images.length > 0 && images.every(i => i.payload.sufficiency === 'adequate') },
    { id: 'image_consistency', label: 'No detected image-integrity concerns', weight: FIVE, passed: evaluation.damage?.integritySeverity === 'none' },
  ] : isNoShow
    ? [
        { id: 'accuracy', label: 'GPS accuracy radius measured', weight: FIVE, passed: evaluation.noShow?.accuracyPresent === true },
        { id: 'samples', label: 'At least two stationary samples', weight: FIVE, passed: stationarySamples.length >= 2 },
        { id: 'arrival', label: 'Arrival event recorded', weight: FIVE, passed: arrival !== null },
        { id: 'contact_attempt', label: 'At least one evidenced contact attempt', weight: FIVE, passed: (evaluation.noShow?.contactAttempts ?? 0) >= 1 },
      ]
    : [
        { id: 'planned', label: 'Planned route length supplied', weight: FIVE, passed: primaryRoute?.payload.plannedDistanceM != null },
        { id: 'actual', label: 'Actual route length supplied', weight: FIVE, passed: primaryRoute?.payload.actualDistanceM != null },
        { id: 'justification', label: 'Justification status is not unknown', weight: FIVE, passed: (primaryRoute?.payload.justification ?? 'unknown') !== 'unknown' },
        { id: 'surcharge', label: 'Eligible surcharge component identifiable', weight: FIVE, passed: evaluation.route?.surchargeCents !== null },
      ];

  const dimensions: Dimension[] = [
    { key: 'completeness', max: 40, score: sumChecks(completeness), checks: completeness },
    { key: 'traceability', max: 20, score: sumChecks(traceability), checks: traceability },
    { key: 'consistency', max: 20, score: sumChecks(consistency), checks: consistency },
    { key: 'measurement', max: 20, score: sumChecks(measurement), checks: measurement },
  ];

  const raw = dimensions.reduce((total, dimension) => total + dimension.score, 0);
  const total = Math.round((raw / 100) * 1000) / 1000;

  return { total, band: bandFor(total, thresholds), dimensions };
}

function sumChecks(checks: Check[]): number {
  return checks.reduce((total, check) => total + (check.passed ? check.weight : 0), 0);
}

export interface EscalationInput {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  thresholds: PolicyThresholds;
  quality: QualityScore;
  judgeDisposition: Disposition;
  judgeConfidence: number;
  agentOutputInvalid: boolean;
  providerFailure: boolean;
  unresolvedCitations: string[];
}

export interface EscalationResult {
  requiresHumanReview: boolean;
  /** Blockers that override any score or model confidence. */
  hardBlockers: string[];
  /** History flags may request review but never grant or refuse a refund. */
  reviewOnlyReasons: string[];
  escalationReasons: string[];
  disposition: Disposition;
  recommendedRefundCents: number | null;
}

export function applyEscalationGate(input: EscalationInput): EscalationResult {
  const hardBlockers: string[] = [];
  if (input.caseRecord.category === 'damage') hardBlockers.push('Damage liability requires human approval; images cannot establish causation.');
  const reviewOnlyReasons: string[] = [];

  const safety = screenSafetyAllegations(input.caseRecord);
  if (safety.length > 0) {
    hardBlockers.push(
      `Safety allegation detected (${safety.join(', ')}). Safety matters are never resolved by the model.`,
    );
  }

  if (input.evaluation.noShow?.policyAmbiguity) {
    hardBlockers.push(
      'Ambiguous governing policy: the supplied sample policy does not define which clock governs the waiting period.',
    );
  }
  if (input.evaluation.noShow?.materialStartConflict) {
    hardBlockers.push(
      'Conflicting high-impact records: the choice of governing waiting clock changes the outcome.',
    );
  }
  if (input.caseRecord.disputedCents > input.thresholds.highValueCents) {
    hardBlockers.push(
      `Disputed amount exceeds the ${input.thresholds.highValueCents} cent high-value review threshold.`,
    );
  }
  if (input.evaluation.route?.ledgerReconciled === false) {
    hardBlockers.push('Inconsistent money: the fare ledger does not reconcile.');
  }
  if (input.agentOutputInvalid) {
    hardBlockers.push('Invalid or unvalidated agent output.');
  }
  if (input.providerFailure) {
    hardBlockers.push('Runtime provider failure. No fixture output was substituted.');
  }
  if (input.unresolvedCitations.length > 0) {
    hardBlockers.push(
      `Unresolvable citation(s): ${input.unresolvedCitations.join(', ')}.`,
    );
  }
  if (input.evaluation.disposition !== input.judgeDisposition) {
    hardBlockers.push(
      `Judge disposition "${input.judgeDisposition}" disagrees with deterministic eligibility "${input.evaluation.disposition}".`,
    );
  }
  if (input.quality.total < input.thresholds.qualityReviewFloor) {
    hardBlockers.push(
      `Evidence quality score ${input.quality.total.toFixed(2)} is below the ${input.thresholds.qualityReviewFloor} review floor.`,
    );
  }
  if (input.judgeConfidence < input.thresholds.judgeConfidenceFloor) {
    hardBlockers.push(
      `Judge model confidence ${input.judgeConfidence.toFixed(2)} is below the ${input.thresholds.judgeConfidenceFloor} floor.`,
    );
  }

  for (const reason of screenHistoryRisk(input.caseRecord)) {
    reviewOnlyReasons.push(`${reason} Routing context only; it does not affect liability or amount.`);
  }

  const requiresHumanReview = hardBlockers.length > 0 || reviewOnlyReasons.length > 0;
  const disposition: Disposition =
    hardBlockers.length > 0 ? 'human_review' : input.evaluation.disposition;
  const recommendedRefundCents =
    hardBlockers.length > 0 ? null : input.evaluation.recommendedRefundCents;

  return {
    requiresHumanReview,
    hardBlockers,
    reviewOnlyReasons,
    escalationReasons: [...hardBlockers, ...reviewOnlyReasons],
    disposition,
    recommendedRefundCents,
  };
}
