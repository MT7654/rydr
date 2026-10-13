import type { CaseRecord, EvidenceItem, PolicyPack } from '../domain/contracts';
import { evaluateCase } from '../domain/policy';
import { buildEvidencePlan } from '../domain/evidencePlan';
import {
  MAX_SOURCE_CALLS_PER_CYCLE,
  type CollectionJob,
  type SourceResult,
} from '../domain/collection';
import { getCase, getPolicyPack, appendCaseVersion } from '../repositories/cases';
import {
  findCollectionJobByKey,
  listCollectionJobsForCase,
  saveCollectionJob,
} from '../repositories/collectionJobs';
import { readSource } from '../tools/sourceTools';
import { planLiveCollection } from './collectionPlanner';
import { withLock } from '../repositories/store';

/**
 * The bounded evidence collection cycle.
 *
 * Runs **before** the adjudication run exists. It plans from the deterministic
 * blockers, consults at most four allowlisted simulated sources, and applies
 * whatever it actually retrieved as one idempotent new case version. The run
 * that follows is then frozen against that version, so collection never mutates
 * a case underneath an execution that has already started.
 *
 * It stops honestly. A missing record is reported as missing, a contradictory
 * record stops the cycle rather than being averaged away, and a policy gap is
 * escalated instead of being papered over with more telemetry.
 */

interface TelemetrySample {
  sampleId?: unknown;
  accuracyMeters?: unknown;
}

interface CommunicationAttempt {
  id?: unknown;
  timestamp?: unknown;
  sender?: unknown;
  direction?: unknown;
  answered?: unknown;
  ringSeconds?: unknown;
  content?: unknown;
}

