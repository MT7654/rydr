import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaseDecision, CaseRecord, PolicyPack } from '../src/domain/contracts';
import { evaluateCase } from '../src/domain/policy';
import { scoreEvidence } from '../src/domain/confidence';
import { buildCatalog } from '../src/agents/evidenceService';
import {
  MAX_PRECEDENTS,
  PrecedentRecordSchema,
  extractCaseFeatures,
  type PrecedentRecord,
} from '../src/domain/precedent';
import { retrievePrecedents, tagSimilarity } from '../src/domain/precedentRetrieval';
import { evaluateActivation } from '../src/domain/precedentGate';
import { appendCaseVersion, getCase, getPolicyPack } from '../src/repositories/cases';
import { getPrecedent, listApprovedPrecedents, savePrecedent } from '../src/repositories/precedents';
import { captureRunSnapshot, getRunSnapshot } from '../src/repositories/snapshots';
import { loadEvaluationSet, loadHeldOutCases, type EvaluationCase } from '../src/lib/evaluationSet';
import {
  approveCandidate,
  authorExample,
  captureOverrideCandidate,
  listPromotableCases,
  loadCuratorWorkbench,
  rejectCandidate,
  rollbackPrecedent,
} from '../src/lib/precedentCurator';
import { fingerprint } from '../src/lib/hash';

/**
 * Precedents and governed learning.
 *
 * The contract these pin down, in one line: a human correction never becomes
 * truth on its own. It is captured inert, it is invisible to the Judge, and it
 * becomes retrievable context only by passing the shadow-replay gate and a
 * curator's approval — and it can always be rolled back without rewriting what
 * a past run was shown.
 */

const DEMO_POLICY_ID = 'rydr-demo-policy-v1';

/** The demo pack is a discriminated union member; narrowing it once keeps the tests readable. */
type DemoPack = Extract<PolicyPack, { source: 'rydr_demo' }>;

async function loadCase(caseId: string): Promise<CaseRecord> {
  const raw = await fs.readFile(path.join('fixtures', 'cases', `${caseId}.json`), 'utf8');
  return JSON.parse(raw) as CaseRecord;
}

interface Prepared {
  caseRecord: CaseRecord;
  pack: DemoPack;
  evaluation: ReturnType<typeof evaluateCase>;
  tags: string[];
}

async function prepare(caseId: string): Promise<Prepared> {
  const caseRecord = await loadCase(caseId);
  const pack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source !== 'rydr_demo') throw new Error(`expected the demo pack for ${caseId}`);
  const evaluation = evaluateCase(caseRecord, pack);
  return {
    caseRecord,
    pack,
    evaluation,
    tags: extractCaseFeatures(caseRecord, evaluation, pack).tags,
  };
}

/** The derived held-out case with this id, as the gate sees it. */
async function heldOutCase(caseId: string): Promise<{
  entry: EvaluationCase;
  pack: DemoPack;
  tags: PrecedentRecord['tags'];
  chargeCents: number;
}> {
  const set = await loadEvaluationSet();
  const entry = set.find((candidate) => candidate.caseId === caseId);
  if (!entry) throw new Error(`unknown evaluation case ${caseId}`);
  const pack = entry.pack;
  if (pack.source !== 'rydr_demo') throw new Error(`expected the demo pack for ${caseId}`);
  const evaluation = evaluateCase(entry.caseRecord, pack);
  return {
    entry,
    pack,
    tags: extractCaseFeatures(entry.caseRecord, evaluation, pack).tags as PrecedentRecord['tags'],
    chargeCents: entry.caseRecord.disputedCents,
  };
}

/** Same as `prepare`, for cases the repository builds rather than reads from a fixture. */
async function prepareFromStore(caseId: string): Promise<Prepared> {
  const caseRecord = await getCase(caseId);
  if (!caseRecord) throw new Error(`unknown case ${caseId}`);
  const pack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source !== 'rydr_demo') throw new Error(`expected the demo pack for ${caseId}`);
  const evaluation = evaluateCase(caseRecord, pack);
  return {
    caseRecord,
    pack,
    evaluation,
    tags: extractCaseFeatures(caseRecord, evaluation, pack).tags,
  };
}

let seq = 0;

