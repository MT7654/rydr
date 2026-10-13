import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withStorageSession } from '../src/repositories/store';
import { askNavigator } from '../src/agents/navigator';
import { updateCheckpoint, submitRemedy, actOnRemedy } from '../src/repositories/journeys';
import { startRun } from '../src/agents/orchestrator';
import { orchestratorConfig } from '../src/lib/runtime';
import { listProviderCalls } from '../src/repositories/providerCalls';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const enabled = process.env.RYDR_RUN_V2_LIVE_TESTS === 'true';
const results: unknown[] = [];
describe.skipIf(!enabled)('bounded live product integration', () => {
  it('tests pickup and reimbursement guidance plus the updated three-role assessment', async () => {
    await withStorageSession(randomUUID(), async () => {
      if (process.env.RYDR_TEST_CORE_ONLY !== 'true') {
      await updateCheckpoint('rider',1,{ action:'entrance', entrance:'North entrance' });
      await updateCheckpoint('driver',2,{ action:'entrance', entrance:'South entrance' });
      const pickup = await askNavigator('rider','I am at the north entrance but the driver is at the south entrance. What should I do next?','pickup',undefined,randomUUID());
      expect(pickup.mode).toBe('live'); expect(['action_recommended','clarification_needed']).toContain(pickup.output.status);
      results.push({ feature:'pickup_navigator',status:pickup.output.status,action:pickup.output.recommendedActionId,message:pickup.output.message,latencyMs:pickup.latencyMs });
      let remedy = await submitRemedy('driver',{ caseId:'SYN-015',version:1,kind:'cleaning',amountCents:2500,note:'Synthetic receipt and trip linkage for an independent reimbursement test.',evidenceIds:['SYN015-IMG-01','SYN015-RECEIPT'] });
      remedy = await actOnRemedy('reviewer',remedy.id,remedy.revision,{ action:'approve',verified:true,tier:'food',note:'Verified the synthetic receipt, vehicle linkage, timing and sample eligibility.' });
      await actOnRemedy('reviewer',remedy.id,remedy.revision,{ action:'post' });
      const payment = await askNavigator('driver','My cleaning reimbursement has been recorded, but rider recovery is pending. Is my reimbursement waiting for the rider to pay?','payments',undefined,randomUUID());
      expect(payment.output.message).not.toMatch(/must wait|waiting for the rider/i);
      results.push({ feature:'payment_navigator',status:payment.output.status,message:payment.output.message,latencyMs:payment.latencyMs });
      const repair = await askNavigator('rider','The GPS arrival location appears uncertain. Which source record can help clarify it?','case','SYN-006',randomUUID());
      expect(['action_recommended','clarification_needed']).toContain(repair.output.status);
      results.push({ feature:'repair_navigator',status:repair.output.status,action:repair.output.recommendedActionId,message:repair.output.message,latencyMs:repair.latencyMs });
      }
      for (const [id,expected] of [['SYN-001','refund'],['SYN-015','human_review']]) {
        const run = await startRun(id,'live',orchestratorConfig('live'));
        const calls = await listProviderCalls(run.id);
        results.push({ feature:'three_role_assessment',caseId:id,state:run.state,disposition:run.resolution?.disposition,callCount:run.callCount,
          errorCode:run.errorCode, errorMessage:run.errorMessage,
          calls:calls.map(c => ({ role:c.role,ok:c.ok,latencyMs:c.latencyMs,inputTokens:c.inputTokens,outputTokens:c.outputTokens,errorCode:c.errorCode,errorMessage:c.errorMessage })) });
        expect(run.state).toBe(expected === 'human_review' ? 'escalated' : 'completed'); expect(run.resolution?.disposition).toBe(expected);
      }
    });
  },240000);
  it('writes a safe verification report', async () => {
    await fs.mkdir(path.join(process.cwd(),'docs'),{ recursive:true });
    await fs.writeFile(path.join(process.cwd(),'docs','product-v2-live-report.json'),JSON.stringify({ generatedAt:new Date().toISOString(),mode:'live',limits:'Synthetic cases and test ledger; not production accuracy or external funds movement.',results },null,2));
  });
});
