import { describe, expect, it } from 'vitest';
import { buildIntakeOutcome, type VerificationInput } from '../src/agents/evidenceIntake';
import { evaluateCase } from '../src/domain/policy';
import { collectPayments } from '../src/domain/evidence';
import { appendCaseVersion, getCase, listCaseVersions } from '../src/repositories/cases';
import {
  chargeRefFor,
  effectiveDecisionForCase,
  listSettlementsForCase,
  postedRefundCents,
  postSettlement,
  recordDecision,
} from '../src/repositories/ledger';
import { loadCase, loadDemoPack } from './helpers';

const UNVERIFIED: VerificationInput = {
  status: 'unverified_claim',
  source: null,
  verifiedBy: null,
  verifiedAt: null,
};

const VERIFIED: VerificationInput = {
  status: 'verified',
  source: 'Trip replay export TRIP-SYN-003',
  verifiedBy: 'Alex Tan (reviewer_demo_01)',
  verifiedAt: '2026-10-02T01:00:00.000Z',
};

function context(verification: VerificationInput = UNVERIFIED) {
  return {
    suppliedBy: 'rider' as const,
    requestId: 'evreq_test_01',
    acceptedBy: 'Alex Tan (reviewer_demo_01)',
    acceptedAt: '2026-10-02T01:00:00.000Z',
    verification,
  };
}

/**
 * The central rule under test: accepting a party's typed value into the case is
 * a decision about what to consider, not a finding that it is true. Only a claim
 * a reviewer has verified against a named source may move the measurement the
 * policy engine reads.
 */
