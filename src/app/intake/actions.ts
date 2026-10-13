'use server';

import { redirect } from 'next/navigation';
import { requireReviewerRole } from '@/lib/demoSession';
import { revalidatePath } from 'next/cache';
import {
  CaseRecordSchema,
  type CaseRecord,
  type EvidenceItem,
} from '@/domain/contracts';
import { decimalToCents } from '@/domain/money';
import { createRuntimeCase, getCase, loadPolicyPacks } from '@/repositories/cases';

/**
 * Guided intake.
 *
 * Builds a case from plain-language fields so a dispute can be filed without
 * hand-writing the internal JSON. Every value still passes the same
 * `CaseRecordSchema` the rest of the app uses, so nothing enters the system
 * unvalidated. Times are entered in Singapore local time and stored with an
 * explicit +08:00 offset.
 */

const SINGAPORE_OFFSET = '+08:00';
const DEFAULT_POLICY = 'rydr-demo-policy-v1';

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function optional(formData: FormData, name: string): string | null {
  const value = field(formData, name);
  return value === '' ? null : value;
}

/** `2026-09-17T09:12` (or with seconds) becomes an offset-aware timestamp. */
function singaporeTime(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/[+-]\d{2}:\d{2}$/.test(trimmed) || trimmed.endsWith('Z')) return trimmed;
  const withSeconds = /T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
  return `${withSeconds}${SINGAPORE_OFFSET}`;
}

function numberOrNull(formData: FormData, name: string): number | null {
  const raw = field(formData, name);
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Collects indexed rows, skipping any row whose id is blank. */
function rows(formData: FormData, prefix: string): number[] {
  const indexes = new Set<number>();
  for (const key of formData.keys()) {
    const match = new RegExp(`^${prefix}(\\d+)_`).exec(key);
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes].sort((a, b) => a - b);
}

function buildEvidence(formData: FormData, caseId: string): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const seen = new Set<string>();

  const push = (item: EvidenceItem | null) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    evidence.push(item);
  };

  for (const index of rows(formData, 'gps')) {
    const id = field(formData, `gps${index}_id`);
    const lat = numberOrNull(formData, `gps${index}_lat`);
    const lng = numberOrNull(formData, `gps${index}_lng`);
    if (!id || lat === null || lng === null) continue;
    const status = field(formData, `gps${index}_status`);
    push({
      id,
      kind: 'gps',
      timestamp: singaporeTime(optional(formData, `gps${index}_at`)),
      source: {
        dataset: `intake:${caseId}`,
        jsonPointer: `/evidence/gps/${index}`,
        provenance: 'synthetic',
      },
      qualityIssues: [],
      payload: {
        lat,
        lng,
        accuracyMeters: numberOrNull(formData, `gps${index}_accuracy`),
        speedKmh: numberOrNull(formData, `gps${index}_speed`),
        status: (
          ['en_route', 'arrived', 'waiting', 'cancelled', 'unknown'].includes(status)
            ? status
            : 'unknown'
        ) as 'en_route' | 'arrived' | 'waiting' | 'cancelled' | 'unknown',
      },
    });
  }

  for (const index of rows(formData, 'event')) {
    const id = field(formData, `event${index}_id`);
    const eventType = field(formData, `event${index}_type`);
    if (!id || !eventType) continue;
    push({
      id,
      kind: 'trip_event',
      timestamp: singaporeTime(optional(formData, `event${index}_at`)),
      source: {
        dataset: `intake:${caseId}`,
        jsonPointer: `/evidence/events/${index}`,
        provenance: 'synthetic',
      },
      qualityIssues: [],
      payload: {
        eventType,
        details: field(formData, `event${index}_details`),
      },
    });
  }

  for (const index of rows(formData, 'contact')) {
    const id = field(formData, `contact${index}_id`);
    if (!id) continue;
    const sender = field(formData, `contact${index}_sender`);
    const answered = field(formData, `contact${index}_answered`);
    push({
      id,
      kind: 'call',
      timestamp: singaporeTime(optional(formData, `contact${index}_at`)),
      source: {
        dataset: `intake:${caseId}`,
        jsonPointer: `/evidence/contact/${index}`,
        provenance: 'synthetic',
      },
      qualityIssues: [],
      payload: {
        sender: (['rider', 'driver', 'system'].includes(sender) ? sender : 'system') as
          | 'rider'
          | 'driver'
          | 'system',
        direction: field(formData, `contact${index}_direction`) === 'incoming' ? 'incoming' : 'outgoing',
        answered: answered === 'yes' ? true : answered === 'no' ? false : null,
        ringSeconds: numberOrNull(formData, `contact${index}_ring`),
        content: field(formData, `contact${index}_content`),
      },
    });
  }

  for (const index of rows(formData, 'route')) {
    const id = field(formData, `route${index}_id`);
    if (!id) continue;
    const justification = field(formData, `route${index}_justification`);
    push({
      id,
      kind: 'route',
      timestamp: singaporeTime(optional(formData, `route${index}_at`)),
      source: {
        dataset: `intake:${caseId}`,
        jsonPointer: `/evidence/route/${index}`,
        provenance: 'synthetic',
      },
      qualityIssues: [],
      payload: {
        plannedDistanceM: numberOrNull(formData, `route${index}_planned`),
        actualDistanceM: numberOrNull(formData, `route${index}_actual`),
        gpsSegmentSumM: numberOrNull(formData, `route${index}_segment`),
        justification: (
          ['verified_justification', 'verified_no_justification', 'unknown'].includes(justification)
            ? justification
            : 'unknown'
        ) as 'verified_justification' | 'verified_no_justification' | 'unknown',
        justificationNote: optional(formData, `route${index}_note`),
      },
    });
  }

  for (const index of rows(formData, 'fare')) {
    const id = field(formData, `fare${index}_id`);
    const component = field(formData, `fare${index}_component`);
    const amount = field(formData, `fare${index}_amount`);
    if (!id || !component || !amount) continue;
    const cents = decimalToCents(Number(amount));
    if (Number.isNaN(cents)) continue;
    push({
      id,
      kind: 'payment',
      timestamp: singaporeTime(optional(formData, `fare${index}_at`)),
      source: {
        dataset: `intake:${caseId}`,
        jsonPointer: `/evidence/fare/${index}`,
        provenance: 'synthetic',
      },
      qualityIssues: [],
      payload: {
        component,
        amountCents: cents,
        direction: field(formData, `fare${index}_direction`) === 'refund' ? 'refund' : 'charge',
        method: field(formData, `fare${index}_method`) || 'card',
        status: 'applied',
      },
    });
  }

  return evidence;
}

