import type {
  CaseRecord,
  Disposition,
  Finding,
  PolicyPack,
  PolicyThresholds,
} from './contracts';
import { diffSeconds, formatSingapore } from './time';
import { capCents } from './money';
import {
  classifyZone,
  hasContraryOffZoneSample,
  haversineMeters,
  maxStationaryGapSeconds,
  type StationarySample,
  type ZoneClass,
} from './geo';
import { compareRoutes, reconcileLedger, type RouteComparison } from './route';
import {
  collectGpsSamples,
  collectPayments,
  contactAttemptCount,
  excessRouteSurchargeCents,
  evidenceOfKind,
  findTripEvent,
  routeEvidence,
  textCorpus,
} from './evidence';
import { assessImageIntegrity } from './imageEvidence';
import { applyReferencePolicy } from './referencePolicy';

/**
 * Deterministic evidence and policy engine.
 *
 * Everything here is pure and model-free. Money is integer cents, timestamps are
 * compared in UTC, and no conclusion is asserted beyond what the evidence
 * supports. Rules come from the selected versioned pack; the supplied
 * sample policy is never merged into it.
 */

export interface NoShowEvaluation {
  arrivalZone: ZoneClass;
  accuracyPresent: boolean;
  maxGapSeconds: number | null;
  continuityOk: boolean;
  earliestStartAt: string | null;
  effectiveStartAt: string | null;
  elapsedSeconds: number | null;
  elapsedUnderEarliestSeconds: number | null;
  materialStartConflict: boolean;
  policyAmbiguity: boolean;
  contactAttempts: number;
  cancellationAt: string | null;
}

export interface RouteEvaluation {
  ledgerBasis?: 'aggregate_totals';
  notificationStatus?: 'agreed' | 'not_informed' | 'unknown';
  eligibleRefundCents?: number | null;
  comparison: RouteComparison;
  justification: 'verified_justification' | 'verified_no_justification' | 'unknown';
  ledgerReconciled: boolean;
  ledgerDifferenceCents: number;
  surchargeCents: number | null;
}

export interface DamageEvaluation {
  imagesPresent: boolean;
  imageCount: number;
  integritySeverity: 'none' | 'low' | 'medium' | 'high';
  humanApprovalRequired: boolean;
}

export interface DeterministicEvaluation {
  caseId: string;
  caseVersion: number;
  category: CaseRecord['category'];
  disposition: Disposition;
  recommendedRefundCents: number | null;
  findings: Finding[];
  issues: string[];
  materialEvidenceIds: string[];
  policyIds: string[];
  noShow: NoShowEvaluation | null;
  route: RouteEvaluation | null;
  damage: DamageEvaluation | null;
  fare?: { quotedCents: number; chargedCents: number; differentialCents: number | null; quoteMultiplier: number; startMultiplier: number; fixedFeeCents: number; notified: boolean | null; reconciled: boolean } | null;
}

const CONTACT_ISSUE =
  'No rider response appears in the supplied contact log. That supports a lack of observed response, not rider absence.';

function demoThresholds(pack: PolicyPack): PolicyThresholds {
  if (pack.source === 'supplied_sample') {
    throw new Error(
      `Deterministic evaluation requires an executable policy pack, received ${pack.id}`,
    );
  }
  return pack.thresholds;
}

function zoneOfSamples(
  samples: StationarySample[],
  pickup: { lat: number; lng: number },
  radius: number,
): { zone: ZoneClass; distances: number[] } {
  const stationary = samples.filter((s) =>
    ['arrived', 'waiting', 'cancelled'].includes(s.status),
  );
  const distances = stationary.map((s) => haversineMeters(pickup, s));
  if (stationary.length === 0) return { zone: 'indeterminate', distances };

  let zone: ZoneClass = 'inside';
  for (let i = 0; i < stationary.length; i += 1) {
    const z = classifyZone(distances[i]!, stationary[i]!.accuracyMeters, radius);
    if (z === 'outside') return { zone: 'outside', distances };
    if (z === 'indeterminate') zone = 'indeterminate';
  }
  return { zone, distances };
}

