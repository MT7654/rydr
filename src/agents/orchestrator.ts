import {
  ResolutionSchema,
  type CaseRecord,
  type Disposition,
  type ExecutionMode,
  type PolicyPack,
  type PrecedentManifest,
  type Resolution,
  type RunRecord,
} from '../domain/contracts';
import { evaluateCase, type DeterministicEvaluation } from '../domain/policy';
import { applyEscalationGate, scoreEvidence, type QualityScore } from '../domain/confidence';
import { retrievePrecedents } from '../domain/precedentRetrieval';
import { getCase, getPolicyPack } from '../repositories/cases';
import { listPrecedents } from '../repositories/precedents';
import {
  appendEvent,
  createRun,
  findRunByIdempotencyKey,
  latestRunForCase,
  reserveCalls,
  transition,
  updateRun,
} from '../repositories/runs';
import { fingerprint } from '../lib/hash';
import { enrichImageCatalog } from '../lib/multimodalPacket';
import { assessBehaviorRisk, combineRisk } from '../domain/behaviorRisk';
import { getAllCases } from '../repositories/cases';
import { RISK_REASONER_PROMPT,riskInput,validateRiskReasoning } from './riskReasoner';
import { waitUntil } from '@vercel/functions';
import { afterStorageCommit } from '../repositories/neon';
import { currentStorageSession, withStorageSession, withLock } from '../repositories/store';
import { captureRunSnapshot, getRunSnapshot } from '../repositories/snapshots';
import { recordProviderCall } from '../repositories/providerCalls';
import { judgeReasoningSummary } from './explanation';
import { applyCompletion } from './completion';
import { buildCatalog, retrieveEvidence, type CatalogEntry } from './evidenceService';
import {
  buildValidationContext,
  validateAdvocateOutput,
  validateJudgeOutput,
} from './validators';
import {
  ADVOCATE_SELECTION,
  DRIVER_ADVOCATE_FINAL,
  JUDGE_FINAL,
  PROMPT_VERSION,
  RIDER_ADVOCATE_FINAL,
  SHARED_RULES,
} from './prompts';
import { assessIntegrity, type IntegrityAssessment } from '../domain/integrity';
import type {
  AgentInvocation,
  AgentProvider,
  AgentResult,
  AgentRole,
  AdvocateSelection,
} from '../providers/types';
import { ProviderError, isAdvocateSelection } from '../providers/types';

import {
  AdvocateInputSchema,
  JudgeInputSchema,
  SelectionInputSchema,
  toCatalogEntries,
  toClauseRefs,
  toFindingRefs,
  type DeterministicBundle,
} from '../providers/runtimeInput';

export interface OrchestratorConfig {
  provider: AgentProvider;
  /** Local catalog selection saves two calls; optional model selection remains available. */
  localEvidenceSelection?: boolean;
  maxCallsPerRun: number;
  maxCallsPerSession: number;
  timeoutMs: number;
  maxOutputTokens: number;
}

export const DEFAULT_CONFIG: Omit<OrchestratorConfig, 'provider'> = {
  maxCallsPerRun: 10,
  maxCallsPerSession: 30,
  timeoutMs: 30_000,
  maxOutputTokens: 1_800,
};

