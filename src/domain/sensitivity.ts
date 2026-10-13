import type { CaseRecord, EvidenceItem, PolicyPack } from './contracts';
import { evaluateCase, type DeterministicEvaluation } from './policy';
import { formatSgd } from './money';
import { hasUnverifiedClaim } from './evidence';
import type { SensitivityScenario } from './collection';

/**
 * Read-only sensitivity analysis.
 *
 * Answers "would the outcome change if this were different?" by running the
 * *same* deterministic engine on a hypothetical variant of the case. Nothing
 * here writes a case version, a ledger entry or a settlement — the variants are
 * in-memory and thrown away.
 *
 * Two honesty rules are enforced:
 *  - a scenario only claims to change the decision when the engine actually
 *    returns a different disposition;
 *  - a scenario is only offered at all when there is a real unresolved field to
 *    vary, so an already-determinate case reports no scenarios rather than
 *    inventing hypotheticals.
 */

/** A stated bound used to ask "what if the radius were tight?" — clearly hypothetical. */
const STATED_ACCURACY_BOUND_METERS = 8;

function describeDisposition(evaluation: DeterministicEvaluation): string {
  switch (evaluation.disposition) {
    case 'refund':
      return `Refund ${formatSgd(evaluation.recommendedRefundCents ?? 0)}`;
    case 'uphold':
      return 'Charge upheld (no refund)';
    case 'partial_refund':
      return `Partial refund ${formatSgd(evaluation.recommendedRefundCents ?? 0)}`;
    default:
      return 'Human review required — no deterministic outcome';
  }
}

function withAccuracy(caseRecord: CaseRecord, accuracyMeters: number): CaseRecord {
  return {
    ...caseRecord,
    evidence: caseRecord.evidence.map((item) =>
      item.kind === 'gps' && item.payload.status !== 'en_route'
        ? { ...item, payload: { ...item.payload, accuracyMeters } }
        : item,
    ),
  };
}

/** Applies an unverified GPS accuracy claim as if it had been verified. */
function withVerifiedClaims(caseRecord: CaseRecord): CaseRecord {
  return {
    ...caseRecord,
    evidence: caseRecord.evidence.map((item) => {
      if (item.kind !== 'gps') return item;
      const claim = (item.claims ?? []).find(
        (candidate) => candidate.field === 'gps_accuracy_meters' && candidate.verification.status !== 'verified',
      );
      if (!claim) return item;
      return { ...item, payload: { ...item.payload, accuracyMeters: claim.value } };
    }),
  };
}

/** Applies an unverified fare-component claim as if it had been verified. */
function withVerifiedFareClaims(caseRecord: CaseRecord): CaseRecord {
  const extra: EvidenceItem[] = [];
  for (const item of caseRecord.evidence) {
    for (const claim of item.claims ?? []) {
      if (claim.field !== 'fare_component_cents') continue;
      if (claim.verification.status === 'verified') continue;
      const id = `HYP-${claim.id}`;
      if (caseRecord.evidence.some((existing) => existing.id === id)) continue;
      extra.push({
        id,
        kind: 'payment',
        timestamp: null,
        source: { dataset: 'hypothetical', jsonPointer: '/', provenance: 'synthetic' },
        payload: {
          component: 'hypothetical_component',
          amountCents: claim.value,
          direction: 'charge',
          method: 'hypothetical',
          status: 'applied',
        },
        qualityIssues: ['Hypothetical only — this line is not part of the case record.'],
      });
    }
  }
  return extra.length ? { ...caseRecord, evidence: [...caseRecord.evidence, ...extra] } : caseRecord;
}

