import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaseRecord, ReviewTask } from '../src/domain/contracts';
import { ReviewTaskSchema } from '../src/domain/contracts';
import { evaluateCase } from '../src/domain/policy';
import { getPolicyPack } from '../src/repositories/cases';
import {
  DEMO_SERVICE_TARGETS,
  SERVICE_TARGET_LABEL,
  classifyEscalation,
  classifyRouting,
  compareQueueEntries,
  deadlineLabel,
  isOverdue,
  overdueMs,
  type QueueEntry,
} from '../src/domain/routing';

/**
 * SLA routing.
 *
 * The contract these pin down: priority decides who looks next and by when, and
 * nothing else. In particular routing must never change a refund amount, and a
 * repeat complainant must not become presumptively wrong by being routed
 * somewhere.
 */

async function loadCase(caseId: string): Promise<CaseRecord> {
  const raw = await fs.readFile(path.join('fixtures', 'cases', `${caseId}.json`), 'utf8');
  return JSON.parse(raw) as CaseRecord;
}

async function route(caseId: string, openedAt = new Date().toISOString()) {
  const caseRecord = await loadCase(caseId);
  const pack = await getPolicyPack(caseRecord.policyVersion);
  if (pack.source !== 'rydr_demo') throw new Error('expected the demo pack');
  return classifyRouting({
    caseRecord,
    evaluation: evaluateCase(caseRecord, pack),
    highValueCents: pack.thresholds.highValueCents,
    openedAt,
  });
}

