import { describe, expect, it } from 'vitest';
import { evaluateCase, screenHistoryRisk, screenSafetyAllegations } from '../src/domain/policy';
import { scoreEvidence, applyEscalationGate } from '../src/domain/confidence';
import { classifyZone } from '../src/domain/geo';
import { compareRoutes } from '../src/domain/route';
import type { CaseRecord } from '../src/domain/contracts';
import { clone, loadCase, loadDemoPack, withTiming } from './helpers';

describe('seed cases resolve as specified', () => {
  it('SYN-001 refunds the disputed no-show fee', async () => {
    const pack = await loadDemoPack();
    const result = evaluateCase(await loadCase('SYN-001'), pack);
    expect(result.disposition).toBe('refund');
    expect(result.recommendedRefundCents).toBe(500);
    expect(result.noShow?.arrivalZone).toBe('outside');
  });

  it('SYN-002 upholds the disputed no-show fee', async () => {
    const pack = await loadDemoPack();
    const result = evaluateCase(await loadCase('SYN-002'), pack);
    expect(result.disposition).toBe('uphold');
    // A decided zero refund, distinct from the null used for a deferred decision.
    expect(result.recommendedRefundCents).toBe(0);
    expect(result.noShow?.arrivalZone).toBe('inside');
    expect(result.noShow?.elapsedSeconds).toBe(530);
  });

  it('SYN-003 escalates on poor accuracy and conflicting times', async () => {
    const pack = await loadDemoPack();
    const result = evaluateCase(await loadCase('SYN-003'), pack);
    expect(result.disposition).toBe('human_review');
    // The 120 m accuracy radius exceeds the 50 m pickup radius, so the zone is
    // indeterminate and no automatic outcome is possible.
    expect(result.noShow?.arrivalZone).toBe('indeterminate');
    expect(result.noShow?.accuracyPresent).toBe(true);
    // The zone is reported as indeterminate rather than asserted either way.
    const zoneFinding = result.findings.find((finding) => finding.id === 'F-ZONE');
    expect(zoneFinding?.text).toContain('indeterminate');
  });

  it('SYN-004 refunds exactly 500 cents', async () => {
    const pack = await loadDemoPack();
    const result = evaluateCase(await loadCase('SYN-004'), pack);
    expect(result.disposition).toBe('refund');
    expect(result.recommendedRefundCents).toBe(500);
    expect(result.route?.comparison.deviationFlagged).toBe(true);
    expect(result.route?.ledgerReconciled).toBe(true);
  });

  it('SYN-005 upholds a verified rider-approved detour', async () => {
    const pack = await loadDemoPack();
    const result = evaluateCase(await loadCase('SYN-005'), pack);
    expect(result.disposition).toBe('uphold');
    expect(result.route?.justification).toBe('verified_justification');
  });

  it('DISP-002 is not forced to the advertised uphold', async () => {
    const pack = await loadDemoPack();
    const result = evaluateCase(await loadCase('DISP-002'), pack);
    expect(result.disposition).toBe('human_review');
    expect(result.noShow?.accuracyPresent).toBe(false);
    expect(result.issues.join(' ')).toContain('supplied sample policy');
  });
});

