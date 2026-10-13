import { z } from 'zod';
import type { CaseRecord, Disposition, PolicyPack } from './contracts';
import { IsoTimestampSchema } from './contracts';
import type { DeterministicEvaluation } from './policy';

/**
 * Policy, precedent and governed learning.
 *
 * Company policy stays authoritative. A precedent is a *resolved example* that
 * may be shown to the Judge as context — it never overrides policy, never
 * backdates a clarification, and never enters a liability calculation on its
 * own. Everything here is deliberately structured and lexical; no embeddings
 * service is required.
 */

/* ------------------------------------------------------------------ */
/*  Case features (the retrieval vocabulary)                           */
/* ------------------------------------------------------------------ */

export const CONDITION_TAGS = [
  'zone_inside',
  'zone_outside',
  'zone_indeterminate',
  'accuracy_missing',
  'continuity_gap',
  'clock_ambiguous',
  'contact_none',
  'threshold_met',
  'threshold_not_met',
  'route_measurable',
  'route_not_measurable',
  'deviation_flagged',
  'deviation_not_flagged',
  'justification_unknown',
  /**
   * Justification is split by *what was verified*, not merely that something
   * was. A verified rider-approved detour and a verified absence of any
   * justification are opposite facts that decide a route dispute in opposite
   * directions; collapsing them into one tag would make the two cases
   * indistinguishable to retrieval, and an example from one would look like it
   * applied to the other.
   */
  'justification_approved',
  'justification_absent',
  'ledger_mismatch',
  'ledger_reconciled',
  'surcharge_identified',
] as const;
export type ConditionTag = (typeof CONDITION_TAGS)[number];

/**
 * The structured description of a case that retrieval matches on.
 *
 * Deterministic evaluation produces these tags, so the same case always yields
 * the same vocabulary and a reviewer can read exactly why two cases were judged
 * similar.
 */
export interface CaseFeatures {
  category: CaseRecord['category'];
  /** Governing pack id, not the display version. */
  policyId: string;
  tags: ConditionTag[];
  disputedCents: number;
}

export function extractCaseFeatures(
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
  pack: PolicyPack,
): CaseFeatures {
  const tags: ConditionTag[] = [];

  const noShow = evaluation.noShow;
  if (noShow) {
    tags.push(`zone_${noShow.arrivalZone}` as ConditionTag);
    if (!noShow.accuracyPresent) tags.push('accuracy_missing');
    if (!noShow.continuityOk) tags.push('continuity_gap');
    if (noShow.materialStartConflict || noShow.policyAmbiguity) tags.push('clock_ambiguous');
    if (noShow.contactAttempts === 0) tags.push('contact_none');
    if (noShow.elapsedSeconds !== null && pack.source !== 'supplied_sample') {
      tags.push(
        (pack.source === 'ryde_official' ? noShow.elapsedSeconds > pack.thresholds.noShowThresholdSeconds : noShow.elapsedSeconds >= pack.thresholds.noShowThresholdSeconds)
          ? 'threshold_met'
          : 'threshold_not_met',
      );
    }
  }

  const route = evaluation.route;
  if (route) {
    tags.push(route.comparison.measurable ? 'route_measurable' : 'route_not_measurable');
    if (route.comparison.measurable) {
      tags.push(route.comparison.deviationFlagged ? 'deviation_flagged' : 'deviation_not_flagged');
    }
    tags.push(
      route.justification === 'unknown'
        ? 'justification_unknown'
        : route.justification === 'verified_justification'
          ? 'justification_approved'
          : 'justification_absent',
    );
    tags.push(route.ledgerReconciled ? 'ledger_reconciled' : 'ledger_mismatch');
    if (route.surchargeCents !== null) tags.push('surcharge_identified');
  }

  return {
    category: caseRecord.category,
    policyId: pack.id,
    tags: Array.from(new Set(tags)).sort(),
    disputedCents: caseRecord.disputedCents,
  };
}

/* ------------------------------------------------------------------ */
/*  Precedent record                                                   */
/* ------------------------------------------------------------------ */

export const PRECEDENT_STATUSES = ['candidate', 'approved', 'rejected', 'retired'] as const;
export type PrecedentStatus = (typeof PRECEDENT_STATUSES)[number];

/**
 * A candidate or approved precedent.
 *
 * A reviewer override produces a **candidate**, which is inert: retrieval never
 * returns it, and nothing downstream may read it as guidance. It becomes
 * `approved` only after a curator passes it through the shadow-replay gate.
 * `retired` preserves the record for history after a rollback.
 */
export const PrecedentRecordSchema = z.object({
  id: z.string().min(1),
  /** The case this example came from. Never retrieved for that case itself. */
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  category: z.enum(['no_show_charge', 'route_overcharge', 'damage']),
  /** Governing pack id this example was decided under. */
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  /** Policy clauses the example actually turned on. */
  citedPolicyIds: z.array(z.string()),
  tags: z.array(z.enum(CONDITION_TAGS)),
  /** Reviewer-readable material facts, in one line each. */
  materialFacts: z.array(z.string()),
  disposition: z.enum(['refund', 'uphold', 'partial_refund']),
  refundCents: z.number().int().nonnegative(),
  chargeCents: z.number().int().positive(),
  status: z.enum(PRECEDENT_STATUSES),
  /** Where the example came from. A human correction is never auto-published. */
  source: z.enum(['reviewer_override', 'curator_authored']),
  /** The automated recommendation the reviewer departed from, for a candidate. */
  priorRecommendation: z.string().nullable(),
  correctionReason: z.string().nullable(),
  /** Set once a curator approves. */
  approvedBy: z.string().nullable(),
  approvedAt: IsoTimestampSchema.nullable(),
  approvalNote: z.string().nullable(),
  /** Set when the shadow-replay gate refused activation. */
  activationFailure: z.string().nullable(),
  /** Set when the precedent is retired by a rollback. */
  retiredAt: IsoTimestampSchema.nullable(),
  retiredReason: z.string().nullable(),
  supersedesPrecedentId: z.string().nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type PrecedentRecord = z.infer<typeof PrecedentRecordSchema>;

/* ------------------------------------------------------------------ */
/*  Retrieval manifest                                                 */
/*                                                                     */
/* The manifest and context schemas live in `contracts.ts` because they */
/* are part of the frozen run snapshot. They are re-exported here so    */
/* retrieval code has one import.                                       */
/* ------------------------------------------------------------------ */

export {
  PrecedentContextSchema,
  PrecedentExclusionSchema,
  PrecedentManifestSchema,
} from './contracts';
export type {
  PrecedentContext,
  PrecedentExclusion,
  PrecedentManifest,
} from './contracts';

export const MAX_PRECEDENTS = 3;
/** Below this overlap the example is not relevant enough to show. */
export const RELEVANCE_FLOOR = 0.34;

export function describeOutcome(record: {
  disposition: Disposition | 'insufficient_evidence';
  refundCents: number;
}): string {
  switch (record.disposition) {
    case 'refund':
      return `Refund of ${(record.refundCents / 100).toFixed(2)} SGD`;
    case 'uphold':
      return 'Charge upheld with no refund';
    case 'partial_refund':
      return `Partial refund of ${(record.refundCents / 100).toFixed(2)} SGD`;
    default:
      return 'Closed without a ruling';
  }
}
