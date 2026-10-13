import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import sharp from 'sharp';
import { withStorageSession, scopeRuntimePath, RUNTIME_DIR } from '../src/repositories/store';
import { getCase, appendCaseVersion } from '../src/repositories/cases';
import { loadCasePacket } from '../src/lib/casePacket';
import { chargeRefFor, recordDecision, postSettlement } from '../src/repositories/ledger';
import { ensureReviewTask, getReviewTask, createEvidenceRequest, listEvidenceRequests } from '../src/repositories/reviewTasks';
import { reserveCalls, sessionCallCount, getRun } from '../src/repositories/runs';
import { storeImage, readImage } from '../src/repositories/imageAssets';
import { DEFAULT_CONFIG, beginRun } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function settle() {
  const record = (await getCase('DISP-002'))!;
  const decision = await recordDecision({ caseId: record.id, caseVersion: record.version, runId: null, taskId: null,
    source: 'reviewer', disposition: 'refund', targetRefundCents: 500, evidenceIds: [], policyIds: [],
    policyVersion: record.policyVersion, explanation: 'A verified test refund.', differenceFromRecommendation: null,
    reviewerId: 'reviewer_demo_01', supersedesDecisionId: null, chargeRef: chargeRefFor(record) });
  await postSettlement({ caseRecord: record, decision });
}

describe('visitor demo isolation', () => {
  it('keeps legacy settlements intact while both fresh visitors start DISP-002 open', async () => {
    await withStorageSession(null, settle);
    for (const session of [A, B]) await withStorageSession(session, async () => {
      const packet = (await loadCasePacket('DISP-002'))!;
      expect(packet.status).toBe('open');
      expect(packet.caseRecord.version).toBe(2);
      expect(packet.decisions).toHaveLength(0);
      expect(packet.settlements).toHaveLength(0);
    });
    expect((await withStorageSession(null, () => loadCasePacket('DISP-002')))?.status).toBe('settled');
  });

  it('settles and versions only the visitor who took the action', async () => {
    await withStorageSession(A, settle);
    expect((await withStorageSession(A, () => loadCasePacket('DISP-002')))?.status).toBe('settled');
    expect((await withStorageSession(B, () => loadCasePacket('DISP-002')))?.status).toBe('open');
    await withStorageSession(A, () => appendCaseVersion('SYN-002', r => ({ ...r, riderStatement: 'Private added evidence.' }), 'New evidence'));
    expect((await withStorageSession(A, () => getCase('SYN-002')))?.version).toBe(2);
    expect((await withStorageSession(B, () => getCase('SYN-002')))?.version).toBe(1);
  });

  it('isolates appeals, evidence requests and image bytes even when their IDs are known', async () => {
    const { task } = await withStorageSession(A, () => ensureReviewTask({ caseId: 'DISP-002', caseVersion: 1, runId: null,
      kind: 'appeal', reasonCodes: [], reasonSummary: 'Private appeal.', submittedBy: 'rider' }));
    await withStorageSession(A, () => createEvidenceRequest({ taskId: task.id, caseId: 'DISP-002', recipient: 'rider',
      question: 'Provide the pickup location.', evidenceType: 'statement', whyItMatters: 'Check location.' }));
    expect(await withStorageSession(B, () => getReviewTask(task.id))).toBeNull();
    expect(await withStorageSession(B, () => listEvidenceRequests(task.id))).toHaveLength(0);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#145d67' } }).png().toBuffer();
    const asset = await withStorageSession(A, () => storeImage(bytes, 'image/png'));
    expect(await withStorageSession(A, () => readImage(asset.hash, true))).toEqual(bytes);
    await expect(withStorageSession(B, () => readImage(asset.hash))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('maintains a separate call allowance for each visitor', async () => {
    expect(await withStorageSession(A, () => reserveCalls(3, 3))).toBe(true);
    expect(await withStorageSession(A, () => reserveCalls(1, 3))).toBe(false);
    expect(await withStorageSession(B, sessionCallCount)).toBe(0);
    expect(await withStorageSession(B, () => reserveCalls(1, 3))).toBe(true);
    expect(await withStorageSession(A, sessionCallCount)).toBe(3);
  });

  it('completes both detached agent workers independently, including identical run IDs', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    let runs;
    try {
      runs = await Promise.all([A, B].map(session => withStorageSession(session,
        () => beginRun('SYN-001', 'fixture', { ...DEFAULT_CONFIG, provider: createFixtureProvider() }, 'same-key'))));
    } finally { clock.mockRestore(); }
    expect(runs[0].id).toBe(runs[1].id);
    await Promise.all([A, B].map(async (session, index) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const run = await withStorageSession(session, () => getRun(runs[index].id));
        if (run?.events.some(event => event.type === 'case:auto_settled')) break;
        if (run?.state === 'failed') throw new Error('Isolated agent worker failed.');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect((await withStorageSession(session, () => getRun(runs[index].id)))?.state).toBe('completed');
      expect((await withStorageSession(session, () => loadCasePacket('SYN-001')))?.status).toBe('settled');
    }));
  });

  it('rejects malformed namespaces and paths belonging to another visitor', async () => {
    expect(() => withStorageSession('../other', () => undefined)).toThrow('Invalid demo session');
    await expect(withStorageSession(A, () => scopeRuntimePath(path.join(RUNTIME_DIR, 'demo-sessions', B, 'runs.json')))).rejects.toThrow('another demo session');
    await expect(withStorageSession(A, () => scopeRuntimePath(path.join(RUNTIME_DIR, '..', 'outside.json')))).rejects.toThrow('outside');
  });
});
