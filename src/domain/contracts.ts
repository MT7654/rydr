import { z } from 'zod';

/**
 * Rydr domain contracts.
 *
 * Rules encoded here (product spec section 6):
 *  - money is integer cents, never negative
 *  - timestamps are offset-aware ISO strings; all arithmetic happens in UTC
 *  - duplicate IDs, malformed timestamps and out-of-range coordinates are rejected
 */

const OFFSET_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const IsoTimestampSchema = z
  .string()
  .regex(OFFSET_ISO, 'timestamp must be ISO 8601 with an explicit offset')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'timestamp is not parseable');

export const NullableTimestampSchema = IsoTimestampSchema.nullable();

export const CentsSchema = z
  .number()
  .int('money must be an integer number of cents')
  .nonnegative('money cannot be negative');

export const LatitudeSchema = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);

export const CategorySchema = z.enum(['no_show_charge', 'route_overcharge', 'damage']);
export type Category = z.infer<typeof CategorySchema>;

export const ExecutionModeSchema = z.enum(['fixture', 'live', 'replay']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const VisionModeSchema = z.enum(['fixture', 'live', 'blocked']);
export type VisionMode = z.infer<typeof VisionModeSchema>;

export const EvidenceKindSchema = z.enum([
  'gps',
  'chat',
  'call',
  'trip_event',
  'payment',
  'route',
  'history',
  'image',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const FindingKindSchema = z.enum([
  'observation',
  'computed',
  'claim',
  'inference',
  'unknown',
]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const ProvenanceSchema = z.enum(['supplied_sample', 'synthetic']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const DispositionSchema = z.enum([
  'refund',
  'uphold',
  'partial_refund',
  'human_review',
]);
export type Disposition = z.infer<typeof DispositionSchema>;

export const AdvocatePositionSchema = z.enum([
  'refund',
  'uphold',
  'partial_refund',
  'review',
]);
export type AdvocatePosition = z.infer<typeof AdvocatePositionSchema>;

export const SourceRefSchema = z.object({
  dataset: z.string().min(1),
  jsonPointer: z.string().min(1),
  provenance: ProvenanceSchema,
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/* ------------------------------------------------------------------ */
/* Evidence payloads, discriminated by kind                            */
/* ------------------------------------------------------------------ */

export const GpsPayloadSchema = z.object({
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  accuracyMeters: z.number().nonnegative().nullable(),
  speedKmh: z.number().nonnegative().nullable(),
  status: z.enum(['en_route', 'arrived', 'waiting', 'cancelled', 'unknown']),
});

export const ChatPayloadSchema = z.object({
  sender: z.enum(['rider', 'driver', 'system']),
  type: z.enum(['message', 'call', 'system']),
  content: z.string(),
});

export const CallPayloadSchema = z.object({
  sender: z.enum(['rider', 'driver', 'system']),
  direction: z.enum(['outgoing', 'incoming']),
  answered: z.boolean().nullable(),
  ringSeconds: z.number().nonnegative().nullable(),
  content: z.string(),
});

export const TripEventPayloadSchema = z.object({
  eventType: z.string().min(1),
  details: z.string(),
});

export const PaymentPayloadSchema = z.object({
  component: z.string().min(1),
  amountCents: CentsSchema,
  direction: z.enum(['charge', 'refund']),
  method: z.string(),
  status: z.enum(['applied', 'pending', 'reversed']),
});

export const RoutePayloadSchema = z.object({
  plannedDistanceM: z.number().nonnegative().nullable(),
  actualDistanceM: z.number().nonnegative().nullable(),
  gpsSegmentSumM: z.number().nonnegative().nullable(),
  justification: z.enum([
    'verified_justification',
    'verified_no_justification',
    'unknown',
  ]),
  justificationNote: z.string().nullable(),
});

/**
 * History is review-routing context only. It never establishes liability and is
 * kept out of liability-agent contexts (product spec section 8).
 */
export const HistoryPayloadSchema = z.object({
  subject: z.enum(['rider', 'driver']),
  avgRating: z.number().min(0).max(5).nullable(),
  totalTrips: z.number().nonnegative().nullable(),
  disputeCount: z.number().nonnegative().nullable(),
  fraudFlags: z.number().nonnegative().nullable(),
  note: z.string().nullable(),
});

export const ImagePayloadSchema = z.object({
  assetUrl: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().nonnegative(),
  /** Content hash (e.g. SHA-256). A hash detects file identity, not capture truth. */
  hash: z.string().min(1),
  /** Capture time from metadata, if present. EXIF is editable; absence is not fraud. */
  captureAt: IsoTimestampSchema.nullable(),
  /** Metadata fields as read from the file. Editable and not proof of authenticity. */
    metadata: z.record(z.string(), z.string()),
  /** Described angles (e.g. front, rear, side). */
  angles: z.array(z.string()),
  sufficiency: z.enum(['adequate', 'inadequate_angles', 'missing_context']),
});

/* ------------------------------------------------------------------ */
/* Evidence item                                                       */
/* ------------------------------------------------------------------ */

export const ClaimVerificationSchema = z.object({
  status: z.enum(['unverified_claim', 'verified']),
  /** What the reviewer checked the value against. Required once verified. */
  source: z.string().nullable(),
  verifiedBy: z.string().nullable(),
  verifiedAt: IsoTimestampSchema.nullable(),
});
export type ClaimVerification = z.infer<typeof ClaimVerificationSchema>;

/**
 * A party-supplied value recorded against an evidence item.
 *
 * A claim never replaces the measurement it disputes — it sits alongside it with
 * its own verification state. Accepting a claim into the case is a decision about
 * what to consider, not a finding that the claim is true. Only a claim a reviewer
 * has marked `verified`, naming what they checked it against, is promoted into
 * the authoritative payload the policy engine reads.
 */
export const EvidenceClaimSchema = z.object({
  id: z.string().min(1),
  /** Which measurement of the host item the claim is about. */
  field: z.enum(['gps_accuracy_meters', 'fare_component_cents']),
  /** The value the party supplied. */
  value: z.number().nonnegative(),
  suppliedBy: z.enum(['rider', 'driver', 'platform']),
  requestId: z.string().min(1),
  suppliedAt: IsoTimestampSchema,
  verification: ClaimVerificationSchema,
  note: z.string().min(1),
});
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;

const evidenceBase = {
  id: z.string().min(1),
  timestamp: NullableTimestampSchema,
  source: SourceRefSchema,
  qualityIssues: z.array(z.string()),
  /**
   * Party-supplied claims about this item. Absent on evidence that no party has
   * disputed, and on records written before claims existed.
   */
  claims: z.array(EvidenceClaimSchema).optional(),
};

export const EvidenceItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...evidenceBase, kind: z.literal('gps'), payload: GpsPayloadSchema }),
  z.object({ ...evidenceBase, kind: z.literal('chat'), payload: ChatPayloadSchema }),
  z.object({ ...evidenceBase, kind: z.literal('call'), payload: CallPayloadSchema }),
  z.object({
    ...evidenceBase,
    kind: z.literal('trip_event'),
    payload: TripEventPayloadSchema,
  }),
  z.object({
    ...evidenceBase,
    kind: z.literal('payment'),
    payload: PaymentPayloadSchema,
  }),
  z.object({ ...evidenceBase, kind: z.literal('route'), payload: RoutePayloadSchema }),
  z.object({
    ...evidenceBase,
    kind: z.literal('history'),
    payload: HistoryPayloadSchema,
  }),
  z.object({
    ...evidenceBase,
    kind: z.literal('image'),
    payload: ImagePayloadSchema,
  }),
]);
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/* ------------------------------------------------------------------ */
/* Findings and policy                                                 */
/* ------------------------------------------------------------------ */

export const FindingSchema = z.object({
  id: z.string().min(1),
  kind: FindingKindSchema,
  text: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  policyIds: z.array(z.string().min(1)),
  material: z.boolean(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const PolicyClauseSchema = z.object({
  id: z.string().min(1),
  category: CategorySchema,
  title: z.string().min(1),
  text: z.string().min(1),
  authority: z.enum(['official_ryde', 'rydr_safeguard', 'demo']).optional(),
  sourceUrl: z.string().url().refine(url => {
    const host = new URL(url).hostname;
    return new URL(url).protocol === 'https:' && (host === 'rydesharing.com' || host === 'help.rydesharing.com');
  }, 'Official policy sources must be Ryde websites.').optional(),
  retrievedAt: z.string().date().optional(),
});
export type PolicyClause = z.infer<typeof PolicyClauseSchema>;

export const PolicyThresholdsSchema = z.object({
  pickupRadiusMeters: z.number().positive(),
  continuityLimitSeconds: z.number().positive(),
  freeWaitSeconds: z.number().nonnegative(),
  noShowThresholdSeconds: z.number().positive(),
  routeExcessPercent: z.number().positive(),
  routeExcessMeters: z.number().positive(),
  highValueCents: z.number().positive(),
  qualityReviewFloor: z.number().min(0).max(1),
  judgeConfidenceFloor: z.number().min(0).max(1),
});
export type PolicyThresholds = z.infer<typeof PolicyThresholdsSchema>;

const packIdentity = {
  id: z.string().min(1),
  version: z.string().min(1),
  label: z.string().min(1),
  clauses: z.array(PolicyClauseSchema),
};

/**
 * Versioned pack shapes with distinct authority:
 *  - rydr_demo carries the complete threshold set the deterministic engine needs.
 *  - supplied_sample carries only what the source actually stated, plus the gaps
 *    Rydr is not allowed to fill in. Structural, so it cannot be silently merged.
 *  - ryde_official carries source-linked public-policy paraphrases separately
 *    from prototype safeguards, with explicit scope and retrieval metadata.
 */
export const PolicyPackSchema = z.discriminatedUnion('source', [
  z.object({
    ...packIdentity,
    source: z.literal('rydr_demo'),
    thresholds: PolicyThresholdsSchema,
  }),
  z.object({
    ...packIdentity,
    source: z.literal('ryde_official'),
    thresholds: PolicyThresholdsSchema,
    officialScope: z.enum(['on_demand_no_show', 'advance_no_show', 'fixed_fare', 'cleaning']),
    retrievedAt: z.string().date(),
    effectiveFrom: z.string().date().nullable(),
    applicability: z.string().min(1),
  }),
  z.object({
    ...packIdentity,
    source: z.literal('supplied_sample'),
    statedThresholds: z.object({
      freeWaitSeconds: z.number().nonnegative().nullable(),
      noShowThresholdSeconds: z.number().positive().nullable(),
      cancellationFeeCents: z.number().nonnegative().nullable(),
    }),
    /** Ambiguities Rydr must not resolve on its own. */
    unresolved: z.array(z.string()),
  }),
]).superRefine((pack, ctx) => {
  if (pack.source !== 'ryde_official') return;
  const official = pack.clauses.filter(clause => clause.authority === 'official_ryde');
  if (!official.length || official.some(clause => !clause.sourceUrl || clause.retrievedAt !== pack.retrievedAt)) {
    ctx.addIssue({ code: 'custom', message: 'Official policy clauses need Ryde source links and a matching retrieval date.' });
  }
});
export type PolicyPack = z.infer<typeof PolicyPackSchema>;

/* ------------------------------------------------------------------ */
/* Case                                                                */
/* ------------------------------------------------------------------ */

export const CaseRecordSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  category: CategorySchema,
  currency: z.literal('SGD'),
  disputedCents: CentsSchema,
  riderStatement: z.string(),
  driverStatement: z.string().nullable(),
  trip: z.object({
    id: z.string().min(1),
    bookingType: z.enum(['on_demand', 'advance', 'unknown']).optional(),
    fareType: z.enum(['fixed', 'metered', 'unknown']).optional(),
    scheduledAt: NullableTimestampSchema,
    pickup: z.object({
      lat: LatitudeSchema,
      lng: LongitudeSchema,
      label: z.string().min(1),
    }),
    dropoff: z
      .object({
        lat: LatitudeSchema,
        lng: LongitudeSchema,
        label: z.string().min(1),
      })
      .nullable(),
  }),
  evidence: z.array(EvidenceItemSchema).min(1),
  /** Versioned policy Rydr actually evaluates against. */
  policyVersion: z.string().min(1),
  /**
   * Organizer/policy text supplied with the sample. Stored separately and never
   * silently merged into the governing pack (product spec section 7).
   */
  suppliedPolicyId: z.string().nullable(),
  provenance: ProvenanceSchema,
  /** Source case ID when this fixture was derived from a supplied sample. */
  derivedFrom: z.string().nullable(),
  /** Explicit change log for synthetic derivation. Empty for supplied samples. */
  changeLog: z.array(z.string()),
})
  .refine(
    (record) => new Set(record.evidence.map((item) => item.id)).size === record.evidence.length,
    { message: 'evidence ids must be unique' },
  )
  .refine(
    (record) => record.evidence.every((item) => item.source.provenance !== undefined),
    { message: 'every evidence item must declare provenance' },
  );
export type CaseRecord = z.infer<typeof CaseRecordSchema>;

export const CaseSummarySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  category: CategorySchema,
  disputedCents: CentsSchema,
  provenance: ProvenanceSchema,
  status: z.enum(['open', 'in_review', 'resolved', 'escalated']),
  lastUpdatedAt: IsoTimestampSchema,
  latestDisposition: DispositionSchema.nullable(),
  syntheticDataNotice: z.literal(true),
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;

/* ------------------------------------------------------------------ */
/* Agent outputs                                                       */
/* ------------------------------------------------------------------ */

export const NextActionSchema = z.object({ actionId:z.enum(['request-source-record','clarify-policy','review-remedy']), findingId:z.string().nullable(), sourceOwner:z.enum(['platform','policy_owner','reviewer']), summary:z.string().min(1).max(350) });
export const AdvocateOutputSchema = z.object({
  side: z.enum(['rider', 'driver']),
  position: AdvocatePositionSchema,
  summary: z.string().min(1),
  supportingFindingIds: z.array(z.string()),
  contradictoryFindingIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  policyIds: z.array(z.string()),
  uncertainties: z.array(z.string()),
  requestedEvidenceIds: z.array(z.string()),
  nextAction: NextActionSchema.nullable().optional(),
  modelConfidence: z.number().min(0).max(1),
});
export type AdvocateOutput = z.infer<typeof AdvocateOutputSchema>;

export const JudgeOutputSchema = z.object({
  disposition: DispositionSchema,
  recommendedRefundCents: CentsSchema.nullable(),
  establishedFindingIds: z.array(z.string()),
  disputedFindingIds: z.array(z.string()),
  materialEvidenceIds: z.array(z.string()),
  policyIds: z.array(z.string()),
  reasoningSummary: z.string().min(1),
  missingEvidence: z.array(z.string()),
  selectedRemedyOptionIds:z.array(z.enum(['existing-fare-position','review-cleaning-eligibility'])).optional(),
  partyExplanations:z.object({ rider:z.string().min(1).max(500),driver:z.string().min(1).max(500) }).optional(),
  modelConfidence: z.number().min(0).max(1),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export const ResolutionSchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  disposition: DispositionSchema,
  recommendedRefundCents: CentsSchema.nullable(),
  evidenceQualityScore: z.number().min(0).max(1),
  confidenceBand: z.enum(['high', 'moderate', 'low']),
  requiresHumanReview: z.boolean(),
  escalationReasons: z.array(z.string()),
  judge: JudgeOutputSchema,
  mode: ExecutionModeSchema,
  policyVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  createdAt: IsoTimestampSchema,
});
export type Resolution = z.infer<typeof ResolutionSchema>;

/* ------------------------------------------------------------------ */
/* Runs and events                                                     */
/* ------------------------------------------------------------------ */

export const RunStateSchema = z.enum([
  'created',
  'normalizing',
  'advocates_running',
  'judging',
  'validating',
  'completed',
  'escalated',
  'failed',
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const RunEventSchema = z.object({
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  at: IsoTimestampSchema,
  actor: z.enum(['system', 'rider_advocate', 'driver_advocate', 'judge', 'validator']),
  type: z.string().min(1),
  summary: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const IntegritySignalSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  evidenceIds: z.array(z.string().min(1)),
  explanation: z.string().min(1),
});
export type IntegritySignal = z.infer<typeof IntegritySignalSchema>;

export const IntegrityAssessmentSchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  assessedAt: IsoTimestampSchema,
  overallSeverity: z.enum(['none', 'low', 'medium', 'high']),
  signals: z.array(IntegritySignalSchema),
  triggersReview: z.boolean(),
});
export type IntegrityAssessment = z.infer<typeof IntegrityAssessmentSchema>;

export const RunRecordSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  mode: ExecutionModeSchema,
  state: RunStateSchema,
  idempotencyKey: z.string().min(1),
  inputHash: z.string().min(1),
  policyVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  provider: z.string().min(1),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  callCount: z.number().int().nonnegative(),
  advocates: z.object({
    rider: AdvocateOutputSchema.nullable(),
    driver: AdvocateOutputSchema.nullable(),
  }),
  judge: JudgeOutputSchema.nullable(),
  resolution: ResolutionSchema.nullable(),
  stageTimingsMs: z.record(z.string(), z.number().nonnegative()),
  events: z.array(RunEventSchema),
  /**
   * Integrity assessment produced in parallel with the advocate pipeline.
   * Absent when the assessment has not finished or when the run was created
   * by a build that did not include integrity checks.
   */
  integrityAssessment: IntegrityAssessmentSchema.nullable().optional(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/* ------------------------------------------------------------------ */
/* Dispute operations workbench                                        */
/*                                                                     */
/* These are business entities, deliberately separate from RunRecord.  */
/* `run.state === 'completed'` must never be read as "case settled".   */
/* ------------------------------------------------------------------ */

export const ReviewTaskStatusSchema = z.enum([
  'queued',
  'assigned',
  'awaiting_evidence',
  'ready',
  'decided',
  'closed_unresolved',
]);
export type ReviewTaskStatus = z.infer<typeof ReviewTaskStatusSchema>;

export const ReviewTaskKindSchema = z.enum([
  'automatic_escalation',
  'party_request',
  'appeal',
  'runtime_failure',
  'integrity_alert',
]);
export type ReviewTaskKind = z.infer<typeof ReviewTaskKindSchema>;

/**
 * SLA routing attached to a task. Deadlines are **demo service targets** for
 * this prototype, not contractual SLAs, and say so in `serviceTargetLabel`.
 *
 * Lateness is never stored — only `dueAt` is — so overdue state is recomputed
 * from server time on every read and survives a restart.
 */
export const TaskRoutingSchema = z.object({
  lane: z.enum(['safety', 'integrity', 'high_value', 'standard']),
  urgency: z.enum(['immediate', 'elevated', 'normal']),
  reason: z.string().min(1),
  codes: z.array(z.string()),
  serviceTargetMs: z.number().int().positive(),
  serviceTargetLabel: z.string().min(1),
  dueAt: IsoTimestampSchema,
  lastActivityAt: IsoTimestampSchema,
});
export type TaskRouting = z.infer<typeof TaskRoutingSchema>;

export const ReviewTaskSchema = z.object({
  submittedBy: z.enum(['rider', 'driver']).optional(),
  id: z.string().min(1),
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  runId: z.string().nullable(),
  kind: ReviewTaskKindSchema,
  status: ReviewTaskStatusSchema,
  assigneeId: z.string().nullable(),
  reasonCodes: z.array(z.string()),
  reasonSummary: z.string().min(1),
  /** What the evidence could not settle, shown to the reviewer as a checklist. */
  openQuestions: z.array(z.string()),
  linkedDecisionId: z.string().nullable(),
  /** Optimistic concurrency token. Stale writes are rejected. */
  revision: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  /**
   * Absent on tasks written before routing existed. Readers fall back to the
   * created time and the standard target rather than inventing a lane.
   */
  routing: TaskRoutingSchema.optional(),
  /**
   * Set when the appeal names a specific material finding to challenge. A
   * targeted challenge is still an appeal, so `kind` stays `appeal` and the
   * generic appeal remains available as a fallback.
   */
  challenge: z
    .object({
      findingId: z.string().min(1),
      findingText: z.string().min(1),
      proposedCorrection: z.string().min(1),
      contestedSource: z.string().nullable(),
      /** The evidence request raised to verify or refute the challenge. */
      evidenceRequestId: z.string().nullable(),
    })
    .optional(),
});
export type ReviewTask = z.infer<typeof ReviewTaskSchema>;

export const EvidenceRequestStatusSchema = z.enum(['open', 'submitted', 'accepted', 'rejected']);
export type EvidenceRequestStatus = z.infer<typeof EvidenceRequestStatusSchema>;

/**
 * A structured party response. These are the only shapes a party may submit
 * that can become case evidence once a reviewer accepts them. Free text alone
 * stays a claim and never becomes verified telemetry.
 *
 * `provenanceNote` is mandatory so the record always says who supplied the value
 * and that it is not independently verified.
 */
export const GpsAccuracyResponseSchema = z.object({
  kind: z.literal('gps_accuracy'),
  /** Catalogue ids of the GPS samples whose accuracy radius is being corrected. */
  sampleIds: z.array(z.string().min(1)).min(1),
  accuracyMeters: z.number().nonnegative(),
  provenanceNote: z.string().min(1),
});

export const FareLedgerResponseSchema = z.object({
  kind: z.literal('fare_ledger'),
  components: z
    .array(
      z.object({
        component: z.string().min(1),
        amountCents: CentsSchema,
      }),
    )
    .min(1),
  provenanceNote: z.string().min(1),
});

export const StructuredEvidenceResponseSchema = z.discriminatedUnion('kind', [
  GpsAccuracyResponseSchema,
  FareLedgerResponseSchema,
]);
export type StructuredEvidenceResponse = z.infer<typeof StructuredEvidenceResponseSchema>;

export const EvidenceRequestSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  caseId: z.string().min(1),
  recipient: z.enum(['rider', 'driver', 'platform']),
  question: z.string().min(1),
  evidenceType: z.string().min(1),
  whyItMatters: z.string().min(1),
  status: EvidenceRequestStatusSchema,
  responseNote: z.string().nullable(),
  /** Structured response offered by the party, pending reviewer acceptance. */
  structuredResponse: StructuredEvidenceResponseSchema.nullable().default(null),
  /** Case version created when a reviewer accepted this response. */
  acceptedIntoCaseVersion: z.number().int().positive().nullable().default(null),
  /**
   * How the reviewer treated the supplied value when accepting it. Acceptance is
   * not verification, so this defaults to an unverified claim.
   */
  responseVerification: ClaimVerificationSchema.nullable().default(null),
  responseEvidenceIds: z.array(z.string()),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

export const DecisionDispositionSchema = z.enum([
  'refund',
  'uphold',
  'partial_refund',
  'insufficient_evidence',
]);
export type DecisionDisposition = z.infer<typeof DecisionDispositionSchema>;

export const CaseDecisionSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  runId: z.string().nullable(),
  taskId: z.string().nullable(),
  source: z.enum(['ai', 'reviewer']),
  disposition: DecisionDispositionSchema,
  targetRefundCents: CentsSchema.nullable(),
  evidenceIds: z.array(z.string()),
  policyIds: z.array(z.string()),
  policyVersion: z.string().min(1),
  explanation: z.string().min(1),
  /** Required when a reviewer departs from the automated recommendation. */
  differenceFromRecommendation: z.string().nullable(),
  reviewerId: z.string().nullable(),
  supersedesDecisionId: z.string().nullable(),
  /** Stable reference to the charged fare, used to prevent double refunds. */
  chargeRef: z.string().min(1),
  createdAt: IsoTimestampSchema,
});
export type CaseDecision = z.infer<typeof CaseDecisionSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string().min(1),
  settlementId: z.string().min(1),
  account: z.enum(['rider', 'platform_fee_clearing', 'driver_allocation']),
  direction: z.enum(['credit', 'debit', 'zero_adjustment']),
  amountCents: CentsSchema,
  note: z.string().min(1),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const SettlementSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  decisionId: z.string().min(1),
  chargeRef: z.string().min(1),
  mode: z.literal('simulation'),
  status: z.enum(['pending', 'posted', 'failed', 'manual_adjustment_required']),
  originalChargeCents: CentsSchema,
  targetRefundCents: CentsSchema,
  deltaRefundCents: CentsSchema,
  retainedCents: CentsSchema,
  ledgerEntryIds: z.array(z.string()),
  idempotencyKey: z.string().min(1),
  failureReason: z.string().nullable(),
  postedAt: IsoTimestampSchema.nullable(),
  createdAt: IsoTimestampSchema,
  /**
   * Refund already posted against this charge *before* this settlement, frozen
   * at posting time. Stored so recovery cannot re-derive it from a ledger that
   * later appeals have since changed, and so rebuilding a historical receipt
   * reproduces what that decision actually recorded.
   *
   * Optional only so settlements written before this field existed stay
   * readable; `priorPostedFor` derives their position from posted history.
   */
  priorPostedCents: CentsSchema.optional(),
  /** Cumulative refunded position this settlement recorded (prior + delta). */
  totalRefundedCents: CentsSchema.optional(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const PartyReceiptSchema = z.object({
  id: z.string().min(1),
  decisionId: z.string().min(1),
  settlementId: z.string().nullable(),
  recipient: z.enum(['rider', 'driver']),
  mode: z.literal('local_preview'),
  headline: z.string().min(1),
  body: z.string().min(1),
  createdAt: IsoTimestampSchema,
});
export type PartyReceipt = z.infer<typeof PartyReceiptSchema>;

/**
 * A charged fare. Reused across duplicate dispute cases so one fee can never be
 * refunded twice.
 */
export const ChargeRecordSchema = z.object({
  ref: z.string().min(1),
  caseId: z.string().min(1),
  tripId: z.string().min(1),
  originalChargeCents: CentsSchema,
  driverAllocationCents: CentsSchema,
  platformFeeCents: CentsSchema,
});
export type ChargeRecord = z.infer<typeof ChargeRecordSchema>;

/** Derived business status for the queue. Not stored on the run. */
export const CaseBusinessStatusSchema = z.enum([
  'open',
  'analyzing',
  'needs_review',
  'awaiting_evidence',
  'ready_for_decision',
  'settlement_pending',
  'settled',
  'settlement_failed',
  'appeal_pending',
  'closed_unresolved',
]);
export type CaseBusinessStatus = z.infer<typeof CaseBusinessStatusSchema>;

/** The single seeded demo reviewer. Not real authentication. */
export const DEMO_REVIEWER_ID = 'reviewer_demo_01';
export const DEMO_REVIEWER_NAME = 'Alex Tan';

/* ------------------------------------------------------------------ */
/* Immutable run snapshots                                             */
/*                                                                     */
/* A run is evaluated against one immutable case version and one       */
/* policy version. The snapshot freezes everything the run actually    */
/* read, so an old report stays faithful after the case is edited.     */
/* Findings are never recomputed against the latest case.              */
/* ------------------------------------------------------------------ */

export const ZoneClassSchema = z.enum(['inside', 'outside', 'indeterminate']);

export const RouteComparisonSchema = z.object({
  plannedDistanceM: z.number().nonnegative().nullable(),
  actualDistanceM: z.number().nonnegative().nullable(),
  excessMeters: z.number().nullable(),
  excessPercent: z.number().nullable(),
  deviationFlagged: z.boolean(),
  measurable: z.boolean(),
});

export const NoShowEvaluationSchema = z.object({
  arrivalZone: ZoneClassSchema,
  accuracyPresent: z.boolean(),
  maxGapSeconds: z.number().nullable(),
  continuityOk: z.boolean(),
  earliestStartAt: IsoTimestampSchema.nullable(),
  effectiveStartAt: IsoTimestampSchema.nullable(),
  elapsedSeconds: z.number().nullable(),
  elapsedUnderEarliestSeconds: z.number().nullable(),
  materialStartConflict: z.boolean(),
  policyAmbiguity: z.boolean(),
  contactAttempts: z.number().int().nonnegative(),
  cancellationAt: IsoTimestampSchema.nullable(),
});

export const RouteEvaluationSchema = z.object({
  comparison: RouteComparisonSchema,
  justification: z.enum(['verified_justification', 'verified_no_justification', 'unknown']),
  ledgerReconciled: z.boolean(),
  ledgerDifferenceCents: z.number(),
  surchargeCents: CentsSchema.nullable(),
});

export const DeterministicEvaluationSchema = z.object({
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  category: CategorySchema,
  disposition: DispositionSchema,
  recommendedRefundCents: CentsSchema.nullable(),
  findings: z.array(FindingSchema),
  issues: z.array(z.string()),
  materialEvidenceIds: z.array(z.string()),
  policyIds: z.array(z.string()),
  noShow: NoShowEvaluationSchema.nullable(),
  route: RouteEvaluationSchema.nullable(),
  damage: z.object({ imagesPresent: z.boolean(), imageCount: z.number().int().nonnegative(), integritySeverity: z.enum(['none', 'low', 'medium', 'high']), humanApprovalRequired: z.boolean() }).nullable().optional(),
});
export type DeterministicEvaluationSnapshot = z.infer<typeof DeterministicEvaluationSchema>;

export const QualityCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  passed: z.boolean(),
  weight: z.number(),
});

export const QualityDimensionSchema = z.object({
  key: z.enum(['completeness', 'traceability', 'consistency', 'measurement']),
  max: z.number(),
  score: z.number(),
  checks: z.array(QualityCheckSchema),
});

export const QualityScoreSchema = z.object({
  total: z.number(),
  band: z.enum(['high', 'moderate', 'low']),
  dimensions: z.array(QualityDimensionSchema),
});
export type QualityScoreSnapshot = z.infer<typeof QualityScoreSchema>;

export const CatalogEntrySchema = z.object({
  id: z.string().min(1),
  kind: EvidenceKindSchema,
  timestamp: IsoTimestampSchema.nullable(),
  summary: z.string(),
  provenance: ProvenanceSchema,
  dataset: z.string(),
  jsonPointer: z.string(),
});
export type CatalogEntrySnapshot = z.infer<typeof CatalogEntrySchema>;

/**
 * Precedent context handed to the Judge, and the manifest of what retrieval
 * considered. Defined here because both are part of the frozen run snapshot.
 *
 * A precedent is context only: it never overrides policy, and it never supplies
 * a rule the governing pack does not state.
 */
export const PrecedentContextSchema = z.object({
  precedentId: z.string().min(1),
  caseId: z.string().min(1),
  category: CategorySchema,
  citedPolicyIds: z.array(z.string()),
  /** Material similarities with the current case, stated plainly. */
  similarities: z.array(z.string()),
  /** Material differences. Always populated when there are any. */
  differences: z.array(z.string()),
  outcome: z.string().min(1),
  disposition: z.enum(['refund', 'uphold', 'partial_refund']),
  refundCents: z.number().int().nonnegative(),
  relevanceScore: z.number().min(0).max(1),
  approvedBy: z.string().min(1),
  approvedAt: IsoTimestampSchema,
});
export type PrecedentContext = z.infer<typeof PrecedentContextSchema>;

export const PrecedentExclusionSchema = z.object({
  precedentId: z.string().min(1),
  reason: z.string().min(1),
});
export type PrecedentExclusion = z.infer<typeof PrecedentExclusionSchema>;

/**
 * What retrieval considered, what it returned and what it rejected. Frozen in
 * the run snapshot, so an old report keeps showing the precedent context that
 * run actually received rather than a freshly retrieved one.
 */
export const PrecedentManifestSchema = z.object({
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  retrievedAt: IsoTimestampSchema,
  strategy: z.literal('structured_lexical'),
  considered: z.number().int().nonnegative(),
  contexts: z.array(PrecedentContextSchema),
  excluded: z.array(PrecedentExclusionSchema),
  /** Honest "nothing relevant" statement when `contexts` is empty. */
  note: z.string().min(1),
});
export type PrecedentManifest = z.infer<typeof PrecedentManifestSchema>;

/**
 * Everything one run read, frozen at the moment it started. `policyHash` covers
 * the pack contents, so a silent policy edit is detectable even if the version
 * string is unchanged.
 */
export const RunSnapshotSchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  caseVersion: z.number().int().positive(),
  capturedAt: IsoTimestampSchema,
  inputHash: z.string().min(1),
  policyVersion: z.string().min(1),
  policyHash: z.string().min(1),
  promptVersion: z.string().min(1),
  provider: z.string().min(1),
  mode: ExecutionModeSchema,
  caseRecord: CaseRecordSchema,
  policyPack: PolicyPackSchema,
  evaluation: DeterministicEvaluationSchema,
  quality: QualityScoreSchema,
  catalog: z.array(CatalogEntrySchema),
  /**
   * Absent on runs recorded before precedent retrieval existed, and on a run
   * where retrieval was not consulted. Absent means "not retrieved", never
   * "retrieved and empty".
   */
  precedents: PrecedentManifestSchema.optional(),
  visionReceipts: z.unknown().optional(),
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

/* ------------------------------------------------------------------ */
/* Provider call telemetry                                             */
/*                                                                     */
/* Role, stage, request id, latency, reported token counts, repair     */
/* count and error. Provider hidden reasoning is deliberately never    */
/* stored. A count the provider did not report stays null rather than  */
/* being estimated.                                                    */
/* ------------------------------------------------------------------ */

export const AgentRoleSchema = z.enum(['rider', 'driver', 'judge', 'navigator', 'vision']);
export type AgentRoleName = z.infer<typeof AgentRoleSchema>;

export const ProviderCallRecordSchema = z.object({
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  role: AgentRoleSchema,
  stage: z.string().min(1),
  /** Provider-assigned request id when the provider reports one. */
  requestId: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  /** Null means the provider did not report usage. Never estimated. */
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  /** True when this call was a bounded repair of a rejected attempt. */
  repair: z.boolean(),
  ok: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  at: IsoTimestampSchema,
});
export type ProviderCallRecord = z.infer<typeof ProviderCallRecordSchema>;
