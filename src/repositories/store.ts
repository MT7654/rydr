import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DEMO_SESSION_COOKIE, validDemoSession } from '../domain/demoAccess';

/**
 * Local JSON persistence for a single local demo process.
 *
 * Writes are atomic (temp file + rename) and serialised per key so concurrent
 * requests cannot interleave partial writes. This is acceptable for one local
 * process only; a deployed app needs durable storage chosen for its host.
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
  return storageScope.run(session, task);
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
  await fs.mkdir(await scopeRuntimePath(dir), { recursive: true });
}

export async function readJson<T>(file: string): Promise<T | null> {
  file = await scopeRuntimePath(file);
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
