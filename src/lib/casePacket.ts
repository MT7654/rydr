import type {
  CaseBusinessStatus,
  CaseDecision,
  CaseRecord,
  CatalogEntrySnapshot,
  EvidenceRequest,
  IntegrityAssessment,
  PolicyPack,
  ProviderCallRecord,
  ReviewTask,
  RunRecord,
  RunSnapshot,
  PrecedentManifest,
  Settlement,
} from '@/domain/contracts';
import type { DeterministicEvaluation } from '@/domain/policy';
import type { QualityScore } from '@/domain/confidence';
import type {
  CollectionJob,
  EvidencePlan,
  SensitivityScenario,
} from '@/domain/collection';
import { evaluateCase } from '@/domain/policy';
import { scoreEvidence } from '@/domain/confidence';
import { buildEvidencePlan } from '@/domain/evidencePlan';
import { buildSensitivityScenarios } from '@/domain/sensitivity';
import { deriveCaseStatus } from '@/domain/caseStatus';
import { buildCatalog } from '@/agents/evidenceService';
import { getCase, getCaseVersion, getPolicyPack } from '@/repositories/cases';
import { listCollectionJobsForCase } from '@/repositories/collectionJobs';
import { selectRunForCase } from '@/repositories/runs';
import { getRunSnapshot, snapshotPolicyIntact } from '@/repositories/snapshots';
import { listProviderCalls } from '@/repositories/providerCalls';
import { listEvidenceRequestsForCase, listReviewTasksForCase } from '@/repositories/reviewTasks';
import { effectiveDecisionForCase, listDecisionsForCase, listSettlementsForCase } from '@/repositories/ledger';

const OPEN_TASK_STATUSES = new Set(['queued', 'assigned', 'awaiting_evidence', 'ready']);

export interface CasePacket {
  caseRecord: CaseRecord;
  pack: PolicyPack;
  evaluation: DeterministicEvaluation;
  quality: QualityScore;
  catalog: CatalogEntrySnapshot[];
  run: RunRecord | null;
  snapshot: RunSnapshot | null;
  /**
   * True when this packet is rendered from a run's frozen snapshot rather than
   * from the case as it stands now. Historical views must not silently switch
   * to the current case, and current views must not silently use old findings.
   */
  renderedFromSnapshot: boolean;
  /** Case version the case is at now, which may be newer than the view. */
  currentCaseVersion: number;
  /** True when the case has moved on since this run was evaluated. */
  supersededByNewerCase: boolean;
  /** True when the displayed run predates the case's current version. */
  runStaleAgainstCurrentVersion: boolean;
  /** True when the frozen policy pack no longer matches the pack on disk. */
  policyChangedSinceRun: boolean;
  providerCalls: ProviderCallRecord[];
  tasks: ReviewTask[];
  openTask: ReviewTask | null;
  evidenceRequests: EvidenceRequest[];
  decisions: CaseDecision[];
  effectiveDecision: CaseDecision | null;
  settlements: Settlement[];
  allSettlements: Settlement[];
  hasOpenAppeal: boolean;
  status: CaseBusinessStatus;
  /**
   * The collection job behind the displayed case version, if collection has run.
   * Frozen: it records the conditions and source reads of that cycle, so the
   * page never recomputes history against a case that has since resolved.
   */
  collectionJob: CollectionJob | null;
  /** The plan as it stands now — what collection would look for next. */
  collectionPlan: EvidencePlan;
  /** Read-only "would the outcome change if…" scenarios for the displayed case. */
  sensitivity: SensitivityScenario[];
  /**
   * Precedent context frozen into the displayed run's snapshot, or null when
   * that run recorded none (or has no snapshot). Read-only: it is never
   * re-retrieved, so a later approval or rollback cannot rewrite what the run
   * appears to have been shown.
   */
  runPrecedents: PrecedentManifest | null;
  /**
   * Integrity assessment from the displayed run, or null when the run has none.
   * Absent on runs created before integrity assessment existed.
   */
  integrityAssessment: IntegrityAssessment | null;
}

export interface LoadCasePacketOptions {
  /** Pin the packet to one recorded run, rendering its frozen snapshot. */
  runId?: string | null;
}

/**
 * Everything a reviewer or party screen needs about one case, in one read.
 *
 * When `runId` names a run that has a snapshot, the packet is built from that
 * snapshot: the case version, policy pack and findings the run actually
 * evaluated. Nothing is recomputed against the current case, so an old report
 * stays faithful after an edit.
 */
