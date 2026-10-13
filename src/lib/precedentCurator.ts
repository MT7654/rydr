import type {
  CaseDecision,
  CaseRecord,
  Disposition,
  PolicyPack,
} from '@/domain/contracts';
import type { DeterministicEvaluation } from '@/domain/policy';
import { evaluateCase } from '@/domain/policy';
import {
  PrecedentRecordSchema,
  extractCaseFeatures,
  type PrecedentRecord,
} from '@/domain/precedent';
import { evaluateActivation, type ActivationEvaluation } from '@/domain/precedentGate';
import { formatSgd } from '@/domain/money';
import { getCaseVersion, getAllCases, getPolicyPack } from '@/repositories/cases';
import {
  createCandidate,
  findCandidateForCaseVersion,
  getPrecedent,
  listApprovedPrecedents,
  listPrecedents,
  updatePrecedent,
} from '@/repositories/precedents';
import { loadHeldOutCases } from '@/lib/evaluationSet';

/**
 * Governed learning.
 *
 * A reviewer who departs from the automated recommendation is telling the
 * company something. The temptation is to treat that correction as truth and
 * let it steer the next case. This module deliberately refuses to: a correction
 * becomes an **inert candidate**, it is invisible to the Judge, and it can only
 * become retrievable context by passing the shadow-replay gate and a curator's
 * explicit approval.
 *
 * The curator lives outside `src/agents` on purpose. It reads the held-out
 * labels, and no runtime agent may be able to reach them — a test enforces that.
 */

export const DEMO_CURATOR_ID = 'curator_demo_01';
export const DEMO_CURATOR_NAME = 'Priya Raman';

/** The automated outcomes that can be *overridden* by a person. */
const RULING_DISPOSITIONS = new Set<Disposition>(['refund', 'uphold', 'partial_refund']);

export interface OverrideInput {
  caseRecord: CaseRecord;
  pack: PolicyPack;
  evaluation: DeterministicEvaluation;
  decision: CaseDecision;
  /** What the automated review had recommended, if it recommended anything. */
  priorRecommendation: { disposition: string; refundCents: number | null } | null;
  /** The reviewer's stated reason for departing. */
  correctionReason: string | null;
  reviewerId: string;
}

export interface OverrideOutcome {
  /** Null when the decision was not an override of a concrete recommendation. */
  candidate: PrecedentRecord | null;
  /** True when an existing candidate for this case version was reused. */
  reused: boolean;
  reason: string;
}

/** One-line material facts a reviewer can scan without re-reading the case. */
function materialFacts(
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
  correctionReason: string | null,
): string[] {
  const facts: string[] = [
    `${caseRecord.category === 'no_show_charge' ? 'No-show charge' : 'Route overcharge'} of ${formatSgd(caseRecord.disputedCents)} disputed at case v${caseRecord.version}.`,
  ];
  for (const issue of evaluation.issues.slice(0, 3)) facts.push(issue);
  if (evaluation.disposition !== 'human_review') {
    facts.push(
      `The deterministic engine read the evidence as "${evaluation.disposition}" at ${
        evaluation.recommendedRefundCents === null
          ? 'no amount'
          : formatSgd(evaluation.recommendedRefundCents)
      }.`,
    );
  }
  if (correctionReason) facts.push(`Reviewer correction: ${correctionReason}`);
  return facts;
}

/**
 * Turns a reviewer override into an inert candidate.
 *
 * Capture is deliberately narrow. A correction is only worth learning from when
 * the company's own rulebook was determinate: if the governing policy was
 * itself unresolved, the reviewer supplied a judgement rather than a correction,
 * and turning that into an example would quietly fill a policy gap with one
 * person's reading of it. That case belongs with the policy owner, not here.
 *
 * A reviewer's ruling on a case the engine merely could not *decide* — a data
 * gap rather than a policy gap — is captured, because that is exactly the
 * judgement a later reviewer would benefit from seeing. It still has to pass
 * the gate and a curator.
 */