export function buildSensitivityScenarios(
  caseRecord: CaseRecord,
  pack: PolicyPack,
  evaluation: DeterministicEvaluation,
): SensitivityScenario[] {
  const baseline = describeDisposition(evaluation);
  const scenarios: SensitivityScenario[] = [];

  const gpsItems = caseRecord.evidence.filter((item) => item.kind === 'gps');
  const hasUnverifiedAccuracyClaim = gpsItems.some((item) =>
    hasUnverifiedClaim(item, 'gps_accuracy_meters'),
  );

  // 1. What if the accuracy radius were tight? Only meaningful while the zone is
  //    genuinely unresolved — otherwise there is nothing to vary.
  if (evaluation.noShow && evaluation.noShow.arrivalZone === 'indeterminate') {
    const variant = evaluateCase(withAccuracy(caseRecord, STATED_ACCURACY_BOUND_METERS), pack);
    scenarios.push({
      id: 'S-ACCURACY',
      label: 'Tighter accuracy radius',
      hypothetical: `If every stationary fix carried a ${STATED_ACCURACY_BOUND_METERS} m accuracy radius instead of the recorded value.`,
      outcome: describeDisposition(variant),
      controllingCondition: 'NS-01 pickup-zone radius rule',
      missingSource: 'Trip telemetry reporting the device accuracy radius',
      changesDecision: variant.disposition !== evaluation.disposition,
      baselineOutcome: baseline,
    });
  }

  // 2. What if the other permitted clock governed the wait?
  const noShow = evaluation.noShow;
  const thresholds = pack.source !== 'supplied_sample' ? pack.thresholds : null;
  if (
    noShow &&
    thresholds &&
    noShow.elapsedSeconds !== null &&
    noShow.elapsedUnderEarliestSeconds !== null &&
    noShow.elapsedSeconds !== noShow.elapsedUnderEarliestSeconds
  ) {
    const threshold = thresholds.noShowThresholdSeconds;
    const latestMet = noShow.elapsedSeconds >= threshold;
    const earliestMet = noShow.elapsedUnderEarliestSeconds >= threshold;
    // Only worth showing when the two permitted clocks actually disagree. If
    // both land on the same side of the threshold then the clock is not what
    // decides the wait, and offering the scenario would imply a doubt that the
    // engine does not have.
    if (latestMet !== earliestMet) {
      scenarios.push({
        id: 'S-CLOCK',
        label: 'Governing waiting clock',
        hypothetical: `If the earliest candidate start governed (${noShow.elapsedUnderEarliestSeconds} s) rather than the latest (${noShow.elapsedSeconds} s).`,
        outcome: `Latest clock: ${noShow.elapsedSeconds} s — ${latestMet ? 'at or above' : 'below'} the ${threshold} s threshold. Earliest clock: ${noShow.elapsedUnderEarliestSeconds} s — ${earliestMet ? 'at or above' : 'below'} the threshold.`,
        controllingCondition: 'NS-03 / NS-06 effective waiting start',
        missingSource: 'A policy owner ruling on which clock applies',
        changesDecision: true,
        baselineOutcome: baseline,
      });
    }
  }

  // 3. What if the party's accuracy correction had been verified?
  if (hasUnverifiedAccuracyClaim) {
    const variant = evaluateCase(withVerifiedClaims(caseRecord), pack);
    scenarios.push({
      id: 'S-VERIFIED-CLAIM',
      label: 'Unverified accuracy correction',
      hypothetical: 'If the party-supplied accuracy radius had been verified against a source.',
      outcome: describeDisposition(variant),
      controllingCondition: 'NS-01 pickup-zone radius rule',
      missingSource: 'A named source the reviewer can verify the correction against',
      changesDecision: variant.disposition !== evaluation.disposition,
      baselineOutcome: baseline,
    });
  }

  // 4. What if the party's fare correction had been verified?
  const hasUnverifiedFareClaim = caseRecord.evidence.some((item) =>
    hasUnverifiedClaim(item, 'fare_component_cents'),
  );
  if (hasUnverifiedFareClaim) {
    const variant = evaluateCase(withVerifiedFareClaims(caseRecord), pack);
    scenarios.push({
      id: 'S-VERIFIED-LEDGER',
      label: 'Unverified fare correction',
      hypothetical: 'If the party-supplied fare component had been verified and included.',
      outcome: describeDisposition(variant),
      controllingCondition: 'RT-05 fare-ledger reconciliation',
      missingSource: 'The platform fare ledger for this trip',
      changesDecision: variant.disposition !== evaluation.disposition,
      baselineOutcome: baseline,
    });
  }

  return scenarios;
}
