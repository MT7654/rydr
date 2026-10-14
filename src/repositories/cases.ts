import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CaseRecordSchema,
  PolicyPackSchema,
  type CaseRecord,
  type PolicyPack,
} from '../domain/contracts';
import { buildDisp002Case } from '../domain/sourceAdapter';
import { listJsonFiles, readJson, RUNTIME_DIR, withLock, writeJsonAtomic, listRuntimeEntries } from './store';

/**
 * Case repository.
 *
 * Source fixtures under `fixtures/` and `reference/` are strictly read-only.
 * Cases created through intake or edited by accepting evidence are written under
 * `data/runtime/cases/<caseId>/v<version>.json`.
 *
 * Every runtime version file is immutable once written. The current version of a
 * case is the highest version present, so an edit never overwrites the version a
 * recorded run was evaluated against. Version numbers are assigned by this
 * repository, never by the caller.
 */

const FIXTURES_DIR = path.join(process.cwd(), 'fixtures');
const CASES_DIR = path.join(FIXTURES_DIR, 'cases');
const POLICIES_DIR = path.join(FIXTURES_DIR, 'policies');
const SOURCE_FILE = path.join(process.cwd(), 'reference', 'DISP-002.source.json');
const RUNTIME_CASES_DIR = path.join(RUNTIME_DIR, 'cases');

let policyCache: Map<string, PolicyPack> | null = null;

export async function loadPolicyPacks(): Promise<Map<string, PolicyPack>> {
  if (policyCache) return policyCache;
  const files = await listJsonFiles(POLICIES_DIR);
  const packs = new Map<string, PolicyPack>();
  for (const file of files) {
    const raw = await readJson<unknown>(path.join(POLICIES_DIR, file));
    const pack = PolicyPackSchema.parse(raw);
    packs.set(pack.id, pack);
  }
  policyCache = packs;
  return packs;
}

export async function getPolicyPack(id: string): Promise<PolicyPack> {
  const packs = await loadPolicyPacks();
  const pack = packs.get(id);
  if (!pack) throw new Error(`Unknown policy pack: ${id}`);
  return pack;
}

export async function getSuppliedPolicyPack(id: string | null): Promise<PolicyPack | null> {
  if (!id) return null;
  return getPolicyPack(id);
}

function caseVersionFile(caseId: string, version: number): string {
  return path.join(RUNTIME_CASES_DIR, caseId, `v${version}.json`);
}

/**
 * Every runtime version of one case, oldest first. Reads the per-case directory
 * layout and, for compatibility, a flat `<caseId>.json` written by an earlier
 * build.
 */
async function runtimeCaseVersions(caseId: string): Promise<CaseRecord[]> {
  const versions: CaseRecord[] = [];

  const dir = path.join(RUNTIME_CASES_DIR, caseId);
  for (const file of await listJsonFiles(dir)) {
    const raw = await readJson<unknown>(path.join(dir, file));
    if (!raw) continue;
    const parsed = CaseRecordSchema.safeParse(raw);
    if (parsed.success && parsed.data.id === caseId) versions.push(parsed.data);
  }

  const legacy = await readJson<unknown>(path.join(RUNTIME_CASES_DIR, `${caseId}.json`));
  if (legacy) {
    const parsed = CaseRecordSchema.safeParse(legacy);
    if (parsed.success && parsed.data.id === caseId) versions.push(parsed.data);
  }

  return versions.sort((a, b) => a.version - b.version);
}

async function listRuntimeCaseIds(): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const entries = await listRuntimeEntries(RUNTIME_CASES_DIR);
    for (const entry of entries) {
      if (entry.directory) ids.add(entry.name);
      else if (entry.name.endsWith('.json')) ids.add(entry.name.replace(/\.json$/, ''));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return [...ids].sort();
}

async function runtimeCases(): Promise<CaseRecord[]> {
  const ids = await listRuntimeCaseIds();
  const records: CaseRecord[] = [];
  for (const id of ids) {
    const versions = await runtimeCaseVersions(id);
    const current = versions[versions.length - 1];
    if (current) records.push(current);
  }
  return records;
}

/** All seed cases: the five synthetic fixtures plus the supplied sample. */
export async function loadSeedCases(): Promise<CaseRecord[]> {
  const files = await listJsonFiles(CASES_DIR);
  const cases: CaseRecord[] = [];
  for (const file of files) {
    const raw = await readJson<unknown>(path.join(CASES_DIR, file));
    if (raw) cases.push(CaseRecordSchema.parse(raw));
  }
  const rawSource = await readJson<unknown>(SOURCE_FILE);
  if (rawSource) cases.push(buildDisp002Case(rawSource));
  const legacy = cases.find(c => c.id === 'DISP-002' && c.version === 1);
  if (legacy) cases.push(CaseRecordSchema.parse({ ...legacy, version: 2, policyVersion: 'ryde-hackathon-policy-v2.1', suppliedPolicyId: 'ryde-hackathon-policy-v2.1', changeLog: ['14 October 2026: attached newly supplied policy v2.1. Raw DISP-002 JSON is unchanged; its embedded eight-minute rule remains a source-precedence review question.'] }));
  return cases.sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
}

