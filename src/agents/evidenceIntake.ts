import type {
  CaseRecord,
  ClaimVerification,
  EvidenceClaim,
  EvidenceItem,
  StructuredEvidenceResponse,
} from '../domain/contracts';

/**
 * Turns an accepted structured party response into a case mutation.
 *
 * Nothing here decides liability, and — importantly — nothing here treats a
 * party's typed value as a measurement. What a party supplies is recorded as a
 * **claim** attached to the evidence it is about, carrying its own verification
 * state. The authoritative payload only moves when a reviewer has marked the
 * claim verified and named what they checked it against.
 *
 * That distinction is the whole point: a string in `qualityIssues` saying "not
 * independently verified" does not stop a value from determining liability if
 * the policy engine reads it anyway. Keeping the claim beside the measurement,
 * rather than in place of it, means an unverified assertion cannot become the
 * operative input by accident.
 *
 * A free-text statement never reaches this module — it stays a claim.
 */

export interface VerificationInput {
  status: 'unverified_claim' | 'verified';
  source: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface AcceptedMutation {
  ok: true;
  apply: (current: CaseRecord) => CaseRecord;
  /** Evidence ids the response changed or created. */
  affectedEvidenceIds: string[];
  /** One line for the case change log. */
  changeSummary: string;
  /** The verification state recorded against the evidence request. */
  verificationRecord: ClaimVerification;
}

export interface RejectedMutation {
  ok: false;
  reason: string;
}

export type IntakeOutcome = AcceptedMutation | RejectedMutation;

export interface IntakeContext {
  /** Who supplied the value. */
  suppliedBy: 'rider' | 'driver' | 'platform';
  /** Review request this response answers, cited in provenance. */
  requestId: string;
  /** Reviewer who accepted it into the case. */
  acceptedBy: string;
  acceptedAt: string;
  /** How the reviewer treated the value when accepting it. */
  verification: VerificationInput;
}

function verificationRecord(context: IntakeContext): ClaimVerification {
  const { verification } = context;
  if (verification.status === 'verified') {
    return {
      status: 'verified',
      source: verification.source,
      verifiedBy: verification.verifiedBy,
      verifiedAt: verification.verifiedAt,
    };
  }
  return { status: 'unverified_claim', source: null, verifiedBy: null, verifiedAt: null };
}

function provenanceNote(context: IntakeContext, supplied: string): string {
  const who = `${context.suppliedBy}`;
  if (context.verification.status === 'verified') {
    return `${supplied} — supplied by the ${who} in response to review request ${context.requestId}, and verified by ${context.acceptedBy} on ${context.acceptedAt.slice(0, 10)} against ${context.verification.source ?? 'an unnamed source'}. This verified value now governs the policy input.`;
  }
  return `${supplied} — supplied by the ${who} in response to review request ${context.requestId}, accepted by ${context.acceptedBy} on ${context.acceptedAt.slice(0, 10)} as an unverified claim. It does not replace the recorded measurement and does not govern the policy input.`;
}

export function buildIntakeOutcome(
  caseRecord: CaseRecord,
  response: StructuredEvidenceResponse,
  context: IntakeContext,
): IntakeOutcome {
  switch (response.kind) {
    case 'gps_accuracy':
      return buildGpsAccuracyOutcome(caseRecord, response, context);
    case 'fare_ledger':
      return buildFareLedgerOutcome(caseRecord, response, context);
  }
}

function buildGpsAccuracyOutcome(
  caseRecord: CaseRecord,
  response: Extract<StructuredEvidenceResponse, { kind: 'gps_accuracy' }>,
  context: IntakeContext,
): IntakeOutcome {
  const gpsItems = caseRecord.evidence.filter((item) => item.kind === 'gps');
  const targets = gpsItems.filter((item) => response.sampleIds.includes(item.id));

  if (targets.length === 0) {
    return {
      ok: false,
      reason: 'None of the named GPS samples exist on this case, so there is nothing to correct.',
    };
  }

  const missing = response.sampleIds.filter((id) => !gpsItems.some((item) => item.id === id));
  const verified = context.verification.status === 'verified';
  const record = verificationRecord(context);
  const note = provenanceNote(
    context,
    `Accuracy radius claimed at ${response.accuracyMeters} m`,
  );
  const targetIds = new Set(targets.map((item) => item.id));

  // What the verified value replaces, so the correction stays traceable.
  const superseded = targets
    .map((item) => `${item.id}: ${item.payload.accuracyMeters ?? 'none'} m`)
    .join(', ');

  return {
    ok: true,
    affectedEvidenceIds: [...targetIds].sort(),
    verificationRecord: record,
    changeSummary: verified
      ? `GPS accuracy radius set to ${response.accuracyMeters} m for ${[...targetIds].sort().join(', ')} from the ${context.suppliedBy} response to ${context.requestId}, verified against ${context.verification.source ?? 'an unnamed source'} (superseded ${superseded})` +
        (missing.length > 0 ? ` (${missing.length} named id(s) not present and ignored)` : '') +
        '.'
      : `Unverified GPS accuracy claim of ${response.accuracyMeters} m recorded against ${[...targetIds].sort().join(', ')} from the ${context.suppliedBy} response to ${context.requestId}; the recorded measurement still governs` +
        (missing.length > 0 ? ` (${missing.length} named id(s) not present and ignored)` : '') +
        '.',
    apply: (current) => ({
      ...current,
      evidence: current.evidence.map((item) => {
        if (item.kind !== 'gps' || !targetIds.has(item.id)) return item;

        const claim: EvidenceClaim = {
          id: `claim_${context.requestId}_${item.id}`,
          field: 'gps_accuracy_meters',
          value: response.accuracyMeters,
          suppliedBy: context.suppliedBy,
          requestId: context.requestId,
          suppliedAt: context.acceptedAt,
          verification: record,
          note: verified
            ? `${note} Supersedes the recorded ${item.payload.accuracyMeters ?? 'none'} m.`
            : `${note} The recorded ${item.payload.accuracyMeters ?? 'none'} m still governs until this is verified.`,
        };

        return {
          ...item,
          // Only a verified claim moves the authoritative measurement.
          payload: verified
            ? { ...item.payload, accuracyMeters: response.accuracyMeters }
            : item.payload,
          qualityIssues: [...item.qualityIssues, claim.note],
          claims: [...(item.claims ?? []), claim],
        };
      }),
    }),
  };
}

function buildFareLedgerOutcome(
  caseRecord: CaseRecord,
  response: Extract<StructuredEvidenceResponse, { kind: 'fare_ledger' }>,
  context: IntakeContext,
): IntakeOutcome {
  const positive = response.components.filter((component) => component.amountCents > 0);
  if (positive.length === 0) {
    return { ok: false, reason: 'A fare ledger needs at least one component above zero.' };
  }

  const verified = context.verification.status === 'verified';
  const record = verificationRecord(context);
  const note = provenanceNote(context, 'Fare ledger component');

  const created: EvidenceItem[] = positive.map((component, index) => ({
    id: `${caseRecord.id}-LEDGER-${String(index + 1).padStart(2, '0')}`,
    kind: 'payment',
    timestamp: null,
    source: {
      dataset: `party_supplied:${context.requestId}`,
      jsonPointer: `/evidence/ledger/${index}`,
      provenance: 'synthetic',
    },
    qualityIssues: [note],
    claims: [
      {
        id: `claim_${context.requestId}_ledger_${index + 1}`,
        field: 'fare_component_cents',
        value: component.amountCents,
        suppliedBy: context.suppliedBy,
        requestId: context.requestId,
        suppliedAt: context.acceptedAt,
        verification: record,
        note,
      },
    ],
    payload: {
      component: component.component,
      amountCents: component.amountCents,
      direction: 'charge',
      method: 'party_supplied_ledger',
      status: 'applied',
    },
  }));

  const existingIds = new Set(caseRecord.evidence.map((item) => item.id));
  const fresh = created.filter((item) => !existingIds.has(item.id));
  if (fresh.length === 0) {
    return { ok: false, reason: 'Every ledger line is already recorded on this case.' };
  }

  const total = positive.reduce((sum, component) => sum + component.amountCents, 0);

  return {
    ok: true,
    affectedEvidenceIds: fresh.map((item) => item.id),
    verificationRecord: record,
    changeSummary: verified
      ? `Fare ledger with ${fresh.length} component(s) totalling ${total} cents added from the ${context.suppliedBy} response to ${context.requestId}, verified against ${context.verification.source ?? 'an unnamed source'}.`
      : `Unverified fare ledger claim with ${fresh.length} component(s) totalling ${total} cents recorded from the ${context.suppliedBy} response to ${context.requestId}. It is held out of ledger reconciliation until verified.`,
    apply: (current) => ({ ...current, evidence: [...current.evidence, ...fresh] }),
  };
}
