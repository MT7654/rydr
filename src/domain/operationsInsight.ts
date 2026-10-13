import type { CaseRecord } from './contracts';
import type { DeterministicEvaluation } from './policy';
import { evaluateCase } from './policy';
import { getPolicyPack } from '../repositories/cases';

/**
 * Read-only operations insight: aggregates supported causes across cases.
 *
 * No external messages are sent. This is a diagnostic view for reviewers and
 * platform operators to see patterns and link them to cases.
 */

export interface CauseGroup {
  cause: string;
  description: string;
  prevention: string;
  caseIds: string[];
  count: number;
}

export interface OperationsInsight {
  totalCases: number;
  groups: CauseGroup[];
  generatedAt: string;
}

function hasPickupReferenceIssue(caseRecord: CaseRecord, evaluation: DeterministicEvaluation): boolean {
  // GPS indeterminate or conflicting arrival evidence suggests pickup reference problems
  if (caseRecord.category !== 'no_show_charge') return false;
  const zone = evaluation.noShow?.arrivalZone;
  if (zone === 'indeterminate') return true;
  const arrival = caseRecord.evidence.find(
    (e) => e.kind === 'trip_event' && e.payload.eventType === 'driver_arrived',
  );
  const gpsArrival = caseRecord.evidence.filter(
    (e) => e.kind === 'gps' && e.payload.status === 'arrived',
  );
  // No GPS arrival sample despite an arrival event
  if (arrival && gpsArrival.length === 0) return true;
  return false;
}

function hasPolicyAmbiguity(_caseRecord: CaseRecord, evaluation: DeterministicEvaluation): boolean {
  if (evaluation.noShow?.policyAmbiguity) return true;
  if (evaluation.route?.justification === 'unknown') return true;
  return false;
}

function hasFareLedgerMismatch(caseRecord: CaseRecord, evaluation: DeterministicEvaluation): boolean {
  if (caseRecord.category !== 'route_overcharge') return false;
  if (evaluation.route?.ledgerReconciled === false) return true;
  return false;
}

function hasUnexpectedTripEnd(caseRecord: CaseRecord): boolean {
  const events = caseRecord.evidence
    .filter((e) => e.kind === 'trip_event')
    .map((e) => e.payload.eventType);
  // Trip ended without a completion event, or cancellation without prior arrival
  const hasCompletion = events.includes('trip_completed');
  const hasCancellation = events.includes('cancellation_fee_applied');
  const hasArrival = events.includes('driver_arrived');
  if (hasCancellation && !hasArrival) return true;
  if (!hasCompletion && !hasCancellation && events.length > 0) return true;
  return false;
}

export async function buildOperationsInsight(caseRecords: CaseRecord[]): Promise<OperationsInsight> {
  const groups: Map<string, CauseGroup> = new Map();

  function add(cause: string, description: string, prevention: string, caseId: string) {
    const existing = groups.get(cause);
    if (existing) {
      if (!existing.caseIds.includes(caseId)) {
        existing.caseIds.push(caseId);
        existing.count = existing.caseIds.length;
      }
    } else {
      groups.set(cause, { cause, description, prevention, caseIds: [caseId], count: 1 });
    }
  }

  for (const caseRecord of caseRecords) {
    const pack = await getPolicyPack(caseRecord.policyVersion).catch(() => null);
    if (!pack || pack.source === 'supplied_sample') continue;
    const evaluation = evaluateCase(caseRecord, pack);

    if (hasPickupReferenceIssue(caseRecord, evaluation)) {
      add(
        'pickup_reference_mismatch',
        'GPS arrival is indeterminate or missing despite a reported arrival event.',
        'Require accuracy radius on every arrival sample and cross-check against the stated pickup label.',
        caseRecord.id,
      );
    }

    if (hasPolicyAmbiguity(caseRecord, evaluation)) {
      add(
        'policy_ambiguity',
        'The governing policy does not define which clock or rule applies.',
        'Clarify the waiting-clock rule and publish an effective-dated policy version.',
        caseRecord.id,
      );
    }

    if (hasFareLedgerMismatch(caseRecord, evaluation)) {
      add(
        'fare_ledger_mismatch',
        'The fare components do not reconcile with the charged amount.',
        'Require itemised fare components at trip completion and reconcile before charging.',
        caseRecord.id,
      );
    }

    if (hasUnexpectedTripEnd(caseRecord)) {
      add(
        'unexpected_trip_end',
        'Trip ended without a completion event, or cancelled before driver arrival.',
        'Audit event-sequence completeness and flag trips that lack a terminal event.',
        caseRecord.id,
      );
    }
  }

  return {
    totalCases: caseRecords.length,
    groups: Array.from(groups.values()).sort((a, b) => b.count - a.count),
    generatedAt: new Date().toISOString(),
  };
}
