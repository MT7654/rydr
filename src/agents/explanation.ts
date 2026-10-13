import type { AdvocateOutput, JudgeOutput, Resolution } from '../domain/contracts';
import type { DeterministicEvaluation } from '../domain/policy';
import { formatSgd } from '../domain/money';

/**
 * Explanations are assembled from deterministic findings and citations. The
 * wording never claims a refund was sent, and never presents the heuristic
 * quality score as a calibrated probability.
 */

/**
 * The judge's narrative, split into its logical parts so the UI can render a
 * scannable explanation rather than one run-on block of prose.
 *
 * `lead` states the outcome, `findings` are the evidence-backed reasons, and
 * `unresolved` lists the questions the evidence could not settle.
 */
export interface ReasoningNarrative {
  lead: string;
  findings: string[];
  unresolved: string[];
}

export function buildReasoningNarrative(evaluation: DeterministicEvaluation): ReasoningNarrative {
  const findings = evaluation.findings
    .filter((finding) => finding.material && finding.kind !== 'claim')
    .map((finding) => finding.text);

  const lead =
    evaluation.disposition === 'human_review'
      ? 'The evidence does not support a deterministic outcome, so this case is routed to a human reviewer.'
      : evaluation.recommendedRefundCents === null
        ? 'No monetary change is recommended.'
        : `Deterministic refund amount: ${formatSgd(evaluation.recommendedRefundCents)}.`;

  return { lead, findings, unresolved: evaluation.issues };
}

/**
 * Flat-string form of the narrative, kept for stored run records and JSON
 * exports. Blocks are separated by a blank line so the structure survives a
 * round-trip through the run store.
 */
export function judgeReasoningSummary(evaluation: DeterministicEvaluation): string {
  const { lead, findings, unresolved } = buildReasoningNarrative(evaluation);
  const blocks = [lead, ...findings];
  if (unresolved.length) {
    blocks.push(`Unresolved:\n${unresolved.join('\n')}`);
  }
  return blocks.join('\n\n');
}

export function whatWouldChangeIt(evaluation: DeterministicEvaluation): string[] {
  const suggestions: string[] = [];
  if (evaluation.route?.eligibleRefundCents != null && evaluation.disposition === 'human_review') suggestions.push('A reviewer must decide the route refund because the deviation exceeds the automatic-ruling limit; more model confidence cannot waive that policy limit.');
  if (evaluation.fare && !evaluation.fare.reconciled) suggestions.push('A source fare comparison with unchanged non-surge components and reconciled quote/charge totals would establish the refundable surge differential.');
  if (evaluation.noShow && !evaluation.noShow.accuracyPresent) {
    suggestions.push(
      'GPS samples that include a reported accuracy radius would allow a pickup-zone determination.',
    );
  }
  if (evaluation.noShow?.materialStartConflict) {
    suggestions.push(
      'A platform statement of which clock governs the waiting period would resolve the timestamp conflict.',
    );
  }
  if (evaluation.noShow?.maxGapSeconds !== null && evaluation.noShow?.maxGapSeconds !== undefined) {
    if (evaluation.noShow.maxGapSeconds > 180) {
      suggestions.push(
        'Denser GPS sampling would remove the gap that prevents asserting continuous presence.',
      );
    }
  }
  if (evaluation.route?.justification === 'unknown') {
    suggestions.push(
      'A verified road-closure record or a rider-approved detour note would settle the justification status.',
    );
  }
  if (evaluation.route?.ledgerReconciled === false) {
    suggestions.push(
      'A reconciled fare ledger would allow the eligible surcharge to be computed.',
    );
  }
  if (suggestions.length === 0) {
    suggestions.push(
      'No single item would change this outcome; the recorded evidence is sufficient for the applied policy.',
    );
  }
  return suggestions;
}

export interface PartyExplanation {
  side: 'rider' | 'driver';
  headline: string;
  body: string[];
  unknowns: string[];
}

/**
 * Both parties get the same disposition in respectful language. History flags and
 * the other party's irrelevant personal data are never disclosed.
 */
export function buildPartyExplanations(
  resolution: Resolution,
  judge: JudgeOutput,
  evaluation: DeterministicEvaluation,
): PartyExplanation[] {
  const refundText =
    resolution.recommendedRefundCents === null
      ? 'No refund amount is recommended while the case is with a human reviewer.'
      : `Recommended refund: ${formatSgd(resolution.recommendedRefundCents)}.`;

  const headline =
    resolution.disposition === 'human_review'
      ? 'This case has been sent for human review'
      : resolution.disposition === 'refund'
        ? 'A refund is recommended on your dispute'
        : resolution.disposition === 'partial_refund'
          ? 'A partial refund is recommended on your dispute'
          : 'The disputed charge is recommended to stand';

  const shared = [
    ...judge.reasoningSummary
      .split('\n\n')
      .map((block) => block.trim())
      .filter(Boolean),
    refundText,
    `This recommendation is based on ${evaluation.findings.filter((f) => f.kind !== 'claim').length} evidence-backed findings and ${judge.policyIds.length} cited policy clauses.`,
    'This is a prototype recommendation. No payment has been made and no account has been penalised.',
  ];

  return [
    { side: 'rider', headline, body: shared, unknowns: judge.missingEvidence },
    { side: 'driver', headline, body: shared, unknowns: judge.missingEvidence },
  ];
}

export function advocateHeadline(advocate: AdvocateOutput | null): string {
  if (!advocate) return 'No case submitted';
  switch (advocate.position) {
    case 'refund':
      return 'Argues the charge should be refunded';
    case 'uphold':
      return 'Argues the charge should stand';
    case 'partial_refund':
      return 'Argues for a partial refund';
    case 'review':
      return 'Asks for human review';
  }
}
