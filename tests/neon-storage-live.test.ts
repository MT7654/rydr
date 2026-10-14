import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import nextEnv from '@next/env';

const enabled = process.env.RUN_NEON_STORAGE_TESTS === '1';
let store: typeof import('../src/repositories/store');
let neon: typeof import('../src/repositories/neon');
const session = randomUUID();
describe.skipIf(!enabled)('Neon actual service integration (isolated synthetic namespace)', () => {
  beforeAll(async () => {
    nextEnv.loadEnvConfig(process.cwd());
    process.env.RYDR_STORAGE_BACKEND = 'neon';
    process.env.RYDR_STORAGE_NAMESPACE = 'verification-' + randomUUID();
    store = await import('../src/repositories/store');
    neon = await import('../src/repositories/neon');
  });
  afterAll(async () => { if (neon) await neon.databasePool().end(); });
  it('persists, lists and isolates database records by visitor', async () => {
    const file = path.join(store.RUNTIME_DIR, 'integration', 'record.json');
    await store.withStorageSession(session, async () => {
      await store.withLock('record', () => store.writeJsonAtomic(file, { value: 42 }));
      expect(await store.readJson(file)).toEqual({ value: 42 });
      expect(await store.listJsonFiles(path.dirname(file))).toEqual(['record.json']);
    });
    await store.withStorageSession(randomUUID(), async () => expect(await store.readJson(file)).toBeNull());
  }, 30000);
  it('rolls back a complete multi-record reviewer transaction on failure', async () => {
    const a = path.join(store.RUNTIME_DIR, 'integration', 'rollback-a.json');
    const b = path.join(store.RUNTIME_DIR, 'integration', 'rollback-b.json');
    await store.withStorageSession(session, async () => {
      await expect(store.withLock('rollback', async () => {
        await store.writeJsonAtomic(a, { amount: 500 });
        await store.withLock('nested', () => store.writeJsonAtomic(b, { amount: 500 }));
        throw new Error('Reject stale reviewer write');
      })).rejects.toThrow('Reject stale');
      expect(await store.readJson(a)).toBeNull();
      expect(await store.readJson(b)).toBeNull();
    });
  }, 30000);
  it('serializes concurrent mutations without losing increments', async () => {
    const file = path.join(store.RUNTIME_DIR, 'integration', 'counter.json');
    await store.withStorageSession(session, async () => {
      await store.writeJsonAtomic(file, { n: 0 });
      await Promise.all(Array.from({ length: 12 }, (_, i) => store.withLock('counter-' + i, async () => {
        const value = await store.readJson<{ n: number }>(file);
        await store.writeJsonAtomic(file, { n: value!.n + 1 });
      })));
      expect(await store.readJson(file)).toEqual({ n: 12 });
    });
  }, 90000);
  it('round trips original image and preview through the private Neon bucket', async () => {
    const { storeImage, readImage } = await import('../src/repositories/imageAssets');
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#cc3355' } }).png().toBuffer();
    const image = await store.withStorageSession(session, async () => {
      const image = await storeImage(bytes, 'image/png');
      expect(await readImage(image.hash, true)).toEqual(bytes);
      expect((await sharp(await readImage(image.hash)).metadata()).format).toBe('png');
      return image;
    });
    await store.withStorageSession(randomUUID(), async () => expect(readImage(image.hash)).rejects.toMatchObject({ code: 'ENOENT' }));
  }, 45000);
  it('stores supporting PDF bytes in object storage and metadata in Postgres', async () => {
    const { submitSupportingRecord, readSupportingAttachment } = await import('../src/repositories/repairSupport');
    const { listEvidenceRequestsForCase } = await import('../src/repositories/reviewTasks');
    const bytes = Buffer.from('%PDF-1.4\n% Synthetic service verification document\n%%EOF');
    await store.withStorageSession(randomUUID(), async () => {
      await submitSupportingRecord('SYN-001', 1, 'driver', 'Synthetic supporting document for storage verification.', randomUUID(), undefined, new File([bytes], 'synthetic.pdf', { type: 'application/pdf' }));
      const requests = await listEvidenceRequestsForCase('SYN-001');
      const id = requests.flatMap(r => r.responseEvidenceIds).find(id => id.startsWith('attachment-'))!;
      expect(await readSupportingAttachment(id, 'SYN-001', 'driver')).toEqual(bytes);
      await expect(readSupportingAttachment(id, 'SYN-001', 'rider')).rejects.toThrow('unavailable');
    });
  }, 90000);
  it('resolves both categories with persisted snapshots, decisions and ledger records', async () => {
    const { startRun, DEFAULT_CONFIG } = await import('../src/agents/orchestrator');
    const { createFixtureProvider } = await import('../src/providers/fixture');
    const { effectiveDecisionForCase, listSettlementsForCase } = await import('../src/repositories/ledger');
    const { getRunSnapshot } = await import('../src/repositories/snapshots');
    await store.withStorageSession(randomUUID(), async () => {
      for (const [id, disposition, cents] of [['SYN-001', 'refund', 500], ['SYN-005', 'uphold', 0]] as const) {
        const run = await startRun(id, 'fixture', { ...DEFAULT_CONFIG, provider: createFixtureProvider(), localEvidenceSelection: true }, randomUUID());
        expect(run.state).toBe('completed');
        expect(run.resolution?.disposition).toBe(disposition);
        expect((await effectiveDecisionForCase(id))?.targetRefundCents).toBe(cents);
        expect(await getRunSnapshot(run.id)).not.toBeNull();
        expect((await listSettlementsForCase(id)).length).toBeGreaterThan(0);
      }
    });
  }, 180000);
  it('starts the worker after an enclosing reviewer transaction commits', async () => {
    const { beginRun, DEFAULT_CONFIG } = await import('../src/agents/orchestrator');
    const { createFixtureProvider } = await import('../src/providers/fixture');
    const { getRun } = await import('../src/repositories/runs');
    await store.withStorageSession(randomUUID(), async () => {
      const run = await store.withLock('review-operation:SYN-002', () => beginRun('SYN-002', 'fixture', { ...DEFAULT_CONFIG, provider: createFixtureProvider(), localEvidenceSelection: true }, randomUUID()));
      for (let i = 0; i < 150; i++) {
        const current = await getRun(run.id);
        if (current?.state === 'completed') return;
        if (current?.state === 'failed') throw new Error(current.errorMessage ?? 'Worker failed');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Worker did not complete');
    });
  }, 120000);
});
