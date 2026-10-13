import { describe, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ role: 'rider' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => ({ value: name === 'rydr-demo-role' ? session.role : '11111111-1111-4111-8111-111111111111' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { submitAppeal, respondToEvidenceRequest } from '@/app/cases/[id]/actions';
import { assignTask } from '@/app/reviews/actions';
import { ensureReviewTask, createEvidenceRequest, listEvidenceRequests, findOpenTask } from '@/repositories/reviewTasks';
import { recordDecision, chargeRefFor } from '@/repositories/ledger';
import { getCase } from '@/repositories/cases';

function form(fields: Record<string,string>) {
  const result = new FormData();
  for (const [key,value] of Object.entries(fields)) result.set(key,value);
  return result;
}

describe('server actions respect the selected demo persona', () => {
  it('attributes an appeal to the session even when the form claims driver', async () => {
    session.role='rider';
    const record=(await getCase('SYN-001'))!;
    await recordDecision({ caseId:record.id,caseVersion:record.version,runId:null,taskId:null,source:'reviewer',disposition:'uphold',targetRefundCents:0,evidenceIds:[],policyIds:[],policyVersion:record.policyVersion,explanation:'Test decision',differenceFromRecommendation:null,reviewerId:'reviewer_demo_01',supersedesDecisionId:null,chargeRef:chargeRefFor(record) });
    await expect(submitAppeal(form({caseId:record.id,as:'driver',reason:'Please check the pickup location.'}))).rejects.toThrow('redirect:');
    const task=await findOpenTask(record.id,'appeal');
    expect(task?.submittedBy).toBe('rider');
    expect(task?.reasonSummary).toMatch(/^Rider appeal/);
  });
  it('rejects a response addressed to the other party without changing the request', async () => {
    session.role='rider';
    const {task}=await ensureReviewTask({caseId:'SYN-003',caseVersion:1,runId:null,kind:'automatic_escalation',reasonCodes:[],reasonSummary:'Need evidence'});
    const request=await createEvidenceRequest({taskId:task.id,caseId:task.caseId,recipient:'driver',question:'Please supply the receipt',evidenceType:'statement',whyItMatters:'Check the fare'});
    await expect(respondToEvidenceRequest(form({caseId:task.caseId,taskId:task.id,requestId:request.id,as:'driver',response:'Forged response'}))).rejects.toThrow('redirect:');
    expect((await listEvidenceRequests(task.id))[0]?.status).toBe('open');
    expect((await listEvidenceRequests(task.id))[0]?.responseNote).toBeNull();
  });
  it('rejects reviewer actions from a party session before looking up or writing a task', async () => {
    session.role='driver';
    await expect(assignTask(form({taskId:'does-not-exist'}))).rejects.toThrow('redirect:/');
  });
  it('requires a party session to submit an appeal', async () => {
    session.role='reviewer';
    await expect(submitAppeal(form({caseId:'SYN-001',as:'rider',reason:'Test'}))).rejects.toThrow('redirect:/');
  });
});
