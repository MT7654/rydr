import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CaseRecordSchema, PolicyPackSchema, type CaseRecord } from '../src/domain/contracts';
import { evaluateCase } from '../src/domain/policy';
import { applyEscalationGate, scoreEvidence } from '../src/domain/confidence';
import { getCase, getCaseVersion, getAllCases, getPolicyPack, saveRuntimeCase } from '../src/repositories/cases';
import { listPrecedents } from '../src/repositories/precedents';
import { retrievePrecedents } from '../src/domain/precedentRetrieval';
import { buildCatalog } from '../src/agents/evidenceService';
import { buildDisp002Case } from '../src/domain/sourceAdapter';
import { withStorageSession } from '../src/repositories/store';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, startRun } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { getRunSnapshot } from '../src/repositories/snapshots';
import { classifyEscalation } from '../src/domain/routing';

const pack = PolicyPackSchema.parse(JSON.parse(await readFile('fixtures/policies/ryde-hackathon-policy-v2.1.json', 'utf8')));
if (pack.source !== 'hackathon_reference') throw new Error('Expected supplied reference');
const thresholds = pack.thresholds;
async function sample(id: string) { return CaseRecordSchema.parse(JSON.parse(await readFile(`fixtures/cases/${id}.json`, 'utf8'))); }
function gate(record: CaseRecord, confidence: number) {
  const evaluation = evaluateCase(record, pack);
  return applyEscalationGate({caseRecord:record,evaluation,thresholds,quality:scoreEvidence(record,evaluation,thresholds),judgeDisposition:evaluation.disposition,judgeConfidence:confidence,agentOutputInvalid:false,providerFailure:false,unresolvedCitations:[]});
}
describe('new supplied datasets and policy v2.1', () => {
  it('runs both new cases end to end and retains fare calculations and route eligibility in frozen snapshots', async () => {
    await withStorageSession(randomUUID(), async () => {
      const config={...DEFAULT_CONFIG,provider:createFixtureProvider()};
      const fareRun=await startRun('DISP-003','fixture',config,'new-supplied-fare');
      expect(fareRun.state).toBe('completed');expect(fareRun.resolution?.recommendedRefundCents).toBe(450);
      expect((await getRunSnapshot(fareRun.id))?.evaluation.fare?.differentialCents).toBe(450);
      const routeRun=await startRun('DISP-001','fixture',config,'new-supplied-route');
      expect(routeRun.state).toBe('escalated');expect(routeRun.resolution?.recommendedRefundCents).toBeNull();
      expect((await getRunSnapshot(routeRun.id))?.evaluation.route?.eligibleRefundCents).toBe(344);
    });
  });
  it('confirms the reissued DISP-002 JSON is identical and preserves v1 while attaching v2', async () => {
    const original = JSON.parse(await readFile('reference/DISP-002.source.json','utf8'));
    const markdown = await readFile('reference/organizer-20261014/DISP-002.reissued.md','utf8');
    expect(JSON.parse(markdown.slice(markdown.indexOf('{'),markdown.lastIndexOf('}')+1))).toEqual(original);
    await withStorageSession(randomUUID(), async () => {
      expect((await getCaseVersion('DISP-002',1))?.policyVersion).toBe('rydr-demo-policy-v1');
      expect((await getCase('DISP-002'))?.version).toBe(2);
      expect((await getCase('DISP-002'))?.policyVersion).toBe(pack.id);
    });
  });
  it('does not replace an existing visitor case version when a seed uses the same version', async () => {
    await withStorageSession(randomUUID(), async () => {
      const original=buildDisp002Case(JSON.parse(await readFile('reference/DISP-002.source.json','utf8')));
      const existing={...original,version:2,changeLog:['Visitor correction retained.']};
      await saveRuntimeCase(existing);
      expect((await getCase('DISP-002'))?.changeLog).toEqual(existing.changeLog);
      expect((await getAllCases()).find(c=>c.id==='DISP-002')?.policyVersion).toBe(original.policyVersion);
      expect((await getCaseVersion('DISP-002',2))?.changeLog).toEqual(existing.changeLog);
    });
  });
  it('calculates the S$4.50 surge-only refund without multiplying fixed fees', async () => {
    const record=await sample('DISP-003'); const evaluation=evaluateCase(record,pack);
    expect(evaluation.fare).toMatchObject({quotedCents:1200,chargedCents:1650,differentialCents:450,fixedFeeCents:300,reconciled:true,notified:false});
    expect(evaluation.disposition).toBe('refund'); expect(evaluation.recommendedRefundCents).toBe(450);
    expect(gate(record,0.4).requiresHumanReview).toBe(false);
  });
  it('requires verification when a surge ledger does not reconcile', async () => {
    const record=await sample('DISP-003');
    for(const e of record.evidence)if(e.kind==='fare')e.payload.fixedFeeCents=0;
    expect(evaluateCase(record,pack).disposition).toBe('human_review');
    expect(evaluateCase(record,pack).recommendedRefundCents).toBeNull();
  });
  it('retains a notified surge charge only when all required notice contents are established', async () => {
    const record=await sample('DISP-003');
    for(const e of record.evidence)if(e.kind==='fare')e.payload.notifiedBeforePickup=true;
    expect(evaluateCase(record,pack).disposition).toBe('human_review');
    for(const e of record.evidence)if(e.kind==='fare')e.payload.noticeIncludesFareAndFreeCancellation=true;
    expect(evaluateCase(record,pack).disposition).toBe('uphold');
  });
  it('computes S$3.44 distance eligibility but enforces the 4.3 km human-review limit', async () => {
    const record=await sample('DISP-001'); const result=evaluateCase(record,pack);
    expect(result.route).toMatchObject({eligibleRefundCents:344,notificationStatus:'not_informed',ledgerBasis:'aggregate_totals'});
    expect(result.route?.comparison.excessMeters).toBe(4300);
    expect(result.disposition).toBe('human_review'); expect(result.recommendedRefundCents).toBeNull();
    expect(result.issues.join(' ')).toContain('automatic ruling');
    const review = gate(record, 1);
    expect(review.requiresHumanReview).toBe(true);
    expect(classifyEscalation(review.escalationReasons)).toMatchObject({kind:'policy_required_review'});
    expect(classifyEscalation(review.escalationReasons).nextAction).toContain('record a supported decision');
  });
  it('uses the one-kilometre tolerance without the former percentage condition', async () => {
    const record=await sample('DISP-001');
    for(const e of record.evidence)if(e.kind==='route')e.payload.actualDistanceM=21501;
    const result=evaluateCase(record,pack);
    expect(result.route?.comparison.excessPercent).toBeLessThan(20);
    expect(result.disposition).toBe('partial_refund'); expect(result.recommendedRefundCents).toBe(344);
    for(const e of record.evidence)if(e.kind==='route')e.payload.actualDistanceM=21500;
    expect(evaluateCase(record,pack).disposition).toBe('uphold');
  });
  it('requires route confidence >=80% and raises the gate to95% for a recorded risk flag', async () => {
    const record=await sample('DISP-001');
    for(const e of record.evidence)if(e.kind==='route')e.payload.actualDistanceM=22300;
    expect(gate(record,0.79).requiresHumanReview).toBe(true);
    expect(gate(record,0.8).requiresHumanReview).toBe(false);
    for(const e of record.evidence)if(e.kind==='history'&&e.payload.subject==='rider')e.payload.fraudFlags=1;
    expect(gate(record,0.94).hardBlockers.join(' ')).toContain('0.95');
    expect(evaluateCase(record,pack).recommendedRefundCents).toBe(344);
  });
  it('shows both no-show contact obligations and the unresolved source-policy conflict', async () => {
    await withStorageSession(randomUUID(),async()=>{
      const record=(await getCase('DISP-002'))!;const result=evaluateCase(record,pack);
      expect(result.noShow).toMatchObject({elapsedSeconds:360,policyAmbiguity:true,accuracyPresent:false});
      expect(result.findings.find(f=>f.id==='F-CONTACT')?.text).toContain('Both are required');
      expect(result.disposition).toBe('human_review');
    });
  });
  it('retrieves only compatible supplied precedent context and never uses another category', async () => {
    const record=await sample('DISP-003');
    const precedents=await listPrecedents();
    const result=retrievePrecedents({caseRecord:record,evaluation:evaluateCase(record,pack),pack,precedents});
    expect(result.contexts.map(p=>p.caseId)).toEqual(['DISP-2026-0142']);
    expect(result.contexts[0]?.refundCents).toBe(320);
    expect(evaluateCase(record,pack).recommendedRefundCents).toBe(450);
  });
  it('keeps answer labels and source verdict commentary out of the normalized case and catalog', async () => {
    const record=await sample('DISP-001');const serialized=JSON.stringify({record,catalog:buildCatalog(record)});
    expect(serialized).not.toMatch(/expected_ruling|recommended_ruling|ruling_rationale|EV-009|credible and experienced/i);
    expect(await getPolicyPack(pack.id)).toMatchObject({source:'hackathon_reference',effectiveFrom:'2026-01-01'});
  });
  it('escalates dangerous-driving allegations even when filed as a small fare dispute', async () => {
    const record=await sample('DISP-003');record.riderStatement+=' Reckless driving made me feel unsafe.';
    expect(gate(record,1).hardBlockers.join(' ')).toContain('Safety allegation');
  });
  it('rejects automatic use outside the effective date', async () => {
    const record=await sample('DISP-003');record.trip.scheduledAt='2025-12-31T23:00:00+08:00';
    expect(evaluateCase(record,pack).disposition).toBe('human_review');
  });
});