interface FareComponent {
  component?: unknown;
  amountCents?: unknown;
  direction?: unknown;
  method?: unknown;
  status?: unknown;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export interface AppliedRecords {
  next: CaseRecord;
  /** Human-readable summary of what was folded in. */
  applied: string[];
  evidenceIds: string[];
}

/**
 * Folds retrieved source records into a candidate next version. Returns null
 * when nothing retrieved could change the case.
 *
 * These are *source* records, not party claims: inside the labelled demo
 * dataset a simulated source read is authoritative. Party submissions keep
 * their claim/verification status and are handled by `evidenceIntake` instead.
 */
export function applySourceRecords(
  caseRecord: CaseRecord,
  results: SourceResult[],
  jobId: string,
): AppliedRecords | null {
  const accuracyBySample = new Map<string, number>();
  const newEvidence: EvidenceItem[] = [];
  const applied: string[] = [];

  for (const result of results) {
    if (result.status !== 'found') continue;

    if (result.tool === 'trip_telemetry') {
      const samples = asArray<TelemetrySample>(
        (result.payload as { samples?: unknown } | null)?.samples,
      );
      let count = 0;
      for (const sample of samples) {
        if (typeof sample.sampleId !== 'string') continue;
        if (typeof sample.accuracyMeters !== 'number' || !Number.isFinite(sample.accuracyMeters)) {
          continue;
        }
        accuracyBySample.set(sample.sampleId, sample.accuracyMeters);
        count += 1;
      }
      if (count > 0) {
        applied.push(
          `trip-telemetry supplied an accuracy radius for ${count} GPS fix(es) (source records ${result.sourceRecordIds.join(', ') || 'unnamed'}).`,
        );
      }
    }

    if (result.tool === 'communications') {
      const attempts = asArray<CommunicationAttempt>(
        (result.payload as { attempts?: unknown } | null)?.attempts,
      );
      for (const attempt of attempts) {
        if (typeof attempt.id !== 'string') continue;
        if (caseRecord.evidence.some((item) => item.id === attempt.id)) continue;
        newEvidence.push({
          id: attempt.id,
          kind: 'call',
          timestamp: typeof attempt.timestamp === 'string' ? attempt.timestamp : null,
          source: {
            dataset: `fixtures/sources/${result.tripId}.json`,
            jsonPointer: `/tools/communications`,
            provenance: 'synthetic',
          },
          payload: {
            sender: attempt.sender === 'rider' || attempt.sender === 'driver' ? attempt.sender : 'system',
            direction: attempt.direction === 'incoming' ? 'incoming' : 'outgoing',
            answered: typeof attempt.answered === 'boolean' ? attempt.answered : null,
            ringSeconds: typeof attempt.ringSeconds === 'number' ? attempt.ringSeconds : null,
            content: typeof attempt.content === 'string' ? attempt.content : '',
          },
          qualityIssues: [
            `Supplied by the simulated communications source (job ${jobId}); the case record did not carry this attempt.`,
          ],
        });
        applied.push(`communications supplied contact attempt ${attempt.id}.`);
      }
    }

    if (result.tool === 'fare_ledger') {
      const components = asArray<FareComponent>(
        (result.payload as { components?: unknown } | null)?.components,
      );
      for (const component of components) {
        if (typeof component.component !== 'string') continue;
        if (typeof component.amountCents !== 'number') continue;
        const id = `SRC-${result.tripId}-${component.component}`.replace(/[^A-Za-z0-9_-]/g, '_');
        if (caseRecord.evidence.some((item) => item.id === id)) continue;
        newEvidence.push({
          id,
          kind: 'payment',
          timestamp: null,
          source: {
            dataset: `fixtures/sources/${result.tripId}.json`,
            jsonPointer: `/tools/fare_ledger`,
            provenance: 'synthetic',
          },
          payload: {
            component: component.component,
            amountCents: component.amountCents,
            direction: component.direction === 'refund' ? 'refund' : 'charge',
            method: typeof component.method === 'string' ? component.method : 'unknown',
            status: component.status === 'pending' || component.status === 'reversed' ? component.status : 'applied',
          },
          qualityIssues: [
            `Supplied by the simulated fare-ledger source (job ${jobId}); treated as authoritative within the demo dataset.`,
          ],
        });
        applied.push(`fare-ledger supplied component "${component.component}".`);
      }
    }

    // `effective_policy` is never auto-applied: an unresolved rule needs a
    // policy owner and an effective date, not a silent rewrite.
  }

  const evidence = caseRecord.evidence.map((item) => {
    if (item.kind !== 'gps') return item;
    const accuracy = accuracyBySample.get(item.id);
    if (accuracy === undefined) return item;
    return {
      ...item,
      payload: { ...item.payload, accuracyMeters: accuracy },
      qualityIssues: [
        ...item.qualityIssues.filter((issue) => !/accuracy/i.test(issue)),
        `Accuracy radius supplied by the simulated trip-telemetry source (job ${jobId}). The original fix coordinates are unchanged.`,
      ],
    };
  });

  const gpsChanged = evidence.some((item, index) => item !== caseRecord.evidence[index]);
  if (!gpsChanged && newEvidence.length === 0) return null;

  return {
    next: { ...caseRecord, evidence: [...evidence, ...newEvidence] },
    applied,
    evidenceIds: [
      ...evidence.filter((item, index) => item !== caseRecord.evidence[index]).map((item) => item.id),
      ...newEvidence.map((item) => item.id),
    ],
  };
}

/**
 * Runs one collection cycle for a case.
 *
 * Idempotent on `collect:<caseId>:v<version>`: a duplicate click reuses the job
 * that version already produced rather than spending a second cycle.
 */
export async function collectForCase(caseId: string, options: {mode?:string} = {}): Promise<CollectionJob> {
  return withLock('collect:'+caseId,()=>collectCaseVersion(caseId,options));
}
async function collectCaseVersion(caseId: string, options: {mode?:string}): Promise<CollectionJob> {
  const caseRecord = await getCase(caseId);
  if (!caseRecord) throw new Error(`Unknown case: ${caseId}`);
  const pack: PolicyPack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source === 'supplied_sample') {
    throw new Error(`Case ${caseId} is governed by a non-demo pack: ${pack.id}`);
  }

  const evaluation = evaluateCase(caseRecord, pack);
  const plan = buildEvidencePlan(caseRecord, evaluation);

  const idempotencyKey = `collect:${caseId}:v${caseRecord.version}`;
  const existing = await findCollectionJobByKey(idempotencyKey);
  if (existing) return existing;

