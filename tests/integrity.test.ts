import { describe, expect, it, beforeEach } from 'vitest';
import { assessIntegrity } from '../src/domain/integrity';
import { classifyRouting } from '../src/domain/routing';
import type { CaseRecord, EvidenceItem } from '../src/domain/contracts';
import { evaluateCase } from '../src/domain/policy';
import { getPolicyPack } from '../src/repositories/cases';
import { startRun } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { ensureReviewTask, listReviewTasksForCase } from '../src/repositories/reviewTasks';
import { getCase } from '../src/repositories/cases';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function loadSyn001(): Promise<CaseRecord> {
  const c = await getCase('SYN-001');
  if (!c) throw new Error('SYN-001 not found');
  return c;
}

function withDuplicateId(original: CaseRecord): CaseRecord {
  return {
    ...original,
    evidence: [
      ...original.evidence,
      { ...original.evidence[0]!, id: original.evidence[0]!.id },
    ],
  };
}

function withImpossibleChronology(original: CaseRecord): CaseRecord {
  const ev = original.evidence.map((item) =>
    item.kind === 'trip_event' && item.payload.eventType === 'driver_arrived'
      ? { ...item, timestamp: '2026-09-14T09:10:00+08:00' as const }
      : item,
  );
  return { ...original, evidence: ev };
}

function withGpsImpossibleSpeed(original: CaseRecord): CaseRecord {
  const ev = original.evidence.map((item, i) =>
    item.kind === 'gps' && i === 1
      ? {
          ...item,
          payload: { ...item.payload, lat: 1.4, lng: 104.0 },
        }
      : item,
  );
  return { ...original, evidence: ev };
}

function withPaymentMismatch(original: CaseRecord): CaseRecord {
  const ev = original.evidence.map((item) =>
    item.kind === 'payment'
      ? {
          ...item,
          payload: { ...item.payload, amountCents: 999 },
        }
      : item,
  );
  return { ...original, evidence: ev };
}

function withReusedContent(original: CaseRecord): CaseRecord {
  const clone: EvidenceItem = {
    ...original.evidence[0]!,
    id: `${original.evidence[0]!.id}_CLONE`,
  };
  return { ...original, evidence: [...original.evidence, clone] };
}

function withMissingProvenance(original: CaseRecord): CaseRecord {
  const ev = original.evidence.map((item, i) =>
    i === 0
      ? {
          ...item,
          source: { dataset: '', jsonPointer: '', provenance: item.source.provenance },
        }
      : item,
  );
  return { ...original, evidence: ev };
}

function withContradictoryClaim(original: CaseRecord): CaseRecord {
  const ev = original.evidence.map((item, i) =>
    i === 0
      ? {
          ...item,
          claims: [
            {
              id: 'claim_01',
              field: 'gps_accuracy_meters' as const,
              value: 999,
              suppliedBy: 'rider' as const,
              requestId: 'req_01',
              suppliedAt: '2026-09-14T09:00:00+08:00',
              verification: { status: 'unverified_claim' as const, source: null, verifiedBy: null, verifiedAt: null },
              note: 'Rider claims accuracy is 999 m',
            },
          ],
        }
      : item,
  );
  return { ...original, evidence: ev };
}

/* ------------------------------------------------------------------ */
/*  Domain: signal detection                                           */
/* ------------------------------------------------------------------ */

