import path from 'node:path';
import {
  RunEventSchema,
  RunRecordSchema,
  type ExecutionMode,
  type RunEvent,
  type RunRecord,
  type RunState,
} from '../domain/contracts';
import { listJsonFiles, readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';

const RUNS_DIR = path.join(RUNTIME_DIR, 'runs');
const INDEX_FILE = path.join(RUNS_DIR, 'index.json');
const SESSION_FILE = path.join(RUNTIME_DIR, 'session.json');

interface RunIndex {
  byIdempotencyKey: Record<string, string>;
}

interface SessionState {
  externalCallCount: number;
}

async function readIndex(): Promise<RunIndex> {
  return (await readJson<RunIndex>(INDEX_FILE)) ?? { byIdempotencyKey: {} };
}

async function writeIndex(index: RunIndex): Promise<void> {
  await writeJsonAtomic(INDEX_FILE, index);
}

export function runFile(runId: string): string {
  return path.join(RUNS_DIR, `${runId}.json`);
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  const raw = await readJson<unknown>(runFile(runId));
  return raw ? RunRecordSchema.parse(raw) : null;
}

export async function listRuns(caseId?: string): Promise<RunRecord[]> {
  const files = await listJsonFiles(RUNS_DIR);
  const runs: RunRecord[] = [];
  for (const file of files) {
    if (file === 'index.json') continue;
    const raw = await readJson<unknown>(path.join(RUNS_DIR, file));
    if (!raw) continue;
    const run = RunRecordSchema.parse(raw);
    if (!caseId || run.caseId === caseId) runs.push(run);
  }
  return runs.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function findRunByIdempotencyKey(key: string): Promise<RunRecord | null> {
  const index = await readIndex();
  const runId = index.byIdempotencyKey[key];
  return runId ? getRun(runId) : null;
}

export async function latestRunForCase(caseId: string): Promise<RunRecord | null> {
  const runs = await listRuns(caseId);
  if (runs.length === 0) return null;
  return runs[runs.length - 1] ?? null;
}

export interface RunSelection {
  run: RunRecord | null;
  /**
   * False when the run returned is not the one the caller asked for — e.g. the
   * visitor requested a live run but only a fixture exists. Callers must keep a
   * fresh-run action available and label the run honestly when this is false.
   */
  matchesRequestedMode: boolean;
  /** True when a specific run id was requested but could not be used. */
  requestedRunUnavailable: boolean;
}

/**
 * Chooses which recorded run to display. Precedence: an explicit run id, then
 * the newest run matching the requested case version and mode, then the newest
 * run overall. Never pretends a run of another mode is the requested one.
 */
export async function selectRunForCase(
  caseId: string,
  options: { runId?: string | null; mode?: ExecutionMode; caseVersion?: number } = {},
): Promise<RunSelection> {
  const { runId, mode, caseVersion } = options;

  if (runId) {
    const requested = await getRun(runId);
    // A run belonging to another case is never shown against this one.
    if (requested && requested.caseId === caseId) {
      return {
        run: requested,
        matchesRequestedMode: !mode || requested.mode === mode,
        requestedRunUnavailable: false,
      };
    }
    return { run: null, matchesRequestedMode: false, requestedRunUnavailable: true };
  }

  const all = await listRuns(caseId);
  const scoped = caseVersion === undefined
    ? all
    : all.filter((run) => run.caseVersion === caseVersion);

  if (mode) {
    const matching = scoped.filter((run) => run.mode === mode);
    if (matching.length > 0) {
      return {
        run: matching[matching.length - 1] ?? null,
        matchesRequestedMode: true,
        requestedRunUnavailable: false,
      };
    }
  }

  const fallback = scoped.length > 0 ? scoped[scoped.length - 1] : (all[all.length - 1] ?? null);
  return {
    run: fallback ?? null,
    matchesRequestedMode: !mode || fallback?.mode === mode,
    requestedRunUnavailable: false,
  };
}

export interface CreateRunInput {
  caseId: string;
  caseVersion: number;
  mode: ExecutionMode;
  idempotencyKey: string;
  inputHash: string;
  policyVersion: string;
  promptVersion: string;
  provider: string;
}

export async function createRun(input: CreateRunInput): Promise<RunRecord> {
  const now = new Date().toISOString();
  const id = `run_${input.caseId}_${Date.now().toString(36)}`;
  const record: RunRecord = {
    id,
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    mode: input.mode,
    state: 'created',
    idempotencyKey: input.idempotencyKey,
    inputHash: input.inputHash,
    policyVersion: input.policyVersion,
    promptVersion: input.promptVersion,
    provider: input.provider,
    createdAt: now,
    updatedAt: now,
    errorCode: null,
    errorMessage: null,
    callCount: 0,
    advocates: { rider: null, driver: null },
    judge: null,
    resolution: null,
    stageTimingsMs: {},
    events: [],
  };

  await withLock(`run:${id}`, async () => {
    await writeJsonAtomic(runFile(id), record);
  });
  await withLock('run-index', async () => {
    const index = await readIndex();
    index.byIdempotencyKey[input.idempotencyKey] = id;
    await writeIndex(index);
  });
  return record;
}

/**
 * Mutates a run under a per-run lock and appends events with monotonically
 * increasing sequence numbers.
 */
export async function updateRun(
  runId: string,
  mutator: (run: RunRecord) => RunRecord,
): Promise<RunRecord> {
  return withLock(`run:${runId}`, async () => {
    const current = await getRun(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    const next = RunRecordSchema.parse({
      ...mutator(current),
      updatedAt: new Date().toISOString(),
    });
    await writeJsonAtomic(runFile(next.id), next);
    return next;
  });
}

export async function appendEvent(runId: string, event: Omit<RunEvent, 'seq' | 'at'>): Promise<RunRecord> {
  return updateRun(runId, (run) => {
    const record: RunEvent = RunEventSchema.parse({
      ...event,
      seq: run.events.length,
      at: new Date().toISOString(),
    });
    return { ...run, events: [...run.events, record] };
  });
}

export async function transition(
  runId: string,
  state: RunState,
  summary: string,
  actor: RunEvent['actor'] = 'system',
): Promise<RunRecord> {
  await updateRun(runId, (run) => ({ ...run, state }));
  return appendEvent(runId, { runId, actor, type: `state:${state}`, summary });
}

/** Shared, atomic session call budget. Never silently falls back to fixture mode. */
export async function reserveCalls(count: number, limit: number): Promise<boolean> {
  return withLock('session-budget', async () => {
    const current = (await readJson<SessionState>(SESSION_FILE)) ?? { externalCallCount: 0 };
    if (current.externalCallCount + count > limit) return false;
    await writeJsonAtomic(SESSION_FILE, {
      externalCallCount: current.externalCallCount + count,
    });
    return true;
  });
}

export async function sessionCallCount(): Promise<number> {
  const current = await readJson<SessionState>(SESSION_FILE);
  return current?.externalCallCount ?? 0;
}