export async function captureOverrideCandidate(input: OverrideInput): Promise<OverrideOutcome> {
  const { caseRecord, pack, evaluation, decision, priorRecommendation, correctionReason } = input;

  if (!correctionReason) {
    return { candidate: null, reused: false, reason: 'No stated departure, so nothing to capture.' };
  }
  if (decision.disposition === 'insufficient_evidence') {
    return {
      candidate: null,
      reused: false,
      reason:
        'A closure without a ruling records no liability outcome, so it cannot become an example.',
    };
  }
  if (evaluation.noShow?.policyAmbiguity) {
    return {
      candidate: null,
      reused: false,
      reason:
        'The governing policy was unresolved here, so the reviewer supplied a judgement rather than a correction. That goes to the policy owner, not into the precedent store.',
    };
  }

  const recommended = priorRecommendation?.disposition ?? null;
  const hadRuling = recommended !== null && RULING_DISPOSITIONS.has(recommended as Disposition);
  if (hadRuling && recommended === decision.disposition && priorRecommendation?.refundCents === decision.targetRefundCents) {
    return {
      candidate: null,
      reused: false,
      reason: 'The recorded outcome matches the automated recommendation, so nothing was overridden.',
    };
  }

  const existing = await findCandidateForCaseVersion(caseRecord.id, decision.caseVersion);
  if (existing) {
    return {
      candidate: existing,
      reused: true,
      reason: `Case v${decision.caseVersion} already has an open candidate; the existing one was kept rather than stacking a duplicate.`,
    };
  }

  const features = extractCaseFeatures(caseRecord, evaluation, pack);
  const knownClauses = new Set(pack.clauses.map((clause) => clause.id));
  const cited = (decision.policyIds.length > 0 ? decision.policyIds : evaluation.policyIds).filter(
    (id) => knownClauses.has(id),
  );

  const candidate = await createCandidate({
    caseId: caseRecord.id,
    caseVersion: decision.caseVersion,
    category: caseRecord.category,
    policyId: pack.id,
    policyVersion: pack.version,
    citedPolicyIds: cited,
    tags: features.tags,
    materialFacts: materialFacts(caseRecord, evaluation, correctionReason),
    disposition: decision.disposition as 'refund' | 'uphold' | 'partial_refund',
    refundCents: decision.targetRefundCents ?? 0,
    chargeCents: caseRecord.disputedCents,
    source: 'reviewer_override',
    priorRecommendation: hadRuling
      ? `${recommended}${
          priorRecommendation?.refundCents === null || priorRecommendation?.refundCents === undefined
            ? ' at no amount'
            : ` at ${formatSgd(priorRecommendation.refundCents)}`
        }`
      : 'the automated review abstained (human_review)',
    correctionReason,
    approvedBy: null,
    approvedAt: null,
    approvalNote: null,
    activationFailure: null,
    retiredAt: null,
    retiredReason: null,
    supersedesPrecedentId: null,
  });

  return {
    candidate,
    reused: false,
    reason: hadRuling
      ? `Captured an inert candidate from case v${decision.caseVersion}: the reviewer departed from the automated "${recommended}" recommendation. It is invisible to the Judge until a curator approves it.`
      : `Captured an inert candidate from case v${decision.caseVersion}: the automated review abstained, so this ruling is the reviewer's own judgement. It is invisible to the Judge until a curator approves it.`,
  };
}

/* ------------------------------------------------------------------ */
/*  Curator decisions                                                  */
/* ------------------------------------------------------------------ */

export interface CuratorResult {
  precedent: PrecedentRecord;
  gate: ActivationEvaluation | null;
  message: string;
}

/**
 * Runs the shadow-replay gate and, only if it passes, activates the candidate.
 *
 * A refusal is recorded on the record rather than thrown away: the next curator
 * should see that this correction was tried and why it was refused.
 */
export async function approveCandidate(input: {
  precedentId: string;
  curatorId?: string;
  note: string;
}): Promise<CuratorResult> {
  const candidate = await requirePrecedent(input.precedentId);
  if (candidate.status !== 'candidate') {
    throw new Error(
      `Precedent ${candidate.id} is "${candidate.status}", not a candidate, so it cannot be approved.`,
    );
  }

  const pack = await getPolicyPack(candidate.policyId);
  const heldOut = await loadHeldOutCases();
  const activePrecedents = await listApprovedPrecedents();
  const gate = evaluateActivation({ candidate, pack, heldOut, activePrecedents });

  if (!gate.passed) {
    const precedent = await updatePrecedent(candidate.id, (record) => ({
      ...record,
      // Stays a candidate: a refused proposal must never become context.
      activationFailure: gate.failure,
    }));
    return {
      precedent,
      gate,
      message: `Activation refused. ${gate.failure ?? ''}`.trim(),
    };
  }

  const approvedAt = new Date().toISOString();
  const precedent = await updatePrecedent(candidate.id, (record) => ({
    ...record,
    status: 'approved',
    approvedBy: input.curatorId ?? DEMO_CURATOR_ID,
    approvedAt,
    approvalNote: input.note,
    activationFailure: null,
  }));

  return {
    precedent,
    gate,
    message: `Approved. The example passed every gate check and can now be retrieved as context for materially similar cases.`,
  };
}