/** A well-formed precedent, so each test states only what it is about. */
function makePrecedent(overrides: Partial<PrecedentRecord> = {}): PrecedentRecord {
  seq += 1;
  const now = new Date().toISOString();
  return PrecedentRecordSchema.parse({
    id: `prec_test_${seq}`,
    caseId: 'SYN-002',
    caseVersion: 1,
    category: 'no_show_charge',
    policyId: DEMO_POLICY_ID,
    policyVersion: '1.0.0',
    citedPolicyIds: ['NS-01'],
    tags: ['threshold_met', 'zone_outside'],
    materialFacts: ['Synthetic example.'],
    disposition: 'refund',
    refundCents: 500,
    chargeCents: 500,
    status: 'approved',
    source: 'curator_authored',
    priorRecommendation: null,
    correctionReason: null,
    approvedBy: 'curator_demo_01',
    approvedAt: now,
    approvalNote: null,
    activationFailure: null,
    retiredAt: null,
    retiredReason: null,
    supersedesPrecedentId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function makeDecision(
  overrides: Partial<CaseDecision> & Pick<CaseDecision, 'disposition' | 'targetRefundCents'>,
): CaseDecision {
  return {
    id: `dec_test_${(seq += 1)}`,
    caseId: 'SYN-002',
    caseVersion: 1,
    runId: 'run_test',
    taskId: 'task_test',
    source: 'reviewer',
    evidenceIds: [],
    policyIds: ['NS-01'],
    policyVersion: DEMO_POLICY_ID,
    explanation: 'Reviewer reason.',
    differenceFromRecommendation: 'The reviewer read the zone evidence differently.',
    reviewerId: 'reviewer_demo_01',
    supersedesDecisionId: null,
    chargeRef: 'charge:SYN-002:v1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Retrieval                                                          */
/* ------------------------------------------------------------------ */

describe('precedent retrieval', () => {
  it('excludes the same pack id when its policy version differs', async () => {
    const target = await heldOutCase('EVAL-002');
    const candidate = makePrecedent({ policyVersion: '0.9.0', tags: target.tags as PrecedentRecord['tags'] });
    expect(retrievePrecedents({ caseRecord: target.entry.caseRecord, evaluation: evaluateCase(target.entry.caseRecord, target.pack), pack: target.pack, precedents: [candidate] }).contexts).toHaveLength(0);
    expect(evaluateActivation({ candidate, pack: target.pack, heldOut: [] }).passed).toBe(false);
  });
  it('never returns a candidate, and says why it was excluded', async () => {
    const target = await heldOutCase('EVAL-002');
    const candidate = makePrecedent({
      status: 'candidate',
      tags: target.tags as PrecedentRecord['tags'],
      caseId: 'SYN-002',
    });

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: [candidate],
    });

    expect(manifest.contexts).toHaveLength(0);
    expect(manifest.excluded).toHaveLength(1);
    expect(manifest.excluded[0]?.reason).toMatch(/not an approved precedent/i);
    expect(manifest.note).toMatch(/no relevant approved precedent/i);
  });

  it('reports "no relevant precedent" honestly rather than inventing context', async () => {
    const target = await heldOutCase('EVAL-002');
    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: [],
    });

    expect(manifest.contexts).toEqual([]);
    expect(manifest.considered).toBe(0);
    expect(manifest.note).toContain('No relevant approved precedent was found for this case');
    expect(manifest.note).toContain('Policy and the evidence stand on their own');
  });

  it('excludes an example decided under incompatible rules', async () => {
    const target = await heldOutCase('EVAL-002');
    const foreign = makePrecedent({
      policyId: 'supplied-sample-policy',
      tags: target.tags as PrecedentRecord['tags'],
      caseId: 'SYN-003',
    });

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: [foreign],
    });

    expect(manifest.contexts).toHaveLength(0);
    expect(manifest.excluded[0]?.reason).toMatch(/incompatible rules/i);
  });

  it('excludes the case itself as its own precedent', async () => {
    const target = await heldOutCase('EVAL-002');
    const self = makePrecedent({ caseId: target.entry.caseRecord.id });

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: [self],
    });

    expect(manifest.contexts).toHaveLength(0);
    expect(manifest.excluded[0]?.reason).toMatch(/cannot be its own precedent/i);
  });

  it('excludes an approved example that is not materially similar', async () => {
    const target = await heldOutCase('EVAL-002');
    const unrelated = makePrecedent({
      tags: ['clock_ambiguous', 'continuity_gap', 'threshold_not_met', 'zone_inside'],
      caseId: 'SYN-004',
    });

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: [unrelated],
    });

    expect(manifest.contexts).toHaveLength(0);
    expect(manifest.excluded[0]?.reason).toMatch(/below the/i);
  });

  it('excludes an example decided under the demo pack from a case governed by a supplied policy', async () => {
    // DISP-002 is evaluated with the demo pack's thresholds, but its rules come
    // from a supplied cancellation policy. An example decided under the demo
    // pack must not be offered to it.
    const supplied = await prepareFromStore('DISP-002');
    expect(supplied.caseRecord.suppliedPolicyId).toBeTruthy();

    const demoExample = makePrecedent({
      caseId: 'SYN-002',
      tags: supplied.tags as PrecedentRecord['tags'],
    });

    const manifest = retrievePrecedents({
      caseRecord: supplied.caseRecord,
      evaluation: supplied.evaluation,
      pack: supplied.pack,
      precedents: [demoExample],
    });

    expect(manifest.contexts).toHaveLength(0);
    expect(manifest.excluded[0]?.reason).toMatch(/supplied policy/i);
  });

  it('returns a relevant approved example with both similarities and differences', async () => {
    const target = await heldOutCase('EVAL-002');
    const relevant = makePrecedent({
      caseId: 'SYN-002',
      tags: target.tags as PrecedentRecord['tags'],
    });

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: [relevant],
    });

    expect(manifest.contexts).toHaveLength(1);
    const context = manifest.contexts[0]!;
    expect(context.similarities.length).toBeGreaterThan(0);
    // The differences are always stated, even when the conditions are identical,
    // because "no difference on the recorded conditions" is itself the claim.
    expect(context.differences.length).toBeGreaterThan(0);
    expect(context.outcome).toContain('Refund');
  });

  it('caps how many examples a run is shown', async () => {
    const target = await heldOutCase('EVAL-002');
    const many = Array.from({ length: MAX_PRECEDENTS + 3 }, (_, index) =>
      makePrecedent({
        id: `prec_cap_${index}`,
        caseId: `SYN-90${index}`,
        tags: target.tags as PrecedentRecord['tags'],
      }),
    );

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: many,
    });

    expect(manifest.contexts).toHaveLength(MAX_PRECEDENTS);
  });
});

