import type { CaseRecord, PolicyPack } from '@/domain/contracts';
import type { DeterministicEvaluation } from '@/domain/policy';
import { displayText } from '@/domain/displayText';
import { Cite } from './Cite';

function minutes(seconds: number) { return `${Number((seconds/60).toFixed(2))} min`; }
export function EvidenceBrief({record, evaluation, pack}: {record:CaseRecord; evaluation:DeterministicEvaluation; pack:PolicyPack}) {
  const facts=[...evaluation.findings].sort((a,b)=>Number(b.material)-Number(a.material));
  const first=facts.slice(0,3);
  function metric(id:string) {
    const noShow=evaluation.noShow;
    if (!noShow) return null;
    if (id==='F-ZONE') return {label:'Pickup-zone determination',value:noShow.arrivalZone==='indeterminate' ? 'Unresolved' : noShow.arrivalZone==='inside' ? 'Inside zone' : 'Outside zone'};
    if (id==='F-GAP' && noShow.maxGapSeconds!==null) return {label:'Largest GPS sample gap',value:minutes(noShow.maxGapSeconds)};
    if (id==='F-START' && noShow.elapsedSeconds!==null) return {label:noShow.materialStartConflict ? 'Latest candidate clock' : 'Effective waiting clock',value:minutes(noShow.elapsedSeconds)};
    return null;
  }
  const clock=evaluation.noShow;
  const threshold=pack.source==='supplied_sample'?null:pack.thresholds.noShowThresholdSeconds;
  const intervals=clock ? [{label:'Effective clock',seconds:clock.elapsedSeconds,start:clock.effectiveStartAt},{label:'Earliest candidate',seconds:clock.elapsedUnderEarliestSeconds,start:clock.earliestStartAt}].filter((x):x is {label:string;seconds:number;start:string|null}=>x.seconds!==null && x.seconds>=0) : [];
  const max=Math.max(threshold??0,...intervals.map(x=>x.seconds),1);
  return <section className="evidence-brief" aria-label="Decision brief"><div className="brief-introduction"><figure className="brief-art"><img src="/illustrations/ride-evidence-guide.png" alt="A miniature ride, pickup pins and evidence tools"/><figcaption>Visual guide · case records below</figcaption></figure><div className="section-heading"><div><p className="eyebrow">Read the ride, before the report</p><h2>The evidence at a glance</h2></div><span className="brief-reference">{record.id} · v{record.version}</span></div></div>
    <div className="brief-findings">{first.map(f=><article className="brief-finding" key={f.id}><span className="brief-number" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">{f.id!=="F-ZONE" && (f.id==="F-GAP" || f.id==="F-START")?<><circle cx="16" cy="16" r="11"/><path d="M16 9v7l5 4"/></>:f.id==="F-ZONE"?<><path d="M16 28S6 18 6 12a10 10 0 0120 0c0 6-10 16-10 16Z"/><circle cx="16" cy="12" r="3"/></>:<><rect x="7" y="4" width="18" height="24" rx="3"/><path d="M11 11h10M11 16h10M11 21h6"/></>}</svg></span><div>{metric(f.id) ? <div className="brief-metric"><span>{metric(f.id)?.label}</span><strong>{metric(f.id)?.value}</strong></div>:null}<span className={`fact-kind fact-kind--${f.kind}`}>{f.kind==='computed'?'Calculated from records':f.kind==='unknown'?'Unresolved':f.kind==='claim'?'Party claim':f.kind==='observation'?'Recorded observation':'Inference'}</span><p>{displayText(f.text)}</p><div className="fact-sources">{f.evidenceIds.map((id,index)=><Cite key={id} id={id} kind="evidence">Source {index+1}</Cite>)}{f.policyIds.map((id,index)=><Cite key={id} id={id} kind="policy">Rule {index+1}</Cite>)}</div></div></article>)}</div>
    {intervals.length ? <figure className="clock-comparison"><figcaption><strong>The waiting clock</strong><span>Singapore time · {clock?.materialStartConflict ? 'Competing interpretations' : 'Recorded intervals'}</span></figcaption><div className="clock-plot">{intervals.map((interval,i)=><div className="clock-row" key={interval.label}><div><strong>{interval.label}</strong><span>{interval.start?new Date(interval.start).toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Singapore'}):'Start unavailable'}</span></div><div className="clock-track"><div className={`clock-bar clock-bar--${i}`} style={{width:`${100*interval.seconds/max}%`}}/><span className="clock-duration">{minutes(interval.seconds)}</span>{threshold!==null?<span className="clock-threshold" style={{left:`${100*threshold/max}%`}} aria-hidden="true"/>:null}</div></div>)}</div><p className="small">{threshold!==null?`Policy threshold: ${minutes(threshold)}. `:'No executable threshold is supplied. '}{clock?.materialStartConflict?'The governing clock remains disputed; these durations are not a final liability decision.':'These durations do not establish the other cancellation conditions.'}</p></figure> : null}
    {evaluation.issues.length ? <div className="brief-blocker"><span className="brief-blocker__mark" aria-hidden="true">!</span><div><strong>What still needs attention</strong><ul>{evaluation.issues.map((issue,i)=><li key={i}>{displayText(issue)}</li>)}</ul></div></div> : <p className="small brief-clear">No unresolved issue identified by the policy checks. The recorded assessment and outcome remain the source of the decision.</p>}
  </section>;
}
