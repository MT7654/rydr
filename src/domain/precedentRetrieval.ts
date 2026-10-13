import type { CaseRecord, PolicyPack } from './contracts';
import type { DeterministicEvaluation } from './policy';
import {
  MAX_PRECEDENTS,
  RELEVANCE_FLOOR,
  describeOutcome,
  extractCaseFeatures,
  type CaseFeatures,
  type PrecedentContext,
  type PrecedentExclusion,
  type PrecedentManifest,
  type PrecedentRecord,
} from './precedent';

/**
 * Structured lexical precedent retrieval.
 *
 * Deliberately not embeddings: the whole point of the demo is that a reviewer
 * can read *why* two cases were considered similar. Every exclusion and every
 * similarity below is a stated rule, not a similarity score in a vector space.
 *
 * The four hard exclusions the spec requires:
 *  - the current case itself (a case cannot be its own precedent);
 *  - examples decided under incompatible rules (different governing pack);
 *  - superseded or rejected examples;
 *  - anything that is not an approved precedent.
 */

export interface RetrievalInput {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  pack: PolicyPack;
  precedents: PrecedentRecord[];
  now?: string;
}

/** Jaccard overlap over condition tags — the whole relevance model. */
export function tagSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let shared = 0;
  for (const tag of setA) if (setB.has(tag)) shared += 1;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

function describeTags(tags: string[]): string[] {
  return tags.map((tag) => tag.replace(/_/g, ' '));
}

/**
 * Why a non-approved record is not context. Stated per status, because "a
 * reviewer correction is still waiting for a curator" and "this example was
 * rolled back" are different facts and a reviewer should not have to guess which
 * one they are looking at.
 */
const NOT_APPROVED_REASON: Record<Exclude<PrecedentRecord['status'], 'approved'>, string> = {
  candidate:
    'Not an approved precedent (status: candidate). A reviewer correction stays inert until a curator approves it.',
  rejected:
    'Not an approved precedent (status: rejected). A curator considered this correction and declined it.',
  retired:
    'Not an approved precedent (status: retired). This example was activated and has since been rolled back.',
};

export function retrievePrecedents(input: RetrievalInput): PrecedentManifest {
  const { caseRecord, evaluation, pack, precedents } = input;
  const features: CaseFeatures = extractCaseFeatures(caseRecord, evaluation, pack);
  const retrievedAt = input.now ?? new Date().toISOString();

  const excluded: PrecedentExclusion[] = [];
  const scored: { record: PrecedentRecord; score: number; shared: string[] }[] = [];

  for (const record of precedents) {
    if (record.caseId === caseRecord.id) {
      excluded.push({
        precedentId: record.id,
        reason: 'The current case cannot be its own precedent.',
      });
      continue;
    }
    if (record.status !== 'approved') {
      excluded.push({
        precedentId: record.id,
        reason: NOT_APPROVED_REASON[record.status],
      });
      continue;
    }
    if (record.policyId !== features.policyId || record.policyVersion !== pack.version) {
      excluded.push({
        precedentId: record.id,
        reason: `Decided under incompatible rules (${record.policyId}); this case is governed by ${features.policyId}.`,
      });
      continue;
    }
    if (record.category !== features.category) {
      excluded.push({
        precedentId: record.id,
        reason: `Different dispute category (${record.category.replace(/_/g, ' ')}).`,
      });
      continue;
    }
    /**
     * A case whose rules come from a supplied policy is governed by a different
     * rulebook from the demo pack, even though the demo pack supplied the
     * thresholds it was evaluated with. An example decided under the demo pack's
     * determinate rules must not be offered to it — that is precisely the
     * "history fills the policy gap" failure the precedent store exists to
     * avoid.
     */
    if (caseRecord.suppliedPolicyId && caseRecord.suppliedPolicyId !== record.policyId) {
      excluded.push({
        precedentId: record.id,
        reason: `This case's rules come from the supplied policy ${caseRecord.suppliedPolicyId}, so an example decided under ${record.policyId} does not apply to it.`,
      });
      continue;
    }

    const score = tagSimilarity(record.tags, features.tags);
    if (score < RELEVANCE_FLOOR) {
      excluded.push({
        precedentId: record.id,
        reason: `Not materially similar: condition overlap ${score.toFixed(2)} is below the ${RELEVANCE_FLOOR} floor.`,
      });
      continue;
    }

    const shared = record.tags.filter((tag) => features.tags.includes(tag));
    scored.push({ record, score, shared });
  }

  scored.sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));

  const contexts: PrecedentContext[] = scored.slice(0, MAX_PRECEDENTS).map((entry) => {
    const differences = differencesFor(entry.record, features, entry.shared);
    return {
      precedentId: entry.record.id,
      caseId: entry.record.caseId,
      category: entry.record.category,
      citedPolicyIds: entry.record.citedPolicyIds,
      similarities: [
        `Same dispute category and governing pack (${entry.record.policyId}).`,
        ...(entry.shared.length > 0
          ? [`Shared conditions: ${describeTags(entry.shared).join(', ')}.`]
          : []),
        ...entry.record.materialFacts.slice(0, 2),
      ],
      differences,
      outcome: describeOutcome({
        disposition: entry.record.disposition,
        refundCents: entry.record.refundCents,
      }),
      disposition: entry.record.disposition,
      refundCents: entry.record.refundCents,
      relevanceScore: Number(entry.score.toFixed(4)),
      approvedBy: entry.record.approvedBy ?? 'unknown curator',
      approvedAt: entry.record.approvedAt ?? entry.record.createdAt,
    };
  });

  return {
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    retrievedAt,
    strategy: 'structured_lexical',
    considered: precedents.length,
    contexts,
    excluded,
    note:
      contexts.length === 0
        ? 'No relevant approved precedent was found for this case. Policy and the evidence stand on their own.'
        : `${contexts.length} approved precedent(s) were considered materially relevant. A precedent is context only: it never overrides policy, and it cannot supply a rule the governing pack does not state.`,
  };
}

/**
 * States the material differences honestly. A precedent shown without its
 * differences invites a reviewer to treat it as a rule.
 */
function differencesFor(
  record: PrecedentRecord,
  features: CaseFeatures,
  shared: string[],
): string[] {
  const differences: string[] = [];

  const onlyInRecord = record.tags.filter((tag) => !features.tags.includes(tag));
  const onlyInCase = features.tags.filter((tag) => !record.tags.includes(tag));

  if (onlyInRecord.length > 0) {
    differences.push(`Present in the precedent but not this case: ${describeTags(onlyInRecord).join(', ')}.`);
  }
  if (onlyInCase.length > 0) {
    differences.push(`Present in this case but not the precedent: ${describeTags(onlyInCase).join(', ')}.`);
  }
  if (record.chargeCents !== features.disputedCents) {
    differences.push(
      `Different disputed amount: ${(record.chargeCents / 100).toFixed(2)} versus ${(features.disputedCents / 100).toFixed(2)} SGD.`,
    );
  }
  if (shared.length === 0) {
    differences.push('No shared condition tags; relevance comes from category and policy alone.');
  }
  if (differences.length === 0) {
    // Saying nothing here would let a reader assume the example *is* the rule.
    differences.push(
      'No material difference on the recorded conditions — the example still states an outcome for one case, not a rule for this one.',
    );
  }
  return differences;
}