export function buildDeterministicBundle(
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
  quality: QualityScore,
): DeterministicBundle {
  const materialFindingIds = evaluation.findings
    .filter((f) => f.material && f.kind !== 'claim')
    .map((f) => f.id);
  const claimFindingIds = evaluation.findings.filter((f) => f.kind === 'claim').map((f) => f.id);

  return {
    category: caseRecord.category,
    allowedActionCatalogue:[{actionId:'request-source-record',sourceOwner:'platform'},{actionId:'clarify-policy',sourceOwner:'policy_owner'},{actionId:'review-remedy',sourceOwner:'reviewer'}],
    allowedRemedyOptionIds:caseRecord.policyVersion === 'ryde-cleaning-20261002' ? ['existing-fare-position','review-cleaning-eligibility'] : ['existing-fare-position'],
    allowedDispositions: Array.from(
      new Set<Disposition>([evaluation.disposition, 'human_review']),
    ),
    deterministicRefundCents: evaluation.recommendedRefundCents,
    issues: evaluation.issues,
    materialFindingIds,
    claimFindingIds,
    materialEvidenceIds: evaluation.materialEvidenceIds,
    policyIds: evaluation.policyIds,
    qualityBand: quality.band,
    narrative: judgeReasoningSummary(evaluation),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProviderError('Provider timed out', 'timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface PreparedRun {
  caseRecord: CaseRecord;
  pack: PolicyPack;
  thresholds: import('../domain/contracts').PolicyThresholds;
  evaluation: DeterministicEvaluation;
  quality: QualityScore;
  catalog: CatalogEntry[];
  bundle: DeterministicBundle;
  clauses: { id: string; title: string; text: string }[];
  /** Approved precedent context, or null when retrieval has not been consulted. */
  precedents: PrecedentManifest | null;
}

/**
 * Retrieves approved precedent context for a case.
 *
 * Retrieval is local and lexical, so it costs no model call. It runs once at run
 * start and the result is frozen into the snapshot: a later approval or rollback
 * must not change what an already-recorded run appears to have been shown.
 */
async function retrieveForRun(
  caseRecord: CaseRecord,
  evaluation: DeterministicEvaluation,
  pack: PolicyPack,
): Promise<PrecedentManifest> {
  const precedents = await listPrecedents();
  return retrievePrecedents({ caseRecord, evaluation, pack, precedents });
}

async function prepare(caseId: string): Promise<PreparedRun> {
  const caseRecord = await getCase(caseId);
  if (!caseRecord) throw new Error(`Unknown case: ${caseId}`);
  const pack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source === 'supplied_sample') {
    throw new Error(`Case ${caseId} is governed by a non-demo pack: ${pack.id}`);
  }
  const evaluation = evaluateCase(caseRecord, pack);
  const quality = scoreEvidence(caseRecord, evaluation, pack.thresholds);
  const catalog = await enrichImageCatalog(caseRecord.id,caseRecord.version,buildCatalog(caseRecord));
  const bundle = buildDeterministicBundle(caseRecord, evaluation, quality);
  const clauses = toClauseRefs(pack.clauses.filter((c) => c.category === caseRecord.category || evaluation.policyIds.includes(c.id) || (c.authority === 'hackathon_reference' && /^REF-[56]\./.test(c.id))));
  return {
    caseRecord,
    pack,
    thresholds: pack.thresholds,
    evaluation,
    quality,
    catalog,
    bundle,
    clauses,
    precedents: null,
  };
}

/**
 * Invokes the provider and records what it reported: role, stage, request id,
 * latency, token usage and any error. Provider hidden reasoning is never stored,
 * and usage the provider did not report stays null instead of being estimated.
 *
 * Telemetry is best-effort: a failure to write it must not fail the run.
 */
async function invokeWithTelemetry(args: {
  runId: string;
  config: OrchestratorConfig;
  request: AgentInvocation;
  repair: boolean;
}): Promise<AgentResult> {
  const { runId, config, request, repair } = args;
  const startedAt = Date.now();
  try {
    const result = await withTimeout(config.provider.invoke(request), config.timeoutMs);
    await recordCall({
      runId,
      role: request.role,
      stage: request.stage,
      requestId: result.providerRequestId ?? null,
      latencyMs: Date.now() - startedAt,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
      repair,
      ok: true,
    });
    return result;
  } catch (error) {
    await recordCall({
      runId,
      role: request.role,
      stage: request.stage,
      requestId: null,
      latencyMs: Date.now() - startedAt,
      inputTokens: null,
      outputTokens: null,
      repair,
      ok: false,
      errorCode: error instanceof ProviderError ? error.code : 'transport',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function recordCall(
  input: Parameters<typeof recordProviderCall>[0],
): Promise<void> {
  try {
    await recordProviderCall(input);
  } catch {
    // Call telemetry is diagnostic only; losing it must not fail a run.
  }
}

interface ResolvedRunStart {
  run: RunRecord;
  /** True when this call created a run that still needs executing. */
  fresh: boolean;
}

/**
 * Whether an existing run may stand in for a requested one.
 *
 * The idempotency key alone is not enough. A caller can supply a key that says
 * nothing about how the run was executed — a task re-run key, say — and a run
 * recorded in fixture mode must never satisfy a request for a live execution.
 * Reuse therefore requires the mode, provider and input to match too.
 */
function isReusableFor(
  existing: RunRecord,
  expected: { mode: ExecutionMode; provider: string; inputHash: string },
): boolean {
  return (
    existing.state !== 'failed' &&
    existing.mode === expected.mode &&
    existing.provider === expected.provider &&
    existing.inputHash === expected.inputHash
  );
}

/**
 * Resolves which run a start request refers to, creating one if needed.
 * Concurrent starts with the same case, version, mode and input resolve to the
 * same run rather than starting a second billed execution.
 */
async function resolveRunStartUnlocked(
  caseId: string,
  mode: ExecutionMode,
  config: OrchestratorConfig,
  idempotencyKey?: string,
): Promise<ResolvedRunStart> {
  const prepared = await prepare(caseId);

  const inputHash = fingerprint({
    case: prepared.caseRecord,
    multimodalCatalog: prepared.catalog,
    evidenceSelection: config.localEvidenceSelection ? 'local' : 'model',
    policyVersion: prepared.pack.version,
    promptVersion: PROMPT_VERSION,
    provider: config.provider.id,
    mode,
  });
  const baseKey =
    idempotencyKey ??
    `${caseId}:v${prepared.caseRecord.version}:${mode}:${inputHash.slice(0, 16)}`;

  if (mode === 'replay') {
    const recorded = await latestRunForCase(caseId);
    if (!recorded || recorded.state !== 'completed') {
      throw new Error('No recorded run is available to replay for this case.');
    }
    return { run: recorded, fresh: false };
  }

  const expected = { mode, provider: config.provider.id, inputHash };

  let key = baseKey;
  let existing = await findRunByIdempotencyKey(key);

  // The key was already claimed by a run for a different execution (a fixture
  // run holding a task re-run key, say). Do not reuse it, and do not overwrite
  // it either — qualify the key so both runs stay addressable.
  if (existing && !isReusableFor(existing, expected)) {
    key = `${baseKey}::${mode}`;
    existing = await findRunByIdempotencyKey(key);
  }

  if (existing && isReusableFor(existing, expected)) return { run: existing, fresh: false };

  const run = await createRun({
    caseId,
    caseVersion: prepared.caseRecord.version,
    mode,
    idempotencyKey: key,
    inputHash,
    policyVersion: prepared.pack.version,
    promptVersion: PROMPT_VERSION,
    provider: config.provider.id,
  });

  // Retrieve precedent context before the snapshot is written, so the frozen
  // record contains exactly what this run was shown. A later approval or
  // rollback cannot rewrite what this run saw.
  const precedents = await retrieveForRun(
    prepared.caseRecord,
    prepared.evaluation,
    prepared.pack,
  );

  // Freeze the exact case version, policy pack and deterministic findings this
  // run will evaluate, before any model call happens. Everything downstream
  // reads the snapshot, so editing the case later cannot rewrite history.
  await captureRunSnapshot({
    runId: run.id,
    mode,
    provider: config.provider.id,
    promptVersion: PROMPT_VERSION,
    inputHash,
    caseRecord: prepared.caseRecord,
    policyPack: prepared.pack,
    evaluation: prepared.evaluation,
    quality: prepared.quality,
    catalog: prepared.catalog,
    precedents,
  });

  return { run, fresh: true };
}

/**
 * Rebuilds the prepared bundle from the run's frozen snapshot. Returns null when
 * no snapshot exists (a run created by an older build), so the caller can fall
 * back to preparing from the current case.
 */
async function prepareFromSnapshot(runId: string): Promise<PreparedRun | null> {
  const snapshot = await getRunSnapshot(runId);
  if (!snapshot) return null;

  const caseRecord = snapshot.caseRecord;
  const pack = snapshot.policyPack;
  if (pack.source === 'supplied_sample') {
    throw new Error(`Case ${caseRecord.id} is governed by a non-demo pack: ${pack.id}`);
  }
  const evaluation = snapshot.evaluation as DeterministicEvaluation;
  const quality = snapshot.quality as QualityScore;

  return {
    caseRecord,
    pack,
    thresholds: pack.thresholds,
    evaluation,
    quality,
    catalog: snapshot.catalog as CatalogEntry[],
    bundle: buildDeterministicBundle(caseRecord, evaluation, quality),
    clauses: toClauseRefs(pack.clauses.filter((clause) => clause.category === caseRecord.category)),
    precedents: snapshot.precedents ?? null,
  };
}

async function resolveRunStart(caseId: string, mode: ExecutionMode, config: OrchestratorConfig, idempotencyKey?: string): Promise<ResolvedRunStart> {
  return withLock('run-start:' + caseId, () => resolveRunStartUnlocked(caseId, mode, config, idempotencyKey));
}

/**
 * Starts a run and waits for the three-agent pipeline to finish before
 * returning. Use this when the caller needs the final record; use `beginRun`
 * when the caller only needs a run id and will monitor progress.
 */
export async function startRun(
  caseId: string,
  mode: ExecutionMode,
  config: OrchestratorConfig,
  idempotencyKey?: string,
): Promise<RunRecord> {
  const { run, fresh } = await resolveRunStart(caseId, mode, config, idempotencyKey);
  if (!fresh) return run;
  return executeRun(run.id, config);
}

/**
 * Persists a run and returns it immediately, so an HTTP caller can redirect to
 * the monitor while the pipeline is still executing. Reuses an existing run for
 * a duplicate request instead of starting a second billed execution.
 */
export async function beginRun(
  caseId: string,
  mode: ExecutionMode,
  config: OrchestratorConfig,
  idempotencyKey?: string,
): Promise<RunRecord> {
  const session = await currentStorageSession();
  return withStorageSession(session, async () => {
    const { run, fresh } = await resolveRunStart(caseId, mode, config, idempotencyKey);
    if (fresh) afterStorageCommit(() => scheduleExecution(run.id, config, session));
    return run;
  });
}

/**
 * Runs currently executing in this process. Guards against a duplicate start
 * scheduling a second execution for the same run id.
 */
const inFlightExecutions = new Set<string>();

/**
 * Executes a run without blocking the caller, so the HTTP response can return a
 * persisted run id immediately and the monitor can observe real progress.
 *
 * This is a bounded worker. On Vercel its promise is registered with waitUntil.
 * The local path uses a long-lived process. Vercel must use Fluid compute and
 * the configured function duration; this is bounded request-attached work, not
 * an unlimited durable job queue.
 *
 * `executeRun` records its own terminal state and error details, so a rejection
 * here means the run could not even be updated; it is swallowed deliberately
 * rather than producing an unhandled rejection.
 */
function scheduleExecution(runId: string, config: OrchestratorConfig, session: string | null): void {
  const executionKey = `${session ?? 'local'}:${runId}`;
  if (inFlightExecutions.has(executionKey)) return;
  inFlightExecutions.add(executionKey);
  const execution = withStorageSession(session, () => executeRun(runId, config))
    .catch(() => undefined)
    .finally(() => {
      inFlightExecutions.delete(executionKey);
    });
  if (process.env.VERCEL) waitUntil(execution);
  else void execution;
}

export async function executeRun(
  runId: string,
  config: OrchestratorConfig,
): Promise<RunRecord> {
  let run = await transition(runId, 'normalizing', 'Normalising evidence and applying deterministic policy.');
  const started = Date.now();
  let integrityPromise: Promise<IntegrityAssessment | null> | undefined;

  try {
    // Prefer the frozen snapshot so a run always evaluates what it captured at
    // start, even if the case was edited while the run was queued. A run with no
    // snapshot (written by an older build) falls back to the current case and
    // retrieves precedent context now.
    let prepared = await prepareFromSnapshot(runId);
    if (!prepared) {
      const fresh = await prepare(run.caseId);
      prepared = {
        ...fresh,
        precedents: await retrieveForRun(fresh.caseRecord, fresh.evaluation, fresh.pack),
      };
    }
    const { caseRecord, evaluation, quality, catalog, bundle, clauses, precedents } = prepared;

    // Risk inspection runs alongside the advocates. Signals do not decide liability;
    // unresolved inspection can hold settlement, and failed analysis remains explicit.


    await appendEvent(runId, {
      runId,
      actor: 'system',
      type: 'evidence:normalized',
      summary: `${catalog.length} evidence items catalogued at case v${caseRecord.version}; deterministic eligibility is "${evaluation.disposition}".`,
    });

    const context = buildValidationContext(
      caseRecord,
      evaluation,
      prepared.pack.clauses.map((clause) => clause.id),
      catalog.map((entry) => entry.id),
    );

    let calls = 0;
    const spend = async (count: number, role: AgentRole) => {
      if (calls + count > config.maxCallsPerRun) {
        throw new ProviderError(
          `Run call cap of ${config.maxCallsPerRun} would be exceeded`,
          'cap_exhausted',
        );
      }
      if (config.provider.external) {
        const ok = await reserveCalls(count, config.maxCallsPerSession);
        if (!ok) {
          throw new ProviderError(
            `Session call cap of ${config.maxCallsPerSession} reached`,
            'cap_exhausted',
          );
        }
      }
      calls += count;
      void role;
      await updateRun(runId, (current) => ({ ...current, callCount: calls }));
    };

    integrityPromise = getAllCases().then(async peers=>{
      const assessment=combineRisk(assessIntegrity(runId,caseRecord),assessBehaviorRisk(caseRecord,peers));
      if(!config.provider.external)return assessment;
      await spend(1,'judge');
      const reply=await invokeWithTelemetry({runId,config,repair:false,request:{role:'judge',stage:'assess_risk',runId,systemInstruction:RISK_REASONER_PROMPT,input:riskInput(caseRecord),allowedEvidenceIds:catalog.map(e=>e.id),timeoutMs:config.timeoutMs,maxOutputTokens:1100}});
      const reasoning=validateRiskReasoning(reply.output,caseRecord);
      const combined=combineRisk(assessment,{score:0,band:'low',signals:reasoning.signals,reviewOnly:true});
      await appendEvent(runId,{runId,actor:'system',type:'risk:reasoned',summary:reasoning.summary});
      return combined;
    });
    // Attach a rejection handler immediately; the awaited gate below still fails explicitly.
    void integrityPromise.catch(()=>undefined);
    await transition(runId, 'advocates_running', 'Rider and Driver advocates are gathering evidence.');

    const advocates: Record<'rider' | 'driver', Awaited<ReturnType<typeof runAdvocate>>> = {
      rider: null,
      driver: null,
    };

    for (const side of ['rider', 'driver'] as const) {
      advocates[side] = await runAdvocate({
        side,
        runId,
        config,
        prepared,
        context,
        spend,
        onEvent: async (type, summary) =>
          appendEvent(runId, { runId, actor: side === 'rider' ? 'rider_advocate' : 'driver_advocate', type, summary }),
      });
      await updateRun(runId, (current) => ({
        ...current,
        advocates: { ...current.advocates, [side]: advocates[side] },
      }));
      await appendEvent(runId, {
        runId,
        actor: side === 'rider' ? 'rider_advocate' : 'driver_advocate',
        type: 'advocate:submitted',
        summary: `${side === 'rider' ? 'Rider' : 'Driver'} advocate submitted a validated case.`,
      });
    }

    run = await transition(runId, 'judging', 'Judge is comparing both validated cases.');

    await spend(1, 'judge');
    const judgeIntegrity = await integrityPromise;
    // Persist and queue before any automatic settlement can occur.
    await updateRun(runId,current=>({...current,integrityAssessment:judgeIntegrity}));
    const judgeInput = JudgeInputSchema.parse({
      phase: 'judge',
      integrity: judgeIntegrity,
      rider: advocates.rider,
      driver: advocates.driver,
      findings: toFindingRefs(evaluation.findings),
      evidence: toCatalogEntries(catalog),
      policyClauses: clauses,
      deterministic: bundle,
      precedents: precedents
        ? {
            strategy: precedents.strategy,
            note: precedents.note,
            contexts: precedents.contexts,
          }
        : null,
    });

    const rawJudge = (
      await invokeWithTelemetry({
        runId,
        config,
        repair: false,
        request: {
          role: 'judge',
          stage: 'judge',
          runId,
          systemInstruction: `${SHARED_RULES}\n\n${JUDGE_FINAL}`,
          input: judgeInput,
          allowedEvidenceIds: catalog.map((entry) => entry.id),
          timeoutMs: config.timeoutMs,
          maxOutputTokens: config.maxOutputTokens,
        },
      })
    ).output;

    let judgeResult = validateJudgeOutput(rawJudge, context);
    if (!judgeResult.ok) {
      await appendEvent(runId, {
        runId,
        actor: 'validator',
        type: 'judge:repair',
        summary: `Judge output invalid: ${judgeResult.errors.join(' ')} Attempting one bounded format repair.`,
      });
      await spend(1, 'judge');
      const repaired = (
        await invokeWithTelemetry({
          runId,
          config,
          repair: true,
          request: {
            role: 'judge',
            stage: 'judge',
            runId,
            systemInstruction: `${SHARED_RULES}\n\n${JUDGE_FINAL}\n\nReturn ONLY the JudgeOutput JSON. Previous attempt was rejected: ${judgeResult.errors.join(' ')}`,
            input: judgeInput,
            allowedEvidenceIds: catalog.map((entry) => entry.id),
            timeoutMs: config.timeoutMs,
            maxOutputTokens: config.maxOutputTokens,
          },
        })
      ).output;
      judgeResult = validateJudgeOutput(repaired, context);
    }

    if (!judgeResult.ok) {
      await updateRun(runId, (current) => ({
        ...current,
        state: 'failed',
        errorCode: 'judge_invalid_output',
        errorMessage: judgeResult.errors.join(' '),
      }));
      await appendEvent(runId, {
        runId,
        actor: 'validator',
        type: 'run:failed',
        summary: 'Judge output remained invalid after one repair. No fixture output was substituted.',
      });
      return (await updateRun(runId, (current) => current)) as RunRecord;
    }

    const judge = judgeResult.value;

    run = await transition(runId, 'validating', 'Applying guardrails and escalation gate.');

    const gate = applyEscalationGate({
      caseRecord,
      evaluation,
      thresholds: prepared.thresholds,
      quality,
      judgeDisposition: judge.disposition,
      judgeConfidence: judge.modelConfidence,
      agentOutputInvalid: false,
      providerFailure: false,
      unresolvedCitations: [],
    });

    await appendEvent(runId, {
      runId,
      actor: 'validator',
      type: 'guardrail:applied',
      summary:
        gate.hardBlockers.length > 0
          ? `Escalation gate applied: ${gate.hardBlockers.length} hard blocker(s).`
          : 'Escalation gate applied: no hard blockers.',
    });

    const resolution: Resolution = ResolutionSchema.parse({
      runId,
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      disposition: gate.disposition,
      recommendedRefundCents: gate.recommendedRefundCents,
      evidenceQualityScore: quality.total,
      confidenceBand: quality.band,
      requiresHumanReview: gate.requiresHumanReview,
      escalationReasons: gate.escalationReasons,
      judge,
      mode: run.mode,
      policyVersion: prepared.pack.version,
      promptVersion: PROMPT_VERSION,
      createdAt: new Date().toISOString(),
    });

    await updateRun(runId, (current) => ({
      ...current,
      judge,
      resolution,
      // Keep the monitor active until the settlement/reviewer task is durable.
      state: 'validating',
      stageTimingsMs: { ...current.stageTimingsMs, total: Date.now() - started },
    }));
    await appendEvent(runId, {
      runId,
      actor: 'system',
      type: 'resolution:ready',
      summary: `Resolution ready: ${resolution.disposition}.`,
    });

    // Turn the finished analysis into an operational outcome: either an
    // automatic simulated settlement, or exactly one open review task.
    const integrityAssessment = await integrityPromise!.catch(() => null as IntegrityAssessment | null);
    if (integrityAssessment) {
      await updateRun(runId, (current) => ({ ...current, integrityAssessment }));
      await appendEvent(runId, {
        runId,
        actor: 'system',
        type: 'integrity:assessed',
        summary: `Integrity assessment: ${integrityAssessment.overallSeverity} severity, ${integrityAssessment.signals.length} signal(s).`,
      });
    }

    const completed = (await updateRun(runId, (current) => current)) as RunRecord;
    const outcome = await applyCompletion(completed);

    return updateRun(runId, current => ({
      ...current, state: gate.requiresHumanReview ? 'escalated' : 'completed',
      stageTimingsMs: { ...current.stageTimingsMs, total: Date.now() - started },
      events: [...current.events, { runId, seq: current.events.length, at: new Date().toISOString(), actor: 'system', type: `case:${outcome.kind}`, summary: outcome.note }],
    }));
  } catch (error) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError(error instanceof Error ? error.message : String(error), 'transport');
    await updateRun(runId, (current) => ({
      ...current,
      state: 'validating',
      errorCode: providerError.code,
      errorMessage: providerError.message,
    }));
    await appendEvent(runId, {
      runId,
      actor: 'system',
      type: 'run:failed',
      summary: `Run failed (${providerError.code}): ${providerError.message}`,
    });

    // A failed run must not leave the case silently stranded.
    const failedIntegrity = await (integrityPromise ?? Promise.resolve(null)).catch(() => null);
    if (failedIntegrity) {
      await updateRun(runId, (current) => ({ ...current, integrityAssessment: failedIntegrity }));
    }

    const failed = (await updateRun(runId, (current) => current)) as RunRecord;
    const outcome = await applyCompletion({ ...failed, state: 'failed' });
    return updateRun(runId, current => ({
      ...current, state: 'failed',
      stageTimingsMs: { ...current.stageTimingsMs, total: Date.now() - started },
      events: [...current.events, { runId, seq: current.events.length, at: new Date().toISOString(), actor: 'system', type: `case:${outcome.kind}`, summary: outcome.note }],
    }));
  }
}

async function runAdvocate(args: {
  side: 'rider' | 'driver';
  runId: string;
  config: OrchestratorConfig;
  prepared: PreparedRun;
  context: ReturnType<typeof buildValidationContext>;
  spend: (count: number, role: AgentRole) => Promise<void>;
  onEvent: (type: string, summary: string) => Promise<unknown>;
}): Promise<import('../domain/contracts').AdvocateOutput | null> {
  const { side, runId, config, prepared, context, spend, onEvent } = args;
  const { caseRecord, evaluation, catalog, bundle, clauses } = prepared;

  if (!config.localEvidenceSelection) await spend(1, side);
  const selectionInput = SelectionInputSchema.parse({
    phase: 'select_evidence',
    side,
    category: caseRecord.category,
    catalog: toCatalogEntries(catalog),
    policyIds: bundle.policyIds,
  });

  const rawSelection = config.localEvidenceSelection ? {
    evidenceIds: catalog.filter(entry => entry.kind !== 'history').map(entry => entry.id),
    reasonSummary: 'Local selection includes all admissible case evidence and excludes account history from liability arguments.',
  } : (
    await invokeWithTelemetry({
      runId,
      config,
      repair: false,
      request: {
        role: side,
        stage: 'select_evidence',
        runId,
        systemInstruction: `${SHARED_RULES}\n\n${ADVOCATE_SELECTION(side)}`,
        input: selectionInput,
        allowedEvidenceIds: catalog.map((entry) => entry.id),
        timeoutMs: config.timeoutMs,
        maxOutputTokens: 1_200,
      },
    })
  ).output;

  let selection: AdvocateSelection | null = isAdvocateSelection(rawSelection)
    ? rawSelection
    : null;

  if (!selection) {
    await onEvent('evidence:selection_repair', 'Selection output malformed; attempting one bounded repair.');
    await spend(1, side);
    const repaired = (
      await invokeWithTelemetry({
        runId,
        config,
        repair: true,
        request: {
          role: side,
          stage: 'select_evidence',
          runId,
          systemInstruction: `${SHARED_RULES}\n\n${ADVOCATE_SELECTION(side)}\n\nReturn ONLY {"evidenceIds": [...], "reasonSummary": "..."}.`,
          input: selectionInput,
          allowedEvidenceIds: catalog.map((entry) => entry.id),
          timeoutMs: config.timeoutMs,
          maxOutputTokens: 1_200,
        },
      })
    ).output;
    selection = isAdvocateSelection(repaired) ? repaired : null;
  }

  if (!selection) {
    throw new ProviderError(
      `${side} advocate produced an invalid evidence selection`,
      'invalid_output',
    );
  }

  let retrieval = retrieveEvidence(selection.evidenceIds, caseRecord, evaluation);

  // One bounded follow-up request when the first selection missed the catalogue.
  if (retrieval.rejectedIds.length > 0 && retrieval.items.length === 0) {
    await onEvent('evidence:followup', 'Selection referenced unknown IDs; one bounded follow-up allowed.');
    await spend(1, side);
    const followUp = (
      await invokeWithTelemetry({
        runId,
        config,
        repair: true,
        request: {
          role: side,
          stage: 'select_evidence',
          runId,
          systemInstruction: `${SHARED_RULES}\n\n${ADVOCATE_SELECTION(side)}\n\nPrevious IDs were not in the catalogue: ${retrieval.rejectedIds.join(', ')}. Select only catalogue IDs.`,
          input: selectionInput,
          allowedEvidenceIds: catalog.map((entry) => entry.id),
          timeoutMs: config.timeoutMs,
          maxOutputTokens: 1_200,
        },
      })
    ).output;
    if (isAdvocateSelection(followUp)) {
      retrieval = retrieveEvidence(followUp.evidenceIds, caseRecord, evaluation);
      selection = followUp;
    }
  }

  await onEvent(
    'evidence:returned',
    `Requested ${selection.evidenceIds.length} item(s); ${retrieval.items.length} returned with ${retrieval.findings.length} material contradictory finding(s).${retrieval.rejectedIds.length ? ` Rejected ${retrieval.rejectedIds.length} unknown ID(s).` : ''}`,
  );

  await spend(1, side);
  const buildInput = AdvocateInputSchema.parse({
    phase: 'build_case',
    side,
    statement: side === 'rider' ? caseRecord.riderStatement : caseRecord.driverStatement,
    findings: toFindingRefs([
      ...evaluation.findings.filter((f) => retrieval.findings.some((r) => r.id === f.id)),
      ...evaluation.findings.filter((f) => f.kind === 'claim' && f.id.includes(side.toUpperCase())),
    ]),
    evidence: toCatalogEntries(catalog).filter((entry) =>
      retrieval.items.some((item) => item.id === entry.id),
    ),
    policyClauses: clauses,
    deterministic: bundle,
  });

  const raw = (
    await invokeWithTelemetry({
      runId,
      config,
      repair: false,
      request: {
        role: side,
        stage: 'build_case',
        runId,
        systemInstruction: `${SHARED_RULES}\n\n${side === 'rider' ? RIDER_ADVOCATE_FINAL : DRIVER_ADVOCATE_FINAL}`,
        input: buildInput,
        allowedEvidenceIds: catalog.map((entry) => entry.id),
        timeoutMs: config.timeoutMs,
        maxOutputTokens: 1_200,
      },
    })
  ).output;

  let result = validateAdvocateOutput(raw, context, side);
  if (!result.ok) {
    await onEvent('advocate:repair', `Advocate output invalid: ${result.errors.join(' ')} One bounded repair allowed.`);
    await spend(1, side);
    const repaired = (
      await invokeWithTelemetry({
        runId,
        config,
        repair: true,
        request: {
          role: side,
          stage: 'build_case',
          runId,
          systemInstruction: `${SHARED_RULES}\n\n${side === 'rider' ? RIDER_ADVOCATE_FINAL : DRIVER_ADVOCATE_FINAL}\n\nReturn ONLY the AdvocateOutput JSON. Previous attempt was rejected: ${result.errors.join(' ')}`,
          input: buildInput,
          allowedEvidenceIds: catalog.map((entry) => entry.id),
          timeoutMs: config.timeoutMs,
          maxOutputTokens: 1_200,
        },
      })
    ).output;
    result = validateAdvocateOutput(repaired, context, side);
  }

  if (!result.ok) {
    throw new ProviderError(
      `${side} advocate output remained invalid: ${result.errors.join(' ')}`,
      'invalid_output',
    );
  }

  return result.value;
}