/* ------------------------------------------------------------------ */
/*  Shadow-replay gate                                                 */
/* ------------------------------------------------------------------ */

describe('shadow-replay activation gate', () => {
  it('refuses an example that argues against a reviewed ruling on a case it covers', async () => {
    const target = await heldOutCase('EVAL-002');
    const pack = target.pack;

    // EVAL-002 is labelled "refund". An example built on the same conditions but
    // stating "uphold" would argue against that reviewed ruling.
    const harmful = makePrecedent({
      tags: target.tags as PrecedentRecord['tags'],
      disposition: 'uphold',
      refundCents: 0,
      chargeCents: target.chargeCents,
    });

    const gate = evaluateActivation({ candidate: harmful, pack, heldOut: await loadHeldOutCases() });

    expect(gate.passed).toBe(false);
    expect(gate.failure).toContain('EVAL-002');
    const replay = gate.checks.find((check) => check.id === 'held_out_replay');
    expect(replay?.passed).toBe(false);
    expect(replay?.detail).toMatch(/Would contradict/);
  });

  it('passes an example that agrees with every reviewed ruling it covers', async () => {
    const target = await heldOutCase('EVAL-002');
    const sound = makePrecedent({
      tags: target.tags as PrecedentRecord['tags'],
      disposition: 'refund',
      refundCents: target.chargeCents,
      chargeCents: target.chargeCents,
    });

    const gate = evaluateActivation({
      candidate: sound,
      pack: target.pack,
      heldOut: await loadHeldOutCases(),
    });

    expect(gate.passed).toBe(true);
    expect(gate.failure).toBeNull();
    expect(gate.checks.every((check) => check.passed)).toBe(true);
  });

  it('does not treat an example that differs on the deciding fact as a claim about the other case', async () => {
    // EVAL-005 (rider-approved detour, upheld) and EVAL-006 (no justification,
    // refunded) overlap heavily but differ on the one fact that decides them.
    const upheld = await heldOutCase('EVAL-005');
    const refunded = await heldOutCase('EVAL-006');
    expect(tagSimilarity(upheld.tags, refunded.tags)).toBeGreaterThanOrEqual(0.34);

    const example = makePrecedent({
      caseId: 'SYN-005',
      category: 'route_overcharge',
      tags: upheld.tags as PrecedentRecord['tags'],
      disposition: 'uphold',
      refundCents: 0,
      chargeCents: upheld.chargeCents,
    });

    const gate = evaluateActivation({
      candidate: example,
      pack: upheld.pack,
      heldOut: await loadHeldOutCases(),
    });

    expect(gate.passed).toBe(true);
    const replay = gate.checks.find((check) => check.id === 'held_out_replay');
    expect(replay?.detail).not.toMatch(/EVAL-006/);
  });

  it('sets a comparable abstention aside instead of counting it as a conflict', async () => {
    // EVAL-001 and EVAL-007 share conditions; one is an upheld ruling, the other
    // abstains because of a safety allegation the escalation gate enforces.
    const clean = await heldOutCase('EVAL-001');
    const safety = await heldOutCase('EVAL-007');
    expect(clean.tags).toEqual(safety.tags);

    const example = makePrecedent({
      caseId: 'SYN-002',
      tags: clean.tags as PrecedentRecord['tags'],
      disposition: 'uphold',
      refundCents: 0,
      chargeCents: clean.chargeCents,
    });

    const gate = evaluateActivation({
      candidate: example,
      pack: clean.pack,
      heldOut: await loadHeldOutCases(),
    });

    expect(gate.passed).toBe(true);
    const replay = gate.checks.find((check) => check.id === 'held_out_replay');
    expect(replay?.detail).toMatch(/abstention\(s\) set aside/);
    expect(replay?.detail).toMatch(/escalation gate/);
  });

  it('refuses an example whose outcome breaks the financial invariants', async () => {
    const target = await heldOutCase('EVAL-002');
    const broken = makePrecedent({
      tags: target.tags as PrecedentRecord['tags'],
      disposition: 'uphold',
      refundCents: 250,
      chargeCents: 500,
    });

    const gate = evaluateActivation({
      candidate: broken,
      pack: target.pack,
      heldOut: await loadHeldOutCases(),
    });

    expect(gate.passed).toBe(false);
    const invariants = gate.checks.find((check) => check.id === 'outcome_invariants');
    expect(invariants?.passed).toBe(false);
  });

  it('refuses an example citing a clause the governing pack does not contain', async () => {
    const target = await heldOutCase('EVAL-002');
    const fabricated = makePrecedent({
      tags: target.tags as PrecedentRecord['tags'],
      citedPolicyIds: ['NS-01', 'NS-99'],
    });

    const gate = evaluateActivation({
      candidate: fabricated,
      pack: target.pack,
      heldOut: await loadHeldOutCases(),
    });

    expect(gate.passed).toBe(false);
    const citations = gate.checks.find((check) => check.id === 'citations_resolve');
    expect(citations?.detail).toContain('NS-99');
  });

  it('refuses an example decided under a different pack', async () => {
    const target = await heldOutCase('EVAL-002');
    const foreign = makePrecedent({
      policyId: 'supplied-sample-policy',
      tags: target.tags as PrecedentRecord['tags'],
    });

    const gate = evaluateActivation({
      candidate: foreign,
      pack: target.pack,
      heldOut: await loadHeldOutCases(),
    });

    expect(gate.passed).toBe(false);
    expect(gate.checks.find((check) => check.id === 'policy_compatible')?.passed).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Curator workflow                                                   */
/* ------------------------------------------------------------------ */

describe('curator workflow', () => {
  it('records a refusal on the record and leaves the candidate inert', async () => {
    const target = await heldOutCase('EVAL-002');
    const harmful = await savePrecedent(
      makePrecedent({
        id: 'prec_curate_harmful',
        caseId: 'SYN-004',
        status: 'candidate',
        source: 'reviewer_override',
        approvedBy: null,
        approvedAt: null,
        tags: target.tags as PrecedentRecord['tags'],
        disposition: 'uphold',
        refundCents: 0,
        chargeCents: target.chargeCents,
      }),
    );

    const result = await approveCandidate({
      precedentId: harmful.id,
      note: 'Looks reasonable to me.',
    });

    expect(result.precedent.status).toBe('candidate');
    expect(result.precedent.activationFailure).toBeTruthy();
    expect(result.precedent.activationFailure).toContain('EVAL-002');
    expect((await listApprovedPrecedents()).some((record) => record.id === harmful.id)).toBe(false);
  });

  it('activates a sound candidate so it becomes retrievable context', async () => {
    const target = await heldOutCase('EVAL-002');
    const sound = await savePrecedent(
      makePrecedent({
        id: 'prec_curate_sound',
        caseId: 'SYN-002',
        status: 'candidate',
        source: 'reviewer_override',
        approvedBy: null,
        approvedAt: null,
        tags: target.tags as PrecedentRecord['tags'],
        disposition: 'refund',
        refundCents: target.chargeCents,
        chargeCents: target.chargeCents,
      }),
    );

    const result = await approveCandidate({
      precedentId: sound.id,
      note: 'The zone evidence plainly fails the pickup test.',
    });

    expect(result.precedent.status).toBe('approved');
    expect(result.precedent.approvedBy).toBe('curator_demo_01');
    expect(result.precedent.activationFailure).toBeNull();

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: await listApprovedPrecedents(),
    });
    expect(manifest.contexts.map((context) => context.precedentId)).toContain(sound.id);
  });

  it('keeps a rejected candidate out of retrieval', async () => {
    const target = await heldOutCase('EVAL-002');
    const rejected = await savePrecedent(
      makePrecedent({
        id: 'prec_curate_rejected',
        caseId: 'SYN-003',
        status: 'candidate',
        source: 'reviewer_override',
        approvedBy: null,
        approvedAt: null,
        tags: target.tags as PrecedentRecord['tags'],
      }),
    );

    const result = await rejectCandidate({
      precedentId: rejected.id,
      reason: 'The correction was about a data-entry slip, not the rule.',
    });
    expect(result.precedent.status).toBe('rejected');

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: await listApprovedPrecedents(),
    });
    expect(manifest.contexts.map((context) => context.precedentId)).not.toContain(rejected.id);
  });

  it('rolls an approved precedent back out of service', async () => {
    const target = await heldOutCase('EVAL-002');
    const example = await savePrecedent(
      makePrecedent({
        id: 'prec_curate_rollback',
        caseId: 'SYN-005',
        status: 'approved',
        tags: target.tags as PrecedentRecord['tags'],
      }),
    );

    const result = await rollbackPrecedent({
      precedentId: example.id,
      reason: 'A later case showed the condition tag was too coarse.',
    });

    expect(result.precedent.status).toBe('retired');
    expect(result.precedent.retiredReason).toContain('too coarse');

    const manifest = retrievePrecedents({
      caseRecord: target.entry.caseRecord,
      evaluation: evaluateCase(target.entry.caseRecord, target.pack),
      pack: target.pack,
      precedents: await listApprovedPrecedents(),
    });
    expect(manifest.contexts.map((context) => context.precedentId)).not.toContain(example.id);
  });

  it('shows the curator the verdict before they press anything', async () => {
    const target = await heldOutCase('EVAL-002');
    await savePrecedent(
      makePrecedent({
        id: 'prec_workbench_harmful',
        caseId: 'SYN-001',
        status: 'candidate',
        source: 'reviewer_override',
        approvedBy: null,
        approvedAt: null,
        tags: target.tags as PrecedentRecord['tags'],
        disposition: 'uphold',
        refundCents: 0,
        chargeCents: target.chargeCents,
      }),
    );

    const workbench = await loadCuratorWorkbench();
    const view = workbench.candidates.find((entry) => entry.record.id === 'prec_workbench_harmful');
    expect(view).toBeDefined();
    expect(view?.gate.passed).toBe(false);
    expect(view?.gate.checks.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses to roll back something that was never approved', async () => {
    await savePrecedent(
      makePrecedent({ id: 'prec_not_approved', status: 'candidate', approvedBy: null, approvedAt: null }),
    );
    await expect(
      rollbackPrecedent({ precedentId: 'prec_not_approved', reason: 'changed my mind' }),
    ).rejects.toThrow(/only an approved precedent/i);
  });
});

/* ------------------------------------------------------------------ */
/*  Reviewer override capture                                          */
/* ------------------------------------------------------------------ */

describe('override capture', () => {
  it('captures a changed partial amount even when the disposition is unchanged', async () => {
    const prepared = await prepare('SYN-004');
    const record = { ...prepared.caseRecord, id: 'AMOUNT-OVERRIDE' };
    const outcome = await captureOverrideCandidate({ caseRecord: record, pack: prepared.pack, evaluation: prepared.evaluation,
      decision: makeDecision({ caseId: record.id, disposition: 'partial_refund', targetRefundCents: 300 }),
      priorRecommendation: { disposition: 'partial_refund', refundCents: 200 }, correctionReason: 'Reviewed the documented fare component.', reviewerId: 'reviewer_demo_01' });
    expect(outcome.candidate?.refundCents).toBe(300);
    expect(outcome.candidate?.status).toBe('candidate');
  });
  it('captures a departure as an inert candidate that is not retrievable', async () => {
    // A case id no other test turns into a candidate, so this exercises capture
    // rather than the duplicate-reuse path.
    const prepared = await prepare('SYN-008');
    const decision = makeDecision({
      caseId: 'SYN-008',
      disposition: 'refund',
      targetRefundCents: prepared.caseRecord.disputedCents,
    });

    const outcome = await captureOverrideCandidate({
      caseRecord: prepared.caseRecord,
      pack: prepared.pack,
      evaluation: prepared.evaluation,
      decision,
      priorRecommendation: { disposition: 'uphold', refundCents: 0 },
      correctionReason: 'The stationary fixes never enter the pickup radius.',
      reviewerId: 'reviewer_demo_01',
    });

    const candidate = outcome.candidate;
    expect(outcome.reused).toBe(false);
    expect(candidate).not.toBeNull();
    expect(candidate?.status).toBe('candidate');
    expect(candidate?.source).toBe('reviewer_override');
    expect(candidate?.priorRecommendation).toContain('uphold');
    expect(candidate?.correctionReason).toContain('pickup radius');
    expect(candidate?.tags.length).toBeGreaterThan(0);

    // Inert: nothing approved, so nothing is retrievable for any case.
    const manifest = retrievePrecedents({
      caseRecord: prepared.caseRecord,
      evaluation: prepared.evaluation,
      pack: prepared.pack,
      precedents: await listApprovedPrecedents(),
    });
    expect(manifest.contexts).toHaveLength(0);
  });

  it('captures nothing when the reviewer agreed with the recommendation', async () => {
    const prepared = await prepare('SYN-002');
    const outcome = await captureOverrideCandidate({
      caseRecord: prepared.caseRecord,
      pack: prepared.pack,
      evaluation: prepared.evaluation,
      decision: makeDecision({ disposition: 'uphold', targetRefundCents: 0 }),
      priorRecommendation: { disposition: 'uphold', refundCents: 0 },
      correctionReason: 'Agreed with the engine.',
      reviewerId: 'reviewer_demo_01',
    });

    expect(outcome.candidate).toBeNull();
    expect(outcome.reason).toMatch(/matches the automated recommendation/i);
  });

  it('captures the reviewer\'s own ruling when the engine merely abstained on a data gap', async () => {
    const prepared = await prepare('SYN-006');
    const outcome = await captureOverrideCandidate({
      caseRecord: prepared.caseRecord,
      pack: prepared.pack,
      evaluation: prepared.evaluation,
      decision: makeDecision({
        caseId: 'SYN-006',
        disposition: 'refund',
        targetRefundCents: prepared.caseRecord.disputedCents,
      }),
      priorRecommendation: { disposition: 'human_review', refundCents: null },
      correctionReason: 'The zone is indeterminate, so the fee is not supported by the rule.',
      reviewerId: 'reviewer_demo_01',
    });

    expect(outcome.candidate).not.toBeNull();
    expect(outcome.candidate?.priorRecommendation).toMatch(/abstained/i);
    expect(outcome.reason).toMatch(/reviewer's own judgement/i);
  });

  it('captures nothing when the governing policy was itself unresolved', async () => {
    const prepared = await prepare('SYN-007');
    const outcome = await captureOverrideCandidate({
      caseRecord: prepared.caseRecord,
      pack: prepared.pack,
      evaluation: prepared.evaluation,
      decision: makeDecision({
        caseId: 'SYN-007',
        disposition: 'uphold',
        targetRefundCents: 0,
      }),
      priorRecommendation: { disposition: 'human_review', refundCents: null },
      correctionReason: 'I read the supplied policy as making the arrival clock govern.',
      reviewerId: 'reviewer_demo_01',
    });

    expect(outcome.candidate).toBeNull();
    expect(outcome.reason).toMatch(/policy owner/i);
  });

  it('captures nothing from a closure without a ruling', async () => {
    const prepared = await prepare('SYN-002');
    const outcome = await captureOverrideCandidate({
      caseRecord: prepared.caseRecord,
      pack: prepared.pack,
      evaluation: prepared.evaluation,
      decision: makeDecision({ disposition: 'insufficient_evidence', targetRefundCents: null }),
      priorRecommendation: { disposition: 'uphold', refundCents: 0 },
      correctionReason: 'The evidence cannot settle it.',
      reviewerId: 'reviewer_demo_01',
    });

    expect(outcome.candidate).toBeNull();
    expect(outcome.reason).toMatch(/no liability outcome/i);
  });

  it('does not stack duplicate candidates for one case version', async () => {
    const prepared = await prepare('SYN-003');
    const args = {
      caseRecord: prepared.caseRecord,
      pack: prepared.pack,
      evaluation: prepared.evaluation,
      decision: makeDecision({
        caseId: 'SYN-003',
        disposition: 'refund',
        targetRefundCents: prepared.caseRecord.disputedCents,
      }),
      priorRecommendation: { disposition: 'uphold', refundCents: 0 },
      correctionReason: 'Override.',
      reviewerId: 'reviewer_demo_01',
    };

    const first = await captureOverrideCandidate(args);
    const second = await captureOverrideCandidate(args);

    expect(first.candidate?.id).toBeTruthy();
    expect(second.reused).toBe(true);
    expect(second.candidate?.id).toBe(first.candidate?.id);
  });
});

/* ------------------------------------------------------------------ */
/*  Snapshot fidelity                                                  */
/* ------------------------------------------------------------------ */

describe('snapshot fidelity', () => {
  it('keeps showing the precedent context a run actually received, after a rollback', async () => {
    const target = await heldOutCase('EVAL-002');

    const example = await savePrecedent(
      makePrecedent({
        id: 'prec_snapshot_fidelity',
        caseId: 'SYN-002',
        status: 'approved',
        tags: target.tags,
      }),
    );

    // The example is retrieved for a *different* case, so it is not its own
    // precedent and the conditions genuinely overlap.
    const retrievalCase = target.entry.caseRecord;
    const manifest = retrievePrecedents({
      caseRecord: retrievalCase,
      evaluation: evaluateCase(retrievalCase, target.pack),
      pack: target.pack,
      precedents: [example],
    });
    expect(manifest.contexts.map((context) => context.precedentId)).toContain(example.id);

    const runId = `run_snapshot_fidelity_${Date.now()}`;
    const quality = scoreEvidence(
      retrievalCase,
      evaluateCase(retrievalCase, target.pack),
      target.pack.thresholds,
    );
    await captureRunSnapshot({
      runId,
      mode: 'fixture',
      provider: 'fixture',
      promptVersion: 'rydr-prompts-v3',
      inputHash: fingerprint({ runId }),
      caseRecord: retrievalCase,
      policyPack: target.pack,
      evaluation: evaluateCase(retrievalCase, target.pack),
      quality,
      catalog: buildCatalog(retrievalCase),
      precedents: manifest,
    });

    await rollbackPrecedent({ precedentId: example.id, reason: 'Superseded by a clearer example.' });
    expect((await getPrecedent(example.id))?.status).toBe('retired');

    // The frozen record is untouched by the rollback.
    const snapshot = await getRunSnapshot(runId);
    expect(snapshot?.precedents?.contexts.map((context) => context.precedentId)).toContain(
      example.id,
    );

    // And a fresh retrieval no longer offers it.
    const fresh = retrievePrecedents({
      caseRecord: retrievalCase,
      evaluation: evaluateCase(retrievalCase, target.pack),
      pack: target.pack,
      precedents: await listApprovedPrecedents(),
    });
    expect(fresh.contexts.map((context) => context.precedentId)).not.toContain(example.id);
  });

  it('leaves the precedents field absent when retrieval was never consulted', async () => {
    const prepared = await prepare('SYN-002');
    const runId = `run_no_precedents_${Date.now()}`;
    const quality = scoreEvidence(prepared.caseRecord, prepared.evaluation, prepared.pack.thresholds);
    await captureRunSnapshot({
      runId,
      mode: 'fixture',
      provider: 'fixture',
      promptVersion: 'rydr-prompts-v3',
      inputHash: fingerprint({ runId }),
      caseRecord: prepared.caseRecord,
      policyPack: prepared.pack,
      evaluation: prepared.evaluation,
      quality,
      catalog: buildCatalog(prepared.caseRecord),
    });

    const snapshot = await getRunSnapshot(runId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.precedents).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Curator authoring                                                  */
/* ------------------------------------------------------------------ */

describe('curator authoring', () => {
  it('promotes a resolved case version into an approved example', async () => {
    // A fresh version, so this does not depend on which other tests have already
    // recorded a precedent against a seed case.
    const bumped = await appendCaseVersion(
      'SYN-002',
      (current) => current,
      'Test fixture: a fresh version to promote as an example.',
    );
    expect(bumped.version).toBeGreaterThan(1);

    const result = await authorExample({
      caseId: 'SYN-002',
      caseVersion: bumped.version,
      note: 'A clean no-show: the vehicle was inside the zone, the wait exceeded the threshold.',
    });

    expect(result.precedent.status).toBe('approved');
    expect(result.precedent.source).toBe('curator_authored');
    expect(result.precedent.caseVersion).toBe(bumped.version);
    // The outcome is read from the engine, never authored.
    expect(result.precedent.disposition).toBe('uphold');
    expect(result.precedent.refundCents).toBe(0);
  });

  it('refuses to promote an abstention, because it decided nothing', async () => {
    await expect(
      authorExample({
        caseId: 'SYN-008',
        caseVersion: 1,
        note: 'Looks clear to me.',
      }),
    ).rejects.toThrow(/abstained/i);
  });

  it('refuses to record a second example for the same case version', async () => {
    await expect(
      authorExample({
        caseId: 'SYN-002',
        caseVersion: 2,
        note: 'Promoting it again.',
      }),
    ).rejects.toThrow(/already recorded/i);
  });

  it('offers only resolved case versions for promotion', async () => {
    const promotable = await listPromotableCases();
    expect(promotable.some((entry) => entry.caseId === 'SYN-002' && entry.caseVersion === 2)).toBe(
      true,
    );
    // SYN-008 abstains, so there is nothing to promote from it.
    expect(promotable.some((entry) => entry.caseId === 'SYN-008')).toBe(false);

    const promoted = promotable.find(
      (entry) => entry.caseId === 'SYN-002' && entry.caseVersion === 2,
    );
    expect(promoted?.existingPrecedentId).toBeTruthy();
    expect(promoted?.existingStatus).toBe('approved');
  });
});

/* ------------------------------------------------------------------ */
/*  Label isolation                                                    */
/* ------------------------------------------------------------------ */

describe('evaluation label isolation', () => {
  it('no runtime agent or provider module can reach the reviewed labels', async () => {
    const roots = ['src/agents', 'src/providers'];
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        const source = await fs.readFile(full, 'utf8');
        if (/evaluationSet|labels\.json/.test(source)) offenders.push(full);
      }
    }

    for (const root of roots) await walk(root);
    expect(offenders).toEqual([]);
  });
});
