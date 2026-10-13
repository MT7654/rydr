import type { CaseRecord } from './contracts';
import type { Remedy } from './journeys';
export function remedyMetrics(remedies:Remedy[]) {
  const posted = remedies.filter(r=>r.status === 'posted');
  const driverCredits = posted.flatMap(r=>r.entries).filter(e=>e.account === 'driver').reduce((n,e)=>n+(e.direction === 'credit'?e.amountCents:-e.amountCents),0);
  const recovery = posted.flatMap(r=>r.entries).filter(e=>e.account === 'platform_recovery').reduce((n,e)=>n+(e.direction === 'credit'?e.amountCents:-e.amountCents),0);
  return {submitted:remedies.length,posted:posted.length,driverCreditsCents:driverCredits,recoveredCents:recovery,
    unrecoveredCleaningCents:Math.max(0,driverCredits-recovery),pausedRecoveries:posted.filter(r=>r.recovery === 'disputed').length,
    postedBeforeRecovery:posted.filter(r=>r.kind === 'cleaning' && r.recovery !== 'received').length};
}
export function crossCaseEvidenceSignals(cases:CaseRecord[]) {
  const files = new Map<string,{caseId:string;tripId:string;evidenceId:string}[]>();
  for(const c of cases)for(const e of c.evidence)if(e.kind === 'image' && e.payload.assetUrl.startsWith('/api/images/')){
    const matches = files.get(e.payload.hash) ?? [];matches.push({caseId:c.id,tripId:c.trip.id,evidenceId:e.id});files.set(e.payload.hash,matches);
  }
  return [...files.entries()].filter(([,refs])=>new Set(refs.map(r=>r.tripId)).size > 1).map(([hash,refs])=>({hash,references:refs,
    explanation:'Identical uploaded file appears in records for different trips. Inspect provenance and legitimate reuse before relying on it. This signal does not establish fraud, collusion or liability.'}));
}
