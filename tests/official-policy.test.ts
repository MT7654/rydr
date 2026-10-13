import { describe, expect, it } from 'vitest';
import { PolicyPackSchema, type CaseRecord } from '../src/domain/contracts';
import { evaluateCase } from '../src/domain/policy';
import { loadCase, loadDemoPack, clone } from './helpers';
import { getPolicyPack } from '../src/repositories/cases';
import { toClauseRefs } from '../src/providers/runtimeInput';
import { startRun, DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { getRunSnapshot } from '../src/repositories/snapshots';
import { canAccessDemoPath } from '../src/domain/demoAccess';

function cancellationAfter(record: CaseRecord, seconds: number) {
  const result = clone(record);
  const arrival = result.evidence.find(e => e.kind === 'trip_event' && e.payload.eventType === 'driver_pressed_im_here')!;
  const at = new Date(Date.parse(arrival.timestamp!) + seconds * 1000).toISOString();
  for (const e of result.evidence) if (e.kind === 'trip_event' && ['driver_cancelled_no_show', 'cancellation_fee_applied'].includes(e.payload.eventType)) e.timestamp = at;
  // Do not use samples recorded after this cancellation to prove waiting presence.
  result.evidence = result.evidence.filter(e => e.kind !== 'gps' || !e.timestamp || Date.parse(e.timestamp) <= Date.parse(at));
  return result;
}

describe('official policy grounding', () => {
  it('uses the strict more-than-three-minute boundary for a scoped no-show example', async () => {
    const record = await loadCase('SYN-011'); const pack = await getPolicyPack(record.policyVersion);
    expect(evaluateCase(cancellationAfter(record, 180), pack).disposition).toBe('refund');
    expect(evaluateCase(cancellationAfter(record, 181), pack).disposition).toBe('uphold');
    expect(evaluateCase(record, pack).recommendedRefundCents).toBe(0);
  });
  it('requires a matching booking type, actual no-show cancellation, charge basis and historical scope', async () => {
    const base = await loadCase('SYN-011'); const pack = await getPolicyPack(base.policyVersion);
    const unknown = clone(base); unknown.trip.bookingType = 'unknown';
    const wrongFee = clone(base); wrongFee.disputedCents = 500;
    const noCancel = clone(base); noCancel.evidence = noCancel.evidence.filter(e => e.kind !== 'trip_event' || e.payload.eventType !== 'driver_cancelled_no_show');
    const old = clone(base); for (const e of old.evidence) if (e.timestamp) e.timestamp = '2026-09-01' + e.timestamp.slice(10);
    const supplied = clone(base); supplied.suppliedPolicyId = 'supplied-sample-policy';
    for (const record of [unknown, wrongFee, noCancel, old, supplied]) {
      const result = evaluateCase(record, pack);
      expect(result.disposition).toBe('human_review'); expect(result.recommendedRefundCents).toBeNull();
    }
  });
  it('does not invent an early-arrival clock for advance bookings', async () => {
    const record = await loadCase('SYN-012'); record.trip.scheduledAt = '2026-10-02T08:50:00+08:00';
    const result = evaluateCase(record, await getPolicyPack(record.policyVersion));
    expect(result.disposition).toBe('human_review'); expect(result.noShow?.policyAmbiguity).toBe(true);
  });
  it('treats missing contact as a review gap rather than an official refund entitlement', async () => {
    const record = await loadCase('SYN-011'); record.evidence = record.evidence.filter(e => e.kind !== 'chat' && e.kind !== 'call');
    const result = evaluateCase(record, await getPolicyPack(record.policyVersion));
    expect(result.noShow?.contactAttempts).toBe(0); expect(result.disposition).toBe('human_review');
  });
  it('does not auto-award route differences or cleaning caps', async () => {
    for (const id of ['SYN-013', 'SYN-014']) {
      const record = await loadCase(id); const result = evaluateCase(record, await getPolicyPack(record.policyVersion));
      expect(result.disposition).toBe('human_review'); expect(result.recommendedRefundCents).toBeNull();
      expect(result.policyIds.some(id => id.startsWith('RYDE-'))).toBe(true);
    }
  });
  it('retains the original sample and demo rules', async () => {
    const sample = await loadCase('DISP-002'); const pack = await loadDemoPack();
    expect(sample.policyVersion).toBe('rydr-demo-policy-v1');
    expect(evaluateCase(sample, pack).disposition).toBe('human_review');
    if (pack.source !== 'supplied_sample') expect(pack.thresholds.noShowThresholdSeconds).toBe(480);
  });
  it('passes official sources and safeguard labels to agents and freezes them in the run snapshot', async () => {
    const record = await loadCase('SYN-011'); const pack = await getPolicyPack(record.policyVersion);
    const refs = toClauseRefs(pack.clauses);
    expect(refs.find(c => c.id === 'NS-04')?.text).toContain('https://help.rydesharing.com/');
    expect(refs.find(c => c.id === 'NS-01')?.text).toContain('not official Ryde policy');
    const run = await startRun(record.id, 'fixture', { ...DEFAULT_CONFIG, provider: createFixtureProvider() }, 'official-grounding');
    expect(run.state).toBe('completed'); expect(run.resolution?.disposition).toBe('uphold');
    const snapshot = await getRunSnapshot(run.id);
    expect(snapshot?.policyPack.source).toBe('ryde_official');
    expect(snapshot?.policyPack.clauses.find(c => c.id === 'NS-04')?.sourceUrl).toContain('rydesharing.com');
  });
  it('validates official source hosts and permits the public policy page for every role', async () => {
    const pack = clone(await getPolicyPack('ryde-on-demand-no-show-20261002'));
    pack.clauses[0]!.sourceUrl = 'https://example.com/policy';
    expect(() => PolicyPackSchema.parse(pack)).toThrow();
    for (const role of [null, 'rider', 'driver', 'reviewer'] as const) expect(canAccessDemoPath(role, '/policies')).toBe(true);
  });
});

