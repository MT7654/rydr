import path from 'node:path';
import {
  EvidenceRequestSchema,
  ReviewTaskSchema,
  type EvidenceRequest,
  type ReviewTask,
  type ReviewTaskKind,
  type ReviewTaskStatus,
  type TaskRouting,
} from '../domain/contracts';
import { classifyRouting } from '../domain/routing';
import { evaluateCase } from '../domain/policy';
import { getCase, getPolicyPack } from './cases';
import { listJsonFiles, readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';
import { listReviewRequests } from './reviewRequests';

const DIR = path.join(RUNTIME_DIR, 'review-tasks');
const REQUESTS_DIR = path.join(DIR, 'evidence-requests');
const MIGRATED_FILE = path.join(DIR, 'migrated-legacy.json');

/** A task in one of these states still needs reviewer work. */
const OPEN_STATUSES = new Set<ReviewTaskStatus>([
  'queued',
  'assigned',
  'awaiting_evidence',
  'ready',
]);

export function isOpenTask(task: ReviewTask): boolean {
  return OPEN_STATUSES.has(task.status);
}

/** Thrown when a caller acts on a task revision that is no longer current. */
export class StaleRevisionError extends Error {
  constructor(taskId: string) {
    super(
      `Task ${taskId} has changed since it was loaded. Reload the task and apply the action again.`,
    );
    this.name = 'StaleRevisionError';
  }
}

function taskFile(taskId: string): string {
  return path.join(DIR, `${taskId}.json`);
}

export async function getReviewTask(taskId: string): Promise<ReviewTask | null> {
  const raw = await readJson<unknown>(taskFile(taskId));
  return raw ? ReviewTaskSchema.parse(raw) : null;
}

export async function listReviewTasks(): Promise<ReviewTask[]> {
  const files = await listJsonFiles(DIR);
  const tasks: ReviewTask[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readJson<unknown>(path.join(DIR, file));
    if (!raw) continue;
    const parsed = ReviewTaskSchema.safeParse(raw);
    if (parsed.success) tasks.push(parsed.data);
  }
  return tasks.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function listReviewTasksForCase(caseId: string): Promise<ReviewTask[]> {
  const all = await listReviewTasks();
  return all.filter((task) => task.caseId === caseId);
}

/**
 * Finds the one open task for a case version, if any. Callers use this to
 * create-or-reuse rather than stacking duplicate escalation tasks.
 */
export async function findOpenTask(
  caseId: string,
  kind?: ReviewTaskKind,
): Promise<ReviewTask | null> {
  const tasks = await listReviewTasksForCase(caseId);
  const open = tasks.filter(isOpenTask);
  const scoped = kind ? open.filter((task) => task.kind === kind) : open;
  return scoped[scoped.length - 1] ?? null;
}

export interface EnsureTaskInput {
  submittedBy?: 'rider' | 'driver';
  caseId: string;
  caseVersion: number;
  runId: string | null;
  kind: ReviewTaskKind;
  reasonCodes: string[];
  reasonSummary: string;
  openQuestions?: string[];
  /** Highest integrity severity reported for this case version, if one ran. */
  integritySeverity?: 'none' | 'low' | 'medium' | 'high';
  /** Set for a targeted factual challenge. */
  challenge?: ReviewTask['challenge'];
}

/**
 * Computes the SLA routing for a task.
 *
 * Exported because a task's lane can legitimately change as new information
 * arrives (an integrity signal raised later, say), and the queue should reflect
 * that rather than freezing the original guess.
 */
export async function computeRouting(input: {
  caseId: string;
  openedAt: string;
  reasonCodes: string[];
  integritySeverity?: 'none' | 'low' | 'medium' | 'high';
}): Promise<TaskRouting | undefined> {
  const caseRecord = await getCase(input.caseId);
  if (!caseRecord) return undefined;
  const pack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source === 'supplied_sample') return undefined;

  return classifyRouting({
    caseRecord,
    evaluation: evaluateCase(caseRecord, pack),
    highValueCents: pack.thresholds.highValueCents,
    openedAt: input.openedAt,
    integrity: { severity: input.integritySeverity ?? 'none' },
    reasonCodes: input.reasonCodes,
  });
}

/**
 * Creates the review task for an escalation, or returns the existing open task
 * for the same case so a repeated escalation does not create duplicates.
 */
export async function ensureReviewTask(
  input: EnsureTaskInput,
): Promise<{ task: ReviewTask; created: boolean }> {
  const existing = await findOpenTask(input.caseId, input.kind);
  if (existing) return { task: existing, created: false };

  const now = new Date().toISOString();
  const routing = await computeRouting({
    caseId: input.caseId,
    openedAt: now,
    reasonCodes: input.reasonCodes,
    integritySeverity: input.integritySeverity,
  });

  const task = ReviewTaskSchema.parse({
    id: `task_${input.caseId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    runId: input.runId,
    kind: input.kind,
    status: 'queued',
    assigneeId: null,
    reasonCodes: input.reasonCodes,
    reasonSummary: input.reasonSummary,
    openQuestions: input.openQuestions ?? [],
    linkedDecisionId: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    ...(routing ? { routing } : {}),
    ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
    ...(input.challenge ? { challenge: input.challenge } : {}),
  });

  await withLock(`review-task:${task.id}`, async () => {
    await writeJsonAtomic(taskFile(task.id), task);
  });

  return { task, created: true };
}

/**
 * Mutates a task, enforcing optimistic concurrency. `expectedRevision` must
 * match the stored revision or the write is rejected as stale.
 */
export async function updateReviewTask(
  taskId: string,
  expectedRevision: number,
  mutator: (task: ReviewTask) => ReviewTask,
): Promise<ReviewTask> {
  return withLock(`review-task:${taskId}`, async () => {
    const current = await getReviewTask(taskId);
    if (!current) throw new Error(`Unknown review task: ${taskId}`);
    if (current.revision !== expectedRevision) throw new StaleRevisionError(taskId);

    const next = ReviewTaskSchema.parse({
      ...mutator(current),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    await writeJsonAtomic(taskFile(next.id), next);
    return next;
  });
}

/* ------------------------------------------------------------------ */
/*  Evidence requests                                                  */
/* ------------------------------------------------------------------ */

function requestsFile(taskId: string): string {
  return path.join(REQUESTS_DIR, `${taskId}.json`);
}

export async function listEvidenceRequests(taskId: string): Promise<EvidenceRequest[]> {
  return (await readJson<EvidenceRequest[]>(requestsFile(taskId))) ?? [];
}

export async function listEvidenceRequestsForCase(caseId: string): Promise<EvidenceRequest[]> {
  const tasks = await listReviewTasksForCase(caseId);
  const all = await Promise.all(tasks.map((task) => listEvidenceRequests(task.id)));
  return all.flat();
}

export async function createEvidenceRequest(input: {
  taskId: string;
  caseId: string;
  recipient: 'rider' | 'driver' | 'platform';
  question: string;
  evidenceType: string;
  whyItMatters: string;
}): Promise<EvidenceRequest> {
  const now = new Date().toISOString();
  const request = EvidenceRequestSchema.parse({
    id: `evreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    taskId: input.taskId,
    caseId: input.caseId,
    recipient: input.recipient,
    question: input.question,
    evidenceType: input.evidenceType,
    whyItMatters: input.whyItMatters,
    status: 'open',
    responseNote: null,
    responseEvidenceIds: [],
    createdAt: now,
    updatedAt: now,
  });

  await withLock(`evidence-requests:${input.taskId}`, async () => {
    const existing = await listEvidenceRequests(input.taskId);
    await writeJsonAtomic(requestsFile(input.taskId), [...existing, request]);
  });

  return request;
}

export async function updateEvidenceRequest(
  taskId: string,
  requestId: string,
  mutator: (request: EvidenceRequest) => EvidenceRequest,
): Promise<EvidenceRequest | null> {
  return withLock(`evidence-requests:${taskId}`, async () => {
    const existing = await listEvidenceRequests(taskId);
    const index = existing.findIndex((request) => request.id === requestId);
    if (index === -1) return null;
    const next = EvidenceRequestSchema.parse({
      ...mutator(existing[index]!),
      updatedAt: new Date().toISOString(),
    });
    const updated = [...existing];
    updated[index] = next;
    await writeJsonAtomic(requestsFile(taskId), updated);
    return next;
  });
}

/* ------------------------------------------------------------------ */
/*  Legacy migration                                                   */
/* ------------------------------------------------------------------ */

/**
 * Earlier builds only appended `pending_review` records with no owner or
 * action. They are migrated into real tasks so nothing stays stranded, and the
 * legacy records are left untouched as history.
 *
 * A legacy record is skipped when the case already carries an open task with the
 * same reason. Otherwise a request that has since become a proper task (an
 * appeal, say) would be migrated a second time and the queue would show the same
 * request twice.
 */
export async function migrateLegacyReviewRequests(): Promise<number> {
  const migrated = (await readJson<string[]>(MIGRATED_FILE)) ?? [];
  const seen = new Set(migrated);
  const created: string[] = [];

  const caseIds = await listJsonFiles(path.join(RUNTIME_DIR, 'review-requests'));
  for (const file of caseIds) {
    if (!file.endsWith('.json')) continue;
    const caseId = file.replace(/\.json$/, '');
    const requests = await listReviewRequests(caseId);
    for (const request of requests) {
      if (seen.has(request.id)) continue;

      const openTasks = await listReviewTasksForCase(request.caseId);
      const alreadyOpen = openTasks.some(
        (task) => isOpenTask(task) && task.reasonSummary.includes(request.reason),
      );
      if (!alreadyOpen) {
        await ensureReviewTask({
          caseId: request.caseId,
          caseVersion: 1,
          runId: request.runId,
          kind: 'party_request',
          reasonCodes: ['party_requested_review'],
          reasonSummary: request.reason,
          openQuestions: [],
        });
        created.push(request.id);
      }
      seen.add(request.id);
    }
  }

  if (created.length > 0) {
    await withLock('review-task-migration', async () => {
      await writeJsonAtomic(MIGRATED_FILE, Array.from(seen));
    });
  }

  return created.length;
}