describe('party claims versus verified evidence', () => {
  it('records an unverified accuracy claim without changing the measurement', async () => {
    const pack = await loadDemoPack();
    const before = await loadCase('SYN-003');

    const beforeEvaluation = evaluateCase(before, pack);
    expect(beforeEvaluation.disposition).toBe('human_review');
    expect(beforeEvaluation.noShow?.arrivalZone).toBe('indeterminate');

    const gpsIds = before.evidence.filter((item) => item.kind === 'gps').map((item) => item.id);
    const outcome = buildIntakeOutcome(
      before,
      {
        kind: 'gps_accuracy',
        sampleIds: gpsIds,
        accuracyMeters: 8,
        provenanceNote: 'The device accuracy radius was misrecorded in the app.',
      },
      context(UNVERIFIED),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verificationRecord.status).toBe('unverified_claim');

    const after = outcome.apply(before);
    const afterEvaluation = evaluateCase(after, pack);

    // The claim is on the record...
    const claimed = after.evidence.find((item) => item.id === gpsIds[0]);
    expect(claimed?.claims).toHaveLength(1);
    expect(claimed?.claims?.[0]?.value).toBe(8);
    expect(claimed?.claims?.[0]?.verification.status).toBe('unverified_claim');

    // ...but the measurement, and therefore the determination, has not moved.
    expect(claimed?.kind === 'gps' && claimed.payload.accuracyMeters).toBe(120);
    expect(afterEvaluation.noShow?.arrivalZone).toBe('indeterminate');
    expect(afterEvaluation.disposition).toBe('human_review');
    expect(afterEvaluation.recommendedRefundCents).toBeNull();
  });

  it('promotes the claim into the measurement only once a reviewer verifies it', async () => {
    const pack = await loadDemoPack();
    const before = await loadCase('SYN-003');
    const gpsIds = before.evidence.filter((item) => item.kind === 'gps').map((item) => item.id);

    const outcome = buildIntakeOutcome(
      before,
      {
        kind: 'gps_accuracy',
        sampleIds: gpsIds,
        accuracyMeters: 8,
        provenanceNote: 'The device accuracy radius was misrecorded in the app.',
      },
      context(VERIFIED),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.verificationRecord.status).toBe('verified');
    expect(outcome.verificationRecord.source).toBe(VERIFIED.source);

    const after = outcome.apply(before);
    const afterEvaluation = evaluateCase(after, pack);

    // Verified: the measurement moves and the case becomes determinable.
    const verifiedItem = after.evidence.find((item) => item.id === gpsIds[0]);
    expect(verifiedItem?.kind === 'gps' && verifiedItem.payload.accuracyMeters).toBe(8);
    expect(afterEvaluation.noShow?.arrivalZone).toBe('inside');
    expect(afterEvaluation.disposition).toBe('refund');
    expect(afterEvaluation.recommendedRefundCents).toBe(500);

    // Both the claim and what it replaced stay traceable.
    expect(verifiedItem?.claims?.[0]?.note).toContain('Supersedes the recorded 120 m');
    expect(verifiedItem?.claims?.[0]?.note).toContain(VERIFIED.source);
    expect(outcome.changeSummary).toContain('superseded');
  });

  it('refuses a correction that names samples the case does not have', async () => {
    const before = await loadCase('SYN-003');
    const outcome = buildIntakeOutcome(
      before,
      {
        kind: 'gps_accuracy',
        sampleIds: ['NOT-A-SAMPLE'],
        accuracyMeters: 8,
        provenanceNote: 'Typo in the sample id.',
      },
      context(UNVERIFIED),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('nothing to correct');
  });

  it('records fare ledger lines as claims held out of reconciliation', async () => {
    const before = await loadCase('SYN-002');
    const outcome = buildIntakeOutcome(
      before,
      {
        kind: 'fare_ledger',
        components: [
          { component: 'base_fare', amountCents: 300 },
          { component: 'excess_route', amountCents: 200 },
        ],
        provenanceNote: 'Exported from the driver app ledger.',
      },
      context(UNVERIFIED),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const after = outcome.apply(before);
    const added = after.evidence.filter((item) => outcome.affectedEvidenceIds.includes(item.id));
    expect(added.length).toBe(2);
    expect(added.every((item) => item.kind === 'payment')).toBe(true);
    expect(
      added.map((item) => (item.kind === 'payment' ? item.payload.amountCents : null)),
    ).toEqual([300, 200]);
    expect(after.evidence.length).toBe(before.evidence.length + 2);

    // An unverified ledger line is not authoritative, so the engine that
    // reconciles the fare must not see it.
    const reconciled = collectPayments(after.evidence).map((payment) => payment.id);
    for (const id of outcome.affectedEvidenceIds) {
      expect(reconciled).not.toContain(id);
    }
  });

  it('admits fare ledger lines once they are verified', async () => {
    const before = await loadCase('SYN-002');
    const outcome = buildIntakeOutcome(
      before,
      {
        kind: 'fare_ledger',
        components: [{ component: 'base_fare', amountCents: 300 }],
        provenanceNote: 'Exported from the driver app ledger.',
      },
      context(VERIFIED),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const after = outcome.apply(before);
    const reconciled = collectPayments(after.evidence).map((payment) => payment.id);
    for (const id of outcome.affectedEvidenceIds) {
      expect(reconciled).toContain(id);
    }
  });

  it('refuses a ledger with no positive component', async () => {
    const before = await loadCase('SYN-002');
    const outcome = buildIntakeOutcome(
      before,
      {
        kind: 'fare_ledger',
        components: [{ component: 'nothing', amountCents: 0 }],
        provenanceNote: 'Empty ledger.',
      },
      context(UNVERIFIED),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('versioned re-review', () => {
  it('creates a new immutable version and leaves the original untouched', async () => {
    const before = await getCase('SYN-003');
    if (!before) throw new Error('missing case');

    const gpsIds = before.evidence.filter((item) => item.kind === 'gps').map((item) => item.id);
    const outcome = buildIntakeOutcome(
      before,
      {
        kind: 'gps_accuracy',
        sampleIds: gpsIds,
        accuracyMeters: 8,
        provenanceNote: 'Corrected from the trip replay export.',
      },
      context(VERIFIED),
    );
    if (!outcome.ok) throw new Error('expected an accepted outcome');

    const next = await appendCaseVersion(
      'SYN-003',
      outcome.apply,
      `Accepted rider response to evreq_test_01: ${outcome.changeSummary}`,
    );

    expect(next.version).toBe(before.version + 1);

    const versions = await listCaseVersions('SYN-003');
    expect(versions.map((record) => record.version)).toContain(before.version);

    // The original version still carries the uncorrected accuracy and no claim.
    const original = versions.find((record) => record.version === before.version);
    const originalSample = original?.evidence.find(
      (item) => item.kind === 'gps' && item.id === gpsIds[0],
    );
    expect(originalSample?.kind === 'gps' && originalSample.payload.accuracyMeters).toBe(120);
    expect(originalSample?.claims ?? []).toHaveLength(0);

    expect(next.changeLog[next.changeLog.length - 1]).toContain('evreq_test_01');
  });
});

describe('appeal accounting', () => {
  it('posts only the additional amount owed after a superseding decision', async () => {
    const caseRecord = await getCase('SYN-005');
    if (!caseRecord) throw new Error('missing case');
    const chargeRef = chargeRefFor(caseRecord);

    const first = await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'ai',
      disposition: 'uphold',
      targetRefundCents: 0,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Original automated decision: the charge stands.',
      differenceFromRecommendation: null,
      reviewerId: null,
      supersedesDecisionId: null,
      chargeRef,
    });
    const { settlement: firstSettlement } = await postSettlement({ caseRecord, decision: first });
    expect(firstSettlement.deltaRefundCents).toBe(0);
    expect(await postedRefundCents(chargeRef)).toBe(0);

    // An appeal that changes the outcome must not re-issue the whole refund.
    const second = await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'partial_refund',
      targetRefundCents: 200,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Appeal upheld in part: 200 cents of the charge was not justified.',
      differenceFromRecommendation: 'The appeal produced a reconciled fare ledger.',
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: first.id,
      chargeRef,
    });
    const { settlement: secondSettlement } = await postSettlement({ caseRecord, decision: second });

    expect(secondSettlement.deltaRefundCents).toBe(200);
    expect(secondSettlement.targetRefundCents).toBe(200);
    expect(secondSettlement.retainedCents).toBe(300);
    expect(await postedRefundCents(chargeRef)).toBe(200);

    const effective = await effectiveDecisionForCase(caseRecord.id);
    expect(effective?.id).toBe(second.id);

    const settlements = await listSettlementsForCase(caseRecord.id);
    expect(settlements.map((settlement) => settlement.idempotencyKey)).toEqual([
      `${chargeRef}:${first.id}`,
      `${chargeRef}:${second.id}`,
    ]);
  });

  it('requires a manual adjustment rather than silently recharging a party', async () => {
    const caseRecord = await getCase('SYN-001');
    if (!caseRecord) throw new Error('missing case');
    const chargeRef = chargeRefFor(caseRecord);

    const generous = await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'refund',
      targetRefundCents: 500,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Full refund recorded.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: null,
      chargeRef,
    });
    await postSettlement({ caseRecord, decision: generous });
    expect(await postedRefundCents(chargeRef)).toBe(500);

    const reduced = await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'partial_refund',
      targetRefundCents: 200,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Reduced on appeal.',
      differenceFromRecommendation: 'The earlier refund was too generous.',
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: generous.id,
      chargeRef,
    });
    const { settlement } = await postSettlement({ caseRecord, decision: reduced });

    // Never a negative credit: the shortfall is flagged for a person instead.
    expect(settlement.status).toBe('manual_adjustment_required');
    expect(settlement.deltaRefundCents).toBe(0);
    expect(await postedRefundCents(chargeRef)).toBe(500);
  });
});
