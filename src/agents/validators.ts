import {
  AdvocateOutputSchema,
  JudgeOutputSchema,
  type AdvocateOutput,
  type CaseRecord,
  type Disposition,
  type JudgeOutput,
} from '../domain/contracts';
import type { DeterministicEvaluation } from '../domain/policy';

/**
 * Provider output validation.
 *
 * Referential validation proves that every cited ID exists and that money and
 * outcome constraints hold. It does not prove every semantic claim; judged test
 * suites and manual inspection are also required.
 */

export interface ValidationContext {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  policyIds: Set<string>;
  findingIds: Set<string>;
  evidenceIds: Set<string>;
  allowedDispositions: Disposition[];
}

const HISTORY_LIABILITY_GROUNDS = [
  'low rating',
  'high rating',
  'average rating',
  'dispute history',
  'prior disputes',
  'fraud flag',
  'account history',
  'rating history',
];

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[]; unresolvedCitations: string[] };

function missingIds(ids: string[], known: Set<string>): string[] {
  return ids.filter((id) => !known.has(id));
}

function hasHistoryLiabilityGround(text: string): boolean {
  const lower = text.toLowerCase();
  return HISTORY_LIABILITY_GROUNDS.some((phrase) => lower.includes(phrase));
}

export function buildValidationContext(
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
  policyClauseIds: string[],
  catalogIds: string[],
): ValidationContext {
  return {
    caseRecord,
    evaluation,
    policyIds: new Set(policyClauseIds),
    findingIds: new Set(evaluation.findings.map((f) => f.id)),
    evidenceIds: new Set(catalogIds),
    allowedDispositions: [evaluation.disposition, 'human_review'],
  };
}

export function validateAdvocateOutput(
  raw: unknown,
  context: ValidationContext,
  side: 'rider' | 'driver',
): ValidationResult<AdvocateOutput> {
  const errors: string[] = [];
  const unresolvedCitations: string[] = [];

  const parsed = AdvocateOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [`Advocate output failed schema validation: ${parsed.error.message}`],
      unresolvedCitations: [],
    };
  }
  const output = parsed.data;

  if (output.side !== side) {
    errors.push(`Advocate side is "${output.side}", expected "${side}".`);
  }
  if (output.nextAction) {
    const owners = { 'request-source-record':'platform','clarify-policy':'policy_owner','review-remedy':'reviewer' };
    if (owners[output.nextAction.actionId] !== output.nextAction.sourceOwner || output.nextAction.findingId && !context.findingIds.has(output.nextAction.findingId)) errors.push('Next action has an invalid source owner or finding reference.');
  }

  const missingEvidence = missingIds(output.evidenceIds, context.evidenceIds);
  const missingRequested = missingIds(output.requestedEvidenceIds, context.evidenceIds);
  const missingFindings = missingIds(
    [...output.supportingFindingIds, ...output.contradictoryFindingIds],
    context.findingIds,
  );
  const missingPolicy = missingIds(output.policyIds, context.policyIds);

  if (missingEvidence.length) {
    errors.push(`Unknown evidence IDs: ${missingEvidence.join(', ')}.`);
    unresolvedCitations.push(...missingEvidence);
  }
  if (missingRequested.length) {
    errors.push(`Unknown requested evidence IDs: ${missingRequested.join(', ')}.`);
    unresolvedCitations.push(...missingRequested);
  }
  if (missingFindings.length) {
    errors.push(`Unknown finding IDs: ${missingFindings.join(', ')}.`);
    unresolvedCitations.push(...missingFindings);
  }
  if (missingPolicy.length) {
    errors.push(`Unknown policy clause IDs: ${missingPolicy.join(', ')}.`);
    unresolvedCitations.push(...missingPolicy);
  }

  if (hasHistoryLiabilityGround(output.summary)) {
    errors.push('Advocate relied on account history or ratings as a liability ground.');
  }

  if (errors.length > 0) {
    return { ok: false, errors, unresolvedCitations: Array.from(new Set(unresolvedCitations)) };
  }
  return { ok: true, value: output };
}

export function validateJudgeOutput(
  raw: unknown,
  context: ValidationContext,
): ValidationResult<JudgeOutput> {
  const errors: string[] = [];
  const unresolvedCitations: string[] = [];

  const parsed = JudgeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [`Judge output failed schema validation: ${parsed.error.message}`],
      unresolvedCitations: [],
    };
  }
  const output = parsed.data;
  const { evaluation, caseRecord } = context;
  if (output.selectedRemedyOptionIds?.includes('review-cleaning-eligibility') && caseRecord.policyVersion !== 'ryde-cleaning-20261002') errors.push('Cleaning remedy option is outside the supplied policy scope.');

  if (!context.allowedDispositions.includes(output.disposition)) {
    errors.push(
      `Disposition "${output.disposition}" is outside deterministic eligibility (${context.allowedDispositions.join(', ')}).`,
    );
  }

  if (output.disposition === 'human_review') {
    if (output.recommendedRefundCents !== null) {
      errors.push('A human_review disposition must carry a null recommended amount.');
    }
  } else {
    if (output.recommendedRefundCents === null) {
      errors.push(
        `Disposition "${output.disposition}" requires the externally calculated refund amount.`,
      );
    } else if (output.recommendedRefundCents !== evaluation.recommendedRefundCents) {
      errors.push(
        `Refund amount ${output.recommendedRefundCents} does not equal the deterministic amount ${evaluation.recommendedRefundCents}.`,
      );
    }
    if (output.recommendedRefundCents !== null && output.recommendedRefundCents > caseRecord.disputedCents) {
      errors.push(
        `Refund amount ${output.recommendedRefundCents} exceeds the disputed amount ${caseRecord.disputedCents}.`,
      );
    }
  }

  const missingEvidence = missingIds(output.materialEvidenceIds, context.evidenceIds);
  const missingFindings = missingIds(
    [...output.establishedFindingIds, ...output.disputedFindingIds],
    context.findingIds,
  );
  const missingPolicy = missingIds(output.policyIds, context.policyIds);

  if (missingEvidence.length) {
    errors.push(`Unknown material evidence IDs: ${missingEvidence.join(', ')}.`);
    unresolvedCitations.push(...missingEvidence);
  }
  if (missingFindings.length) {
    errors.push(`Unknown finding IDs: ${missingFindings.join(', ')}.`);
    unresolvedCitations.push(...missingFindings);
  }
  if (missingPolicy.length) {
    errors.push(`Unknown policy clause IDs: ${missingPolicy.join(', ')}.`);
    unresolvedCitations.push(...missingPolicy);
  }
  if (output.policyIds.length === 0) {
    errors.push('Judge cited no policy clauses.');
  }
  if (hasHistoryLiabilityGround(output.reasoningSummary)) {
    errors.push('Judge relied on account history or ratings as a liability ground.');
  }
  if (evaluation.issues.length > 0 && output.missingEvidence.length === 0) {
    errors.push(
      'Material unknowns were dropped: the deterministic evaluation recorded unresolved issues but the judge listed none.',
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors, unresolvedCitations: Array.from(new Set(unresolvedCitations)) };
  }
  return { ok: true, value: output };
}