export async function loadCasePacket(
  caseId: string,
  options: LoadCasePacketOptions = {},
): Promise<CasePacket | null> {
  const currentCase = await getCase(caseId);
  if (!currentCase) return null;

  const selection = await selectRunForCase(caseId, {
    runId: options.runId ?? null,
    caseVersion: options.runId ? undefined : currentCase.version,
  });

  const snapshot = selection.run ? await getRunSnapshot(selection.run.id) : null;
  const pinnedByRunId = Boolean(options.runId);
  // Render from the snapshot when the caller pinned a run, or when the run was
  // evaluated against the version the case is still at. A run left behind by a
  // newer case version is *not* used to answer "what does this case say now" —
  // it is surfaced as a stale run instead, so the page can offer a fresh review.
  const renderedFromSnapshot = Boolean(
    snapshot &&
      selection.run?.caseId === caseId &&
      (pinnedByRunId || snapshot.caseVersion === currentCase.version),
  );

  let caseRecord = currentCase;
  let pack: PolicyPack;
  let evaluation: DeterministicEvaluation;
  let quality: QualityScore;
  let catalog: CatalogEntrySnapshot[];
  let policyChangedSinceRun = false;

  if (renderedFromSnapshot && snapshot) {
    caseRecord = snapshot.caseRecord;
    pack = snapshot.policyPack;
    evaluation = snapshot.evaluation as DeterministicEvaluation;
    quality = snapshot.quality as QualityScore;
    catalog = snapshot.catalog;
    if (pack.source === 'supplied_sample') return null;
    const livePack = await getPolicyPack(pack.id).catch(() => null);
    policyChangedSinceRun = !snapshotPolicyIntact(snapshot, livePack);
  } else {
    const resolvedPack = await getPolicyPack(currentCase.policyVersion);
    if (resolvedPack.source === 'supplied_sample') return null;
    pack = resolvedPack;
    evaluation = evaluateCase(currentCase, pack);
    quality = scoreEvidence(currentCase, evaluation, pack.thresholds);
    catalog = buildCatalog(currentCase);
  }

  const tasks = await listReviewTasksForCase(caseId);
  const evidenceRequests = await listEvidenceRequestsForCase(caseId);
  const decisions = await listDecisionsForCase(caseId);
  const effectiveDecision = await effectiveDecisionForCase(caseId);
  const allSettlements = await listSettlementsForCase(caseId);
  const providerCalls = selection.run ? await listProviderCalls(selection.run.id) : [];

  const jobs = await listCollectionJobsForCase(caseId);
  // The job that explains the displayed version: the one that produced it, or
  // the one that ran against it and changed nothing (a blocked cycle).
  const collectionJob =
    jobs.find((job) => job.resultingVersion === caseRecord.version) ??
    jobs.filter((job) => job.startingVersion === caseRecord.version).pop() ??
    null;

  const collectionPlan = buildEvidencePlan(caseRecord, evaluation);
  const sensitivity = buildSensitivityScenarios(caseRecord, pack, evaluation);

  const settlements = effectiveDecision
    ? allSettlements.filter((settlement) => settlement.decisionId === effectiveDecision.id)
    : [];

  const openTask = tasks.filter((task) => OPEN_TASK_STATUSES.has(task.status)).pop() ?? null;
  const hasOpenAppeal = tasks.some(
    (task) => task.kind === 'appeal' && OPEN_TASK_STATUSES.has(task.status),
  );

  const status = deriveCaseStatus({
    runState: selection.run?.state ?? null,
    tasks,
    effectiveDecision,
    settlements,
    hasOpenAppeal,
  });

  return {
    caseRecord,
    pack,
    evaluation,
    quality,
    catalog,
    run: selection.run,
    snapshot: snapshot ?? null,
    renderedFromSnapshot,
    currentCaseVersion: currentCase.version,
    supersededByNewerCase: renderedFromSnapshot && caseRecord.version < currentCase.version,
    runStaleAgainstCurrentVersion: Boolean(
      selection.run && selection.run.caseVersion < currentCase.version,
    ),
    policyChangedSinceRun,
    providerCalls,
    tasks,
    openTask,
    evidenceRequests,
    decisions,
    effectiveDecision,
    settlements,
    allSettlements,
    hasOpenAppeal,
    status,
    collectionJob,
    collectionPlan,
    sensitivity,
    runPrecedents: snapshot?.precedents ?? null,
    integrityAssessment: selection.run?.integrityAssessment ?? null,
  };
}

/** Loads every case packet at its current version. */
export async function loadAllCasePackets(): Promise<CasePacket[]> {
  const { currentStorageSession, withStorageSession } = await import('@/repositories/store');
  return withStorageSession(await currentStorageSession(), loadAllCasePacketsUncached);
}

async function loadAllCasePacketsUncached(): Promise<CasePacket[]> {
  const { getAllCases } = await import('@/repositories/cases');
  const cases = await getAllCases();
  const packets = await Promise.all(cases.map((record) => loadCasePacket(record.id)));
  return packets.filter((packet): packet is CasePacket => packet !== null);
}

/** One exact historical case version, with the pack it named. */
export async function loadCaseVersionPacket(
  caseId: string,
  version: number,
): Promise<{ caseRecord: CaseRecord; pack: PolicyPack } | null> {
  const caseRecord = await getCaseVersion(caseId, version);
  if (!caseRecord) return null;
  const pack = await getPolicyPack(caseRecord.policyVersion);
  return { caseRecord, pack };
}
