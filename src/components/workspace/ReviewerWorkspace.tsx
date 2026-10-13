import Link from 'next/link';
import {WorkspaceInteractions} from './WorkspaceInteractions';
import type { ReactNode } from 'react';
import type { WorkspaceData } from '@/lib/workspace';
import { navigatorReady } from '@/agents/navigator';
import { workspaceHref } from '@/domain/workspaceRoute';
import { CitationDrawer } from '@/components/CitationDrawer';
import { EvidenceBrief } from '@/components/EvidenceBrief';
import { CaseTimeline } from '@/components/CaseTimeline';
import { PolicyBasis } from '@/components/PolicyBasis';
import { DamageEvidencePanel } from '@/components/DamageEvidencePanel';
import { visionMode } from '@/providers/vision';
import { PrecedentPanel } from '@/components/PrecedentPanel';
import { IntegrityPanel } from '@/components/IntegrityPanel';
import { EvidenceRepair } from '@/components/EvidenceRepair';
import { CollectionPanel } from '@/components/CollectionPanel';
import { RunLauncher } from '@/components/RunLauncher';
import { RunMonitor } from '@/components/RunMonitor';
import { Cite } from '@/components/Cite';
import { ReadableText } from '@/components/ReadableText';
import { PartyOutcome } from './PartyOutcome';
import { PartyHistory } from './PartyHistory';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceProgress } from './WorkspaceProgress';
import { NextActionPanel } from './NextActionPanel';
import { AssuranceJourney } from '@/components/AssuranceJourney';

