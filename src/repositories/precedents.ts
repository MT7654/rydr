import path from 'node:path';
import { PrecedentRecordSchema, type PrecedentRecord } from '../domain/precedent';
import { listJsonFiles, readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';

const DIR = path.join(RUNTIME_DIR, 'precedents');
const SEED_DIR = path.join(process.cwd(), 'fixtures', 'precedents');

/**
 * Precedent storage. Candidates, approved examples, rejected proposals and
 * retired records all live here together, distinguished by `status`, so the
 * history of a correction is never destroyed by a later rollback.
 */

function file(id: string): string {
  return path.join(DIR, `${id}.json`);
}

export async function getPrecedent(id: string): Promise<PrecedentRecord | null> {
  const raw = await readJson<unknown>(file(id)) ?? await readJson<unknown>(path.join(SEED_DIR, `${id}.json`));
  if (!raw) return null;
  const parsed = PrecedentRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function listPrecedents(): Promise<PrecedentRecord[]> {
  const files = await listJsonFiles(DIR);
  const seeds = await listJsonFiles(SEED_DIR);
  const records: PrecedentRecord[] = [];
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const raw = await readJson<unknown>(path.join(DIR, name));
    if (!raw) continue;
    const parsed = PrecedentRecordSchema.safeParse(raw);
    if (parsed.success) records.push(parsed.data);
  }
  const seeded: PrecedentRecord[] = [];
  for (const name of seeds) {
    const parsed = PrecedentRecordSchema.safeParse(await readJson<unknown>(path.join(SEED_DIR, name)));
    if (parsed.success) seeded.push(parsed.data);
  }
  const byId = new Map([...seeded, ...records].map(record => [record.id, record]));
  return [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/**
 * The examples retrieval may use. Everything else — candidates, rejected
 * proposals, retired records — is deliberately invisible to the Judge.
 */
export async function listApprovedPrecedents(): Promise<PrecedentRecord[]> {
  return (await listPrecedents()).filter((record) => record.status === 'approved');
}

export async function listCandidates(): Promise<PrecedentRecord[]> {
  return (await listPrecedents()).filter((record) => record.status === 'candidate');
}

export async function savePrecedent(record: PrecedentRecord): Promise<PrecedentRecord> {
  const parsed = PrecedentRecordSchema.parse(record);
  await withLock(`precedent:${parsed.id}`, async () => {
    await writeJsonAtomic(file(parsed.id), parsed);
  });
  return parsed;
}

export async function createCandidate(
  input: Omit<PrecedentRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
): Promise<PrecedentRecord> {
  const now = new Date().toISOString();
  return savePrecedent(
    PrecedentRecordSchema.parse({
      ...input,
      id: `prec_${input.caseId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      status: 'candidate',
      createdAt: now,
      updatedAt: now,
    }),
  );
}

/**
 * Finds an existing candidate for the same case version, so pressing "record
 * override" twice does not stack duplicate proposals for one correction.
 */
export async function findCandidateForCaseVersion(
  caseId: string,
  caseVersion: number,
): Promise<PrecedentRecord | null> {
  const candidates = await listCandidates();
  return (
    candidates.find(
      (record) => record.caseId === caseId && record.caseVersion === caseVersion,
    ) ?? null
  );
}

export async function updatePrecedent(
  id: string,
  mutator: (record: PrecedentRecord) => PrecedentRecord,
): Promise<PrecedentRecord> {
  return withLock(`precedent:${id}`, async () => {
    const current = await getPrecedent(id);
    if (!current) throw new Error(`Unknown precedent: ${id}`);
    const next = PrecedentRecordSchema.parse({
      ...mutator(current),
      updatedAt: new Date().toISOString(),
    });
    await writeJsonAtomic(file(next.id), next);
    return next;
  });
}
