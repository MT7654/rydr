import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RunRecord } from '../src/domain/contracts';
const control = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { entered: false, gate, release };
});
vi.mock('../src/agents/completion', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/agents/completion')>();
  return { ...actual, applyCompletion: async (run: RunRecord) => { control.entered = true; await control.gate; return actual.applyCompletion(run); } };
});
import { beginRun, DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { withStorageSession } from '../src/repositories/store';
import { getRun } from '../src/repositories/runs';
import { listSettlementsForCase } from '../src/repositories/ledger';
describe('durable completion ordering', () => {
  it('keeps polling active until the receipt is posted, then exposes the final event', async () => {
    await withStorageSession(randomUUID(), async () => {
      const run = await beginRun('SYN-001', 'fixture', { ...DEFAULT_CONFIG, provider: createFixtureProvider(), localEvidenceSelection: true });
      try {
        for (let i=0;i<500&&!control.entered;i++) await new Promise(resolve=>setTimeout(resolve,10));
        expect(control.entered).toBe(true);
        expect((await getRun(run.id))?.state).toBe('validating');
        expect(await listSettlementsForCase('SYN-001')).toHaveLength(0);
      } finally { control.release(); }
      for(let i=0;i<500;i++){
        const current=await getRun(run.id);
        if(current?.state==='completed'){
          expect(current.events.some(e=>e.type==='case:auto_settled')).toBe(true);
          expect((await listSettlementsForCase('SYN-001')).some(s=>s.status==='posted')).toBe(true);
          return;
        }
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw new Error('Completion did not finish');
    });
  },20000);
});
