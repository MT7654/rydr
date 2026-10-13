import type { CaseRecord, EvidenceItem } from './contracts';
import { haversineMeters } from './geo';
import { assessImageIntegrity } from './imageEvidence';
import { evidenceOfKind } from './evidence';

/**
 * Integrity assessment: deterministic tampering-signal detection.
 *
 * This runs in parallel with the advocate pipeline. It never blocks the main
 * run, and its result does not change the judge's disposition. When it finds
 * signals of sufficient severity it raises a separate review task so a human
 * can look at the evidence before the case is settled.
 */

export type IntegritySeverity = 'none' | 'low' | 'medium' | 'high';

export interface IntegritySignal {
  code: string;
  severity: Exclude<IntegritySeverity, 'none'>;
  evidenceIds: string[];
  explanation: string;
}

export interface IntegrityAssessment {
  runId: string;
  caseId: string;
  caseVersion: number;
  assessedAt: string;
  overallSeverity: IntegritySeverity;
  signals: IntegritySignal[];
  /** True when the signals are strong enough to warrant a review task. */
  triggersReview: boolean;
}

const SEVERITY_RANK: Record<IntegritySeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function maxSeverity(a: IntegritySeverity, b: IntegritySeverity): IntegritySeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** km/h above which two GPS samples are considered impossible in this context. */
const IMPOSSIBLE_SPEED_KMH = 120;

/* ------------------------------------------------------------------ */
/*  Signal detectors                                                   */
/* ------------------------------------------------------------------ */

function detectDuplicateIds(evidence: EvidenceItem[]): IntegritySignal | null {
  const seen = new Map<string, string[]>();
  for (const item of evidence) {
    const list = seen.get(item.id) ?? [];
    list.push(item.id);
    seen.set(item.id, list);
  }
  const duplicates = Array.from(seen.entries()).filter(([, list]) => list.length > 1);
  if (duplicates.length === 0) return null;
  const ids = duplicates.map(([id]) => id);
  return {
    code: 'duplicate_evidence_ids',
    severity: 'medium',
    evidenceIds: ids,
    explanation: `Duplicate evidence ID(s): ${ids.join(', ')}. This may indicate copy-paste tampering.`,
  };
}

function detectImpossibleChronology(evidence: EvidenceItem[]): IntegritySignal | null {
  const events = evidenceOfKind(evidence, 'trip_event')
    .filter((e) => e.timestamp !== null)
    .map((e) => ({ type: e.payload.eventType, at: Date.parse(e.timestamp as string), id: e.id }))
    .sort((a, b) => a.at - b.at);

  const order: string[] = [];
  for (const ev of events) order.push(ev.type);

  const idx = (type: string) => order.indexOf(type);
  const bad: string[] = [];

  const arrived = idx('driver_arrived');
  const started = idx('wait_timer_started');
  const expired = idx('wait_timer_expired');
  const cancelled = idx('cancellation_fee_applied');
  const booked = idx('booking_confirmed');

  if (booked !== -1) {
    if (arrived !== -1 && arrived < booked) bad.push('driver_arrived before booking_confirmed');
    if (started !== -1 && started < booked) bad.push('wait_timer_started before booking_confirmed');
  }
  if (arrived !== -1 && started !== -1 && started < arrived) {
    bad.push('wait_timer_started before driver_arrived');
  }
  if (started !== -1 && expired !== -1 && expired < started) {
    bad.push('wait_timer_expired before wait_timer_started');
  }
  if (expired !== -1 && cancelled !== -1 && cancelled < expired) {
    bad.push('cancellation_fee_applied before wait_timer_expired');
  }
  if (arrived !== -1 && cancelled !== -1 && cancelled < arrived) {
    bad.push('cancellation_fee_applied before driver_arrived');
  }

  if (bad.length === 0) return null;
  return {
    code: 'impossible_chronology',
    severity: 'high',
    evidenceIds: events.map((e) => e.id),
    explanation: `Impossible event order: ${bad.join('; ')}.`,
  };
}

function detectGpsImpossibleSpeed(evidence: EvidenceItem[]): IntegritySignal | null {
  const gps = evidenceOfKind(evidence, 'gps')
    .filter((item) => item.timestamp !== null)
    .map((item) => ({
      id: item.id,
      at: Date.parse(item.timestamp as string),
      lat: item.payload.lat,
      lng: item.payload.lng,
    }))
    .sort((a, b) => a.at - b.at);

  const bad: string[] = [];
  for (let i = 1; i < gps.length; i += 1) {
    const prev = gps[i - 1]!;
    const curr = gps[i]!;
    const dtHours = (curr.at - prev.at) / 1000 / 3600;
    if (dtHours <= 0) continue;
    const distKm = haversineMeters(prev, curr) / 1000;
    const speedKmh = distKm / dtHours;
    if (speedKmh > IMPOSSIBLE_SPEED_KMH) {
      bad.push(`${prev.id} → ${curr.id} (${Math.round(speedKmh)} km/h)`);
    }
  }

  if (bad.length === 0) return null;
  return {
    code: 'gps_impossible_speed',
    severity: 'high',
    evidenceIds: gps.map((g) => g.id),
    explanation: `GPS samples imply impossible speed: ${bad.join('; ')}.`,
  };
}

