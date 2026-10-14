import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startRun, DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { withStorageSession } from '../src/repositories/store';
import { getRunSnapshot } from '../src/repositories/snapshots';
import { effectiveDecisionForCase, listSettlementsForCase } from '../src/repositories/ledger';
import { listReviewTasksForCase } from '../src/repositories/reviewTasks';

const scenarios = [
  { id: 'SYN-001', disposition: 'refund', refundCents: 500 },
  { id: 'SYN-005', disposition: 'uphold', refundCents: 0 },
  { id: 'DISP-003', disposition: 'refund', refundCents: 450 },
  { id: 'DISP-001', disposition: 'human_review', refundCents: null },
  { id: 'DISP-002', disposition: 'human_review', refundCents: null },
] as const;
const output = path.join(process.cwd(), 'data', 'judge-evaluation', 'report.json');
const results: Record<string, unknown>[] = [];
const report = (status: string) => ({
  schemaVersion: 1, status, generatedAt: new Date().toISOString(), mode: 'fixture',
  provider: 'local scripted fixture; no runtime LLM', externalPaidCalls: 0,
  limitations: 'Verifies the shipped policy, orchestration, citations, escalation and simulated settlement contracts. Does not verify live ADP reasoning, model quality, photo authenticity or real payments. Expected assertions are evaluator-only and are never runtime agent inputs.',
  results,
});
beforeAll(async () => {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report('running'), null, 2) + '\n');
});
afterAll(async () => {
  const passed = results.length === scenarios.length && results.every(row => row.status === 'passed');
  await writeFile(output, JSON.stringify(report(passed ? 'passed' : 'failed'), null, 2) + '\n');
  console.log(`Judge evaluation report: ${path.relative(process.cwd(), output)} (${passed ? 'passed' : 'failed'})`);
});

describe('judge verification without credentials', () => {
  for (const scenario of scenarios) {
    it(`resolves or safely refers ${scenario.id}`, async () => {
      const row: Record<string, unknown> = { caseId: scenario.id, status: 'failed' };
      results.push(row);
      await withStorageSession(randomUUID(), async () => {
        const provider = createFixtureProvider();
        expect(provider.external).toBe(false);
        const run = await startRun(scenario.id, 'fixture', {
          ...DEFAULT_CONFIG, provider, localEvidenceSelection: true,
        }, `judge:${randomUUID()}`);
        const snapshot = await getRunSnapshot(run.id);
        const decision = await effectiveDecisionForCase(scenario.id);
        const settlements = await listSettlementsForCase(scenario.id);
        const tasks = await listReviewTasksForCase(scenario.id);
        Object.assign(row, {
          runId: run.id, mode: run.mode, provider: run.provider, state: run.state,
          caseVersion: run.caseVersion, policyVersion: run.policyVersion,
          promptVersion: run.promptVersion, callCount: run.callCount,
          resolution: run.resolution, advocates: run.advocates, judge: run.judge,
          case: snapshot?.caseRecord, policy: snapshot?.policyPack,
          evaluation: snapshot?.evaluation, findings: snapshot?.evaluation.findings, quality: snapshot?.quality,
          snapshotHash: snapshot?.inputHash,
          decision, settlements, reviewTasks: tasks,
        });
        expect(run.mode).toBe('fixture');
        expect(run.provider).toBe('fixture');
        expect(run.callCount).toBe(3);
        expect(snapshot).not.toBeNull();
        expect(run.advocates.rider).not.toBeNull();
        expect(run.advocates.driver).not.toBeNull();
        expect(run.judge).not.toBeNull();
        expect(run.resolution?.disposition).toBe(scenario.disposition);
        if (scenario.id === 'DISP-001') expect(snapshot?.evaluation.route?.eligibleRefundCents).toBe(344);
        if (scenario.id === 'DISP-002') expect(snapshot?.evaluation.noShow?.accuracyPresent).toBe(false);
        const known = new Set([
          ...(snapshot?.catalog.map(item => item.id) ?? []),
          ...(snapshot?.evaluation.findings.map(item => item.id) ?? []),
          ...(snapshot?.policyPack.clauses.map(item => item.id) ?? []),
        ]);
        const citations = [
          ...(run.judge?.materialEvidenceIds ?? []), ...(run.judge?.policyIds ?? []),
          ...(run.judge?.establishedFindingIds ?? []), ...(run.judge?.disputedFindingIds ?? []),
        ];
        expect(citations.length).toBeGreaterThan(0);
        expect(citations.every(id => known.has(id))).toBe(true);
        if (scenario.disposition === 'human_review') {
          expect(run.state).toBe('escalated');
          expect(run.resolution?.requiresHumanReview).toBe(true);
          expect(decision).toBeNull();
          expect(settlements).toHaveLength(0);
          expect(tasks.some(task => task.runId === run.id)).toBe(true);
        } else {
          expect(run.state).toBe('completed');
          expect(decision?.targetRefundCents).toBe(scenario.refundCents);
          expect(settlements.filter(item => item.status === 'posted').reduce((sum, item) => sum + item.deltaRefundCents, 0)).toBe(scenario.refundCents);
        }
        row.status = 'passed';
      });
    }, 30000);
  }
});
