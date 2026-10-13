import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEvaluationSet } from '../src/lib/evaluationSet';
import { createRuntimeCase } from '../src/repositories/cases';
import { startRun, DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { getRunSnapshot } from '../src/repositories/snapshots';
describe('reproducible synthetic evaluation', () => {
  it('records actual fixture outcomes and latency without exposing labels to runtime agents', async () => {
    const entries = await loadEvaluationSet();
    const rows = [];
    for (const entry of entries) {
      await createRuntimeCase(entry.caseRecord);
      const started = performance.now();
      const run = await startRun(entry.caseId, 'fixture', { ...DEFAULT_CONFIG, provider: createFixtureProvider(), localEvidenceSelection: true }, `evaluation:${entry.caseId}`);
      const latencyMs = Math.round(performance.now() - started);
      expect(run.callCount).toBe(3);
      const snapshot = await getRunSnapshot(run.id);
      const known = new Set([...(snapshot?.catalog.map(i => i.id) ?? []), ...(snapshot?.evaluation.findings.map(i => i.id) ?? []), ...entry.pack.clauses.map(c => c.id)]);
      const cites = [...(run.judge?.materialEvidenceIds ?? []), ...(run.judge?.policyIds ?? []), ...(run.judge?.establishedFindingIds ?? []), ...(run.judge?.disputedFindingIds ?? [])];
      expect(cites.every(id => known.has(id))).toBe(true);
      const expected = entry.expectedDisposition === 'insufficient_evidence' ? 'human_review' : entry.expectedDisposition;
      rows.push({ caseId: entry.caseId, expected, actual: run.resolution?.disposition ?? 'failed', automatic: run.resolution?.requiresHumanReview === false, calls: run.callCount, latencyMs, resolvedCitations: cites.length, agreement: run.resolution?.disposition === expected });
    }
    const automatic = rows.filter(row => row.automatic);
    const latencies = rows.map(row => row.latencyMs).sort((a,b) => a-b);
    const report = { generatedAt: new Date().toISOString(), mode: 'fixture', provider: 'local scripted fixture; no live LLM calls', sampleSize: rows.length,
      limitations: 'Eight hand-authored synthetic cases, not production performance or a calibrated fairness estimate. Insufficient-evidence labels map to human_review. Latency includes local file writes and test-runner load. Precedent retrieval correctness is checked separately; no approved examples are seeded into this evaluation.',
      automaticResolutionCoverage: automatic.length / rows.length, agreementWithSyntheticLabels: rows.filter(r => r.agreement).length / rows.length,
      wrongfulAutomaticOutcomes: automatic.filter(r => !r.agreement).length,
      unnecessaryEscalationsAgainstLabels: rows.filter(r => !r.automatic && r.expected !== 'human_review').length,
      modelInvocations: rows.reduce((sum,r) => sum+r.calls,0), externalPaidCalls: 0,
      p50LatencyMs: latencies[Math.ceil(latencies.length*.5)-1], p95LatencyMs: latencies[Math.ceil(latencies.length*.95)-1], rows };
    await mkdir('docs', { recursive: true });
    await writeFile('docs/synthetic-evaluation-report.json', JSON.stringify(report,null,2)+'\n');
    expect(report.wrongfulAutomaticOutcomes).toBe(0);
  }, 30000);
});