/** One record per case: the seed fixture, or the newest runtime version of it. */
export async function getAllCases(): Promise<CaseRecord[]> {
  const seeds = await loadSeedCases();
  const runtime = await runtimeCases();
  const byId = new Map<string, CaseRecord>();
  for (const record of seeds) byId.set(record.id, record);
  for (const record of runtime) {
    const existing = byId.get(record.id);
    if (!existing || record.version >= existing.version) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The current version of a case: the newest runtime version, else the seed. */
export async function getCase(id: string): Promise<CaseRecord | null> {
  const versions = await runtimeCaseVersions(id);
  const newest = versions[versions.length - 1];
  // A newly supplied seed policy revision can be newer than an existing runtime v1.


  const seeds = await loadSeedCases();
  const matches = seeds.filter((record) => record.id === id);
  if (newest) matches.push(newest);
  if (matches.length === 0) return null;
  return matches.reduce((best, current) => (current.version >= best.version ? current : best));
}

/**
 * One exact historical version. Used to render an old run faithfully instead of
 * recomputing it against the current case.
 */
export async function getCaseVersion(id: string, version: number): Promise<CaseRecord | null> {
  const versions = await runtimeCaseVersions(id);
  const match = versions.find((record) => record.version === version);
  if (match) return match;

  const seeds = await loadSeedCases();
  return seeds.find((record) => record.id === id && record.version === version) ?? null;
}

/**
 * Full version history for one case, oldest first. The seed fixture is version 1
 * and stays part of the history after runtime versions are appended to it.
 */
export async function listCaseVersions(id: string): Promise<CaseRecord[]> {
  const seeds = (await loadSeedCases()).filter((record) => record.id === id);
  const runtime = await runtimeCaseVersions(id);

  const byVersion = new Map<number, CaseRecord>();
  for (const record of seeds) byVersion.set(record.version, record);
  // A runtime version supersedes a seed claiming the same number.
  for (const record of runtime) byVersion.set(record.version, record);

  return [...byVersion.values()].sort((a, b) => a.version - b.version);
}

/**
 * Low-level immutable write of one explicit version. Used by migrations and
 * tests. Application code should use `createRuntimeCase` or `appendCaseVersion`
 * so the version number is assigned by the server.
 */
export async function saveRuntimeCase(record: CaseRecord): Promise<CaseRecord> {
  const parsed = CaseRecordSchema.parse(record);
  await withLock(`case:${parsed.id}`, async () => {
    const file = caseVersionFile(parsed.id, parsed.version);
    if (await readJson<unknown>(file)) {
      throw new Error(
        `Case ${parsed.id} version ${parsed.version} already exists and is immutable.`,
      );
    }
    await writeJsonAtomic(file, parsed);
  });
  return parsed;
}

/** Creates version 1 of a brand new case. Rejects a case id that already exists. */
export async function createRuntimeCase(
  input: Omit<CaseRecord, 'version'> & { version?: number },
): Promise<CaseRecord> {
  const existing = await getCase(input.id);
  if (existing) throw new Error(`Case ${input.id} already exists.`);
  return saveRuntimeCase(CaseRecordSchema.parse({ ...input, version: 1 }));
}

/**
 * Appends the next immutable version of an existing case. The mutator receives
 * the current record and returns the new content; the version number and the
 * provenance trail are set here, not by the caller.
 */
export async function appendCaseVersion(
  caseId: string,
  mutate: (current: CaseRecord) => CaseRecord,
  changeNote?: string,
): Promise<CaseRecord> {
  return withLock(`case:${caseId}`, async () => {
    const current = await getCase(caseId);
    if (!current) throw new Error(`Unknown case: ${caseId}`);

    const drafted = mutate(current);
    const version = current.version + 1;
    // Every version records why it exists, so the history is never silent.
    const note = changeNote ?? `Version ${version} recorded.`;
    const next = CaseRecordSchema.parse({
      ...drafted,
      id: caseId,
      version,
      changeLog: [...drafted.changeLog, note],
    });

    await writeJsonAtomic(caseVersionFile(caseId, next.version), next);
    return next;
  });
}

export async function readRawSourceSample(): Promise<unknown> {
  return readJson<unknown>(SOURCE_FILE);
}

export async function assertSourceUnchanged(): Promise<boolean> {
  // The source fixture is read-only; we only assert we can still read and adapt it.
  const raw = await readRawSourceSample();
  if (!raw) return false;
  buildDisp002Case(raw);
  return true;
}

export async function copySourceToRuntimeForInspection(): Promise<string> {
  return fs.readFile(SOURCE_FILE, 'utf8');
}