export async function rejectCandidate(input: {
  precedentId: string;
  curatorId?: string;
  reason: string;
}): Promise<CuratorResult> {
  const candidate = await requirePrecedent(input.precedentId);
  if (candidate.status !== 'candidate') {
    throw new Error(`Precedent ${candidate.id} is "${candidate.status}" and cannot be rejected.`);
  }
  const precedent = await updatePrecedent(candidate.id, (record) => ({
    ...record,
    status: 'rejected',
    approvedBy: input.curatorId ?? DEMO_CURATOR_ID,
    approvalNote: input.reason,
  }));
  return { precedent, gate: null, message: 'Candidate rejected and kept for history.' };
}

/**
 * Rolls an approved precedent back out of service.
 *
 * The record is retired rather than deleted: a run that already showed the
 * example must still be explainable, and the audit trail of what was once
 * active is part of the demo's honesty.
 */
export async function rollbackPrecedent(input: {
  precedentId: string;
  curatorId?: string;
  reason: string;
}): Promise<CuratorResult> {
  const record = await requirePrecedent(input.precedentId);
  if (record.status !== 'approved') {
    throw new Error(`Only an approved precedent can be rolled back; this one is "${record.status}".`);
  }
  const precedent = await updatePrecedent(record.id, (current) => ({
    ...current,
    status: 'retired',
    retiredAt: new Date().toISOString(),
    retiredReason: input.reason,
    approvalNote: `${current.approvalNote ?? ''}${current.approvalNote ? ' ' : ''}Rolled back by ${input.curatorId ?? DEMO_CURATOR_ID}: ${input.reason}`.trim(),
  }));
  return {
    precedent,
    gate: null,
    message:
      'Rolled back. It is no longer retrieved for new runs; runs that already recorded it keep the frozen context they were shown.',
  };
}

async function requirePrecedent(id: string): Promise<PrecedentRecord> {
  const record = await getPrecedent(id);
  if (!record) throw new Error(`Unknown precedent: ${id}`);
  return record;
}

/**
 * Promotes a case the engine actually decided into an example.
 *
 * This is the curator's other tool. It is not "publish this correction" — it is
 * "this resolved case is a clear example worth showing a later reviewer". The
 * outcome is read from the deterministic evaluation of that exact case version
 * and never invented, so a curator selects an example rather than writing a
 * ruling. An abstention cannot be promoted, because it decided nothing.
 *
 * The new record goes through the same shadow-replay gate as a reviewer's
 * correction: a refusal leaves it as a candidate with the reason recorded.
 */