function evaluateNoShow(
  caseRecord: CaseRecord,
  thresholds: PolicyThresholds,
  officialScope?: 'on_demand_no_show' | 'advance_no_show',
): {
  evaluation: NoShowEvaluation;
  disposition: Disposition;
  refundCents: number | null;
  findings: Finding[];
  issues: string[];
  materialEvidenceIds: string[];
} {
  const findings: Finding[] = [];
  const issues: string[] = [];
  const materialEvidenceIds: string[] = [];
  const gpsItems = evidenceOfKind(caseRecord.evidence, 'gps');
  const samples = collectGpsSamples(caseRecord.evidence);

  const official = Boolean(officialScope);
  const arrival = findTripEvent(caseRecord.evidence, official ? 'driver_pressed_im_here' : 'driver_arrived');
  const timerStart = findTripEvent(caseRecord.evidence, 'wait_timer_started');
  const cancellation = official ? findTripEvent(caseRecord.evidence, 'driver_cancelled_no_show') :
    findTripEvent(caseRecord.evidence, 'cancellation_fee_applied') ??
    findTripEvent(caseRecord.evidence, 'trip_cancelled') ??
    findTripEvent(caseRecord.evidence, 'driver_released');

  const { zone, distances } = zoneOfSamples(
    samples,
    caseRecord.trip.pickup,
    thresholds.pickupRadiusMeters,
  );
  const accuracyPresent = samples.some((s) => s.accuracyMeters !== null);
  const maxGap = maxStationaryGapSeconds(samples);
  const continuityOk = maxGap === null || maxGap <= thresholds.continuityLimitSeconds;
  const contactAttempts = official
    ? evidenceOfKind(caseRecord.evidence, 'call').filter(item => item.payload.direction === 'outgoing').length + evidenceOfKind(caseRecord.evidence, 'chat').filter(item => item.payload.sender === 'driver').length
    : contactAttemptCount(caseRecord.evidence);

  const candidates = (official ? [arrival?.timestamp ?? null] : [
    arrival?.timestamp ?? null,
    caseRecord.trip.scheduledAt,
    timerStart?.timestamp ?? null,
  ]).filter((value): value is string => value !== null);

  const sorted = [...candidates].sort((a, b) => Date.parse(a) - Date.parse(b));
  const earliestStartAt = sorted[0] ?? null;
  const effectiveStartAt = sorted[sorted.length - 1] ?? null;

  const elapsedSeconds =
    effectiveStartAt && cancellation
      ? diffSeconds(effectiveStartAt, cancellation.timestamp)
      : null;
  const elapsedUnderEarliestSeconds =
    earliestStartAt && cancellation
      ? diffSeconds(earliestStartAt, cancellation.timestamp)
      : null;

  const thresholdMet = (value: number | null) =>
    value !== null && (official ? value > thresholds.noShowThresholdSeconds : value >= thresholds.noShowThresholdSeconds);

  const straddlesThreshold =
    elapsedSeconds !== null &&
    elapsedUnderEarliestSeconds !== null &&
    thresholdMet(elapsedSeconds) !== thresholdMet(elapsedUnderEarliestSeconds);

  const startSpread =
    earliestStartAt && effectiveStartAt
      ? diffSeconds(earliestStartAt, effectiveStartAt)
      : 0;

  /**
   * NS-03 defines the effective start as the latest candidate, so a spread on its
   * own is not a conflict. It becomes material only when an ambiguous supplied
   * policy governs the case AND the choice of clock changes the outcome.
   */
  const earlyAdvance = officialScope === 'advance_no_show' && Boolean(arrival && caseRecord.trip.scheduledAt && Date.parse(arrival.timestamp) < Date.parse(caseRecord.trip.scheduledAt));
  const policyAmbiguity = earlyAdvance || (caseRecord.suppliedPolicyId !== null && startSpread > 0);
  const materialStartConflict = policyAmbiguity && straddlesThreshold;

  const evaluation: NoShowEvaluation = {
    arrivalZone: zone,
    accuracyPresent,
    maxGapSeconds: maxGap,
    continuityOk,
    earliestStartAt,
    effectiveStartAt,
    elapsedSeconds,
    elapsedUnderEarliestSeconds,
    materialStartConflict,
    policyAmbiguity,
    contactAttempts,
    cancellationAt: cancellation?.timestamp ?? null,
  };

  const nearest = distances.length ? Math.round(Math.min(...distances)) : null;
  const worst = distances.length ? Math.round(Math.max(...distances)) : null;

  findings.push({
    id: 'F-ZONE',
    kind: 'computed',
    text:
      nearest === null
        ? `No stationary GPS samples are available, so pickup-zone presence cannot be measured against the ${thresholds.pickupRadiusMeters} m radius.`
        : `Stationary driver samples place the vehicle between ${nearest} m and ${worst} m from the pickup point. With the reported accuracy radii against a ${thresholds.pickupRadiusMeters} m radius, the zone determination is "${zone}".`,
    evidenceIds: gpsItems.map((item) => item.id),
    policyIds: ['NS-01'],
    material: true,
  });
  materialEvidenceIds.push(...gpsItems.map((item) => item.id));

  findings.push({
    id: 'F-GAP',
    kind: 'computed',
    text:
      maxGap === null
        ? 'Fewer than two stationary samples exist, so waiting continuity cannot be established.'
        : `Largest gap between stationary samples is ${maxGap} s against a continuity limit of ${thresholds.continuityLimitSeconds} s.`,
    evidenceIds: gpsItems.map((item) => item.id),
    policyIds: ['NS-02'],
    material: true,
  });

  findings.push({
    id: 'F-START',
    kind: 'computed',
    text:
      effectiveStartAt && elapsedSeconds !== null
        ? official
          ? `Recorded “I'm Here” time is ${formatSingapore(effectiveStartAt)}. Elapsed time to driver no-show cancellation is ${elapsedSeconds} s; Ryde's published condition requires more than ${thresholds.noShowThresholdSeconds} s.`
          : `Effective waiting start is ${formatSingapore(effectiveStartAt)}, the latest of arrival, scheduled pickup and timer start. Elapsed time to cancellation is ${elapsedSeconds} s against a ${thresholds.noShowThresholdSeconds} s no-show threshold.`
        : 'Effective waiting start cannot be computed because arrival, scheduled pickup and cancellation times are not all present.',
    evidenceIds: [arrival?.id, timerStart?.id, cancellation?.id].filter(
      (id): id is string => Boolean(id),
    ),
    policyIds: ['NS-03', 'NS-04'],
    material: true,
  });

  findings.push({
    id: 'F-CONTACT',
    kind: 'observation',
    text: `${contactAttempts} evidenced contact attempt(s) are recorded. A sent notification proves attempted notification, not receipt.`,
    evidenceIds: caseRecord.evidence
      .filter((item) => item.kind === 'call' || item.kind === 'chat')
      .map((item) => item.id),
    policyIds: ['NS-05'],
    material: true,
  });

  if (contactAttempts > 0) issues.push(CONTACT_ISSUE);
  if (!accuracyPresent) {
    issues.push(
      'No GPS accuracy radius is recorded, so an automatic pickup-zone determination is not possible.',
    );
  }

  if (materialStartConflict) {
    findings.push({
      id: 'F-CONFLICT',
      kind: 'unknown',
      text: `The choice of governing waiting clock changes the outcome: ${elapsedUnderEarliestSeconds} s from the earliest candidate start versus ${elapsedSeconds} s from the latest, against a ${thresholds.noShowThresholdSeconds} s threshold.`,
      evidenceIds: [arrival?.id, timerStart?.id, cancellation?.id].filter(
        (id): id is string => Boolean(id),
      ),
      policyIds: ['NS-06'],
      material: true,
    });
    issues.push(
      'Material timestamp conflict: the governing waiting clock is not established by the evidence.',
    );
  }

  if (earlyAdvance) {
    issues.push('The driver arrived before the advance pickup time. The retrieved policy does not establish how early arrival affects the no-show clock; a policy owner must clarify it.');
  } else if (policyAmbiguity) {
    issues.push(
      `A supplied sample policy (${caseRecord.suppliedPolicyId}) is attached but does not define which clock governs the waiting period. It is stored separately and is not merged into the governing policy.`,
    );
  } else if (startSpread > 0 && effectiveStartAt) {
    issues.push(
      `Arrival, scheduled pickup and timer start differ by ${startSpread} s. The demo policy takes the latest of the three, so the effective waiting start is ${formatSingapore(effectiveStartAt)}.`,
    );
  }

  if (!continuityOk) {
    issues.push(
      `Sampling gap of ${maxGap} s exceeds the ${thresholds.continuityLimitSeconds} s continuity limit. Continuous presence is not asserted across that gap.`,
    );
  }

  let disposition: Disposition = 'human_review';
  let refundCents: number | null = null;

  if (earlyAdvance) {
    disposition = 'human_review';
  } else if (zone === 'outside' || hasContraryOffZoneSample(samples, caseRecord.trip.pickup, thresholds.pickupRadiusMeters)) {
    disposition = 'refund';
    refundCents = caseRecord.disputedCents;
  } else if (zone === 'indeterminate') {
    disposition = 'human_review';
  } else if (samples.length === 0 || !arrival || !cancellation) {
    disposition = 'human_review';
    issues.push('Missing material no-show evidence: arrival or cancellation record is absent.');
  } else if (!continuityOk) {
    disposition = 'human_review';
  } else if (materialStartConflict) {
    disposition = 'human_review';
  } else if (elapsedSeconds === null) {
    disposition = 'human_review';
  } else if (!thresholdMet(elapsedSeconds)) {
    disposition = 'refund';
    refundCents = caseRecord.disputedCents;
  } else if (contactAttempts === 0) {
    disposition = official ? 'human_review' : 'refund';
    refundCents = official ? null : caseRecord.disputedCents;
    issues.push(
      official ? 'Ryde advises attempting in-app contact. No attempt is evidenced; Rydr requests review rather than treating this as an official automatic-refund rule.' : 'No evidenced contact attempt is recorded, which the demo policy requires before a no-show fee is charged.',
    );
  } else {
    disposition = 'uphold';
    // A decided outcome of zero refund. Null is reserved for a deferred decision.
    refundCents = 0;
  }

  return {
    evaluation,
    disposition,
    refundCents,
    findings,
    issues,
    materialEvidenceIds,
  };
}

