import type { CaseRecord, Disposition, PolicyPack } from './contracts';
import { evaluateCase } from './policy';
import { extractCaseFeatures, RELEVANCE_FLOOR, type PrecedentRecord } from './precedent';
import { tagSimilarity } from './precedentRetrieval';

/**
 * The shadow-replay gate.
 *
 * Activation is not a formality. A candidate must pass every check below before
 * it can be retrieved for any future case, and a failure is recorded on the
 * record rather than silently discarded.
 *
 * The interesting check is the held-out replay. Because a precedent only ever
 * supplies *context*, it cannot change a deterministic outcome — so a naive
 * "replay produced the same decisions" check would always pass and prove
 * nothing. What the gate actually tests is that activating the candidate would
 * not put an example in front of the Judge for a case whose reviewed outcome it
 * contradicts. That is the failure mode that matters: a harmful example is one
 * that argues against a correct ruling on a materially similar case.
 */

export interface HeldOutCase {
  caseId: string;
  caseRecord: CaseRecord;
  pack: PolicyPack;
  /** The reviewed label. Never passed to a runtime agent. */
  expectedDisposition: Disposition | 'insufficient_evidence';
}

/**
 * The reviewed outcomes that count as a *ruling*.
 *
 * `human_review` and `insufficient_evidence` are abstentions: they decide
 * nothing about liability, and the deterministic escalation gate enforces them
 * regardless of what context the Judge was shown.
 */
const RULING_OUTCOMES = new Set<Disposition | 'insufficient_evidence'>([
  'refund',
  'uphold',
  'partial_refund',
]);

export interface GateCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ActivationEvaluation {
  passed: boolean;
  checks: GateCheck[];
  /** Present when the gate refused, ready to store on the record. */
  failure: string | null;
}

/** The refund invariants the simulated ledger enforces, applied to the example. */
export function checkOutcomeInvariants(record: {
  disposition: 'refund' | 'uphold' | 'partial_refund';
  refundCents: number;
  chargeCents: number;
}): { ok: boolean; detail: string } {
  const { disposition, refundCents, chargeCents } = record;
  if (disposition === 'uphold') {
    return refundCents === 0
      ? { ok: true, detail: 'An upheld charge records a zero refund.' }
      : { ok: false, detail: `An upheld charge cannot record a ${refundCents}-cent refund.` };
  }
  if (disposition === 'refund') {
    return refundCents === chargeCents
      ? { ok: true, detail: 'A full refund equals the disputed charge.' }
      : {
          ok: false,
          detail: `A refund of ${refundCents} does not equal the ${chargeCents}-cent charge.`,
        };
  }
  return refundCents > 0 && refundCents < chargeCents
    ? { ok: true, detail: 'A partial refund sits strictly between zero and the charge.' }
    : {
        ok: false,
        detail: `A partial refund of ${refundCents} is not strictly inside (0, ${chargeCents}).`,
      };
}