describe('no-show timing rules', () => {
  it('479 seconds is ineligible and 480 seconds is eligible', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-002');

    const at479 = withTiming(base, {
      scheduled: '2026-09-16T08:45:00+08:00',
      arrival: '2026-09-16T08:45:00+08:00',
      timerStart: '2026-09-16T08:45:00+08:00',
      cancellation: '2026-09-16T08:52:59+08:00',
    });
    expect(evaluateCase(at479, pack).disposition).toBe('refund');

    const at480 = withTiming(base, {
      scheduled: '2026-09-16T08:45:00+08:00',
      arrival: '2026-09-16T08:45:00+08:00',
      timerStart: '2026-09-16T08:45:00+08:00',
      cancellation: '2026-09-16T08:53:00+08:00',
    });
    expect(evaluateCase(at480, pack).disposition).toBe('uphold');
  });

  it('early arrival cannot start the clock before the scheduled pickup', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-002');
    const early = withTiming(base, {
      scheduled: '2026-09-16T08:45:00+08:00',
      arrival: '2026-09-16T08:40:00+08:00',
      timerStart: '2026-09-16T08:45:10+08:00',
      cancellation: '2026-09-16T08:52:50+08:00',
    });
    const result = evaluateCase(early, pack);
    expect(result.noShow?.effectiveStartAt).toBe('2026-09-16T08:45:10+08:00');
    expect(result.disposition).toBe('refund');
  });

  it('a spread between clocks is resolved by NS-03, not escalated', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-002');
    const spread = withTiming(base, {
      scheduled: '2026-09-16T08:45:00+08:00',
      arrival: '2026-09-16T08:43:00+08:00',
      timerStart: '2026-09-16T08:45:10+08:00',
      cancellation: '2026-09-16T08:51:00+08:00',
    });
    const result = evaluateCase(spread, pack);
    expect(result.noShow?.effectiveStartAt).toBe('2026-09-16T08:45:10+08:00');
    expect(result.noShow?.materialStartConflict).toBe(false);
    expect(result.disposition).toBe('refund');
  });

  it('an ambiguous supplied policy makes the governing clock material', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-002');
    const conflicting = withTiming(base, {
      scheduled: '2026-09-16T08:45:00+08:00',
      arrival: '2026-09-16T08:43:00+08:00',
      timerStart: '2026-09-16T08:45:10+08:00',
      cancellation: '2026-09-16T08:51:00+08:00',
    });
    conflicting.suppliedPolicyId = 'supplied-sample-policy';
    const result = evaluateCase(conflicting, pack);
    expect(result.noShow?.materialStartConflict).toBe(true);
    expect(result.disposition).toBe('human_review');
  });
});

describe('pickup zone determination', () => {
  it('classifies inside, outside and indeterminate conservatively', () => {
    expect(classifyZone(10, 5, 50)).toBe('inside');
    expect(classifyZone(60, 5, 50)).toBe('outside');
    expect(classifyZone(45, 20, 50)).toBe('indeterminate');
  });

  it('missing accuracy yields indeterminate, never certainty', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-002');
    const stripped = clone(base);
    for (const item of stripped.evidence) {
      if (item.kind === 'gps') item.payload.accuracyMeters = null;
    }
    const result = evaluateCase(stripped, pack);
    expect(result.noShow?.arrivalZone).toBe('indeterminate');
    expect(result.disposition).toBe('human_review');
  });

  it('a long sampling gap prevents asserting continuous presence', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-002');
    const gapped = clone(base);
    const stationary = gapped.evidence.filter(
      (item) => item.kind === 'gps' && ['arrived', 'waiting', 'cancelled'].includes(item.payload.status),
    );
    // Leave only the first and last stationary samples: a 9 minute gap.
    for (const item of stationary.slice(1, -1)) {
      const index = gapped.evidence.indexOf(item);
      gapped.evidence.splice(index, 1);
    }
    const result = evaluateCase(gapped, pack);
    expect(result.noShow?.maxGapSeconds).toBeGreaterThan(180);
    expect(result.disposition).toBe('human_review');
  });
});

describe('route rules', () => {
  it('deviation equality does not exceed the threshold', () => {
    const atMeters = compareRoutes(
      { plannedDistanceM: 10000, actualDistanceM: 11000, gpsSegmentSumM: 11000 },
      { excessPercent: 20, excessMeters: 1000 },
    );
    expect(atMeters.deviationFlagged).toBe(false);

    const atPercent = compareRoutes(
      { plannedDistanceM: 8200, actualDistanceM: 9840, gpsSegmentSumM: 9840 },
      { excessPercent: 20, excessMeters: 1000 },
    );
    expect(atPercent.deviationFlagged).toBe(false);
  });

  it('unknown justification with a material excess escalates', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-004');
    const unknown = clone(base);
    for (const item of unknown.evidence) {
      if (item.kind === 'route') item.payload.justification = 'unknown';
    }
    expect(evaluateCase(unknown, pack).disposition).toBe('human_review');
  });

  it('an unreconciled ledger escalates', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-004');
    const broken = clone(base);
    for (const item of broken.evidence) {
      if (item.kind === 'payment' && item.payload.component === 'final_fare') {
        item.payload.amountCents = 2400;
      }
    }
    const result = evaluateCase(broken, pack);
    expect(result.route?.ledgerReconciled).toBe(false);
    expect(result.disposition).toBe('human_review');
  });

  it('the refund is capped at the disputed amount', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-004');
    const smallerDispute = clone(base);
    smallerDispute.disputedCents = 300;
    const result = evaluateCase(smallerDispute, pack);
    expect(result.recommendedRefundCents).toBe(300);
  });

  it('an unidentifiable surcharge component escalates', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-004');
    const stripped = clone(base);
    stripped.evidence = stripped.evidence.filter(
      (item) => !(item.kind === 'payment' && item.payload.component === 'excess_route_surcharge'),
    );
    for (const item of stripped.evidence) {
      if (item.kind === 'payment' && item.payload.component === 'final_fare') {
        item.payload.amountCents = 1800;
      }
    }
    expect(evaluateCase(stripped, pack).disposition).toBe('human_review');
  });
});

