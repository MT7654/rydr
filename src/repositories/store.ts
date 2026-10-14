import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { storageBackend, withDatabaseReads, withDatabaseTransaction, readDatabaseJson, writeDatabaseJson, listDatabaseKeys } from './neon';
import { putPrivateObject, getPrivateObject } from './objectStorage';
import { DEMO_SESSION_COOKIE, validDemoSession } from '../domain/demoAccess';

/**
 * Backend-dependent persistence: local atomic JSON files for one process,
 * or Neon Postgres transactions and private object storage for hosted state.
 * Visitor namespaces and immutable source fixtures are preserved in both modes.
 */

/**
 * Tests point this at a scratch directory via RYDR_RUNTIME_DIR so they never
 * touch the app's own demo state.
 */
export const RUNTIME_DIR = process.env.RYDR_RUNTIME_DIR
  ? path.resolve(process.cwd(), process.env.RYDR_RUNTIME_DIR)
  : path.join(process.cwd(), 'data', 'runtime');

const locks = new Map<string, Promise<unknown>>();
const storageScope = new AsyncLocalStorage<string | null>();

/** Explicit scope also pins detached agent work to its originating visitor. */
export function withStorageSession<T>(session: string | null, task: () => T): T {
  if (session !== null && !validDemoSession(session)) throw new Error('Invalid demo session.');
  if (storageScope.getStore() === session) return task();
  return storageScope.run(session, () => withDatabaseReads(task));
}

export async function currentStorageSession(): Promise<string | null> {
  const explicit = storageScope.getStore();
  if (explicit !== undefined) return explicit;
  // Domain tests and command-line evaluation keep their existing isolated root.
  if (process.env.NODE_ENV === 'test') return null;
  let value: string | undefined;
  try {
    const { cookies } = await import('next/headers');
    value = (await cookies()).get(DEMO_SESSION_COOKIE)?.value;
  } catch (error) {
    if (error instanceof Error && /outside a request scope/i.test(error.message)) return null;
    throw error;
  }
  if (!validDemoSession(value)) throw new Error('Enter a demo role to start your own session.');
  return value;
}

/** Map logical repository paths into the current visitor's namespace. */
export async function scopeRuntimePath(file: string): Promise<string> {
  const session = await currentStorageSession();
  const resolved = path.resolve(file);
  if (!session) return resolved;
  const relative = path.relative(RUNTIME_DIR, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    const immutable = ['fixtures','reference'].some(folder => {
      const rel = path.relative(path.join(process.cwd(), folder), resolved);
      return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
    });
    if (immutable) return resolved;
    throw new Error('This path is outside the demo session storage.');
  }
  const parts = relative.split(path.sep);
  if (parts[0] === 'demo-sessions') {
    if (parts[1] !== session) throw new Error('This record belongs to another demo session.');
    return resolved;
  }
  return path.join(RUNTIME_DIR, 'demo-sessions', session, relative);
}

/** Read/write retry budgets for the torn-read window described below. */
const READ_ATTEMPTS = 6;
const READ_RETRY_MS = 12;
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 12;

export async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const session = await currentStorageSession();
  if (storageBackend() === 'neon') return withDatabaseTransaction(session ?? 'global', () => withStorageSession(session, task));
  key = `${session ?? 'local'}:${key}`;
  const previous = locks.get(key) ?? Promise.resolve();
  const scopedTask = () => withStorageSession(session, task);
  const current = previous.then(scopedTask, scopedTask);
  locks.set(
    key,
    current.catch(() => undefined),
  );
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

export async function ensureDir(dir: string): Promise<void> {
  if (storageBackend() === 'neon' && runtimeKey(await scopeRuntimePath(dir)) !== null) return;
  await fs.mkdir(await scopeRuntimePath(dir), { recursive: true });
}

export async function readJson<T>(file: string): Promise<T | null> {
  file = await scopeRuntimePath(file);
  const key = runtimeKey(file);
  if (storageBackend() === 'neon' && key !== null) return readDatabaseJson<T>(key);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      lastError = error;
      // A write in flight can briefly expose an empty or partial file when the
      // rename-over-existing fallback below has to be used. Retry before
      // concluding the content is really malformed: a genuinely corrupt file
      // still fails every attempt.
      await delay(READ_RETRY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

/** Resolves after `ms`, so a retry gives an in-flight writer time to finish. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renames `tmp` onto `file`, retrying briefly. Windows refuses the rename while
 * another handle holds the destination open, and the reader that caused that is
 * usually milliseconds from finishing.
 */
async function renameWithRetry(tmp: string, file: string): Promise<boolean> {
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(tmp, file);
      return true;
    } catch {
      await delay(RENAME_RETRY_MS * (attempt + 1));
    }
  }
  return false;
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  file = await scopeRuntimePath(file);
  const key = runtimeKey(file);
  if (storageBackend() === 'neon' && key !== null) { await writeDatabaseJson(key, value); return; }
  await ensureDir(path.dirname(file));
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (await renameWithRetry(tmp, file)) return;
  // Last resort. copyFile is not atomic, so a reader may see a partial file —
  // readJson retries to absorb that window.
  await fs.copyFile(tmp, file);
  await fs.rm(tmp, { force: true });
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  dir = await scopeRuntimePath(dir);
  const key = runtimeKey(dir);
  if (storageBackend() === 'neon' && key !== null) {
    const prefix = key ? key + '/' : '';
    return (await listDatabaseKeys(prefix)).map(file => file.slice(prefix.length)).filter(file => !file.includes('/') && file.endsWith('.json'));
  }
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function tmpDir(): string {
  return os.tmpdir();
}

/** Stable logical keys, independent of host OS and deployment checkout path. */
function runtimeKey(file: string): string | null {
  const relative = path.relative(RUNTIME_DIR, path.resolve(file));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}
export async function listRuntimeEntries(dir: string): Promise<Array<{ name: string; directory: boolean }>> {
  const scoped = await scopeRuntimePath(dir), key = runtimeKey(scoped);
  if (storageBackend() === 'neon' && key !== null) {
    const prefix = key ? key + '/' : '', found = new Map<string, boolean>();
    for (const file of await listDatabaseKeys(prefix)) {
      const rest = file.slice(prefix.length), name = rest.split('/')[0];
      if (name) found.set(name, rest.includes('/'));
    }
    return [...found].map(([name, directory]) => ({ name, directory }));
  }
  try { return (await fs.readdir(scoped, { withFileTypes: true })).map(entry => ({ name: entry.name, directory: entry.isDirectory() })); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export async function writeBinary(file: string, bytes: Buffer, contentType: string): Promise<void> {
  const scoped = await scopeRuntimePath(file), key = runtimeKey(scoped);
  if (key === null) throw new Error('Binary writes must be in runtime storage.');
  if (storageBackend() === 'neon') { await putPrivateObject(key, bytes, contentType); return; }
  await ensureDir(path.dirname(scoped));
  await fs.writeFile(scoped, bytes, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
}
export async function readBinary(file: string): Promise<Buffer> {
  const scoped = await scopeRuntimePath(file), key = runtimeKey(scoped);
  if (key === null) throw new Error('Binary reads must be in runtime storage.');
  return storageBackend() === 'neon' ? getPrivateObject(key) : fs.readFile(scoped);
}
