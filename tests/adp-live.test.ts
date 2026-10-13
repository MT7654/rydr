/**
 * Live ADP integration tests.
 * These require ADP credentials and make real API calls.
 * Skip if credentials are not configured.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { orchestratorConfig } from '../src/lib/runtime';
import { startRun } from '../src/agents/orchestrator';
import { loadSeedCases } from '../src/repositories/cases';

const hasCredentials = Boolean(
  process.env.RYDR_ADP_ENDPOINT &&
    process.env.RYDR_ADP_RIDER_APPKEY &&
    process.env.RYDR_ADP_DRIVER_APPKEY &&
    process.env.RYDR_ADP_JUDGE_APPKEY,
);

const describeIf = hasCredentials && process.env.RYDR_RUN_LIVE_TESTS === 'true' ? describe : describe.skip;

describeIf('live ADP integration', () => {
  beforeAll(() => {
    // Ensure live mode for this test file
    process.env.RYDR_AGENT_MODE = 'live';
  });

  it('runs SYN-001 (no-show refund) through live ADP agents', async () => {
    const cases = await loadSeedCases();
    const testCase = cases.find((c) => c.id === 'SYN-001');
    expect(testCase).toBeDefined();

    const config = orchestratorConfig('live');
    expect(config.provider.id).toBe('adp');
    expect(config.provider.external).toBe(true);

    const run = await startRun(testCase!.id, 'live', config);

    const completed = run;

    expect(completed.state).toBe('completed');
    expect(completed.resolution).toBeDefined();
    expect(completed.resolution!.disposition).toBe('refund');
    expect(completed.callCount).toBeGreaterThan(0);
    expect(completed.callCount).toBeLessThanOrEqual(config.maxCallsPerRun);

    console.log('Live SYN-001 result:', {
      disposition: completed.resolution!.disposition,
      recommendedRefundCents: completed.resolution!.recommendedRefundCents,
      callCount: completed.callCount,
      evidenceQualityScore: completed.resolution!.evidenceQualityScore,
    });
  }, 120000);

  it('runs SYN-005 (route uphold) through live ADP agents', async () => {
    const cases = await loadSeedCases();
    const testCase = cases.find((c) => c.id === 'SYN-005');
    expect(testCase).toBeDefined();

    const config = orchestratorConfig('live');

    const run = await startRun(testCase!.id, 'live', config);

    const completed = run;

    expect(completed.state).toBe('completed');
    expect(completed.resolution).toBeDefined();
    expect(completed.resolution!.disposition).toBe('uphold');

    console.log('Live SYN-005 result:', {
      disposition: completed.resolution!.disposition,
      recommendedRefundCents: completed.resolution!.recommendedRefundCents,
      callCount: completed.callCount,
      evidenceQualityScore: completed.resolution!.evidenceQualityScore,
    });
  }, 120000);
});
