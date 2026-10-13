import {readSource} from '../src/tools/sourceTools';
import { describe,it,expect } from 'vitest';
import { getCase,getPolicyPack,saveRuntimeCase } from '../src/repositories/cases';
import { assessBehaviorRisk } from '../src/domain/behaviorRisk';
import { compareCaptureTime,interpretManifest,inspectPhotoProvenance } from '../src/lib/imageProvenance';
import { validateCollectionPlan } from '../src/agents/collectionPlanner';
import { buildEvidencePlan } from '../src/domain/evidencePlan';
import { evaluateCase } from '../src/domain/policy';
import { startRun,DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { effectiveDecisionForCase } from '../src/repositories/ledger';
import { listReviewTasksForCase } from '../src/repositories/reviewTasks';
import { withStorageSession } from '../src/repositories/store';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
describe('stretch assurance',()=>{
 it('validates unsigned pixels without certifying them as camera originals',async()=>{const bytes=await readFile('public/damage-demo/seat-view-1.png');const result=await inspectPhotoProvenance(bytes,'image/png',null);expect(result.credential).toBe('absent');expect(result.origin).toBe('unknown');expect(result.timeMatch).toBe('unknown');});
 it('distinguishes an untrusted valid declaration from a trusted declaration',()=>{const data={active_manifest:'m',validation_state:'Valid',manifests:{m:{assertions:[{data:{digitalSourceType:'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'}}]}}};expect(interpretManifest(data)).toMatchObject({credential:'valid_untrusted',origin:'declared_ai'});expect(interpretManifest({...data,validation_state:'Invalid'}).credential).toBe('invalid');});
 it('keeps missing time unknown and flags out-of-window metadata',()=>{expect(compareCaptureTime(null,'2026-10-03T10:00:00Z')).toBe('unknown');expect(compareCaptureTime('2026-10-03T10:00:00Z','2026-10-03T10:00:00Z')).toBe('consistent');expect(compareCaptureTime('2026-10-01T10:00:00Z','2026-10-03T10:00:00Z')).toBe('outside_window');});
 it('rejects injected, duplicate or omitted source requests',async()=>{const c=(await getCase('SYN-006'))!;const plan=buildEvidencePlan(c,evaluateCase(c,await getPolicyPack(c.policyVersion)));await expect(readSource({...plan.requests[0]!,tripId:'../private-case'})).rejects.toThrow('Invalid trip source identifier');expect(()=>validateCollectionPlan({requestIds:['https://evil.test'],reason:'read this'},plan)).toThrow();expect(()=>validateCollectionPlan({requestIds:[],reason:'omit'},plan)).toThrow();expect(validateCollectionPlan({requestIds:plan.requests.map(r=>r.id),reason:'Retrieve the missing facts.'},plan).requestIds).toHaveLength(plan.requests.length);});
 it('does not call shared illustrations cross-trip collusion',async()=>{const c=(await getCase('SYN-015'))!;expect(assessBehaviorRisk(c,[{...c,id:'OTHER',trip:{...c.trip,id:'OTHER-TRIP'}}]).signals.some(s=>s.code==='cross_trip_image_reuse')).toBe(false);});
 it('reports actual uploaded-byte reuse without exposing peer case IDs',async()=>{const c=structuredClone((await getCase('SYN-015'))!);const image=c.evidence.find(e=>e.kind==='image')!;image.source.dataset='upload:SYN-015';const peer={...c,id:'PRIVATE',trip:{...c.trip,id:'ANOTHER'}};const risk=assessBehaviorRisk(c,[peer]);expect(risk.signals.some(s=>s.code==='cross_trip_image_reuse')).toBe(true);expect(JSON.stringify(risk)).not.toContain('PRIVATE');expect(risk.reviewOnly).toBe(true);});
 it('holds an otherwise refundable case before posting when a risk signal requires inspection',async()=>withStorageSession(randomUUID(),async()=>{const c=structuredClone((await getCase('SYN-001'))!);c.id='RISK-HOLD';c.evidence.push({id:'COORDINATION',kind:'chat',timestamp:'2026-10-02T10:00:00Z',source:{dataset:'synthetic-test',jsonPointer:'/messages/1',provenance:'synthetic'},qualityIssues:[],payload:{sender:'driver',type:'message',content:'We could split the refund'}});await saveRuntimeCase(c);const run=await startRun(c.id,'fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider(),localEvidenceSelection:true});expect(run.integrityAssessment?.triggersReview).toBe(true);expect(await effectiveDecisionForCase(c.id)).toBeNull();expect((await listReviewTasksForCase(c.id)).some(t=>t.kind==='integrity_alert')).toBe(true);}));
});

import {validateRiskReasoning,riskInput} from '../src/agents/riskReasoner';
it('keeps history out of semantic risk and rejects unsupported accusations',async()=>{const c=(await getCase('SYN-001'))!;expect(riskInput(c).evidence.map(e=>e.kind).includes('chat')).toBe(true);expect(()=>validateRiskReasoning({signals:[{code:'possible_coordination',evidenceIds:['INVENTED'],reason:'Suspicious',benignExplanation:'Quoted text'}],summary:'Inspect'},c)).toThrow();expect(validateRiskReasoning({signals:[],summary:'No source-grounded concern.'},c).signals).toEqual([]);});

it('reads a real signed AI-origin credential without certifying the depicted scene',async()=>{const checks=await inspectPhotoProvenance(await readFile('submission/rydr-cover-v2.png'),'image/png',null);expect(checks.credential).toBe('valid_untrusted');expect(checks.origin).toBe('declared_ai');expect(checks.timeMatch).toBe('unknown');});