function evaluateRoute(
  caseRecord: CaseRecord,
  thresholds: PolicyThresholds,
  official = false,
): {
  evaluation: RouteEvaluation;
  disposition: Disposition;
  refundCents: number | null;
  findings: Finding[];
  issues: string[];
  materialEvidenceIds: string[];
} {
  const findings: Finding[] = [];
  const issues: string[] = [];
  const materialEvidenceIds: string[] = [];

  const routeItems = routeEvidence(caseRecord.evidence);
  const primary = routeItems[0] ?? null;

  const comparison = compareRoutes(
    primary
      ? {
          plannedDistanceM: primary.payload.plannedDistanceM,
          actualDistanceM: primary.payload.actualDistanceM,
          gpsSegmentSumM: primary.payload.gpsSegmentSumM,
        }
      : { plannedDistanceM: null, actualDistanceM: null, gpsSegmentSumM: null },
    {
      excessPercent: thresholds.routeExcessPercent,
      excessMeters: thresholds.routeExcessMeters,
    },
  );

  const justification = primary?.payload.justification ?? 'unknown';

  const payments = collectPayments(caseRecord.evidence);
  const declaredTotal = payments.find((p) => p.payload.component === 'final_fare');
  const components = payments.filter((p) => p.payload.component !== 'final_fare');
  const ledger = reconcileLedger(
    components.map((p) => ({
      component: p.payload.component,
      amountCents: p.payload.amountCents,
    })),
    declaredTotal?.payload.amountCents ?? 0,
  );

  const surcharge = excessRouteSurchargeCents(caseRecord.evidence);

  const evaluation: RouteEvaluation = {
    comparison,
    justification,
    ledgerReconciled: ledger.reconciled,
    ledgerDifferenceCents: ledger.differenceCents,
    surchargeCents: surcharge?.amountCents ?? null,
  };

  if (primary) materialEvidenceIds.push(primary.id);

  findings.push({
    id: 'F-ROUTE',
    kind: 'computed',
    text: comparison.measurable
      ? `Planned route ${comparison.plannedDistanceM} m versus actual route ${comparison.actualDistanceM} m: excess ${comparison.excessMeters} m (${comparison.excessPercent?.toFixed(1)}%). Deviation flag is ${comparison.deviationFlagged ? 'raised' : 'not raised'} against thresholds of ${thresholds.routeExcessMeters} m and ${thresholds.routeExcessPercent}%.`
      : 'Planned or actual route length is missing, so route deviation cannot be measured.',
    evidenceIds: routeItems.map((item) => item.id),
    policyIds: ['RT-01', 'RT-02'],
    material: true,
  });

  findings.push({
    id: 'F-LEDGER',
    kind: 'computed',
    text: `Fare ledger components sum to ${ledger.componentSumCents} cents against a declared final fare of ${ledger.finalFareCents} cents. Reconciled: ${ledger.reconciled ? 'yes' : 'no'}.`,
    evidenceIds: payments.map((payment) => payment.id),
    policyIds: ['RT-05'],
    material: true,
  });
  materialEvidenceIds.push(...payments.map((payment) => payment.id));

  findings.push({
    id: 'F-JUSTIFICATION',
    kind: 'observation',
    text: `Trip-linked justification status is "${justification}". ${primary?.payload.justificationNote ?? 'No justification note is recorded.'} Absence of a note is unknown, not proof that no justification existed.`,
    evidenceIds: primary ? [primary.id] : [],
    policyIds: ['RT-03', 'RT-04'],
    material: true,
  });

  let disposition: Disposition = 'human_review';
  let refundCents: number | null = null;

  if (official) {
    disposition = 'human_review';
    issues.push('Review the fixed quote, approved changes and receipt. Prototype route thresholds are evidence flags, not an official refund formula.');
  } else if (!comparison.measurable) {
    disposition = 'human_review';
    issues.push('Missing material route evidence: planned or actual route length is unavailable.');
  } else if (!ledger.reconciled) {
    disposition = 'human_review';
    issues.push(
      `Fare ledger does not reconcile: components differ from the declared final fare by ${ledger.differenceCents} cents.`,
    );
  } else if (!comparison.deviationFlagged) {
    disposition = 'uphold';
    refundCents = 0;
  } else if (justification === 'unknown') {
    disposition = 'human_review';
    issues.push(
      'Deviation exceeds thresholds but the justification status is unknown, and a material excess charge is present.',
    );
  } else if (justification === 'verified_justification') {
    disposition = 'uphold';
    refundCents = 0;
  } else if (surcharge === null) {
    disposition = 'human_review';
    issues.push(
      'A verified unjustified deviation is established but no eligible excess-route surcharge component can be identified, so a deterministic refund amount cannot be computed.',
    );
  } else {
    disposition = 'refund';
    // Deterministic amount, capped at the disputed charge. Integer cents only.
    refundCents = capCents(surcharge.amountCents, caseRecord.disputedCents);
    findings.push({
      id: 'F-REFUND',
      kind: 'computed',
      text: `Eligible excess-route surcharge is ${surcharge.amountCents} cents, capped at the disputed amount of ${caseRecord.disputedCents} cents. Deterministic refund: ${refundCents} cents.`,
      evidenceIds: [surcharge.id],
      policyIds: ['RT-05'],
      material: true,
    });
    materialEvidenceIds.push(surcharge.id);
  }

  return { evaluation, disposition, refundCents, findings, issues, materialEvidenceIds };
}

