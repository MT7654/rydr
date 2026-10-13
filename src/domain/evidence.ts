import type {
  CaseRecord,
  EvidenceClaim,
  EvidenceItem,
  EvidenceKind,
  PaymentPayloadSchema,
} from './contracts';
import type { z } from 'zod';
import type { StationarySample } from './geo';

type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

export function evidenceOfKind<K extends EvidenceKind>(
  evidence: EvidenceItem[],
  kind: K,
): Extract<EvidenceItem, { kind: K }>[] {
  return evidence.filter((item) => item.kind === kind) as Extract<
    EvidenceItem,
    { kind: K }
  >[];
}

export function evidenceById(evidence: EvidenceItem[], id: string): EvidenceItem | null {
  return evidence.find((item) => item.id === id) ?? null;
}

export function assertUniqueEvidenceIds(evidence: EvidenceItem[]): void {
  const seen = new Set<string>();
  for (const item of evidence) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate evidence id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

/** First trip_event matching an event type, or null. */
export function findTripEvent(
  evidence: EvidenceItem[],
  eventType: string,
): { id: string; timestamp: string; details: string } | null {
  const match = evidenceOfKind(evidence, 'trip_event').find(
    (item) => item.payload.eventType === eventType,
  );
  if (!match || match.timestamp === null) return null;
  return { id: match.id, timestamp: match.timestamp, details: match.payload.details };
}

export function collectGpsSamples(evidence: EvidenceItem[]): StationarySample[] {
  return evidenceOfKind(evidence, 'gps')
    .filter((item) => item.timestamp !== null)
    .map((item) => ({
      timestamp: item.timestamp as string,
      lat: item.payload.lat,
      lng: item.payload.lng,
      accuracyMeters: item.payload.accuracyMeters,
      status: item.payload.status,
    }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/**
 * Evidenced contact attempts: driver-initiated messages/calls plus platform
 * notifications. A sent notification proves attempted notification, not receipt.
 */
export function contactAttemptCount(evidence: EvidenceItem[]): number {
  const calls = evidenceOfKind(evidence, 'call').length;
  const driverMessages = evidenceOfKind(evidence, 'chat').filter(
    (item) => item.payload.sender === 'driver',
  ).length;
  const notifications = evidenceOfKind(evidence, 'trip_event').filter(
    (item) => item.payload.eventType === 'rider_notified',
  ).length;
  return calls + driverMessages + notifications;
}

/**
 * True when a measurement on this item rests on a claim nobody has verified.
 *
 * A party-supplied value is recorded as a claim rather than written over the
 * measurement. Until a reviewer marks it verified against a named source, the
 * claim is an assertion awaiting verification — not a measurement. The engine
 * must not let an assertion decide liability, so this is how callers tell the
 * difference.
 */
export function hasUnverifiedClaim(
  item: EvidenceItem,
  field: EvidenceClaim['field'],
): boolean {
  return (item.claims ?? []).some(
    (claim) => claim.field === field && claim.verification.status !== 'verified',
  );
}

/**
 * Payments that may be used for ledger reconciliation.
 *
 * A party-supplied ledger line is admitted only once someone has verified it
 * against a source. Otherwise a typed number would silently change whether the
 * fare reconciles — which is exactly the kind of unverified claim deciding
 * liability that the claim model exists to prevent.
 */
export function collectPayments(evidence: EvidenceItem[]): {
  id: string;
  payload: PaymentPayload;
}[] {
  return evidenceOfKind(evidence, 'payment')
    .filter((item) => !hasUnverifiedClaim(item, 'fare_component_cents'))
    .map((item) => ({
      id: item.id,
      payload: item.payload,
    }));
}

/** The ledger component representing an excess-route surcharge, if identifiable. */
export function excessRouteSurchargeCents(
  evidence: EvidenceItem[],
): { id: string; amountCents: number } | null {
  const match = collectPayments(evidence).find(
    (payment) =>
      payment.payload.component === 'excess_route_surcharge' &&
      payment.payload.direction === 'charge',
  );
  return match ? { id: match.id, amountCents: match.payload.amountCents } : null;
}

export function collectHistory(evidence: EvidenceItem[]) {
  return evidenceOfKind(evidence, 'history').map((item) => ({
    id: item.id,
    payload: item.payload,
  }));
}

export function routeEvidence(evidence: EvidenceItem[]) {
  return evidenceOfKind(evidence, 'route');
}

/**
 * Free-text corpus for safety-allegation screening. Statements and message text
 * are untrusted case content and are never treated as instructions.
 */
export function textCorpus(caseRecord: CaseRecord): string {
  const parts: string[] = [caseRecord.riderStatement, caseRecord.driverStatement ?? ''];
  for (const item of caseRecord.evidence) {
    if (item.kind === 'chat' || item.kind === 'call') parts.push(item.payload.content);
    if (item.kind === 'trip_event') parts.push(item.payload.details);
  }
  return parts.join(' \n ').toLowerCase();
}
