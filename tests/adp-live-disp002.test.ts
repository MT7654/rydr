/**
 * Live ADP test: DISP-002 (ambiguous case) should escalate to human_review.
 * Requires ADP credentials. Skips if not configured.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { orchestratorConfig } from '../src/lib/runtime';
import { startRun } from '../src/agents/orchestrator';
import { getCase } from '../src/repositories/cases';

const hasCredentials = Boolean(
  process.env.RYDR_ADP_ENDPOINT &&
    process.env.RYDR_ADP_RIDER_APPKEY &&
    process.env.RYDR_ADP_DRIVER_APPKEY &&
    process.env.RYDR_ADP_JUDGE_APPKEY,
);

const describeIf = hasCredentials && process.env.RYDR_RUN_LIVE_TESTS === 'true' ? describe : describe.skip;

describeIf('live ADP — DISP-002 escalation', () => {
  beforeAll(() => {
    process.env.RYDR_AGENT_MODE = 'live';
  });

  it('escalates DISP-002 to human_review through live agents', async () => {
    const testCase = await getCase('DISP-002');
    expect(testCase).toBeDefined();
    expect(testCase!.category).toBe('no_show_charge');

    const config = orchestratorConfig('live');
    expect(config.provider.id).toBe('adp');

    const run = await startRun(testCase!.id, 'live', config);

    console.log('DISP-002 live result:', {
      state: run.state,
      disposition: run.resolution?.disposition ?? null,
      recommendedRefundCents: run.resolution?.recommendedRefundCents ?? null,
      callCount: run.callCount,
      escalationReasons: run.resolution?.escalationReasons ?? [],
    });

    // Should escalate, not complete with a forced ruling
    expect(run.state).toBe('escalated');
    expect(run.resolution).toBeDefined();
    expect(run.resolution!.disposition).toBe('human_review');
    expect(run.resolution!.recommendedRefundCents).toBeNull();
    // callCount may be undefined on escalated runs; the key assertion is state + disposition
    if (run.callCount !== undefined) {
      expect(run.callCount).toBeGreaterThan(0);
      expect(run.callCount).toBeLessThanOrEqual(config.maxCallsPerRun);
    }
  }, 300000);
});
