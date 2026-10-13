import type { z } from 'zod';
import { z as zod } from 'zod';
import type {
  AdvocateOutput,
  Disposition,
  Finding,
  PolicyClause,
} from '../domain/contracts';
import { IntegrityAssessmentSchema } from '../domain/contracts';
import type { CatalogEntry } from '../agents/evidenceService';

/**
 * Bounded inputs handed to a runtime provider. Keeping the deterministic bundle
 * explicit means a live provider receives the allowed outcomes and the externally
 * computed amount, and never has to multiply fares or invent a percentage.
 *
 * The supplied sample's advertised expected ruling is never part of any input.
 */

export const DeterministicBundleSchema = zod.object({
  allowedActionCatalogue:zod.array(zod.object({ actionId:zod.string(),sourceOwner:zod.string() })).optional(),
  allowedRemedyOptionIds:zod.array(zod.string()).optional(),
  category: zod.enum(['no_show_charge', 'route_overcharge', 'damage']),
  allowedDispositions: zod.array(zod.string()),
  deterministicRefundCents: zod.number().nonnegative().nullable(),
  issues: zod.array(zod.string()),
  materialFindingIds: zod.array(zod.string()),
  claimFindingIds: zod.array(zod.string()),
  materialEvidenceIds: zod.array(zod.string()),
  policyIds: zod.array(zod.string()),
  qualityBand: zod.enum(['high', 'moderate', 'low']),
  narrative: zod.string(),
});
export type DeterministicBundle = z.infer<typeof DeterministicBundleSchema>;

export const SelectionInputSchema = zod.object({
  phase: zod.literal('select_evidence'),
  side: zod.enum(['rider', 'driver']),
  category: zod.enum(['no_show_charge', 'route_overcharge', 'damage']),
  catalog: zod.array(
    zod.object({ id: zod.string(), kind: zod.string(), summary: zod.string() }),
  ),
  policyIds: zod.array(zod.string()),
});
export type SelectionInput = z.infer<typeof SelectionInputSchema>;

export const AdvocateInputSchema = zod.object({
  phase: zod.literal('build_case'),
  side: zod.enum(['rider', 'driver']),
  statement: zod.string().nullable(),
  findings: zod.array(zod.object({ id: zod.string(), kind: zod.string(), text: zod.string(), material: zod.boolean() })),
  evidence: zod.array(
    zod.object({ id: zod.string(), kind: zod.string(), summary: zod.string() }),
  ),
  policyClauses: zod.array(
    zod.object({ id: zod.string(), title: zod.string(), text: zod.string() }),
  ),
  deterministic: DeterministicBundleSchema,
});
export type AdvocateInput = z.infer<typeof AdvocateInputSchema>;

/**
 * Approved precedent context. Supplied to the Judge only, never to an advocate,
 * and never to any deterministic tool. Each entry states its differences as well
 * as its similarities, so an example cannot be read as a rule.
 */
export const PrecedentContextInputSchema = zod.object({
  precedentId: zod.string(),
  caseId: zod.string(),
  category: zod.string(),
  citedPolicyIds: zod.array(zod.string()),
  similarities: zod.array(zod.string()),
  differences: zod.array(zod.string()),
  outcome: zod.string(),
  disposition: zod.string(),
  refundCents: zod.number(),
  relevanceScore: zod.number(),
  approvedBy: zod.string(),
  approvedAt: zod.string(),
});

export const PrecedentBundleSchema = zod.object({
  strategy: zod.string(),
  note: zod.string(),
  contexts: zod.array(PrecedentContextInputSchema),
});

export const JudgeInputSchema = zod.object({
  phase: zod.literal('judge'),
  integrity: IntegrityAssessmentSchema.nullable().default(null),
  rider: zod.unknown().nullable(),
  driver: zod.unknown().nullable(),
  findings: zod.array(zod.object({ id: zod.string(), kind: zod.string(), text: zod.string(), material: zod.boolean() })),
  evidence: zod.array(
    zod.object({ id: zod.string(), kind: zod.string(), summary: zod.string() }),
  ),
  policyClauses: zod.array(
    zod.object({ id: zod.string(), title: zod.string(), text: zod.string() }),
  ),
  deterministic: DeterministicBundleSchema,
  /**
   * Null means retrieval was not consulted, which is different from "consulted
   * and found nothing" (an empty `contexts` array).
   */
  precedents: PrecedentBundleSchema.nullable().default(null),
});
export type JudgeInput = z.infer<typeof JudgeInputSchema>;

export type RuntimeInput = SelectionInput | AdvocateInput | JudgeInput;

export function toCatalogEntries(entries: CatalogEntry[]): {
  id: string;
  kind: string;
  summary: string;
}[] {
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    summary: entry.summary,
  }));
}

export function toFindingRefs(findings: Finding[]): {
  id: string;
  kind: string;
  text: string;
  material: boolean;
}[] {
  return findings.map((finding) => ({
    id: finding.id,
    kind: finding.kind,
    text: finding.text,
    material: finding.material,
  }));
}

export function toClauseRefs(clauses: PolicyClause[]): {
  id: string;
  title: string;
  text: string;
}[] {
  return clauses.map((clause) => ({
    id: clause.id,
    title: clause.title,
    text: `${clause.text}${clause.authority ? ` [Basis: ${clause.authority === 'official_ryde' ? 'Published Ryde policy, paraphrased' : 'Rydr evidence safeguard, not official Ryde policy'}. ${clause.sourceUrl ? `Source: ${clause.sourceUrl}. Retrieved: ${clause.retrievedAt}.` : ''}]` : ''}`,
  }));
}

export function advocateOutputsForJudge(
  rider: AdvocateOutput | null,
  driver: AdvocateOutput | null,
): { rider: AdvocateOutput | null; driver: AdvocateOutput | null } {
  return { rider, driver };
}

export function dispositionLabel(disposition: Disposition): string {
  switch (disposition) {
    case 'refund':
      return 'Fee refunded';
    case 'uphold':
      return 'Fee upheld';
    case 'partial_refund':
      return 'Partial refund recommended';
    case 'human_review':
      return 'Human review needed';
  }
}