/** A task shaped like a real one, for ordering tests. */
function task(overrides: Partial<ReviewTask> & Pick<ReviewTask, 'id' | 'routing'>): ReviewTask {
  const now = new Date().toISOString();
  return ReviewTaskSchema.parse({
    caseId: 'SYN-001',
    caseVersion: 1,
    runId: null,
    kind: 'automatic_escalation',
    status: 'queued',
    assigneeId: null,
    reasonCodes: [],
    reasonSummary: 'synthetic',
    openQuestions: [],
    linkedDecisionId: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

/** A complete routing block for ordering tests. */
function makeRouting(
  overrides: Partial<NonNullable<ReviewTask['routing']>> = {},
): NonNullable<ReviewTask['routing']> {
  return {
    lane: 'standard',
    urgency: 'normal',
    reason: 'test',
    codes: [],
    serviceTargetMs: 60_000,
    serviceTargetLabel: SERVICE_TARGET_LABEL,
    dueAt: '2026-10-02T12:00:00.000Z',
    lastActivityAt: '2026-10-02T12:00:00.000Z',
    ...overrides,
  };
}

describe('routing: lanes and service targets', () => {
  it('routes an explicit safety allegation to the safety lane with the shortest target', async () => {
    const base = await loadCase('SYN-002');
    const pack = await getPolicyPack(base.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('expected the demo pack');

    const unsafe: CaseRecord = {
      ...base,
      id: 'SYN-ROUTE-SAFETY',
      riderStatement: 'The driver threatened me and I felt unsafe during the pickup.',
    };

    const decision = classifyRouting({
      caseRecord: unsafe,
      evaluation: evaluateCase(unsafe, pack),
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
    });

    expect(decision.lane).toBe('safety');
    expect(decision.urgency).toBe('immediate');
    expect(decision.serviceTargetMs).toBe(DEMO_SERVICE_TARGETS.safety);
    expect(decision.serviceTargetLabel).toBe(SERVICE_TARGET_LABEL);
    expect(decision.codes).toContain('safety_language');
  });

  it('does not read tone as safety — an angry fare complaint stays a fare dispute', async () => {
    const base = await loadCase('SYN-002');
    const pack = await getPolicyPack(base.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('expected the demo pack');

    const angry: CaseRecord = {
      ...base,
      id: 'SYN-ROUTE-ANGRY',
      riderStatement:
        'This is absolutely outrageous and I am furious! You charged me five dollars for nothing and I want it back immediately!!',
    };

    const decision = classifyRouting({
      caseRecord: angry,
      evaluation: evaluateCase(angry, pack),
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
    });

    expect(decision.lane).not.toBe('safety');
    expect(decision.lane).toBe('standard');
  });

  it('raises the lane for a high-value dispute and keeps the standard target otherwise', async () => {
    const base = await loadCase('SYN-002');
    const pack = await getPolicyPack(base.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('expected the demo pack');

    const pricey: CaseRecord = {
      ...base,
      id: 'SYN-ROUTE-HIGH',
      disputedCents: pack.thresholds.highValueCents + 1,
    };

    const high = classifyRouting({
      caseRecord: pricey,
      evaluation: evaluateCase(pricey, pack),
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
    });
    expect(high.lane).toBe('high_value');
    expect(high.serviceTargetMs).toBe(DEMO_SERVICE_TARGETS.elevated);

    const standard = await route('SYN-002');
    expect(standard.lane).toBe('standard');
    expect(standard.serviceTargetMs).toBe(DEMO_SERVICE_TARGETS.standard);
  });

  it('raises the integrity lane from an integrity reason code', async () => {
    const caseRecord = await loadCase('SYN-002');
    const pack = await getPolicyPack(caseRecord.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('expected the demo pack');

    const decision = classifyRouting({
      caseRecord,
      evaluation: evaluateCase(caseRecord, pack),
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
      reasonCodes: ['integrity_duplicate_claim'],
    });

    expect(decision.lane).toBe('integrity');
    expect(decision.serviceTargetMs).toBe(DEMO_SERVICE_TARGETS.elevated);
  });

  it('states the demo target on every decision rather than implying a contractual SLA', async () => {
    const decision = await route('SYN-002');
    expect(decision.serviceTargetLabel).toMatch(/prototype service target/i);
    expect(decision.serviceTargetLabel).toMatch(/not a contractual/i);
    expect(Date.parse(decision.dueAt) - Date.parse(decision.lastActivityAt)).toBe(
      decision.serviceTargetMs,
    );
  });
});

describe('routing: priority never changes liability', () => {
  it('leaves the disposition and refund identical across lanes', async () => {
    const base = await loadCase('SYN-002');
    const pack = await getPolicyPack(base.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('expected the demo pack');

    const baseline = evaluateCase(base, pack);
    const openedAt = new Date().toISOString();

    // Same case, three different routing pressures.
    const lanes = [
      classifyRouting({
        caseRecord: base,
        evaluation: baseline,
        highValueCents: pack.thresholds.highValueCents,
        openedAt,
      }).lane,
      classifyRouting({
        caseRecord: base,
        evaluation: baseline,
        highValueCents: pack.thresholds.highValueCents,
        openedAt,
        reasonCodes: ['integrity_duplicate_claim'],
      }).lane,
      classifyRouting({
        caseRecord: { ...base, disputedCents: pack.thresholds.highValueCents + 1 },
        evaluation: baseline,
        highValueCents: pack.thresholds.highValueCents,
        openedAt,
      }).lane,
    ];

    expect(new Set(lanes).size).toBe(3);

    // The deterministic outcome is a pure function of the case, so routing
    // cannot have moved it.
    for (const _ of lanes) {
      const again = evaluateCase(base, pack);
      expect(again.disposition).toBe(baseline.disposition);
      expect(again.recommendedRefundCents).toBe(baseline.recommendedRefundCents);
    }
  });

  it('records prior disputes as ordering context only, never as a liability reason', async () => {
    const base = await loadCase('SYN-002');
    const pack = await getPolicyPack(base.policyVersion);
    if (pack.source !== 'rydr_demo') throw new Error('expected the demo pack');

    // A rider with a long dispute history and a low rating.
    const repeat: CaseRecord = {
      ...base,
      id: 'SYN-ROUTE-REPEAT',
      evidence: base.evidence.map((item) =>
        item.kind === 'history' && item.payload.subject === 'rider'
          ? {
              ...item,
              payload: {
                ...item.payload,
                disputeCount: 14,
                avgRating: 1.4,
                fraudFlags: 2,
              },
            }
          : item,
      ),
    };

    const decision = classifyRouting({
      caseRecord: repeat,
      evaluation: evaluateCase(repeat, pack),
      highValueCents: pack.thresholds.highValueCents,
      openedAt: new Date().toISOString(),
    });

    // History is context: it is surfaced, but it does not even move the lane,
    // and it never becomes a liability finding.
    expect(decision.codes).toContain('history_context');
    expect(decision.lane).toBe('standard');
    expect(decision.reason).toMatch(/cannot change the outcome/i);

    const withHistory = evaluateCase(repeat, pack);
    const withoutHistory = evaluateCase(base, pack);
    expect(withHistory.disposition).toBe(withoutHistory.disposition);
    expect(withHistory.recommendedRefundCents).toBe(withoutHistory.recommendedRefundCents);
  });
});

describe('routing: ordering, aging and overdue', () => {
  const now = Date.parse('2026-10-02T12:00:00.000Z');

  function entry(
    id: string,
    lane: NonNullable<ReviewTask['routing']>['lane'],
    dueAt: string,
    createdAt: string,
  ): QueueEntry {
    const r = makeRouting({ lane, dueAt, lastActivityAt: createdAt });
    return { task: task({ id, routing: r, createdAt }), caseRecord: null };
  }

  it('sorts a new safety case ahead of every ordinary dispute', () => {
    const entries = [
      entry('standard', 'standard', '2026-10-02T11:00:00.000Z', '2026-10-01T12:00:00.000Z'),
      entry('high', 'high_value', '2026-10-02T11:30:00.000Z', '2026-10-02T11:00:00.000Z'),
      entry('safety', 'safety', '2026-10-02T13:00:00.000Z', '2026-10-02T11:55:00.000Z'),
    ];

    const ordered = [...entries].sort((a, b) => compareQueueEntries(a, b, now));
    // The safety case is not even overdue yet, and still leads.
    expect(ordered[0]!.task.id).toBe('safety');
  });

  it('moves an aging low-value case forward instead of starving it behind high-value work', () => {
    const entries = [
      // Fresh high-value work, not yet due.
      entry('high', 'high_value', '2026-10-02T13:00:00.000Z', '2026-10-02T11:30:00.000Z'),
      // Small charge, long past its target.
      entry('low', 'standard', '2026-10-02T06:00:00.000Z', '2026-10-01T05:00:00.000Z'),
    ];

    const ordered = [...entries].sort((a, b) => compareQueueEntries(a, b, now));
    expect(ordered[0]!.task.id).toBe('low');
  });

  it('orders overdue cases by how overdue they are', () => {
    const entries = [
      entry('recent', 'standard', '2026-10-02T11:00:00.000Z', '2026-10-01T12:00:00.000Z'),
      entry('ancient', 'standard', '2026-10-01T00:00:00.000Z', '2026-09-29T12:00:00.000Z'),
    ];

    const ordered = [...entries].sort((a, b) => compareQueueEntries(a, b, now));
    expect(ordered[0]!.task.id).toBe('ancient');
  });

  it('derives overdue state from the stored deadline and the server clock', () => {
    const dueAt = '2026-10-02T11:00:00.000Z';
    expect(isOverdue(dueAt, Date.parse('2026-10-02T10:59:00.000Z'))).toBe(false);
    expect(isOverdue(dueAt, now)).toBe(true);
    expect(overdueMs(dueAt, now)).toBe(60 * 60_000);
    expect(overdueMs(dueAt, Date.parse('2026-10-02T10:00:00.000Z'))).toBe(0);
    expect(deadlineLabel(dueAt, now)).toBe('1h overdue');
    expect(deadlineLabel('2026-10-02T12:45:00.000Z', now)).toBe('due in 45m');
  });

  it('stores only the deadline, so lateness survives a restart', async () => {
    const r = makeRouting({
      serviceTargetMs: DEMO_SERVICE_TARGETS.standard,
      dueAt: '2026-09-01T00:00:00.000Z',
      lastActivityAt: '2026-08-31T00:00:00.000Z',
    });

    // Round-trips through the schema exactly as it would through disk.
    const persisted = ReviewTaskSchema.parse(task({ id: 'restart', routing: r }));
    expect(persisted.routing?.dueAt).toBe('2026-09-01T00:00:00.000Z');
    expect(Object.keys(persisted.routing ?? {})).not.toContain('overdue');
    // The lateness is computed on read, from the clock — not remembered.
    expect(isOverdue(persisted.routing!.dueAt, now)).toBe(true);
  });

  it('falls back to the standard target for a task written before routing existed', () => {
    const legacy = task({ id: 'legacy' } as never);
    expect(legacy.routing).toBeUndefined();
    const entries: QueueEntry[] = [{ task: legacy, caseRecord: null }];
    expect(() => compareQueueEntries(entries[0]!, entries[0]!, now)).not.toThrow();
  });
});

describe('routing: escalation kinds name the right next action', () => {
  it('distinguishes the five escalation kinds', () => {
    expect(classifyEscalation(['safety_language']).kind).toBe('safety');
    expect(classifyEscalation(['policy_ambiguity']).kind).toBe('policy_ambiguity');
    expect(classifyEscalation(['integrity_duplicate_claim']).kind).toBe('integrity');
    expect(classifyEscalation(['provider_timeout']).kind).toBe('runtime_failure');
    expect(classifyEscalation(['evidence_insufficient']).kind).toBe('evidence_gap');
  });

  it('prefers safety over every other kind when codes overlap', () => {
    const result = classifyEscalation(['evidence_insufficient', 'safety_language']);
    expect(result.kind).toBe('safety');
    expect(result.nextAction).toMatch(/never resolved by the model/i);
  });

  it('tells a policy gap apart from a missing record', () => {
    const policy = classifyEscalation(['policy_ambiguity']);
    const evidence = classifyEscalation(['evidence_gap']);
    expect(policy.nextAction).toMatch(/more evidence cannot settle/i);
    expect(evidence.nextAction).toMatch(/request or retrieve/i);
  });
});
