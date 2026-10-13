import {it,expect,vi} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/cases/DISP-002'}));
vi.mock('../src/lib/demoSession',()=>({getDemoRole:async()=> 'reviewer',getDemoSession:async()=> 'test-session'}));
import {deriveWorkspaceView,type WorkspaceInput} from '../src/domain/workspace';
import {workspaceHref} from '../src/domain/workspaceRoute';
import {loadWorkspace} from '../src/lib/workspace';
import {ReviewerWorkspace} from '../src/components/workspace/ReviewerWorkspace';
import {PartyWorkspace} from '../src/components/workspace/PartyWorkspace';
import {ReviewTaskWorkbench} from '../src/components/workspace/ReviewTaskWorkbench';
import {createFixtureProvider} from '../src/providers/fixture';
import {startRun,DEFAULT_CONFIG} from '../src/agents/orchestrator';
import {ensureReviewTask} from '../src/repositories/reviewTasks';
import {navigatorContext} from '../src/agents/navigator';
const base:WorkspaceInput={caseId:'DISP-002',role:'reviewer',currentCaseVersion:1,displayedCaseVersion:1,historical:false,status:'open',runState:null,hasRun:false,runStaleAgainstCurrentVersion:false,runMissingForCurrentVersion:false,tasks:[],evidenceRequests:[],effectiveDecision:null,settlements:[],hasOpenAppeal:false};
it('preserves one section, selected task and pinned run in workspace URLs',()=>{const url=workspaceHref('DISP-002','driver','history',{taskId:'task-a',runId:'run-a'});const q=new URL(url,'http://localhost').searchParams;expect(q.get('case')).toBe('DISP-002');expect(q.getAll('section')).toEqual(['history']);expect(q.get('task')).toBe('task-a');expect(q.get('run')).toBe('run-a');});
it('does not offer another assessment during an active run',()=>{const view=deriveWorkspaceView({...base,hasRun:true,runState:'judging',status:'analyzing'});expect(view.primaryAction?.enabled).toBe(false);expect(view.nextActor).toBe('platform');});
it('prioritizes current evidence reassessment ahead of a ready decision',async()=>{const task=await ensureReviewTask({caseId:'DISP-002',caseVersion:1,runId:null,kind:'party_request',reasonCodes:[],reasonSummary:'source changed',openQuestions:[]});const view=deriveWorkspaceView({...base,tasks:[{...task.task,status:'ready'}],hasRun:true,runStaleAgainstCurrentVersion:true,currentCaseVersion:2});expect(view.primaryAction?.id).toBe('reassess');});
it('renders reviewer outcome and explicit history rather than an empty canvas',async()=>{for(const section of ['outcome','history']){const data=(await loadWorkspace('DISP-002',{role:'reviewer',section}))!;const html=renderToStaticMarkup(createElement(ReviewerWorkspace,{data,workbench:null,taskOptions:[]}));expect(html).toContain(section==='outcome'?'No final decision':'Case record');expect((html.match(/<h1/g)||[]).length).toBe(1);}});
it.each(['rider','driver'] as const)('renders the %s appeal destination without a reviewer-only rejection',async role=>{const data=(await loadWorkspace('DISP-002',{role,section:'appeal'}))!;const html=renderToStaticMarkup(await PartyWorkspace({data}));expect(html).not.toContain('That section belongs to the reviewer workspace');expect(html).toContain('No final decision');});
it('never renders mutation forms in a pinned historical review',async()=>{const run=await startRun('DISP-002','fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider()},'readonly-audit');const data=(await loadWorkspace('DISP-002',{role:'reviewer',runId:run.id}))!;const task=data.packet.tasks[0];expect(task).toBeTruthy();const html=renderToStaticMarkup(createElement(ReviewTaskWorkbench,{task,packet:data.packet,caseVersions:[],currentCaseVersion:1,selected:true,historical:true}));expect(html).not.toContain('<form');expect(html).toContain('read-only');});
it('does not send the other party appeal grounds to Navigator',async()=>{await ensureReviewTask({caseId:'SYN-002',caseVersion:1,runId:null,kind:'appeal',submittedBy:'driver',reasonCodes:['party_appeal'],reasonSummary:'PRIVATE-DRIVER-GROUNDS',openQuestions:['PRIVATE-QUESTION']});const rider=await navigatorContext('rider','case','SYN-002');expect(JSON.stringify(rider.context)).not.toContain('PRIVATE-DRIVER-GROUNDS');expect(JSON.stringify(rider.context)).not.toContain('PRIVATE-QUESTION');const reviewer=await navigatorContext('reviewer','case','SYN-002');expect(JSON.stringify(reviewer.context)).toContain('PRIVATE-DRIVER-GROUNDS');});



it('keeps an explicitly selected task in Navigator context even when an appeal has higher priority',async()=>{
 const first=await ensureReviewTask({caseId:'SYN-005',caseVersion:1,runId:null,kind:'party_request',reasonCodes:[],reasonSummary:'Selected evidence task',openQuestions:[]});
 await ensureReviewTask({caseId:'SYN-005',caseVersion:1,runId:null,kind:'appeal',submittedBy:'rider',reasonCodes:[],reasonSummary:'Separate appeal task',openQuestions:[]});
 const result=await navigatorContext('reviewer','case','SYN-005',{taskId:first.task.id,caseVersion:1,taskRevision:first.task.revision});
 expect((result.context as {selectedTask:{id:string}}).selectedTask.id).toBe(first.task.id);
 await expect(navigatorContext('reviewer','case','SYN-005',{taskId:first.task.id,taskRevision:first.task.revision+1})).rejects.toThrow('This task has changed');
});
it('rejects stale Navigator case versions before making a provider call',async()=>{
 await expect(navigatorContext('reviewer','case','DISP-002',{caseVersion:99})).rejects.toThrow('This case has changed');
});