/** Safety allegations route to a human reviewer and are never resolved by the model. */
export function screenSafetyAllegations(caseRecord: CaseRecord): string[] {
  const corpus = textCorpus(caseRecord);
  const markers = [
    'assault',
    'unsafe',
    'threatened',
    'threatening',
    'accident',
    'injury',
    'injured',
    'harass',
    'sexual',
    'weapon',
    'reckless driving',
    'dangerous driving',
    'felt unsafe',
    'inappropriate behavior',
    'inappropriate behaviour',
  ];
  return markers.filter((marker) => corpus.includes(marker));
}

/**
 * History is review-routing context only. It never grants or refuses a refund and
 * never changes the amount (product spec sections 7 and 11).
 */
export function screenHistoryRisk(caseRecord: CaseRecord): string[] {
  const reasons: string[] = [];
  for (const item of evidenceOfKind(caseRecord.evidence, 'history')) {
    const { subject, fraudFlags, disputeCount, avgRating } = item.payload;
    if (fraudFlags !== null && fraudFlags > 0) {
      reasons.push(`${subject} account history records ${fraudFlags} risk flag(s).`);
    }
    if (disputeCount !== null && disputeCount >= 6) {
      reasons.push(`${subject} account history records ${disputeCount} prior disputes.`);
    }
    if (avgRating !== null && avgRating < 3) {
      reasons.push(`${subject} average rating is ${avgRating.toFixed(1)}.`);
    }
  }
  return reasons;
}

