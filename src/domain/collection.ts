import { z } from 'zod';

/**
 * Evidence collection contracts.
 *
 * A collection job is an auditable, bounded record of "Rydr went and looked".
 * It runs **before** the adjudication run is created, so the three core agents
 * always judge one frozen case version — collection never mutates a case
 * underneath a run that has already started.
 *
 * Every source here is a *simulated* adapter reading labelled demo fixtures.
 * Nothing in this module contacts a real provider, and a successful simulated
 * read is authoritative only inside the demo dataset.
 */

/* ------------------------------------------------------------------ */
/*  Allowlisted tools                                                  */
/* ------------------------------------------------------------------ */

/**
 * The complete set of sources a collection job may consult. There is no
 * arbitrary URL, SQL or filesystem tool: a plan can only name one of these, and
 * each takes a validated case/trip id plus a bounded window.
 */
export const SOURCE_TOOL_IDS = [
  'trip_telemetry',
  'communications',
  'fare_ledger',
  'effective_policy',
] as const;
export type SourceToolId = (typeof SOURCE_TOOL_IDS)[number];

export const SOURCE_STATUSES = ['found', 'unavailable', 'conflict', 'not_applicable'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Why a source could not settle the question. Drives the reviewer's next action. */
export const COLLECTION_STOP_REASONS = [
  'resolved',
  'no_conditions',
  'unavailable',
  'conflict',
  'policy_ambiguity',
  'budget_exhausted',
  'safety_routing',
] as const;
export type CollectionStopReason = (typeof COLLECTION_STOP_REASONS)[number];

/** How a condition should be read by a reviewer. */
export const CONDITION_KINDS = [
  'evidence_gap',
  'policy_ambiguity',
  'integrity',
  'runtime_failure',
  'safety',
] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

/* ------------------------------------------------------------------ */
/*  Plan                                                               */
/* ------------------------------------------------------------------ */

export const DisputedConditionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(CONDITION_KINDS),
  /** What is unresolved, in the reviewer's words. */
  summary: z.string().min(1),
  /** The policy condition that makes it material. */
  policyIds: z.array(z.string()),
  /** True when the outcome genuinely depends on it. */
  material: z.boolean(),
  /** The one tool that could settle it, or null when no tool can. */
  tool: z.enum(SOURCE_TOOL_IDS).nullable(),
  /** Why that tool could change the result. */
  whyItMatters: z.string().min(1),
});
export type DisputedCondition = z.infer<typeof DisputedConditionSchema>;

export const SourceRequestSchema = z.object({
  id: z.string().min(1),
  conditionId: z.string().min(1),
  tool: z.enum(SOURCE_TOOL_IDS),
  caseId: z.string().min(1),
  tripId: z.string().min(1),
  /** Bounded window, or null for a whole-trip read. */
  windowFrom: z.string().nullable(),
  windowTo: z.string().nullable(),
  /** The specific fields wanted, so the read stays narrow. */
  fields: z.array(z.string()),
  reason: z.string().min(1),
});
export type SourceRequest = z.infer<typeof SourceRequestSchema>;

export const EvidencePlanSchema = z.object({
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  conditions: z.array(DisputedConditionSchema),
  requests: z.array(SourceRequestSchema),
  /** Conditions no allowlisted tool can settle — a person must resolve them. */
  needsHumanInput: z.array(z.string()),
  /** True when collection would spend a source call. */
  hasWork: z.boolean(),
});
export type EvidencePlan = z.infer<typeof EvidencePlanSchema>;

/* ------------------------------------------------------------------ */
/*  Results                                                            */
/* ------------------------------------------------------------------ */

export const SourceResultSchema = z.object({
  requestId: z.string().min(1),
  tool: z.enum(SOURCE_TOOL_IDS),
  toolVersion: z.string().min(1),
  /** Always `simulated`: this prototype never calls a real Ryde API. */
  sourceType: z.literal('simulated'),
  status: z.enum(SOURCE_STATUSES),
  sourceRecordIds: z.array(z.string()),
  retrievedAt: z.string().min(1),
  tripId: z.string().min(1),
  /** Stable hash of the payload, so a reviewer can tell two reads apart. */
  payloadHash: z.string().min(1),
  /** Evidence ids this result created or corrected, if any. */
  evidenceIds: z.array(z.string()),
  note: z.string().min(1),
  /** The retrieved values. Shape depends on the tool. */
  payload: z.unknown(),
});
export type SourceResult = z.infer<typeof SourceResultSchema>;

export const CollectionJobSchema = z.object({
  planner: z.object({mode:z.literal('live'),reason:z.string(),requestIds:z.array(z.string()),runId:z.string()}).optional(),
  id: z.string().min(1),
  caseId: z.string().min(1),
  startingVersion: z.number().int().positive(),
  status: z.enum(['completed', 'blocked', 'failed']),
  stopReason: z.enum(COLLECTION_STOP_REASONS),
  conditions: z.array(DisputedConditionSchema),
  results: z.array(SourceResultSchema),
  /** Version created by applying accepted records, or null when nothing changed. */
  resultingVersion: z.number().int().positive().nullable(),
  toolCallCount: z.number().int().nonnegative(),
  /** Idempotency key, so a duplicate click reuses this job. */
  idempotencyKey: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  note: z.string().min(1),
});
export type CollectionJob = z.infer<typeof CollectionJobSchema>;

/* ------------------------------------------------------------------ */
/*  Sensitivity (read-only)                                            */
/* ------------------------------------------------------------------ */

export const SensitivityScenarioSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** The hypothetical, stated as a hypothetical. */
  hypothetical: z.string().min(1),
  /** What the deterministic engine returns under that hypothetical. */
  outcome: z.string().min(1),
  /** The condition that controls the result. */
  controllingCondition: z.string().min(1),
  /** What source would settle it, or null. */
  missingSource: z.string().nullable(),
  /** True only when deterministic evaluation shows the outcome actually moves. */
  changesDecision: z.boolean(),
  /** Baseline disposition, so the reader can see the comparison. */
  baselineOutcome: z.string().min(1),
});
export type SensitivityScenario = z.infer<typeof SensitivityScenarioSchema>;

/** Hard bound on a single collection cycle, matching the spec's budget. */
export const MAX_SOURCE_CALLS_PER_CYCLE = 4;
export const SOURCE_TOOL_VERSION = 'rydr-source-tools-v1';
