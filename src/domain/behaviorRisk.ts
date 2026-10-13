import type { CaseRecord } from './contracts';
import type { IntegrityAssessment, IntegritySignal } from './integrity';
export interface BehaviorRisk {score:number;band:'low'|'elevated'|'high';signals:IntegritySignal[];reviewOnly:true;}
/** Transparent triage signals; never a probability of guilt or a liability input. */
export function assessBehaviorRisk(record:CaseRecord, peers:CaseRecord[]):BehaviorRisk {
 const signals:IntegritySignal[]=[];
 for(const item of record.evidence){
  if(item.kind==='history' && item.payload.totalTrips!==null && item.payload.disputeCount!==null && item.payload.totalTrips>=10 && item.payload.disputeCount>=5 && item.payload.disputeCount/item.payload.totalTrips>=0.25)
   signals.push({code:'history_dispute_frequency',severity:'low',evidenceIds:[item.id],explanation:'A recorded history shows frequent disputes. Repeated legitimate complaints are possible; inspect source history. This changes review priority only.'});
  if(item.kind==='chat' && /(?:split|share).{0,30}(?:refund|compensation)|(?:fake|fabricat).{0,30}(?:claim|receipt|damage)/i.test(item.payload.content))
   signals.push({code:'possible_coordination_language',severity:'medium',evidenceIds:[item.id],explanation:'A message contains possible claim coordination language. Quotation, denial or reporting are benign alternatives. Read the original conversation before drawing any conclusion.'});
  if(item.kind==='image' && item.source.dataset.startsWith('upload:')){
   const matches=peers.filter(c=>c.trip.id!==record.trip.id && c.evidence.some(e=>e.kind==='image'&&e.source.dataset.startsWith('upload:')&&e.payload.hash===item.payload.hash));
   if(matches.length)signals.push({code:'cross_trip_image_reuse',severity:'medium',evidenceIds:[item.id],explanation:'The same uploaded bytes appear on '+new Set(matches.map(c=>c.trip.id)).size+' other trip record(s) in this session. Legitimate reuse is possible; inspect source provenance. Other cases remain private.'});
  }
 }
 const score=Math.min(100,signals.reduce((sum,s)=>sum+(s.severity==='medium'?30:10),0));
 return {score,band:score>=60?'high':score>=30?'elevated':'low',signals,reviewOnly:true};
}
export function combineRisk(assessment:IntegrityAssessment,risk:BehaviorRisk):IntegrityAssessment{
 const signals=[...assessment.signals,...risk.signals];
 const severity=signals.some(s=>s.severity==='high')?'high':signals.some(s=>s.severity==='medium')?'medium':signals.length?'low':'none';
 return {...assessment,signals,overallSeverity:severity,triggersReview:severity==='high'||severity==='medium'};
}