export async function authorExample(input: {
  caseId: string;
  caseVersion: number;
  note: string;
  curatorId?: string;
}): Promise<CuratorResult> {
  const caseRecord = await getCaseVersion(input.caseId, input.caseVersion);
  if (!caseRecord) {
    throw new Error(`Case ${input.caseId} has no version ${input.caseVersion}.`);
  }
  const pack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source === 'supplied_sample') {
    throw new Error(`Case ${input.caseId} is governed by a non-demo pack: ${pack.id}`);
  }

  const evaluation = evaluateCase(caseRecord, pack);
  if (evaluation.disposition === 'human_review') {
    throw new Error(
      'The engine abstained on that case version, so there is no resolved outcome to promote.',
    );
  }

  const already = (await listPrecedents()).find(
    (record) =>
      record.caseId === caseRecord.id &&
      record.caseVersion === caseRecord.version &&
      record.status !== 'rejected',
  );
  if (already) {
    throw new Error(
      `Case ${caseRecord.id} v${caseRecord.version} is already recorded as ${already.status} (${already.id}).`,
    );
  }

  const features = extractCaseFeatures(caseRecord, evaluation, pack);
  const knownClauses = new Set(pack.clauses.map((clause) => clause.id));

  const record = await createCandidate({
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    category: caseRecord.category,
    policyId: pack.id,
    policyVersion: pack.version,
    citedPolicyIds: evaluation.policyIds.filter((id) => knownClauses.has(id)),
    tags: features.tags,
    materialFacts: materialFacts(caseRecord, evaluation, null),
    disposition: evaluation.disposition as 'refund' | 'uphold' | 'partial_refund',
    refundCents: evaluation.recommendedRefundCents ?? 0,
    chargeCents: caseRecord.disputedCents,
    source: 'curator_authored',
    priorRecommendation: null,
    correctionReason: input.note,
    approvedBy: null,
    approvedAt: null,
    approvalNote: null,
    activationFailure: null,
    retiredAt: null,
    retiredReason: null,
    supersedesPrecedentId: null,
  });

  return approveCandidate({ precedentId: record.id, curatorId: input.curatorId, note: input.note });
}

/* ------------------------------------------------------------------ */
/*  Curator workbench                                                  */
/* ------------------------------------------------------------------ */

/** A resolved case version a curator may promote into an example. */
export interface PromotableCase {
  caseId: string;
  caseVersion: number;
  category: CaseRecord['category'];
  disposition: Disposition;
  refundCents: number | null;
  disputedCents: number;
  /** Set when the case version already has a precedent in some status. */
  existingPrecedentId: string | null;
  existingStatus: PrecedentRecord['status'] | null;
}

/**
 * The app's own resolved case versions, so a curator can seed the example set
 * from real history instead of inventing one. Abstentions are omitted: there is
 * nothing to promote.
 */
export async function listPromotableCases(): Promise<PromotableCase[]> {
  const cases = await getAllCases();
  const precedents = await listPrecedents();
  const promotable: PromotableCase[] = [];

  for (const caseRecord of cases) {
    let pack: PolicyPack;
    try {
      pack = await getPolicyPack(caseRecord.policyVersion);
    } catch {
      continue;
    }
    if (pack.source === 'supplied_sample') continue;
    const evaluation = evaluateCase(caseRecord, pack);
    if (evaluation.disposition === 'human_review') continue;

    const existing = precedents.find(
      (record) => record.caseId === caseRecord.id && record.caseVersion === caseRecord.version,
    );
    promotable.push({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      category: caseRecord.category,
      disposition: evaluation.disposition,
      refundCents: evaluation.recommendedRefundCents,
      disputedCents: caseRecord.disputedCents,
      existingPrecedentId: existing?.id ?? null,
      existingStatus: existing?.status ?? null,
    });
  }

  return promotable.sort((a, b) => a.caseId.localeCompare(b.caseId));
}

export interface CandidateView {
  record: PrecedentRecord;
  gate: ActivationEvaluation;
}

export interface CuratorWorkbench {
  candidates: CandidateView[];
  approved: PrecedentRecord[];
  rejected: PrecedentRecord[];
  retired: PrecedentRecord[];
}

/**
 * Everything the curator screen needs, with the gate already run for each
 * candidate so the reviewer sees the verdict before they press anything.
 */
export async function loadCuratorWorkbench(): Promise<CuratorWorkbench> {
  const all = await listPrecedents();
  const heldOut = await loadHeldOutCases();
  const activePrecedents = all.filter((record) => record.status === 'approved');

  const candidates: CandidateView[] = [];
  for (const record of all.filter((entry) => entry.status === 'candidate')) {
    let gate: ActivationEvaluation;
    try {
      const pack = await getPolicyPack(record.policyId);
      gate = evaluateActivation({ candidate: record, pack, heldOut, activePrecedents });
    } catch (error) {
      gate = {
        passed: false,
        checks: [],
        failure: `The governing pack for ${record.policyId} could not be loaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    candidates.push({ record, gate });
  }

  return {
    candidates,
    approved: activePrecedents,
    rejected: all.filter((record) => record.status === 'rejected'),
    retired: all.filter((record) => record.status === 'retired'),
  };
}

/** Exported for tests that need to build a well-formed record. */
export { PrecedentRecordSchema };