function evaluateDamage(caseRecord: CaseRecord): {
  disposition: Disposition;
  refundCents: number | null;
  findings: Finding[];
  issues: string[];
  materialEvidenceIds: string[];
  evaluation: DamageEvaluation;
} {
  const images = evidenceOfKind(caseRecord.evidence, 'image');
  const integrity = assessImageIntegrity({
    evidence: caseRecord.evidence,
    tripScheduledAt: caseRecord.trip.scheduledAt,
  });

  const findings: Finding[] = [];
  if (images.length > 0) {
    findings.push({
      id: 'F-DAMAGE-IMAGES',
      kind: 'observation',
      text: `${images.length} image(s) submitted as damage evidence.`,
      evidenceIds: images.map((i) => i.id),
      policyIds: ['DM-01'],
      material: true,
    });
  }
  for (const [index, signal] of integrity.signals.entries()) {
    findings.push({
      id: `F-DAMAGE-${signal.code.toUpperCase()}-${index + 1}`,
      kind: 'observation',
      text: signal.explanation,
      evidenceIds: signal.evidenceIds,
      policyIds: ['DM-02'],
      material: true,
    });
  }

  const issues: string[] = [
    'Damage claims require human approval in this prototype.',
    ...(images.length === 0 ? ['No image evidence was submitted.'] : []),
    ...integrity.signals.map((s) => s.explanation),
  ];

  return {
    disposition: 'human_review',
    refundCents: null,
    findings,
    issues,
    materialEvidenceIds: images.map((i) => i.id),
    evaluation: {
      imagesPresent: images.length > 0,
      imageCount: images.length,
      integritySeverity: integrity.overallSeverity,
      humanApprovalRequired: true,
    },
  };
}

