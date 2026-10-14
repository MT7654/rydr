import Link from 'next/link';
import type { ReactNode } from 'react';
import type { WorkspaceData } from '@/lib/workspace';

import { navigatorReady } from '@/agents/navigator';
import { workspaceHref } from '@/domain/workspaceRoute';

import { CitationDrawer } from '@/components/CitationDrawer';
import { Cite } from '@/components/Cite';
import { PolicyBasis } from '@/components/PolicyBasis';
import { DamageEvidencePanel } from '@/components/DamageEvidencePanel';
import { visionMode } from '@/providers/vision';
import { PrecedentPanel } from '@/components/PrecedentPanel';
import { IntegrityPanel } from '@/components/IntegrityPanel';
import { EvidenceRepair } from '@/components/EvidenceRepair';
import { CollectionPanel } from '@/components/CollectionPanel';
import { RunLauncher } from '@/components/RunLauncher';
import { RunMonitor } from '@/components/RunMonitor';
import { AgentComparison } from '@/components/AgentComparison';
import { ReadableText } from '@/components/ReadableText';
import { NavigatorPanel } from '@/components/NavigatorPanel';
import { PartyOutcome } from './PartyOutcome';
import { PartyHistory } from './PartyHistory';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceInteractions } from './WorkspaceInteractions';
import { NextActionPanel } from './NextActionPanel';
import { CaseExhibit } from './CaseExhibit';
import { CaseFindings } from './CaseFindings';
import { CaseViewTabs } from './CaseViewTabs';
import { CaseRail } from './CaseRail';
export function ReviewerWorkspace({data,workbench,taskOptions,notice,error,mode='fixture',payments,caseVersions=[],runs=[],caseOptions=[],embeddedThresholdSeconds=null}: {
 embeddedThresholdSeconds?:number|null;caseOptions?:{id:string;label:string;amount:string;version:number}[];data:WorkspaceData;detailView?:ReactNode;workbench:ReactNode;taskOptions:{id:string;label:string;status:string}[];notice?:string;error?:string;mode?:'live'|'fixture';payments?:ReactNode;caseVersions?:{version:number;evidence:unknown[];changeLog:string[]}[];runs?:{id:string;caseVersion:number;mode:string}[];
}) {
 const {view,packet}=data;const record=packet.caseRecord,id=record.id;
 const task=packet.tasks.find(t=>t.id===view.selectedTaskId);
 const context={taskId:view.selectedTaskId,runId:data.historical?packet.run?.id:null,mode};
 const href=(section:string)=>workspaceHref(id,'reviewer',section,context);
 const requested=data.explicitSection?data.section:view.primaryAction?.section??'brief';
 const destination=requested==='outcome'||requested==='history'?requested:'review';
 const hasCurrentRun=packet.run&&(data.historical||!packet.runStaleAgainstCurrentVersion);
 const sourceRunId=packet.renderedFromSnapshot?packet.run?.id??null:context.runId;
 const panels=[
  {id:'navigator',title:'Case Navigator',content:<NavigatorPanel key={[id,view.selectedTaskId,task?.revision,view.currentCaseVersion,context.runId].join(':')} target="case" caseId={id} ready={navigatorReady()&&!data.historical} prompts={data.prompts} taskId={view.selectedTaskId??undefined} taskRevision={task?.revision} caseVersion={view.currentCaseVersion} runId={context.runId??undefined}/>},
  {id:'policy-basis',title:'Governing policy',content:<><PolicyBasis pack={packet.pack} suppliedSample={record.suppliedPolicyId!==null}/>{packet.pack.clauses.map(c=><p key={c.id}><Cite kind="policy" id={c.id}>{c.title}</Cite></p>)}</>},
  {id:'accounts',title:'Both party accounts',content:<><h3>Rider account</h3><ReadableText text={record.riderStatement} expanded/><h3>Driver account</h3><ReadableText text={record.driverStatement??'No driver statement recorded.'} expanded/></>},
  {id:'consistency',title:'Precedents and integrity',content:<><PrecedentPanel manifest={packet.runPrecedents}/><IntegrityPanel assessment={packet.integrityAssessment}/></>},
 ];
 return <main className="container workspace resolution-desk"><WorkspaceInteractions/><div className="desk-layout">
  <CaseRail selected={id} options={caseOptions}/>
  <div className="desk-canvas"><WorkspaceHeader view={view} caseRecord={record} role="reviewer" activeCaseId={id} runId={context.runId}/>
  {data.historical?<p className="notice" role="status">Recorded assessment · v{record.version}. Read-only. <Link href={workspaceHref(id,'reviewer','brief')}>Return to current case</Link></p>:null}
  {notice?<div className="notice notice--success" role="status" tabIndex={-1}>{notice}</div>:null}{error?<div className="notice notice--danger" role="alert" tabIndex={-1}>{error}</div>:null}
  <CaseViewTabs role="reviewer" section={destination==='review'?'assessment':destination} href={href}/>
  {taskOptions.length?<details className="workspace-taskbar"><summary>Other open tasks ({taskOptions.length})</summary><ul>{taskOptions.map(t=><li key={t.id}><Link href={workspaceHref(id,'reviewer','decision',{taskId:t.id,mode})}>{t.label} · {t.status}</Link></li>)}</ul></details>:null}
  <NextActionPanel view={view} basePath={href('brief')} navigatorReady={false} navigatorTarget="case" prompts={[]}/>
  {destination==='review'?<>
   <section id="assessment" className="desk-assessment">
    {hasCurrentRun?<RunMonitor caseId={id} runId={packet.run!.id} initialRun={packet.run!} findings={packet.evaluation.findings} initialCalls={packet.providerCalls} historical={data.historical} comparison={false}/>:<div className="assessment-launch"><div><h2>{packet.runStaleAgainstCurrentVersion?'Assess the updated records':'Assess both accounts'}</h2><p className="small muted">Each advocate examines the records. The judge applies the governing policy.</p></div>{!data.historical?<RunLauncher caseId={id} mode={mode} includeImages={mode==='live'&&record.category==='damage'} label={mode==='live'?'Run live assessment':'Run sample assessment'}/>:<p>No run recorded for this version.</p>}</div>}
    {packet.run?.state==='failed'&&!data.historical?<RunLauncher caseId={id} mode={mode} label="Retry assessment"/>:null}
   </section>
   <nav className="desk-index" aria-label="Review sections"><a href="#overview">Overview</a><a href="#findings">Findings</a><a href="#evidence">Evidence</a>{task?<a href="#current-task">Current task</a>:null}<button type="button" data-inspect="consistency">Consistency checks</button></nav>
   <CaseExhibit record={record} evaluation={packet.evaluation} pack={packet.pack} embeddedThresholdSeconds={embeddedThresholdSeconds}/>
   <div className="desk-account-entry"><div><h3>Two accounts of the same ride</h3><p className="small muted">Statements remain separate from recorded observations.</p></div><button type="button" className="btn btn--ghost btn--sm" data-inspect="accounts">Read full accounts</button></div>
   <CaseFindings findings={packet.evaluation.findings} issues={packet.evaluation.issues} compact={Boolean(hasCurrentRun)}/>{hasCurrentRun?<AgentComparison findings={packet.evaluation.findings} rider={packet.run!.advocates.rider} driver={packet.run!.advocates.driver} judge={packet.run!.judge} compactHeading/>:null}
   <section id="evidence" className="desk-sources"><div className="section-heading"><h2>Source records</h2><span className="small muted">{data.evidence.length} records · v{record.version}</span></div><details open={requested==='evidence'}><summary>Inspect the evidence</summary><ul className="source-record-list">{data.evidence.map(e=><li key={e.id}><Cite kind="evidence" id={e.id}>{e.kind.replaceAll('_',' ')} · {e.timestamp?new Date(e.timestamp).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+' SGT':'Time not recorded'}</Cite><span className="small muted">{e.id}</span></li>)}</ul></details>
    {record.category==='damage'?<DamageEvidencePanel key={String(packet.run?.id)+packet.run?.state+record.version} record={record} frozen={data.historical} mode={visionMode()} initialReceipt={packet.snapshot?.visionReceipts}/>:null}
    {!data.historical?<details open={requested==='evidence'}><summary>Collect or verify a missing source</summary><CollectionPanel caseId={id} caseVersion={record.version} plan={packet.collectionPlan} job={packet.collectionJob} sensitivity={packet.sensitivity}/>{packet.collectionJob?.planner?<p className="small">Collection planner: {packet.collectionJob.planner.reason} · {packet.collectionJob.toolCallCount} simulated source calls</p>:null}</details>:null}
   </section>
   {task?<section id="current-task" className="desk-current-task">{workbench}</section>:null}
  </>:null}
  {destination==='outcome'?<><PartyOutcome caseRecord={record} role="reviewer" evaluation={packet.evaluation} effectiveDecision={packet.effectiveDecision} settlements={packet.settlements} allSettlements={packet.allSettlements} hasOpenAppeal={packet.hasOpenAppeal} hasOpenAppealByMe={false} readOnly={data.historical}/>{!data.historical?payments:null}{!data.historical?<details className="card"><summary>Audit a disputed record</summary><EvidenceRepair caseId={id} version={packet.currentCaseVersion} conditions={packet.collectionPlan.conditions} repairs={[]} liveReady={navigatorReady()} previousRun={packet.run?{state:packet.run.state,caseVersion:packet.run.caseVersion,mode:packet.run.mode}:null}/></details>:null}</>:null}
  {destination==='history'?<><PartyHistory decisions={packet.decisions} tasks={packet.tasks} role="reviewer" currentDecisionId={packet.effectiveDecision?.id??null} currentCaseVersion={packet.currentCaseVersion} displayedCaseVersion={record.version}/><section className="desk-record"><h2>Evidence versions</h2><ol className="record-events">{caseVersions.map(v=><li key={v.version}><strong>Case v{v.version}</strong><span>{v.evidence.length} records</span><details><summary>Version changes</summary>{v.changeLog.map((line,i)=><p key={i}>{line}</p>)}</details></li>)}</ol><h2>Recorded assessments</h2><ol className="record-events">{runs.map(r=><li key={r.id}><Link href={workspaceHref(id,'reviewer','assessment',{runId:r.id,mode})}>{r.mode==='live'?'Live':'Sample'} assessment · v{r.caseVersion}</Link><span className="small muted">Read-only snapshot</span></li>)}</ol></section></>:null}
  </div></div><CitationDrawer key={id+':'+context.runId+':'+record.version} caseId={id} runId={sourceRunId} panels={panels}/>
 </main>;
}