function detectPaymentMismatch(caseRecord: CaseRecord): IntegritySignal | null {
  const charges = evidenceOfKind(caseRecord.evidence, 'payment').filter(
    (p) => p.payload.direction === 'charge' && p.payload.status === 'applied',
  );
  const cancellationFees = charges.filter((p) => p.payload.component === 'cancellation_fee');
  const routeCharges = charges.filter((p) => p.payload.component === 'excess_route_surcharge');

  const target = caseRecord.disputedCents;
  const mismatches: string[] = [];

  if (caseRecord.category === 'no_show_charge') {
    for (const fee of cancellationFees) {
      if (fee.payload.amountCents !== target) {
        mismatches.push(
          `${fee.id} records ${fee.payload.amountCents} cents but disputed amount is ${target} cents`,
        );
      }
    }
  }

  if (caseRecord.category === 'route_overcharge') {
    for (const rc of routeCharges) {
      if (rc.payload.amountCents !== target) {
        mismatches.push(
          `${rc.id} records ${rc.payload.amountCents} cents but disputed amount is ${target} cents`,
        );
      }
    }
  }

  if (mismatches.length === 0) return null;
  return {
    code: 'payment_mismatch',
    severity: 'medium',
    evidenceIds: charges.map((p) => p.id),
    explanation: `Payment mismatch: ${mismatches.join('; ')}.`,
  };
}

function detectReusedContent(evidence: EvidenceItem[]): IntegritySignal | null {
  const byKind = new Map<string, EvidenceItem[]>();
  for (const item of evidence) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }

  const bad: string[] = [];
  for (const [, items] of byKind) {
    const fingerprints = new Map<string, string>();
    for (const item of items) {
      const key = JSON.stringify(item.payload);
      const existing = fingerprints.get(key);
      if (existing && existing !== item.id) {
        bad.push(`${existing} and ${item.id}`);
      }
      fingerprints.set(key, item.id);
    }
  }

  if (bad.length === 0) return null;
  return {
    code: 'reused_evidence_content',
    severity: 'low',
    evidenceIds: evidence.map((e) => e.id),
    explanation: `Identical payload content across different evidence IDs: ${bad.join('; ')}.`,
  };
}

function detectMissingProvenance(evidence: EvidenceItem[]): IntegritySignal | null {
  const bad = evidence.filter(
    (item) =>
      !item.source.dataset ||
      !item.source.jsonPointer ||
      !item.source.provenance,
  );
  if (bad.length === 0) return null;
  return {
    code: 'missing_provenance',
    severity: 'low',
    evidenceIds: bad.map((item) => item.id),
    explanation: `${bad.length} evidence item(s) missing dataset, JSON pointer or provenance.`,
  };
}

function detectContradictoryClaims(caseRecord: CaseRecord): IntegritySignal | null {
  const bad: string[] = [];
  for (const item of caseRecord.evidence) {
    for (const claim of item.claims ?? []) {
      if (claim.field === 'gps_accuracy_meters' && item.kind === 'gps') {
        const measured = item.payload.accuracyMeters;
        if (measured !== null && measured !== claim.value) {
          bad.push(
            `${item.id} claim says accuracy ${claim.value} m but measurement is ${measured} m`,
          );
        }
      }
      if (claim.field === 'fare_component_cents' && item.kind === 'payment') {
        const measured = item.payload.amountCents;
        if (measured !== claim.value) {
          bad.push(
            `${item.id} claim says amount ${claim.value} cents but measurement is ${measured} cents`,
          );
        }
      }
    }
  }
  if (bad.length === 0) return null;
  return {
    code: 'contradictory_claim',
    severity: 'medium',
    evidenceIds: caseRecord.evidence.map((e) => e.id),
    explanation: `Contradictory party claim(s): ${bad.join('; ')}.`,
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function assessIntegrity(
  runId: string,
  caseRecord: CaseRecord,
): IntegrityAssessment {
  const signals: IntegritySignal[] = assessImageIntegrity({ evidence: caseRecord.evidence, tripScheduledAt: caseRecord.trip.scheduledAt }).signals.map(signal => ({ ...signal, severity: signal.code === 'duplicate_image' || signal.code === 'mismatched_timestamp' ? 'medium' as const : 'low' as const }));

  const dup = detectDuplicateIds(caseRecord.evidence);
  if (dup) signals.push(dup);

  const chron = detectImpossibleChronology(caseRecord.evidence);
  if (chron) signals.push(chron);

  const gps = detectGpsImpossibleSpeed(caseRecord.evidence);
  if (gps) signals.push(gps);

  const pay = detectPaymentMismatch(caseRecord);
  if (pay) signals.push(pay);

  const reused = detectReusedContent(caseRecord.evidence);
  if (reused) signals.push(reused);

  const prov = detectMissingProvenance(caseRecord.evidence);
  if (prov) signals.push(prov);

  const claims = detectContradictoryClaims(caseRecord);
  if (claims) signals.push(claims);

  let overallSeverity: IntegritySeverity = 'none';
  for (const s of signals) {
    overallSeverity = maxSeverity(overallSeverity, s.severity);
  }

  return {
    runId,
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    assessedAt: new Date().toISOString(),
    overallSeverity,
    signals,
    triggersReview: overallSeverity === 'high' || overallSeverity === 'medium',
  };
}
