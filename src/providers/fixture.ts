import type {
  AdvocateOutput,
  Disposition,
  JudgeOutput,
} from '../domain/contracts';
import { judgeReasoningSummary } from '../agents/explanation';
import type { DeterministicEvaluation } from '../domain/policy';
import {
  AdvocateInputSchema,
  JudgeInputSchema,
  SelectionInputSchema,
  type DeterministicBundle,
} from './runtimeInput';
import type { AgentInvocation, AgentProvider, AgentResult } from './types';

/**
 * Fixture provider: deterministic, model-free development output.
 *
 * It exists so the pipeline, validation and UI can be built and tested without
 * spending runtime credits. Every run produced by this provider is permanently
 * labeled "Fixture simulation" and is never presented as live AI output.
 */

const NO_SHOW_KINDS = new Set(['gps', 'trip_event', 'call', 'chat', 'payment']);
const ROUTE_KINDS = new Set(['route', 'payment', 'trip_event', 'chat', 'gps']);

function eligibilityOf(bundle: DeterministicBundle): Disposition {
  return (bundle.allowedDispositions.find((d) => d !== 'human_review') ??
    'human_review') as Disposition;
}

function confidenceFor(bundle: DeterministicBundle, decisive: number): number {
  if (eligibilityOf(bundle) === 'human_review') return 0.55;
  if (bundle.qualityBand === 'high') return decisive;
  if (bundle.qualityBand === 'moderate') return 0.78;
  return 0.66;
}

function selectEvidence(
  input: { catalog: { id: string; kind: string }[]; policyIds: string[] },
  category: 'no_show_charge' | 'route_overcharge' | string,
): { evidenceIds: string[]; reasonSummary: string } {
  const wanted = category === 'route_overcharge' ? ROUTE_KINDS : NO_SHOW_KINDS;
  const evidenceIds = input.catalog
    .filter((entry) => wanted.has(entry.kind))
    .map((entry) => entry.id);
  return {
    evidenceIds,
    reasonSummary:
      'Requesting the case-relevant evidence for this category, including records that could contradict my position.',
  };
}

function buildAdvocate(
  input: {
    side: 'rider' | 'driver';
    statement: string | null;
    findings: { id: string; kind: string; text: string; material: boolean }[];
    deterministic: DeterministicBundle;
  },
  _evaluation: DeterministicEvaluation | null,
): AdvocateOutput {
  const { deterministic } = input;
  const eligibility = eligibilityOf(deterministic);
  const computedIds = input.findings
    .filter((f) => f.material && f.kind !== 'claim')
    .map((f) => f.id);
  const claimIds = input.findings.filter((f) => f.kind === 'claim').map((f) => f.id);
  const ownClaimId =
    input.side === 'rider'
      ? claimIds.find((id) => id.includes('RIDER'))
      : claimIds.find((id) => id.includes('DRIVER'));

  const isDecisive = eligibility !== 'human_review';
  const sideWins =
    (input.side === 'rider' && eligibility === 'refund') ||
    (input.side === 'driver' && eligibility === 'uphold');

  const position: AdvocateOutput['position'] = !isDecisive
    ? 'review'
    : input.side === 'rider'
      ? 'refund'
      : 'uphold';

  const supporting = [
    ...(ownClaimId ? [ownClaimId] : []),
    ...(isDecisive && sideWins ? computedIds : []),
  ];
  const contradictory = [...(isDecisive && !sideWins ? computedIds : []), ...(isDecisive ? [] : computedIds)];

  const summary = isDecisive
    ? sideWins
      ? `${input.side === 'rider' ? 'Rider' : 'Driver'} position: the recorded evidence and the applied policy clauses support ${eligibility === 'refund' ? 'refunding the disputed charge' : 'retaining the disputed charge'}. Contrary evidence is acknowledged below.`
      : `${input.side === 'rider' ? 'Rider' : 'Driver'} position: I argue my side's case, while acknowledging the deterministic findings that weigh against it.`
    : `${input.side === 'rider' ? 'Rider' : 'Driver'} position: material facts remain unresolved, so I ask for human review rather than a contested outcome.`;

  return {
    side: input.side,
    position,
    summary,
    supportingFindingIds: supporting,
    contradictoryFindingIds: Array.from(new Set(contradictory)),
    evidenceIds: deterministic.materialEvidenceIds,
    policyIds: deterministic.policyIds,
    uncertainties: deterministic.issues,
    requestedEvidenceIds: deterministic.materialEvidenceIds,
    modelConfidence: confidenceFor(deterministic, sideWins ? 0.84 : 0.62),
  };
}

function buildJudge(
  input: {
    findings: { id: string; kind: string; text: string; material: boolean }[];
    deterministic: DeterministicBundle;
  },
  evaluation: DeterministicEvaluation | null,
): JudgeOutput {
  const { deterministic } = input;
  const eligibility = eligibilityOf(deterministic);
  const isReview = eligibility === 'human_review';

  return {
    disposition: eligibility,
    recommendedRefundCents: isReview ? null : deterministic.deterministicRefundCents,
    establishedFindingIds: isReview ? [] : deterministic.materialFindingIds,
    disputedFindingIds: deterministic.claimFindingIds,
    materialEvidenceIds: deterministic.materialEvidenceIds,
    policyIds: deterministic.policyIds,
    reasoningSummary:
      deterministic.narrative ||
      (evaluation ? judgeReasoningSummary(evaluation) : 'No deterministic narrative available.'),
    missingEvidence: deterministic.issues,
    modelConfidence: confidenceFor(deterministic, 0.88),
  };
}

export interface FixtureProviderContext {
  evaluation?: DeterministicEvaluation | null;
  category?: 'no_show_charge' | 'route_overcharge' | 'damage';
}

export function createFixtureProvider(
  context: FixtureProviderContext = {},
): AgentProvider {
  return {
    id: 'fixture',
    capabilities: { nativeTools: false, strictJson: true, parallelCalls: true },
    external: false,
    async invoke(request: AgentInvocation): Promise<AgentResult> {
      const raw = request.input as Record<string, unknown>;

      if (request.stage === 'select_evidence') {
        const parsed = SelectionInputSchema.parse(raw);
        return { output: selectEvidence(parsed, parsed.category) };
      }

      if (request.stage === 'build_case') {
        const parsed = AdvocateInputSchema.parse(raw);
        return { output: buildAdvocate(parsed, context.evaluation ?? null) };
      }

      const parsed = JudgeInputSchema.parse(raw);
      return { output: buildJudge(parsed, context.evaluation ?? null) };
    },
  };
}