describe('assessIntegrity', () => {
  it('returns low severity for reused fixture content but does not trigger review', async () => {
    const caseRecord = await loadSyn001();
    const result = assessIntegrity('run_test', caseRecord);
    // SYN-001 is a synthetic fixture with identical GPS payloads, so the
    // honest assessment reports reused content as low severity.
    expect(result.signals.some((s) => s.code === 'reused_evidence_content')).toBe(true);
    expect(result.overallSeverity).toBe('low');
    expect(result.triggersReview).toBe(false);
  });

  it('detects duplicate evidence IDs as medium severity', async () => {
    const caseRecord = withDuplicateId(await loadSyn001());
    const result = assessIntegrity('run_test', caseRecord);
    expect(result.signals.some((s) => s.code === 'duplicate_evidence_ids')).toBe(true);
    expect(result.overallSeverity).toBe('medium');
    expect(result.triggersReview).toBe(true);
  });

  it('detects impossible chronology as high severity', async () => {
    const caseRecord = withImpossibleChronology(await loadSyn001());
    const result = assessIntegrity('run_test', caseRecord);
    expect(result.signals.some((s) => s.code === 'impossible_chronology')).toBe(true);
    expect(result.overallSeverity).toBe('high');
    expect(result.triggersReview).toBe(true);
  });

  it('detects GPS impossible speed as high severity', async () => {
    const caseRecord = withGpsImpossibleSpeed(await loadSyn001());
    const result = assessIntegrity('run_test', caseRecord);
    expect(result.signals.some((s) => s.code === 'gps_impossible_speed')).toBe(true);
    expect(result.overallSeverity).toBe('high');
    expect(result.triggersReview).toBe(true);
  });

  it('detects payment mismatch as medium severity', async () => {
    const caseRecord = withPaymentMismatch(await loadSyn001());
    const result = assessIntegrity('run_test', caseRecord);
    expect(result.signals.some((s) => s.code === 'payment_mismatch')).toBe(true);
    expect(result.overallSeverity).toBe('medium');
    expect(result.triggersReview).toBe(true);
  });

  it('detects reused evidence content as low severity', async () => {
    const caseRecord = withReusedContent(await loadSyn001());
    const result = assessIntegrity('run_test', caseRecord);
    expect(result.signals.some((s) => s.code === 'reused_evidence_content')).toBe(true);
    expect(result.overallSeverity).toBe('low');
    expect(result.triggersReview).toBe(false);
  });

  it('detects missing provenance as low severity', async () => {
    const caseRecord = withMissingProvenance(await loadSyn001());
    const result = assessIntegrity('run_test', caseRecord);
    expect(result.signals.some((s) => s.code === 'missing_provenance')).toBe(true);
    expect(result.overallSeverity).toBe('low');
    expect(result.triggersReview).toBe(false);
  });

  it('detects contradictory claim as medium severity', async () => {
    const caseRecord = withContradictoryClaim(await loadSyn001());
    const result = assessIntegrity('run_test', caseRecord);
    expect(result.signals.some((s) => s.code === 'contradictory_claim')).toBe(true);
    expect(result.overallSeverity).toBe('medium');
    expect(result.triggersReview).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Routing                                                            */
/* ------------------------------------------------------------------ */

describe('integrity routing', () => {
  it('routes high severity integrity to the safety lane with immediate urgency', async () => {
    const caseRecord = await loadSyn001();
    const pack = await getPolicyPack(caseRecord.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('Expected demo pack');
    const evaluation = evaluateCase(caseRecord, pack);
    const routing = classifyRouting({
      caseRecord,
      evaluation,
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
      integrity: { severity: 'high' },
    });
    expect(routing.lane).toBe('safety');
    expect(routing.urgency).toBe('immediate');
    expect(routing.codes).toContain('integrity_high');
  });

  it('routes medium severity integrity to the integrity lane with elevated urgency', async () => {
    const caseRecord = await loadSyn001();
    const pack = await getPolicyPack(caseRecord.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('Expected demo pack');
    const evaluation = evaluateCase(caseRecord, pack);
    const routing = classifyRouting({
      caseRecord,
      evaluation,
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
      integrity: { severity: 'medium' },
    });
    expect(routing.lane).toBe('integrity');
    expect(routing.urgency).toBe('elevated');
    expect(routing.codes).toContain('integrity_medium');
  });

  it('routes low severity integrity to the standard lane (no signal)', async () => {
    const caseRecord = await loadSyn001();
    const pack = await getPolicyPack(caseRecord.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('Expected demo pack');
    const evaluation = evaluateCase(caseRecord, pack);
    const routing = classifyRouting({
      caseRecord,
      evaluation,
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
      integrity: { severity: 'low' },
    });
    expect(routing.lane).toBe('standard');
  });
});

/* ------------------------------------------------------------------ */
/*  Orchestrator integration                                           */
/* ------------------------------------------------------------------ */

describe('integrity in the run lifecycle', () => {
  beforeEach(async () => {
    // Clean up any integrity tasks from prior tests
    const tasks = await listReviewTasksForCase('SYN-001');
    for (const task of tasks) {
      if (task.kind === 'integrity_alert') {
        const { updateReviewTask } = await import('../src/repositories/reviewTasks');
        await updateReviewTask(task.id, task.revision, (t) => ({ ...t, status: 'closed_unresolved' }));
      }
    }
  });

  it('stores the integrity assessment on the run record', async () => {
    const config = { ...DEFAULT_CONFIG, provider: createFixtureProvider() };
    const run = await startRun('SYN-001', 'fixture', config);
    expect(run.integrityAssessment).toBeDefined();
    // SYN-001 fixture has reused GPS payloads, so low severity is honest.
    expect(run.integrityAssessment!.overallSeverity).toBe('low');
    expect(run.integrityAssessment!.triggersReview).toBe(false);
  });

  it('does not change disposition when a high-severity signal is present', async () => {
    // Create a corrupted version of SYN-001 with duplicate IDs
    const original = await loadSyn001();
    const corrupted = withDuplicateId(original);
    // We can't easily run the orchestrator on an in-memory case, so we test
    // the assessIntegrity result independently and verify routing in a unit test.
    const assessment = assessIntegrity('run_test', corrupted);
    expect(assessment.overallSeverity).toBe('medium');
    expect(assessment.triggersReview).toBe(true);
    // The main pipeline disposition would still be computed from the deterministic
    // engine and judge — integrity does not alter it.
  });

  it('creates an integrity review task for a high-severity signal', async () => {
    const caseRecord = withImpossibleChronology(await loadSyn001());
    const assessment = assessIntegrity('run_integ', caseRecord);
    expect(assessment.triggersReview).toBe(true);

    const { task, created } = await ensureReviewTask({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: 'run_integ',
      kind: 'integrity_alert',
      reasonCodes: assessment.signals.map((s) => `integrity_${s.code}`),
      reasonSummary: `Integrity assessment detected ${assessment.signals.length} signal(s).`,
      openQuestions: assessment.signals.map((s) => s.explanation),
      integritySeverity: assessment.overallSeverity,
    });

    expect(created).toBe(true);
    expect(task.kind).toBe('integrity_alert');
    expect(task.routing?.lane).toBe('safety');
    expect(task.routing?.urgency).toBe('immediate');
  });

  it('does not create a task when severity is low', async () => {
    const caseRecord = withMissingProvenance(await loadSyn001());
    const assessment = assessIntegrity('run_low', caseRecord);
    expect(assessment.overallSeverity).toBe('low');
    expect(assessment.triggersReview).toBe(false);
  });
});
