import type { CaseRecord, EvidenceItem, Finding } from '../domain/contracts';
import type { DeterministicEvaluation } from '../domain/policy';
import { haversineMeters } from '../domain/geo';
import { formatSingapore } from '../domain/time';

/**
 * Read-only evidence service used by the agents.
 *
 * History is excluded from liability contexts by default: ratings and dispute
 * counts are review-routing information only and must never decide liability.
 */

export interface CatalogEntry {
  id: string;
  kind: EvidenceItem['kind'];
  timestamp: string | null;
  summary: string;
  provenance: 'supplied_sample' | 'synthetic';
  dataset: string;
  jsonPointer: string;
}

export function summarizeEvidence(item: EvidenceItem, pickup: { lat: number; lng: number }): string {
  const when = item.timestamp ? formatSingapore(item.timestamp) : 'no timestamp';
  switch (item.kind) {
    case 'gps': {
      const distance = Math.round(haversineMeters(pickup, item.payload));
      const accuracy =
        item.payload.accuracyMeters === null ? 'not reported' : `${item.payload.accuracyMeters} m`;
      return `GPS at ${when}: status ${item.payload.status}, ${distance} m from pickup, accuracy ${accuracy}, speed ${item.payload.speedKmh ?? '?'} km/h.`;
    }
    case 'chat':
      return `Message at ${when} from ${item.payload.sender}: "${item.payload.content}"`;
    case 'call':
      return `Call at ${when} from ${item.payload.sender} (${item.payload.direction}): answered=${
        item.payload.answered === null ? 'unknown' : String(item.payload.answered)
      }, rang ${item.payload.ringSeconds ?? '?'}s. "${item.payload.content}"`;
    case 'trip_event':
      return `App event at ${when} [${item.payload.eventType}]: ${item.payload.details}`;
    case 'payment':
      return `Payment line at ${when}: ${item.payload.component} ${item.payload.amountCents} cents (${item.payload.direction}, ${item.payload.status}).`;
    case 'route':
      return `Route record at ${when}: planned ${item.payload.plannedDistanceM ?? '?'} m, actual ${item.payload.actualDistanceM ?? '?'} m, justification ${item.payload.justification}. ${item.payload.justificationNote ?? ''}`;
    case 'history':
      return `Account history (${item.payload.subject}): rating ${item.payload.avgRating ?? '?'}, trips ${item.payload.totalTrips ?? '?'}, disputes ${item.payload.disputeCount ?? '?'}, risk flags ${item.payload.fraudFlags ?? '?'}.`;
    case 'image':
      return `Image ${item.id}: ${item.payload.mimeType}, ${item.payload.sizeBytes} bytes; capture time ${item.payload.captureAt ?? 'unknown'}. Upload and metadata do not establish authenticity or causation.`;
  }
}

export function buildCatalog(
  caseRecord: CaseRecord,
  options: { includeHistory?: boolean } = {},
): CatalogEntry[] {
  return caseRecord.evidence
    .filter((item) => options.includeHistory === true || item.kind !== 'history')
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      timestamp: item.timestamp,
      summary: summarizeEvidence(item, caseRecord.trip.pickup),
      provenance: item.source.provenance,
      dataset: item.source.dataset,
      jsonPointer: item.source.jsonPointer,
    }));
}

export interface RetrievalResult {
  items: EvidenceItem[];
  /** Material contradictory findings are always returned, never hidden. */
  findings: Finding[];
  rejectedIds: string[];
}

export function retrieveEvidence(
  requestedIds: string[],
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
): RetrievalResult {
  const allowlist = new Set(
    buildCatalog(caseRecord).map((entry) => entry.id),
  );
  const accepted = requestedIds.filter((id) => allowlist.has(id));
  const rejectedIds = requestedIds.filter((id) => !allowlist.has(id));

  const items = caseRecord.evidence.filter(
    (item) => accepted.includes(item.id) && item.kind !== 'history',
  );

  return {
    items,
    findings: evaluation.findings.filter((finding) => finding.material),
    rejectedIds,
  };
}
