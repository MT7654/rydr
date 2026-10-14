import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {startRun,DEFAULT_CONFIG} from '../src/agents/orchestrator';
import {createFixtureProvider} from '../src/providers/fixture';
import {applyCompletion} from '../src/agents/completion';
import {ensureReviewTask,getReviewTask,listReviewTasksForCase} from '../src/repositories/reviewTasks';
import {withStorageSession} from '../src/repositories/store';
it('refreshes an existing failure task after a valid retry without another primary escalation',async()=>{
 const run=await withStorageSession(randomUUID(),()=>startRun('DISP-002','fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider()},randomUUID()));
 await withStorageSession(randomUUID(),async()=>{
  const {task}=await ensureReviewTask({caseId:'DISP-002',caseVersion:run.caseVersion,runId:run.id,kind:'runtime_failure',reasonCodes:['transport'],reasonSummary:'Historical provider failure.',openQuestions:['The review did not finish.']});
  const outcome=await applyCompletion(run);expect(outcome.taskId).toBe(task.id);
  const updated=await getReviewTask(task.id);expect(updated?.kind).toBe('automatic_escalation');expect(updated?.status).toBe('ready');expect(updated?.reasonSummary).toContain('re-review completed');expect(updated?.reasonCodes).not.toContain('transport');
  const tasks=await listReviewTasksForCase('DISP-002');expect(tasks.filter(t=>['runtime_failure','automatic_escalation'].includes(t.kind))).toHaveLength(1);
 });
});
