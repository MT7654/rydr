import { describe,it,expect,afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withStorageSession } from '../src/repositories/store';
import { reserveProviderAttempt } from '../src/repositories/providerBudget';
import { getCase,getPolicyPack } from '../src/repositories/cases';
import { submitSupportingRecord,supportingRequests,readSupportingAttachment } from '../src/repositories/repairSupport';
import { getCheckpoint,updateCheckpoint,requestRepair,submitRemedy,actOnRemedy } from '../src/repositories/journeys';
import { initialCheckpoint,transitionPickup,validateNavigator } from '../src/domain/journeys';
import { checkpointPolicyPreview } from '../src/domain/pickupPolicy';
import { remedyReceipt } from '../src/domain/remedyReceipt';
import { repairComparison } from '../src/repositories/repairComparison';
import { crossCaseEvidenceSignals,remedyMetrics } from '../src/domain/journeyMetrics';
import { listReviewTasksForCase } from '../src/repositories/reviewTasks';
import { mkdir,writeFile } from 'node:fs/promises';
const isolate = <T>(fn:()=>Promise<T>)=>withStorageSession(randomUUID(),fn);
afterEach(()=>{delete process.env.RYDR_MAX_PROVIDER_CALLS_PER_DAY;});
describe('remaining product v2 acceptance',()=>{
  it('shares the paid-call cap across fresh visitors, including concurrent attempts and day reset',async()=>{
    process.env.RYDR_MAX_PROVIDER_CALLS_PER_DAY='2'; const day=new Date('2099-01-01T00:00:00Z');
    const attempts=await Promise.all(Array.from({length:5},()=>isolate(()=>reserveProviderAttempt(day))));
    expect(attempts.filter(Boolean)).toHaveLength(2);expect(await isolate(()=>reserveProviderAttempt(day))).toBe(false);
    expect(await reserveProviderAttempt(new Date('2099-01-02T00:00:00Z'))).toBe(true);
  });
  it('supports an owner-private correction and rejects stale or duplicate submissions',async()=>isolate(async()=>{
    const key=randomUUID();const input={kind:'gps_accuracy',sampleIds:['SYN006-GPS-01'],accuracyMeters:6,provenanceNote:'Party-supplied screenshot claim.'};
    const a=await submitSupportingRecord('SYN-006',1,'rider','GPS source proposes a six metre accuracy radius.',key,input);
    const b=await submitSupportingRecord('SYN-006',1,'rider','GPS source proposes a six metre accuracy radius.',key,input);expect(b).toEqual(a);
    expect(await supportingRequests('SYN-006','driver')).toHaveLength(0);
    const requests=await supportingRequests('SYN-006','rider');expect(requests).toHaveLength(1);expect(requests[0].responseVerification).toBeNull();expect((await getCase('SYN-006'))?.version).toBe(1);
    await expect(submitSupportingRecord('SYN-006',99,'rider','This record is stale for the case.',randomUUID())).rejects.toThrow(/changed/);
  }));
  it('keeps PDF bytes private to the submitting role and reviewer, and does not create evidence from an irrelevant document',async()=>isolate(async()=>{
    await submitSupportingRecord('SYN-006',1,'rider','This unrelated receipt does not prove arrival accuracy.',randomUUID(),undefined,new File(['%PDF-1.4\nSynthetic test document'], 'sample.pdf',{type:'application/pdf'}));
    const [request]=await supportingRequests('SYN-006','rider');const id=request.responseEvidenceIds[0];
    expect((await readSupportingAttachment(id,'SYN-006','reviewer')).toString()).toContain('Synthetic');
    await expect(readSupportingAttachment(id,'SYN-006','driver')).rejects.toThrow(/unavailable/);
    expect((await getCase('SYN-006'))?.version).toBe(1);
    await expect(submitSupportingRecord('SYN-006',1,'driver','Wrong file type must not be accepted.',randomUUID(),undefined,new File(['<script>bad</script>'],'x.pdf',{type:'application/pdf'}))).rejects.toThrow(/PDF/);
  }));
  it('shows actual changed findings without inventing a prior assessment',async()=>isolate(async()=>{
    const repair=await requestRepair('SYN-006',1,'missing_gps_accuracy','rider').catch(async()=>{
      const {buildEvidencePlan}=await import('../src/domain/evidencePlan');const {evaluateCase}=await import('../src/domain/policy');const c=(await getCase('SYN-006'))!;return requestRepair(c.id,c.version,buildEvidencePlan(c,evaluateCase(c,await getPolicyPack(c.policyVersion))).conditions[0].id,'rider');
    });expect(repair.resultingVersion).toBe(2);
    const comparison=await repairComparison('SYN-006','rider');expect(comparison?.changes.length).toBeGreaterThan(0);expect(comparison?.beforeDisposition).toBeNull();expect(comparison?.afterDisposition).toBeNull();
    expect(await repairComparison('SYN-006','driver')).toBeNull();
  }));
  it('uses the selected policy engine at exact waiting boundaries and holds unresolved access',async()=>{
    const template=(await getCase('SYN-011'))!;const pack=await getPolicyPack(template.policyVersion);let c=initialCheckpoint();
    c=transitionPickup(c,'driver',{action:'contact'});c=transitionPickup(c,'driver',{action:'playback',seconds:180});
    expect(checkpointPolicyPreview(c,template,pack).disposition).toBe('refund');
    c=transitionPickup(c,'driver',{action:'playback',seconds:181});expect(checkpointPolicyPreview(c,template,pack).disposition).toBe('uphold');
    c=transitionPickup(c,'rider',{action:'entrance',entrance:'North entrance'});c=transitionPickup(c,'driver',{action:'entrance',entrance:'South entrance'});
    expect(checkpointPolicyPreview(c,template,pack).disposition).toBe('human_review');
  });
  it('routes safety out of normal pickup and preserves party claims in the linked case',async()=>isolate(async()=>{
    const c=await updateCheckpoint('rider',1,{action:'safety'});expect(c.status).toBe('review_requested');expect(c.safetyReported).toBe(true);
    const tasks=await listReviewTasksForCase(c.linkedCaseId!);expect(tasks[0].routing?.lane).toBe('safety');
    await expect(updateCheckpoint('driver',c.revision,{action:'pickup'})).rejects.toThrow(/closed/);
    expect((await getCase(c.linkedCaseId!))?.disputedCents).toBe(0);expect((await getCheckpoint()).policyId).toContain('ryde');
  }));
  it('produces distinct private receipts and actual unrecovered exposure',async()=>isolate(async()=>{
    let r=await submitRemedy('driver',{caseId:'SYN-015',version:1,kind:'cleaning',amountCents:2500,evidenceIds:['SYN015-IMG-01','SYN015-RECEIPT'],note:'Please verify this synthetic professional receipt.'});
    r=await actOnRemedy('reviewer',r.id,r.revision,{action:'approve',verified:true,tier:'food',note:'Private reviewer note with full verification of sample linkage and timing.'});
    r=await actOnRemedy('reviewer',r.id,r.revision,{action:'post'});
    const driver=remedyReceipt(r,'driver');const rider=remedyReceipt(r,'rider');expect(driver.receiptId).not.toBe(rider.receiptId);expect(driver.netCreditCents).toBe(2500);expect(rider.entries).toHaveLength(0);
    expect(JSON.stringify(driver)).not.toContain('Private reviewer');expect(JSON.stringify(rider)).not.toContain('Private reviewer');
    expect(remedyMetrics([r]).unrecoveredCleaningCents).toBe(2500);
    r=await actOnRemedy('reviewer',r.id,r.revision,{action:'recover'});expect(remedyMetrics([r]).unrecoveredCleaningCents).toBe(0);expect(remedyReceipt(r,'rider').netCreditCents).toBe(-2500);
  }));
  it('flags identical uploaded files across trips without a fraud verdict, and excludes static sample illustrations',async()=>{
    const a=(await getCase('SYN-015'))!;const b=structuredClone(a);b.id='OTHER';b.trip.id='OTHER-TRIP';
    expect(crossCaseEvidenceSignals([a,b])).toHaveLength(0);
    for(const c of [a,b])for(const e of c.evidence)if(e.kind==='image')e.payload.assetUrl=`/api/images/${e.payload.hash}`;
    expect(crossCaseEvidenceSignals([a,b])[0].explanation).toContain('does not establish fraud');
  });
  it('rejects Navigator execution claims despite otherwise valid references',()=>{
    expect(()=>validateNavigator({schemaVersion:'rydr-navigator-v1',status:'no_supported_action',message:'I have transferred money to your bank.',matchedFindingIds:[],recommendedActionId:null,sourceOwner:null,clarificationQuestion:null,evidenceIds:[],policyIds:[]},{actions:[],findingIds:[],evidenceIds:[],policyIds:[]})).toThrow(/execution/);
  });
  it('records a measured synthetic boundary evaluation, with expected labels outside runtime inputs',async()=>{
    const template=(await getCase('SYN-011'))!;const pack=await getPolicyPack(template.policyVersion);const rows=[];
    for(const [seconds,expected] of [[179,'refund'],[180,'refund'],[181,'uphold']] as const){let c=transitionPickup(initialCheckpoint(),'driver',{action:'contact'});c=transitionPickup(c,'driver',{action:'playback',seconds});const actual=checkpointPolicyPreview(c,template,pack).disposition;expect(actual).toBe(expected);rows.push({seconds,expected,actual,externalCalls:0});}
    await mkdir('docs',{recursive:true});await writeFile('docs/product-v2-boundary-evaluation.json',JSON.stringify({generatedAt:new Date().toISOString(),source:'labelled synthetic playback',scope:'Three boundary cases; not production accuracy or measured user savings.',rows},null,2));
  });
});

