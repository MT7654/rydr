import path from 'node:path';
import { CollectionJobSchema, type CollectionJob } from '../domain/collection';
import { listJsonFiles, readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';

const JOBS_DIR = path.join(RUNTIME_DIR, 'collection-jobs');

/**
 * Collection jobs are append-only audit records: what Rydr looked for, what the
 * source returned, and which case version that produced. They are deliberately
 * separate from runs, because a job completes *before* a run exists.
 */

function jobFile(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

export async function getCollectionJob(id: string): Promise<CollectionJob | null> {
  const raw = await readJson<unknown>(jobFile(id));
  if (!raw) return null;
  const parsed = CollectionJobSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function listCollectionJobsForCase(caseId: string): Promise<CollectionJob[]> {
  const files = await listJsonFiles(JOBS_DIR);
  const jobs: CollectionJob[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readJson<unknown>(path.join(JOBS_DIR, file));
    if (!raw) continue;
    const parsed = CollectionJobSchema.safeParse(raw);
    if (parsed.success && parsed.data.caseId === caseId) jobs.push(parsed.data);
  }
  return jobs.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** The most recent job for a case, which is the one the case page shows. */
export async function latestCollectionJob(caseId: string): Promise<CollectionJob | null> {
  const jobs = await listCollectionJobsForCase(caseId);
  return jobs[jobs.length - 1] ?? null;
}

export async function findCollectionJobByKey(key: string): Promise<CollectionJob | null> {
  const files = await listJsonFiles(JOBS_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readJson<unknown>(path.join(JOBS_DIR, file));
    if (!raw) continue;
    const parsed = CollectionJobSchema.safeParse(raw);
    if (parsed.success && parsed.data.idempotencyKey === key) return parsed.data;
  }
  return null;
}

export async function saveCollectionJob(job: CollectionJob): Promise<CollectionJob> {
  const parsed = CollectionJobSchema.parse(job);
  await withLock(`collection-job:${parsed.id}`, async () => {
    await writeJsonAtomic(jobFile(parsed.id), parsed);
  });
  return parsed;
}
