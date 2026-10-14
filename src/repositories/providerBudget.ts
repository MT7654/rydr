import { withIndependentDatabaseOperation } from './neon';
import path from 'node:path';
import { RUNTIME_DIR, readJson, writeJsonAtomic, withStorageSession, withLock } from './store';
/** Shared across visitors. A failed request still consumes its reserved attempt. */
export async function reserveProviderAttempt(now = new Date()): Promise<boolean> {
  return withIndependentDatabaseOperation(() => withStorageSession(null, () => withLock('provider-daily-budget', async () => {
    const file = path.join(RUNTIME_DIR, 'provider-daily-budget.json');
    const day = now.toISOString().slice(0,10);
    const rawLimit = Number(process.env.RYDR_MAX_PROVIDER_CALLS_PER_DAY ?? 200);
    const limit = Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 200;
    const previous = await readJson<{ day: string; attempts: number }>(file);
    const attempts = previous?.day === day ? previous.attempts : 0;
    if (attempts >= limit) return false;
    await writeJsonAtomic(file, { day, attempts: attempts + 1 }); return true;
  })));
}
