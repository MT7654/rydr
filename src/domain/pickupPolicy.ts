import type { CaseRecord, PolicyPack, EvidenceItem } from './contracts';
import type { Checkpoint } from './journeys';
import { evaluateCase } from './policy';
/** Frozen scripted source records, never derived from party claims as verified GPS. */
export function checkpointPolicyPreview(c: Checkpoint, template: CaseRecord, pack: PolicyPack) {
  if (c.playbackSeconds === null) return { disposition:'not_checked', summary:'Play the labelled source sequence to inspect the waiting condition. Party entrance reports are not GPS.', findings:[] as string[] };
  if (pack.id !== c.policyId || template.trip.bookingType !== c.bookingType) return { disposition:'human_review',summary:'Policy scope mismatch. Reviewer clarification is required.',findings:[] as string[] };
  const start = Date.parse('2026-10-02T00:45:05Z'); const at = (s:number)=>new Date(start+s*1000).toISOString();
  const source = { dataset:'checkpoint-script-v1',jsonPointer:'/events',provenance:'synthetic' as const };
  const gps = template.evidence.find(e=>e.kind === 'gps'); if (!gps || gps.kind !== 'gps') throw new Error('Sample GPS template unavailable.');
  const evidence:EvidenceItem[] = [0,Math.floor(c.playbackSeconds/2),c.playbackSeconds].map((s,i)=>({ ...gps,id:`PICKUP-GPS-${i}`,timestamp:at(s),source,payload:{ ...gps.payload,status:i === 0 ? 'arrived' : i === 2 ? 'cancelled' : 'waiting' } }));
  evidence.push({ id:'PICKUP-ARRIVAL',kind:'trip_event',timestamp:at(0),source,qualityIssues:[],payload:{eventType:'driver_pressed_im_here',details:'Scripted arrival for on-demand policy boundary testing.'} },{ id:'PICKUP-CANCEL',kind:'trip_event',timestamp:at(c.playbackSeconds),source,qualityIssues:[],payload:{eventType:'driver_cancelled_no_show',details:'Hypothetical cancellation; no charge executed.'} });
  if(c.contactAttempts) evidence.push({id:'PICKUP-CONTACT',kind:'chat',timestamp:at(1),source,qualityIssues:['Scripted contact; no delivery or response proved.'],payload:{sender:'driver',type:'message',content:'I am at the pickup point. Please check your entrance.'}});
  const evaluation = evaluateCase({...template,trip:{...template.trip,scheduledAt:at(0)},evidence},pack);
  const mismatch = c.riderEntrance && c.driverEntrance && c.riderEntrance !== c.driverEntrance && c.status !== 'clarified';
  const disposition = c.safetyReported || mismatch ? 'human_review' : evaluation.disposition;
  return { disposition, summary: c.safetyReported ? 'Safety review takes priority; normal cancellation actions remain paused.' : mismatch ? 'Rydr proposed access safeguard: hold the recommendation while entrances differ. This pause is not a published Ryde rule.' : disposition === 'refund' ? 'The sample source does not support a no-show charge at this waiting boundary.' : disposition === 'uphold' ? 'The scripted records support the policy conditions. This is a preview, not a posted charge or proof of rider absence.' : 'An eligibility condition remains unresolved. Request review before any charge.', findings:evaluation.findings.filter(f=>f.material).map(f=>f.text).slice(0,3) };
}
