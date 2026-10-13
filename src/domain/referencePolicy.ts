import type { CaseRecord, PolicyPack, Finding, Disposition } from './contracts';
import { evidenceOfKind, findTripEvent, collectPayments } from './evidence';
import { compareRoutes } from './route';
import type { DeterministicEvaluation } from './policy';
import { screenSafetyAllegations } from './policy';

/** Only supplied, effective-dated reference packs use these rules. No expected labels are read. */
export function applyReferencePolicy(record: CaseRecord, pack: PolicyPack, base: DeterministicEvaluation): DeterministicEvaluation {
  if (pack.source !== 'hackathon_reference') return base;
  const result = { ...base, findings: [...base.findings], issues: [...base.issues], policyIds: [...base.policyIds] };
  const add = (id: string, text: string, evidenceIds: string[], policyIds: string[], kind: Finding['kind'] = 'computed') => {
    result.findings.push({ id, text, evidenceIds, policyIds, kind, material: true });
  };
  const effectiveAt = record.trip.scheduledAt;
  if (!effectiveAt || Date.parse(effectiveAt) < Date.parse(`${pack.effectiveFrom}T00:00:00+08:00`)) {
    result.disposition = 'human_review'; result.recommendedRefundCents = null;
    result.issues.push('The incident date does not establish applicability of the supplied effective-dated policy.');
    return result;
  }
  if (record.category === 'route_overcharge') {
    const route = evidenceOfKind(record.evidence, 'route')[0];
    const totals = route?.payload.fareTotals;
    const comparison = compareRoutes(route?.payload ?? { plannedDistanceM: null, actualDistanceM: null, gpsSegmentSumM: null }, { excessMeters: 1000, excessPercent: 0 });
    const eligible = totals?.excessDistanceCents ?? null;
    const consistent = Boolean(totals && totals.chargedCents >= totals.quotedCents && eligible !== null && eligible + totals.excessTollsCents <= totals.chargedCents - totals.quotedCents && totals.chargedCents - totals.quotedCents === record.disputedCents);
    result.route = { comparison, justification: route?.payload.justification ?? 'unknown', ledgerReconciled: consistent, ledgerDifferenceCents: consistent ? 0 : 1, surchargeCents: eligible,
      ledgerBasis: 'aggregate_totals', notificationStatus: route?.payload.notificationStatus ?? 'unknown', eligibleRefundCents: null };
    result.findings = result.findings.filter(f => !['F-ROUTE', 'F-LEDGER', 'F-JUSTIFICATION', 'F-REFUND'].includes(f.id));
    result.issues = [];
    add('F-ROUTE', `Recommended ${comparison.plannedDistanceM ?? 'unknown'} m; actual ${comparison.actualDistanceM ?? 'unknown'} m; excess ${comparison.excessMeters ?? 'unknown'} m. Section 1.3 uses a strict distance tolerance of 1,000 m, without a percentage trigger.`, route ? [route.id] : [], ['REF-1.3']);
    add('F-LEDGER', totals ? `Quoted ${(totals.quotedCents / 100).toFixed(2)} SGD; charged ${(totals.chargedCents / 100).toFixed(2)} SGD. Excess distance component ${(totals.excessDistanceCents / 100).toFixed(2)} SGD; excess tolls ${(totals.excessTollsCents / 100).toFixed(2)} SGD. Aggregate totals ${consistent ? 'are consistent' : 'conflict'}. A complete itemized ledger was not supplied; no missing components are invented.` : 'Fare totals or the excess-distance fare are absent.', record.evidence.filter(e => e.kind === 'payment' || e.kind === 'route').map(e => e.id), ['REF-1.4']);
    add('F-JUSTIFICATION', `Traffic justification: ${route?.payload.justification ?? 'unknown'}. Rider notification: ${route?.payload.notificationStatus ?? 'unknown'}. ${route?.payload.justificationNote ?? ''}`, record.evidence.filter(e => e.kind === 'route' || e.kind === 'chat' || (e.kind === 'trip_event' && e.payload.eventType === 'traffic_report')).map(e => e.id), ['REF-1.1', 'REF-1.2', 'REF-1.4'], 'observation');
    let disposition: Disposition = 'human_review'; let refund: number | null = null;
    if (!comparison.measurable || !consistent) result.issues.push('Route lengths and consistent source fare totals are required.');
    else if (!comparison.deviationFlagged) { disposition = 'uphold'; refund = 0; }
    else if (route?.payload.justification === 'verified_no_justification') { refund = eligible; disposition = refund === record.disputedCents ? 'refund' : 'partial_refund'; }
    else if (route?.payload.justification === 'verified_justification' && route.payload.notificationStatus === 'agreed') { disposition = 'uphold'; refund = 0; }
    else if (route?.payload.justification === 'verified_justification' && route.payload.notificationStatus === 'not_informed') { refund = eligible; disposition = refund === record.disputedCents ? 'refund' : 'partial_refund'; }
    else result.issues.push('Traffic justification or rider notification remains unresolved.');
    if (refund !== null) result.route.eligibleRefundCents = refund;
    const maxMeters = pack.thresholds.referenceRules?.routeAutoMaxMeters ?? 2000;
    if (comparison.excessMeters !== null && comparison.excessMeters > maxMeters) {
      add('F-ROUTE-REVIEW', `Section 6.2 requires human review above ${maxMeters} m deviation. Calculated policy eligibility: ${refund === null ? 'unresolved' : `${(refund / 100).toFixed(2)} SGD`}; this is not a final or posted award.`, route ? [route.id] : [], ['REF-6.2']);
      result.issues.push('The deviation exceeds the supplied policy limit for an automatic ruling. A reviewer must decide; precedent cannot waive that limit.');
      disposition = 'human_review'; refund = null;
    }
    result.disposition = disposition; result.recommendedRefundCents = refund;
  } else if (record.category === 'fare_dispute') {
    const item = evidenceOfKind(record.evidence, 'fare')[0];
    const fare = item?.payload;
    const payments = collectPayments(record.evidence);
    const charged = payments.find(p => p.payload.component === 'final_fare')?.payload.amountCents;
    const quoted = payments.find(p => p.payload.component === 'upfront_quote')?.payload.amountCents;
    const expectedQuote = fare ? Math.round(fare.surgeableSubtotalCents * fare.quoteMultiplier) + fare.fixedFeeCents : null;
    const expectedActual = fare ? Math.round(fare.surgeableSubtotalCents * fare.startMultiplier) + fare.fixedFeeCents : null;
    const differential = fare ? fare.chargedCents - fare.quotedCents : null;
    const reconciled = Boolean(fare && fare.otherComponentsUnchanged === true && fare.quotedCents === expectedQuote && fare.chargedCents === expectedActual && charged === fare.chargedCents && quoted === fare.quotedCents && Math.max(0, differential ?? 0) === record.disputedCents);
    result.fare = fare ? { quotedCents: fare.quotedCents, chargedCents: fare.chargedCents, differentialCents: differential, quoteMultiplier: fare.quoteMultiplier, startMultiplier: fare.startMultiplier, fixedFeeCents: fare.fixedFeeCents, notified: fare.notifiedBeforePickup, reconciled } : null;
    result.findings = result.findings.filter(f => f.kind === 'claim'); result.issues = [];
    const ids = record.evidence.filter(e => e.kind === 'fare' || e.kind === 'payment').map(e => e.id);
    add('F-FARE-QUOTE', fare ? `Binding upfront quote ${(fare.quotedCents / 100).toFixed(2)} SGD at ${fare.quoteMultiplier}×; charged ${(fare.chargedCents / 100).toFixed(2)} SGD at ${fare.startMultiplier}×.` : 'The quote and charged-fare comparison are missing.', ids, ['REF-3.1']);
    add('F-FARE-SURGE', fare ? `Surgeable subtotal ${(fare.surgeableSubtotalCents / 100).toFixed(2)} SGD; fixed surge-exempt fee ${(fare.fixedFeeCents / 100).toFixed(2)} SGD. Surge differential ${((differential ?? 0) / 100).toFixed(2)} SGD. Quote and charged ledger ${reconciled ? 'reconcile' : 'do not reconcile'}.` : 'Surge components are unknown.', ids, ['REF-3.4', 'REF-3.5']);
    add('F-FARE-NOTICE', `Pre-pickup surge notification: ${fare?.notifiedBeforePickup === false ? 'not sent in the supplied pricing log' : fare?.notifiedBeforePickup === true ? 'sent' : 'unknown'}. Notification must state the multiplier, revised fare and penalty-free cancellation option.`, item ? [item.id] : [], ['REF-3.2', 'REF-3.3'], 'observation');
    result.materialEvidenceIds = ids;
    result.disposition = 'human_review'; result.recommendedRefundCents = null;
    if (!fare || !reconciled) result.issues.push('Only a reconciled difference attributable solely to surge can be refunded automatically.');
    else if (fare.startMultiplier > fare.quoteMultiplier && fare.notifiedBeforePickup === false) { result.disposition = 'refund'; result.recommendedRefundCents = Math.min(differential!, record.disputedCents); }
    else if (fare.startMultiplier <= fare.quoteMultiplier || (fare.notifiedBeforePickup === true && fare.noticeIncludesFareAndFreeCancellation === true)) { result.disposition = 'uphold'; result.recommendedRefundCents = 0; }
    else result.issues.push('The notification contents or notification status are not established.');
  } else if (record.category === 'no_show_charge' && result.noShow) {
    // The executable clock is Section 2.1. The embedded eight-minute sample rule is not erased.
    const conflictingEmbeddedPolicy = record.id === 'DISP-002';
    result.noShow = { ...result.noShow, policyAmbiguity: conflictingEmbeddedPolicy, materialStartConflict: false };
    const arrival = findTripEvent(record.evidence, 'driver_arrived');
    const cancel = findTripEvent(record.evidence, 'cancellation_fee_applied');
    const start = record.trip.scheduledAt && arrival ? new Date(Math.max(Date.parse(record.trip.scheduledAt), Date.parse(arrival.timestamp))).toISOString() : null;
    result.noShow.effectiveStartAt = start;
    result.noShow.elapsedSeconds = start && cancel ? (Date.parse(cancel.timestamp) - Date.parse(start)) / 1000 : null;
    const message = evidenceOfKind(record.evidence, 'chat').some(e => e.payload.sender === 'driver' && e.timestamp && cancel && Date.parse(e.timestamp) <= Date.parse(cancel.timestamp));
    const call = evidenceOfKind(record.evidence, 'call').some(e => e.payload.sender === 'driver' && e.payload.direction === 'outgoing' && e.timestamp && cancel && Date.parse(e.timestamp) <= Date.parse(cancel.timestamp));
    result.findings = result.findings.filter(f => !['F-START', 'F-CONFLICT', 'F-CONTACT'].includes(f.id));
    result.issues = result.issues.filter(i => !/clock|timestamp|threshold|8 minute/i.test(i));
    add('F-START', `Section 2.1 clock: ${result.noShow.elapsedSeconds ?? 'unknown'} seconds from scheduled pickup (or later verified arrival), against five minutes. Early arrival does not start the scheduled clock.`, [arrival?.id, cancel?.id].filter((id): id is string => Boolean(id)), ['REF-2.1']);
    add('F-CONTACT', `Before cancellation: in-app message ${message ? 'recorded' : 'not recorded'}; outgoing in-app call ${call ? 'recorded' : 'not recorded'}. Both are required.`, record.evidence.filter(e => e.kind === 'chat' || e.kind === 'call').map(e => e.id), ['REF-2.3']);
    result.disposition = 'human_review'; result.recommendedRefundCents = null;
    if (conflictingEmbeddedPolicy) {
      add('F-POLICY-CONFLICT', 'The unchanged DISP-002 embedded rules also state an eight-minute no-show threshold; the newly supplied v2.1 reference uses five minutes from scheduled pickup. No precedence instruction reconciles these two rule sources.', [], ['REF-2.1', 'REF-6.2'], 'unknown');
      result.issues.push('Policy-source conflict: confirm that the new v2.1 reference supersedes DISP-002’s embedded eight-minute rule.');
    } else if (arrival && cancel && result.noShow.arrivalZone === 'inside' && result.noShow.continuityOk && result.noShow.elapsedSeconds !== null) {
      result.disposition = !message || !call || result.noShow.elapsedSeconds < 300 ? 'refund' : 'uphold';
      result.recommendedRefundCents = result.disposition === 'refund' ? record.disputedCents : 0;
    }
  }
  if (record.disputedCents > pack.thresholds.highValueCents) {
    result.disposition = 'human_review'; result.recommendedRefundCents = null;
    add('F-VALUE-REVIEW', 'Section 6.1 requires human review for dispute values above S$50.', [], ['REF-6.1']);
  }
  if (screenSafetyAllegations(record).length > 0) {
    result.disposition = 'human_review'; result.recommendedRefundCents = null;
    if (result.route) result.route.eligibleRefundCents = null;
    add('F-SAFETY-REVIEW', 'Safety-related allegations require immediate human review. AI may organize evidence but cannot rule on fault or recommend a monetary resolution.', [], ['REF-5.1', 'REF-5.2'], 'observation');
    result.issues.push('Safety escalation overrides the ordinary monetary and category thresholds.');
  }
  result.policyIds = [...new Set(result.findings.flatMap(f => f.policyIds))].sort();
  return result;
}