describe('history cannot decide liability', () => {
  it('swapping ratings and flags leaves liability and amount unchanged', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-001');
    const swapped = clone(base);
    for (const item of swapped.evidence) {
      if (item.kind === 'history') {
        item.payload.avgRating = item.payload.subject === 'rider' ? 2.5 : 5.0;
        item.payload.fraudFlags = item.payload.subject === 'rider' ? 3 : 0;
        item.payload.disputeCount = 9;
      }
    }

    const before = evaluateCase(base, pack);
    const after = evaluateCase(swapped, pack);
    expect(after.disposition).toBe(before.disposition);
    expect(after.recommendedRefundCents).toBe(before.recommendedRefundCents);
  });

  it('history flags can request review without changing the outcome', async () => {
    const pack = await loadDemoPack();
    const base = await loadCase('SYN-001');
    const flagged = clone(base);
    for (const item of flagged.evidence) {
      if (item.kind === 'history' && item.payload.subject === 'rider') {
        item.payload.fraudFlags = 2;
      }
    }
    const evaluation = evaluateCase(flagged, pack);
    if (pack.source !== 'rydr_demo') throw new Error('expected demo pack');
    const quality = scoreEvidence(flagged, evaluation, pack.thresholds);
    const gate = applyEscalationGate({
      caseRecord: flagged,
      evaluation,
      thresholds: pack.thresholds,
      quality,
      judgeDisposition: evaluation.disposition,
      judgeConfidence: 0.9,
      agentOutputInvalid: false,
      providerFailure: false,
      unresolvedCitations: [],
    });
    expect(gate.reviewOnlyReasons.length).toBeGreaterThan(0);
    expect(gate.requiresHumanReview).toBe(true);
    expect(gate.disposition).toBe('refund');
  });

  it('safety allegations are routed to a human', async () => {
    const base = await loadCase('SYN-001');
    const unsafe = clone(base);
    unsafe.riderStatement = 'The driver assaulted me and I felt unsafe during the trip.';
    expect(screenSafetyAllegations(unsafe).length).toBeGreaterThan(0);
    expect(screenSafetyAllegations(base)).toEqual([]);
  });
});

describe('evidence quality score', () => {
  it('retains a breakdown and never exceeds 1', async () => {
    const pack = await loadDemoPack();
    const caseRecord = await loadCase('DISP-002');
    const evaluation = evaluateCase(caseRecord, pack);
    if (pack.source !== 'rydr_demo') throw new Error('expected demo pack');
    const quality = scoreEvidence(caseRecord, evaluation, pack.thresholds);
    expect(quality.total).toBeLessThanOrEqual(1);
    expect(quality.dimensions).toHaveLength(4);
    expect(quality.dimensions.map((d) => d.max).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('scores the supplied sample below a clean synthetic case', async () => {
    const pack = await loadDemoPack();
    if (pack.source !== 'rydr_demo') throw new Error('expected demo pack');
    const clean = await loadCase('SYN-002');
    const sample = await loadCase('DISP-002');
    const cleanScore = scoreEvidence(clean, evaluateCase(clean, pack), pack.thresholds);
    const sampleScore = scoreEvidence(sample, evaluateCase(sample, pack), pack.thresholds);
    expect(sampleScore.total).toBeLessThan(cleanScore.total);
  });
});

describe('money integrity', () => {
  it('never produces float drift', async () => {
    const pack = await loadDemoPack();
    const result = evaluateCase(await loadCase('SYN-004'), pack);
    expect(Number.isInteger(result.recommendedRefundCents ?? 0)).toBe(true);
    expect(result.recommendedRefundCents).toBe(500);
  });
});

describe('history risk screening', () => {
  it('reports flags without deciding liability', async () => {
    const base: CaseRecord = await loadCase('SYN-001');
    expect(screenHistoryRisk(base)).toEqual([]);
  });
});