function fail(caseId: string, message: string): never {
  const params = new URLSearchParams({ error: message, caseId });
  redirect(`/intake?${params.toString()}`);
}

export async function submitIntake(formData: FormData): Promise<void> {
  await requireReviewerRole();
  const caseId = (field(formData, 'caseId') || `CASE-${Date.now().toString(36).toUpperCase()}`).trim();
  const category = field(formData, 'category');
  const riderStatement = field(formData, 'riderStatement');
  const disputed = field(formData, 'disputed');
  const pickupLat = numberOrNull(formData, 'pickupLat');
  const pickupLng = numberOrNull(formData, 'pickupLng');
  const policyVersion = field(formData, 'policyVersion') || DEFAULT_POLICY;

  if (!riderStatement) fail(caseId, 'A rider statement is required: what is being disputed?');
  if (!disputed) fail(caseId, 'Enter the disputed amount in SGD.');
  if (pickupLat === null || pickupLng === null) {
    fail(caseId, 'Enter the pickup point coordinates so the zone can be measured.');
  }

  const disputedCents = decimalToCents(Number(disputed));
  if (Number.isNaN(disputedCents) || disputedCents <= 0) {
    fail(caseId, 'The disputed amount must be a positive amount in SGD.');
  }

  const existing = await getCase(caseId);
  if (existing) fail(caseId, `Case ${caseId} already exists. Choose a different reference.`);

  const packs = await loadPolicyPacks();
  const pack = packs.get(policyVersion);
  if (!pack) fail(caseId, `Unknown policy pack: ${policyVersion}.`);
  if (pack.source === 'supplied_sample') {
    fail(
      caseId,
      'That policy pack is a supplied sample. It is stored separately and cannot govern a case.',
    );
  }
  if (pack.source === 'ryde_official' && !pack.clauses.some(clause => clause.category === category && clause.authority === 'official_ryde')) {
    fail(caseId, 'Choose a Ryde policy matching this dispute category, or use the example rules.');
  }

  const evidence = buildEvidence(formData, caseId);
  if (category === 'damage' && evidence.length === 0) evidence.push({
    id: 'DAMAGE-STATEMENT', kind: 'trip_event', timestamp: null,
    source: { dataset: `intake:${caseId}`, jsonPointer: '/riderStatement', provenance: 'synthetic' },
    qualityIssues: ['Party statement only; damage images and trip linkage remain unverified.'],
    payload: { eventType: 'damage_disputed', details: riderStatement },
  });
  if (evidence.length === 0) {
    fail(caseId, 'Add at least one piece of evidence: a GPS sample, a trip event or a contact attempt.');
  }

  const dropoffLat = numberOrNull(formData, 'dropoffLat');
  const dropoffLng = numberOrNull(formData, 'dropoffLng');
  const dropoffLabel = optional(formData, 'dropoffLabel');

  const draft = {
    id: caseId,
    category: category === 'damage' ? 'damage' : category === 'route_overcharge' ? 'route_overcharge' : 'no_show_charge',
    currency: 'SGD',
    disputedCents,
    riderStatement,
    driverStatement: optional(formData, 'driverStatement'),
    trip: {
      id: field(formData, 'tripId') || `TRIP-${caseId}`,
      bookingType: field(formData, 'bookingType') === 'on_demand' ? 'on_demand' : field(formData, 'bookingType') === 'advance' ? 'advance' : 'unknown',
      fareType: field(formData, 'fareType') === 'fixed' ? 'fixed' : field(formData, 'fareType') === 'metered' ? 'metered' : 'unknown',
      scheduledAt: singaporeTime(optional(formData, 'scheduledAt')),
      pickup: {
        lat: pickupLat,
        lng: pickupLng,
        label: field(formData, 'pickupLabel') || 'Pickup point',
      },
      dropoff:
        dropoffLat !== null && dropoffLng !== null
          ? { lat: dropoffLat, lng: dropoffLng, label: dropoffLabel ?? 'Dropoff point' }
          : null,
    },
    evidence,
    // A case names the pack it is governed by; the pack carries its own version.
    policyVersion: pack.id,
    suppliedPolicyId: null,
    provenance: 'synthetic' as const,
    derivedFrom: null,
    changeLog: [`Filed through guided intake on ${new Date().toISOString().slice(0, 10)}.`],
  } satisfies Omit<CaseRecord, 'version'>;

  const parsed = CaseRecordSchema.safeParse({ ...draft, version: 1 });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    fail(
      caseId,
      `The case could not be validated: ${first ? `${first.path.join('.')} — ${first.message}` : 'unknown issue'}.`,
    );
  }

  await createRuntimeCase(parsed.data);
  revalidatePath('/');
  revalidatePath('/?view=queue');
  redirect(`/cases/${caseId}?mode=fixture`);
}