export function evaluateCase(
  caseRecord: CaseRecord,
  pack: PolicyPack,
): DeterministicEvaluation {
  const thresholds = demoThresholds(pack);
  const result =
    caseRecord.category === 'no_show_charge'
      ? evaluateNoShow(caseRecord, thresholds, pack.source === 'ryde_official' && (pack.officialScope === 'on_demand_no_show' || pack.officialScope === 'advance_no_show') ? pack.officialScope : undefined)
      : caseRecord.category === 'route_overcharge'
        ? evaluateRoute(caseRecord, thresholds, pack.source === 'ryde_official')
        : evaluateDamage(caseRecord);

  if (pack.source === 'ryde_official') {
    const scopeMatches =
      (pack.officialScope === 'on_demand_no_show' && caseRecord.category === 'no_show_charge' && caseRecord.trip.bookingType === 'on_demand') ||
      (pack.officialScope === 'advance_no_show' && caseRecord.category === 'no_show_charge' && caseRecord.trip.bookingType === 'advance' && caseRecord.trip.scheduledAt !== null) ||
      (pack.officialScope === 'fixed_fare' && caseRecord.category === 'route_overcharge' && caseRecord.trip.fareType === 'fixed') ||
      (pack.officialScope === 'cleaning' && caseRecord.category === 'damage');
    const completedTrip = evidenceOfKind(caseRecord.evidence, 'trip_event').some(item => item.payload.eventType === 'trip_completed');
    const noShowScope = pack.officialScope === 'on_demand_no_show' || pack.officialScope === 'advance_no_show';
    const rules = pack.clauses.filter(clause => clause.authority === 'official_ryde' && clause.category === caseRecord.category);
    result.findings.push(...rules.map(clause => ({ id: `F-POLICY-${clause.id}`, kind: 'observation' as const,
      text: `Published Ryde policy (paraphrase): ${clause.text}`, evidenceIds: [], policyIds: [clause.id], material: true })));
    const arrival = findTripEvent(caseRecord.evidence, 'driver_pressed_im_here');
    const cancel = findTripEvent(caseRecord.evidence, 'driver_cancelled_no_show');
    const earliestEvidence = caseRecord.evidence.map(item => item.timestamp).filter((at): at is string => Boolean(at)).sort((a,b) => Date.parse(a) - Date.parse(b))[0];
    const incidentDate = earliestEvidence ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(earliestEvidence)) : null;
    const historicalScopeUnknown = pack.effectiveFrom === null && (!incidentDate || incidentDate < pack.retrievedAt);
    if (!scopeMatches || historicalScopeUnknown || caseRecord.suppliedPolicyId !== null || (noShowScope && (caseRecord.disputedCents !== 661 || completedTrip || !arrival || !cancel || Date.parse(cancel.timestamp) < Date.parse(arrival.timestamp)))) {
      result.disposition = 'human_review'; result.refundCents = null;
      result.issues.push('Official-policy applicability is unresolved: confirm booking/fare type, charge basis and whether the trip completed. Supplied sample rules are never replaced by a current website policy.');
      if (historicalScopeUnknown) result.issues.push('The trip predates the retrieved snapshot or its date is missing. The policy effective date is unconfirmed; do not apply this snapshot automatically to historical trips.');
    }
    if (pack.officialScope === 'fixed_fare') {
      // The public pages do not establish an automatic route-length refund formula.
      result.disposition = 'human_review'; result.refundCents = null;
      result.issues.push('Ryde generally uses fixed quoted fares outside RydeTAXI, while tolls or accepted destination changes may alter charges. Review the quote, receipt and approved changes; route length alone cannot establish a refund.');
    }
    if (pack.officialScope === 'cleaning') {
      result.issues.push('Apply Ryde cleaning-claim requirements: trip linkage, vehicle-plate photo, professional-cleaning receipt and submission deadlines. Fee tiers are caps, not automatic charges; a reviewer must verify incident type and costs.');
    }
  }

  const claims: Finding[] = [
    {
      id: 'F-CLAIM-RIDER',
      kind: 'claim',
      text: caseRecord.riderStatement
        ? `Rider statement: ${caseRecord.riderStatement}`
        : 'No rider statement supplied.',
      evidenceIds: [],
      policyIds: [],
      material: true,
    },
    {
      id: 'F-CLAIM-DRIVER',
      kind: 'claim',
      text: caseRecord.driverStatement
        ? `Driver statement: ${caseRecord.driverStatement}`
        : 'No driver statement supplied. A driver position may only be inferred from evidence with explicit attribution.',
      evidenceIds: [],
      policyIds: [],
      material: true,
    },
  ];

  const policyIds = Array.from(
    new Set(result.findings.flatMap((finding) => finding.policyIds)),
  ).sort();

  return applyReferencePolicy(caseRecord, pack, {
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    category: caseRecord.category,
    disposition: result.disposition,
    recommendedRefundCents: result.refundCents,
    findings: [...result.findings, ...claims],
    issues: result.issues,
    materialEvidenceIds: Array.from(new Set(result.materialEvidenceIds)),
    policyIds,
    noShow:
      caseRecord.category === 'no_show_charge'
        ? (result as ReturnType<typeof evaluateNoShow>).evaluation
        : null,
    route:
      caseRecord.category === 'route_overcharge'
        ? (result as ReturnType<typeof evaluateRoute>).evaluation
        : null,
    damage:
      caseRecord.category === 'damage'
        ? (result as ReturnType<typeof evaluateDamage>).evaluation
        : null,
  });
}
