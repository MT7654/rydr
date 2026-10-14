import Link from 'next/link';
import type { ReactNode } from 'react';
import { WorkspaceInteractions } from './WorkspaceInteractions';
import type { WorkspaceData } from '@/lib/workspace';
import { navigatorReady } from '@/agents/navigator';
import { CitationDrawer } from '@/components/CitationDrawer';
import { NavigatorPanel } from '@/components/NavigatorPanel';
import { RepairSupport } from '@/components/RepairSupport';
import { EvidenceRepair } from '@/components/EvidenceRepair';
import { listRepairs } from '@/repositories/journeys';
import { healthSnapshot } from '@/lib/runtime';
import { workspaceHref } from '@/domain/workspaceRoute';
import { PolicyBasis } from '@/components/PolicyBasis';
import { ReadableText } from '@/components/ReadableText';
import { CaseVisual } from '@/components/CaseVisuals';
import { Cite } from '@/components/Cite';
import { WorkspaceHeader } from './WorkspaceHeader';
import { NextActionPanel } from './NextActionPanel';
import { CaseViewTabs } from './CaseViewTabs';
import { PartyBrief } from './PartyBrief';
import { PartyEvidence } from './PartyEvidence';
import { PartyOutcome } from './PartyOutcome';
import { PartyHistory } from './PartyHistory';
export async function PartyWorkspace({data,notice,error,selector,payments}:{data:WorkspaceData;notice?:string;error?:string;selector?:ReactNode;payments?:ReactNode}) {
 const {view,packet,role}=data;const record=packet.caseRecord;
 const runId=data.historical?packet.run?.id:null;
 const sourceRunId=packet.renderedFromSnapshot?packet.run?.id??null:runId;
 const href=(section:string)=>workspaceHref(record.id,role,section,{taskId:view.selectedTaskId,runId});
 const repairs=await listRepairs(record.id,role);
 const active=data.explicitSection?data.section:packet.effectiveDecision?'outcome':view.primaryAction?.section??'brief';
 const history=active==='history';
 const evidence=active==='evidence'||data.requests.some(r=>r.recipient===role&&(r.status==='open'||(!packet.effectiveDecision&&r.status==='submitted')));
 const own=role==='driver'?record.driverStatement:record.riderStatement;
 return <main className="container workspace party-ride">
  <WorkspaceInteractions/>{selector}
  <WorkspaceHeader view={view} caseRecord={record} role={role} activeCaseId={record.id} runId={runId}/>
  <div className="ride-ribbon" aria-label="Trip summary"><span className="ride-stop">{record.trip.pickup.label}</span><span aria-hidden="true">→</span><span className="ride-stop">{record.trip.dropoff?.label??'Pickup / cancelled ride'}</span><span className="small muted">{record.trip.scheduledAt?new Date(record.trip.scheduledAt).toLocaleDateString('en-SG',{timeZone:'Asia/Singapore',day:'numeric',month:'short',year:'numeric'}):'Date not recorded'}</span></div>
  {notice?<div className="notice notice--success" role="status" tabIndex={-1}>{notice}</div>:null}{error?<div className="notice notice--danger" role="alert" tabIndex={-1}>{error}</div>:null}
  {data.historical?<p className="notice">Recorded version · read-only. <Link href={workspaceHref(record.id,role,'brief')}>Return to your current ride</Link></p>:null}
  <CaseViewTabs role={role} section={history?'history':'brief'} href={href}/>
  <NextActionPanel view={view} basePath={href('brief')} navigatorReady={false} navigatorTarget="case" prompts={[]}/>
  {history?<PartyHistory decisions={packet.decisions} tasks={packet.tasks} role={role} currentDecisionId={packet.effectiveDecision?.id??null} currentCaseVersion={packet.currentCaseVersion} displayedCaseVersion={record.version}/>:<>
   {!packet.effectiveDecision&&!evidence?<section className="ride-introduction"><div><p className="eyebrow">Your next step stays with this ride</p><h2>{view.stageLabel}</h2><p>{view.nextActionExplanation}</p><button type="button" className="btn btn--ghost" data-inspect="account">Read your full account</button></div><img src="/illustrations/pickup-concept.webp" width={960} height={640} alt="" className="pickup-concept"/></section>:null}
   {evidence?<><PartyEvidence caseId={record.id} role={role} readOnly={data.historical} requests={data.requests} evidence={data.evidence} gpsSamples={data.gpsSamples as Extract<(typeof data.evidence)[number],{kind:'gps'}>[]}/>{!data.historical?<details className="card" id="repair-entry"><summary>Check a disputed fact and its next step</summary><RepairSupport caseId={record.id} version={packet.currentCaseVersion} role={role} requests={data.requests} gpsSamples={data.gpsSamples.filter((e):e is Extract<(typeof data.gpsSamples)[number],{kind:'gps'}>=>e.kind==='gps')}/><EvidenceRepair caseId={record.id} version={packet.currentCaseVersion} conditions={packet.collectionPlan.conditions} repairs={repairs} liveReady={healthSnapshot().liveAvailable} previousRun={packet.run?{state:packet.run.state,caseVersion:packet.run.caseVersion,mode:packet.run.mode}:null}/></details>:null}</>:null}
   {packet.effectiveDecision||active==='appeal'?<><PartyOutcome caseRecord={record} role={role} evaluation={packet.evaluation} effectiveDecision={packet.effectiveDecision} settlements={packet.settlements} allSettlements={packet.allSettlements} readOnly={data.historical} hasOpenAppeal={packet.hasOpenAppeal} hasOpenAppealByMe={packet.tasks.some(t=>t.kind==='appeal'&&t.submittedBy===role&&['queued','assigned','ready','awaiting_evidence'].includes(t.status))}/>{!data.historical?<div id="payments">{payments}</div>:null}</>:null}
   <details className="ride-support" open={active==='brief'&&!packet.effectiveDecision&&!evidence}><summary>The records and uncertainty</summary><PartyBrief caseRecord={record} findings={packet.evaluation.findings} issues={packet.evaluation.issues} role={role} decided={Boolean(packet.effectiveDecision)}/>{record.category==='fare_dispute'||record.category==='route_overcharge'?<CaseVisual caseRecord={record} evaluation={packet.evaluation} pack={packet.pack}/>:null}<ul className="source-record-list">{data.evidence.map(e=><li key={e.id}><Cite id={e.id} kind="evidence">{e.kind.replaceAll('_',' ')} · {e.timestamp?new Date(e.timestamp).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+' SGT':'Time not recorded'}</Cite></li>)}</ul></details>
   <div className="ride-support-links"><button type="button" data-inspect="navigator">Ask about this case</button><button type="button" data-inspect="policy-basis">Rules and sources</button><Link href="/rides?journey=pickup">Clarify the next pickup</Link><Link href={href('history')}>Case record</Link></div>
  </>}
  <CitationDrawer key={[record.id,record.version,runId].join(':')} caseId={record.id} runId={sourceRunId} panels={[
   {id:'navigator',title:'Case Navigator',content:<NavigatorPanel key={[record.id,view.selectedTaskId,view.currentCaseVersion].join(':')} target="case" caseId={record.id} ready={navigatorReady()&&!data.historical} prompts={data.prompts} taskId={view.selectedTaskId??undefined} taskRevision={packet.tasks.find(t=>t.id===view.selectedTaskId)?.revision} caseVersion={view.currentCaseVersion} runId={runId??undefined}/>},
   {id:'account',title:'Your full account',content:<ReadableText text={own??'No statement recorded.'} expanded/>},
   {id:'policy-basis',title:'Rules for this ride',content:<PolicyBasis pack={packet.pack} suppliedSample={record.suppliedPolicyId!==null}/>},
  ]}/>
 </main>;
}
