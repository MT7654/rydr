import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

type Transaction = { client: PoolClient; namespace: string; scope: string; afterCommit: Array<() => void> };
const transactions = new AsyncLocalStorage<Transaction | undefined>();
type ReadCache = { records: Map<string, unknown>; prefixes: Map<string, Promise<string[]>> };
const reads = new AsyncLocalStorage<ReadCache>();
export function withDatabaseReads<T>(task: () => T): T { return reads.getStore() ? task() : reads.run({ records: new Map(), prefixes: new Map() }, task); }
let pool: Pool | undefined;
export function storageBackend(): 'file' | 'neon' {
  const configured = process.env.RYDR_STORAGE_BACKEND;
  if (configured && configured !== 'file' && configured !== 'neon') throw new Error('Invalid RYDR_STORAGE_BACKEND.');
  if (configured === 'file') {
    if (process.env.VERCEL) throw new Error('Vercel requires Neon storage; local file mode is unavailable.');
    return 'file';
  }
  const enabled = configured === 'neon' || (process.env.NODE_ENV !== 'test' && !!process.env.DATABASE_URL);
  if (enabled && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Neon storage.');
  if (!enabled && process.env.VERCEL) throw new Error('Configure DATABASE_URL before deploying Rydr.');
  return enabled ? 'neon' : 'file';
}
export function storageNamespace(): string {
  const value = process.env.RYDR_STORAGE_NAMESPACE ?? 'rydr';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error('Invalid storage namespace.');
  return value;
}
export function databasePool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    const url = new URL(process.env.DATABASE_URL);
    if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
    pool = new Pool({ connectionString: url.toString(), max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
    if (process.env.VERCEL) attachDatabasePool(pool);
    pool.on('error', () => { /* Operations surface failures without logging connection secrets. */ });
  }
  return pool;
}
export function databaseClient(): Pool | PoolClient {
  return transactions.getStore()?.client ?? databasePool();
}
/** Every mutation in one visitor namespace is serialized across app instances.
 * Nested repository locks share the transaction, so stale reviewer writes roll back together.
 * A database transaction is never held for a detached provider invocation.
 */
export async function withDatabaseTransaction<T>(scope: string, task: () => Promise<T>): Promise<T> {
  const namespace = storageNamespace();
  const existing = transactions.getStore();
  if (existing) {
    if (existing.namespace !== namespace || existing.scope !== scope) throw new Error('Cannot switch storage scope inside a transaction.');
    return task();
  }
  const client = await databasePool().connect();
  const state: Transaction = { client, namespace, scope, afterCommit: [] };
  const parentReads = reads.getStore();
  let result: T;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '20s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`rydr:${namespace}:${scope}`]);
    result = await transactions.run(state, () => reads.run({ records: new Map(), prefixes: new Map() }, task));
    await client.query('COMMIT');
    parentReads?.records.clear(); parentReads?.prefixes.clear();
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
  for (const callback of state.afterCommit) transactions.run(undefined, callback);
  return result;
}
/** Start background work only after the enclosing reviewer/run-start transaction commits. */
export function afterStorageCommit(task: () => void): void {
  const state = transactions.getStore();
  if (state) state.afterCommit.push(task);
  else transactions.run(undefined, task);
}
export async function readDatabaseJson<T>(key: string): Promise<T | null> {
  const cache = reads.getStore(), cacheKey = storageNamespace() + ':' + key;
  if (cache?.records.has(cacheKey)) return structuredClone(cache.records.get(cacheKey) as T | null);
  const result = await databaseClient().query<{ value: T }>('SELECT value FROM rydr_records WHERE namespace=$1 AND key=$2', [storageNamespace(), key]);
  const value = result.rows[0]?.value ?? null;
  cache?.records.set(cacheKey, value);
  return structuredClone(value);
}
export async function writeDatabaseJson(key: string, value: unknown): Promise<void> {
  await databaseClient().query('INSERT INTO rydr_records(namespace,key,value) VALUES($1,$2,$3::jsonb) ON CONFLICT(namespace,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [storageNamespace(), key, JSON.stringify(value)]);
  const cache = reads.getStore();
  cache?.records.set(storageNamespace() + ':' + key, structuredClone(value)); cache?.prefixes.clear();
}
export async function listDatabaseKeys(prefix: string): Promise<string[]> {
  const cache = reads.getStore(), cacheKey = storageNamespace() + ':' + prefix;
  const existing = cache?.prefixes.get(cacheKey); if (existing) return existing;
  const query = (async () => {
    const result = await databaseClient().query<{ key: string; value: unknown }>('SELECT key,value FROM rydr_records WHERE namespace=$1 AND starts_with(key,$2) ORDER BY key', [storageNamespace(), prefix]);
    for (const row of result.rows) cache?.records.set(storageNamespace() + ':' + row.key, row.value);
    return result.rows.map(row => row.key);
  })();
  cache?.prefixes.set(cacheKey, query);
  try { return await query; } catch (error) { cache?.prefixes.delete(cacheKey); throw error; }
}