export function evaluateActivation(input: {
  candidate: PrecedentRecord;
  pack: PolicyPack;
  heldOut: HeldOutCase[];
  /** Approved precedents that would remain active alongside this one. */
  activePrecedents?: PrecedentRecord[];
}): ActivationEvaluation {
  const { candidate, pack, heldOut } = input;
  const checks: GateCheck[] = [];

  const invariants = checkOutcomeInvariants(candidate);
  checks.push({
    id: 'outcome_invariants',
    label: 'Outcome obeys the financial invariants',
    passed: invariants.ok,
    detail: invariants.detail,
  });

  const policyCompatible = candidate.policyId === pack.id && candidate.policyVersion === pack.version;
  checks.push({
    id: 'policy_compatible',
    label: 'Decided under the governing policy pack',
    passed: policyCompatible,
    detail: policyCompatible
      ? `The example was decided under ${candidate.policyId}, which is the governing pack.`
      : `The example was decided under ${candidate.policyId}, but this case is governed by ${pack.id}.`,
  });

  const knownPolicyIds = new Set(pack.clauses.map((clause) => clause.id));
  const unknownCitations = candidate.citedPolicyIds.filter((id) => !knownPolicyIds.has(id));
  checks.push({
    id: 'citations_resolve',
    label: 'Every cited clause exists in the governing pack',
    passed: unknownCitations.length === 0,
    detail:
      unknownCitations.length === 0
        ? `${candidate.citedPolicyIds.length} cited clause(s) all resolve.`
        : `Unknown cited clause(s): ${unknownCitations.join(', ')}.`,
  });

  // The held-out replay.
  //
  // A precedent only ever supplies *context*, so it cannot change a
  // deterministic outcome — a naive "replay produced the same decisions" check
  // would always pass and prove nothing. What this check actually tests is
  // whether activating the candidate would put an example in front of the Judge
  // that argues against a ruling a human already reviewed on a case the example
  // genuinely covers.
  //
  // Two conditions make a held-out case "covered" rather than merely similar:
  //  - the two are materially comparable (condition overlap at or above the
  //    relevance floor); and
  //  - the candidate's own conditions are a subset of the held-out case's, so
  //    none of the differences the candidate states explains the gap. An example
  //    that openly differs on the deciding fact is not a claim about this case.
  //
  // Abstentions are set aside, not counted as conflicts. `human_review` and
  // `insufficient_evidence` are not rulings, and they are enforced independently
  // by the deterministic escalation gate — no precedent can turn one into a
  // ruling. They are still counted and reported, so the curator can see what was
  // considered.
  const conflicts: string[] = [];
  let comparable = 0;
  let abstentionsSetAside = 0;

  for (const heldOutCase of heldOut) {
    if (heldOutCase.caseRecord.id === candidate.caseId) continue;
    if (heldOutCase.pack.id !== candidate.policyId || heldOutCase.pack.version !== candidate.policyVersion) continue;
    if (heldOutCase.caseRecord.category !== candidate.category) continue;

    const evaluation = evaluateCase(heldOutCase.caseRecord, heldOutCase.pack);
    const features = extractCaseFeatures(heldOutCase.caseRecord, evaluation, heldOutCase.pack);
    const score = tagSimilarity(candidate.tags, features.tags);
    if (score < RELEVANCE_FLOOR) continue;

    const covered = candidate.tags.every((tag) => features.tags.includes(tag));
    if (!covered) continue;

    comparable += 1;

    if (!RULING_OUTCOMES.has(heldOutCase.expectedDisposition)) {
      abstentionsSetAside += 1;
      continue;
    }

    if (heldOutCase.expectedDisposition !== candidate.disposition) {
      conflicts.push(
        `${heldOutCase.caseId} (overlap ${score.toFixed(2)}) is labelled "${heldOutCase.expectedDisposition}" but this example states "${candidate.disposition}" on the same conditions`,
      );
    }
  }

  checks.push({
    id: 'held_out_replay',
    label: 'Does not argue against a reviewed ruling on a case it covers',
    passed: conflicts.length === 0,
    detail:
      conflicts.length === 0
        ? comparable === 0
          ? 'No held-out case is materially comparable on these conditions, so the example cannot mislead any of them.'
          : `${comparable} comparable held-out case(s) reviewed; the example agrees with every reviewed ruling${
              abstentionsSetAside > 0
                ? ` (${abstentionsSetAside} comparable abstention(s) set aside: a human_review outcome is enforced by the escalation gate and cannot be overturned by an example)`
                : ''
            }.`
        : `Would contradict: ${conflicts.join('; ')}.`,
  });

  const failed = checks.filter((check) => !check.passed);
  return {
    passed: failed.length === 0,
    checks,
    failure:
      failed.length === 0
        ? null
        : `Activation refused by the shadow-replay gate: ${failed.map((check) => `${check.label} — ${check.detail}`).join(' ')}`,
  };
}