  // The current version may itself be the product of an earlier cycle. Applying
  // the same records again would create a pointless second version, so a job
  // that already produced this version is reused rather than re-run.
  const produced = (await listCollectionJobsForCase(caseId)).find(
    (job) => job.resultingVersion === caseRecord.version,
  );
  if (produced) return produced;

  const now = new Date().toISOString();
  const base = {
    id: `job_${caseId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    caseId,
    startingVersion: caseRecord.version,
    conditions: plan.conditions,
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };

  // Safety routes to a person. It is never collected, and never monetised.
  if (plan.conditions.some((condition) => condition.kind === 'safety')) {
    return saveCollectionJob({
      ...base,
      status: 'blocked',
      stopReason: 'safety_routing',
      results: [],
      resultingVersion: null,
      toolCallCount: 0,
      note: 'Safety language is present, so this case is routed to a human reviewer without collection.',
    });
  }

  if (!plan.hasWork) {
    return saveCollectionJob({
      ...base,
      status: 'completed',
      stopReason: 'no_conditions',
      results: [],
      resultingVersion: null,
      toolCallCount: 0,
      note:
        plan.conditions.length === 0
          ? 'No unresolved material condition was identified, so no source was consulted.'
          : 'The unresolved conditions cannot be settled by any allowlisted source, so no source was consulted.',
    });
  }

  const planner=options.mode==='live'?await planLiveCollection(plan):undefined;
  const requests = planner?planner.requestIds.map(id=>plan.requests.find(r=>r.id===id)!):plan.requests.slice(0, MAX_SOURCE_CALLS_PER_CYCLE);
  const results: SourceResult[] = [];
  for (const request of requests) {
    results.push(await readSource(request));
  }

  const policyBlocked = plan.conditions.some(
    (condition) => condition.kind === 'policy_ambiguity',
  );
  const conflicted = results.find((result) => result.status === 'conflict');
  const unavailable = results.filter((result) => result.status === 'unavailable');
  const found = results.filter((result) => result.status === 'found');

  // Contradictory authoritative records stop the cycle. Averaging two sources
  // that disagree would invent a fact neither of them asserts.
  if (conflicted) {
    return saveCollectionJob({
      ...base,
      status: 'blocked',
      stopReason: 'conflict',
      planner,
      results,
      resultingVersion: null,
      toolCallCount: results.length,
      note: `The ${conflicted.tool} source returned contradictory records for this trip. Collection stopped without changing the case.`,
    });
  }

  const candidate = applySourceRecords(caseRecord, found, base.id);
  let resultingVersion: number | null = null;

  if (candidate) {
    const next = await appendCaseVersion(
      caseId,
      (current) => {if(current.version!==caseRecord.version)throw new Error('Case changed while collecting. Reopen current evidence before assessing.');return applySourceRecords(current, found, base.id)?.next ?? current;},
      `Evidence collection job ${base.id} applied source records: ${candidate.applied.join(' ')}`,
    );
    resultingVersion = next.version;
  }

  let status: CollectionJob['status'] = 'completed';
  let stopReason: CollectionJob['stopReason'] = resultingVersion ? 'resolved' : 'no_conditions';
  let note: string;

  if (policyBlocked) {
    status = 'blocked';
    stopReason = 'policy_ambiguity';
    note = resultingVersion
      ? `Collected what was available and applied it as v${resultingVersion}. The governing waiting clock is still undefined, so this needs a platform policy owner — more telemetry cannot settle it.`
      : 'The governing waiting clock is undefined. This is a policy gap, not a missing measurement, so it needs a platform policy owner rather than another source read.';
  } else if (resultingVersion) {
    note = `Applied retrieved source records as case v${resultingVersion}: ${candidate?.applied.join(' ')}`;
  } else if (unavailable.length > 0) {
    status = 'blocked';
    stopReason = 'unavailable';
    note = `The ${unavailable.map((result) => result.tool).join(', ')} source held no usable record for this trip. Nothing was fabricated, so the case remains unresolved.`;
  } else {
    note = 'The consulted sources returned no record that changes the case.';
  }

  return saveCollectionJob({
    ...base,
    status,
    stopReason,
    planner,
    results,
    resultingVersion,
    toolCallCount: results.length,
    note,
  });
}