const SECTIONS = [['brief','Brief'],['assessment','Assessment'],['evidence','Evidence'],['decision','Decision'],['outcome','Outcome'],['history','Case record']] as const;
export function ReviewerWorkspace({data,workbench,taskOptions,notice,error,mode='fixture',payments,caseVersions=[],runs=[]}: {
 data:WorkspaceData;detailView?:ReactNode;workbench:ReactNode;taskOptions:{id:string;label:string;status:string}[];notice?:string;error?:string;mode?:'live'|'fixture';payments?:ReactNode;caseVersions?:{version:number;evidence:unknown[];changeLog:string[]}[];runs?:{id:string;caseVersion:number;mode:string}[];
}) {
 const {view,packet}=data; const id=packet.caseRecord.id;const task=packet.tasks.find(t=>t.id===view.selectedTaskId);
 const context={taskId:view.selectedTaskId,runId:data.historical?packet.run?.id:null,mode};
 const href=(section:string)=>workspaceHref(id,'reviewer',section,context);
 const active=data.explicitSection?data.section:view.primaryAction?.section??'brief';
 const section=active==='appeal'?'decision':active;
 const record=packet.caseRecord;
 return <main className="container stack workspace">
  <WorkspaceInteractions/><WorkspaceHeader view={view} caseRecord={record} role="reviewer" activeCaseId={id} runId={data.historical?packet.run?.id:null}/>
  <WorkspaceProgress progress={data.progress} basePath={href('brief')}/>
  {data.historical?<p className="notice" role="status">Recorded assessment · case v{record.version}. This view is read-only. Current case actions are available after returning to the current case.</p>:null}
  <div className="workspace-taskbar"><span className="small muted">{task?'Selected task: '+task.kind.replaceAll('_',' ')+' · revision '+task.revision:'No open review task'}</span>
  {taskOptions.length?<details><summary>Other open tasks ({taskOptions.length})</summary><ul>{taskOptions.map(t=><li key={t.id}><Link href={workspaceHref(id,'reviewer','decision',{taskId:t.id,mode})}>{t.label} · {t.status}</Link></li>)}</ul></details>:null}</div>
  {notice?<div className="notice notice--success" role="status">{notice}</div>:null}{error?<div className="notice notice--danger" role="alert">{error}</div>:null}
  <nav className="workspace-sections" aria-label="Case sections">{SECTIONS.map(([key,label])=><Link key={key} className="filter" aria-current={section===key?'page':undefined} href={href(key)}>{label}</Link>)}</nav>
  <div className="workspace-grid"><div className="workspace-canvas">
  {section==='brief'?<><section className="card"><h2>What is disputed</h2><ReadableText text={record.riderStatement??'No rider statement recorded.'}/>{record.driverStatement?<details><summary>Driver account</summary><ReadableText text={record.driverStatement}/></details>:null}</section><EvidenceBrief record={record} evaluation={packet.evaluation} pack={packet.pack}/><PolicyBasis pack={packet.pack} suppliedSample={record.suppliedPolicyId!==null}/></>:null}
  {section==='assessment'?<section id="assessment" className="stack">
   {packet.run&&!packet.runStaleAgainstCurrentVersion?<RunMonitor key={packet.run.id} caseId={id} runId={packet.run.id} initialRun={packet.run} findings={packet.evaluation.findings} initialCalls={packet.providerCalls}/>:<section className="card"><h2>{packet.runStaleAgainstCurrentVersion?'Assess updated evidence':'Assess both accounts'}</h2><p>Two advocates examine the records. The judge applies the governing policy and refers unresolved cases to a reviewer.</p>{!data.historical?<RunLauncher caseId={id} mode={mode} includeImages={mode==='live'&&record.category==='damage'} label={record.category==='damage'?'Collect, inspect and assess':'Collect and assess both accounts'}/>:<p>No assessment is available in this historical record.</p>}</section>}
   {packet.run?.state==='failed'&&!data.historical?<RunLauncher caseId={id} mode={mode} label="Retry assessment"/>:null}
   <AssuranceJourney record={record} run={packet.run}/>
   {packet.collectionJob?.planner?<p className="notice">Live collection planner: {packet.collectionJob.planner.reason} · {packet.collectionJob.toolCallCount} simulated source call(s).</p>:null}
   {record.category==='damage'?<DamageEvidencePanel key={String(packet.run?.id)+':'+packet.run?.state+':'+record.version} record={record} frozen={data.historical} mode={visionMode()} initialReceipt={packet.snapshot?.visionReceipts}/>:null}
   <details className="card"><summary>Case brief and source timeline</summary><EvidenceBrief record={record} evaluation={packet.evaluation} pack={packet.pack}/><CaseTimeline items={record.evidence.filter(e=>e.timestamp!==null)}/></details>
   <details className="card"><summary>Similar cases and evidence integrity</summary><PrecedentPanel manifest={packet.runPrecedents}/><IntegrityPanel assessment={packet.integrityAssessment}/></details>
  </section>:null}
  {section==='evidence'?<><section className="card"><h2>Source records</h2><CaseTimeline items={record.evidence.filter(e=>e.timestamp!==null)}/><details><summary>All evidence ({data.evidence.length})</summary><ul>{data.evidence.map(e=><li key={e.id}><Cite kind="evidence" id={e.id}>{e.kind.replaceAll('_',' ')} · {e.timestamp??'time not recorded'} · {e.id}</Cite></li>)}</ul></details><details><summary>Applicable rules</summary>{packet.pack.clauses.map(c=><p key={c.id}><Cite kind="policy" id={c.id}>{c.title}</Cite></p>)}</details></section>
   <DamageEvidencePanel key={String(packet.run?.id)+':'+packet.run?.state+':'+record.version} record={record} frozen={data.historical} mode={visionMode()} initialReceipt={packet.snapshot?.visionReceipts}/>
   {!data.historical?<CollectionPanel caseId={id} caseVersion={record.version} plan={packet.collectionPlan} job={packet.collectionJob} sensitivity={packet.sensitivity}/>:null}
   {task?workbench:null}
  </>:null}
  {section==='decision'?<>{task?.kind==='appeal'?<section className="card" id="appeal-review"><h2>Appeal grounds</h2><p>{task.reasonSummary}</p>{task.openQuestions.map((q,i)=><p key={i}>{q}</p>)}</section>:null}{task?workbench:<section className="card"><h2>No open review task</h2><p>Assess this case or inspect the recorded outcome.</p></section>}</>:null}
  {section==='outcome'?<><PartyOutcome caseRecord={record} role="reviewer" evaluation={packet.evaluation} effectiveDecision={packet.effectiveDecision} settlements={packet.settlements} allSettlements={packet.allSettlements} hasOpenAppeal={packet.hasOpenAppeal} hasOpenAppealByMe={false}/>{!data.historical?payments:null}{!data.historical?<details className="card"><summary>Audit the decision or check a disputed record</summary><EvidenceRepair caseId={id} version={packet.currentCaseVersion} conditions={packet.collectionPlan.conditions} repairs={[]} liveReady={navigatorReady()} previousRun={packet.run?{state:packet.run.state,caseVersion:packet.run.caseVersion,mode:packet.run.mode}:null}/></details>:null}</>:null}
  {section==='history'?<><PartyHistory decisions={packet.decisions} tasks={packet.tasks} role="reviewer" currentDecisionId={packet.effectiveDecision?.id??null} currentCaseVersion={packet.currentCaseVersion} displayedCaseVersion={record.version}/><section className="card"><h2>Evidence versions</h2><ul>{caseVersions.map(v=><li key={v.version}>Case v{v.version} · {v.evidence.length} records<details><summary>Changes in this version</summary>{v.changeLog.map((line,i)=><p key={i}>{line}</p>)}</details></li>)}</ul><h2>Recorded assessments</h2><ul>{runs.map(r=><li key={r.id}><Link href={workspaceHref(id,'reviewer','assessment',{runId:r.id,mode})}>{r.mode==='live'?'Live assessment':'Sample assessment'} · case v{r.caseVersion}</Link></li>)}</ul>{packet.run?<Link href={workspaceHref(id,'reviewer','assessment',{runId:packet.run.id,mode})}>Inspect frozen assessment · v{packet.run.caseVersion}</Link>:<p>No recorded assessment.</p>}</section></>:null}
  </div><NextActionPanel view={view} basePath={href('brief')} navigatorReady={navigatorReady()&&!data.historical} navigatorTarget="case" navigatorCaseId={id} prompts={data.prompts} taskRevision={task?.revision} runId={data.historical?packet.run?.id:undefined}/></div>
  <p className="small"><Link href="/worklist">Back to Worklist</Link></p>
  <CitationDrawer key={id+':'+(packet.run?.id??record.version)} caseId={id} runId={data.historical?packet.run?.id:null}/>
 </main>;
}
