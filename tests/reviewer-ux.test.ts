import { it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { randomUUID } from 'node:crypto';
import { canAccessDemoPath } from '../src/domain/demoAccess';
import { primaryLinks, utilityLinks, TEAM_TOOL_LINKS, primaryReviewTask } from '../src/domain/navigation';
import { assessmentExcerpt } from '../src/domain/reading';
import { withStorageSession } from '../src/repositories/store';
import { ensureReviewTask, listReviewTasksForCase } from '../src/repositories/reviewTasks';
import { createFixtureProvider } from '../src/providers/fixture';
import { DEFAULT_CONFIG, startRun } from '../src/agents/orchestrator';
import ResolutionPage from '../src/app/cases/[id]/resolution/page';
import { CaseDetailView } from '../src/components/CaseDetailView';
import { loadCasePacket } from '../src/lib/casePacket';
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
/**
 * The guided-workspaces build collapsed primary navigation to one destination
 * per role (spec §3). These assertions keep the original intent — a party has
 * no reviewer surface and the admin routes stay out of reach — while checking
 * that the payments/policies capabilities are still reachable rather than
 * deleted.
 */
it.each(['rider','driver'] as const)('keeps %s navigation and direct routes outside admin functions', role => {
  expect(primaryLinks(role).map(link => link.label)).toEqual(['My rides']);
  expect(utilityLinks(role).map(link => link.label)).toContain('Help & policies');
  for(const path of ['/intake','/operations','/precedents','/review-queue','/worklist','/api/cases/intake']) expect(canAccessDemoPath(role,path)).toBe(false);
  // Legacy party routes resolve, and the repair entry point stays usable.
  for(const path of ['/portal','/rides','/payments','/cases/DISP-002/repair']) expect(canAccessDemoPath(role,path)).toBe(true);
});
it('gives reviewers a task-focused primary navigation', () => {
  expect(primaryLinks('reviewer').map(link => link.label)).toEqual(['Worklist']);
  expect(canAccessDemoPath('reviewer','/intake')).toBe(true);
  expect(canAccessDemoPath('reviewer','/worklist')).toBe(true);
  // Aggregate tools moved into Team tools; they are not gone.
  const teamHrefs = TEAM_TOOL_LINKS.map(link => link.href);
  expect(teamHrefs).toContain('/payments');
  expect(teamHrefs).toContain('/policies');
  expect(teamHrefs).toContain('/precedents');
});
it('retains one primary decision task while preserving related records', () => {
  const tasks=[{id:'request',kind:'party_request'},{id:'assessment',kind:'automatic_escalation'}];
  expect(primaryReviewTask(tasks)?.id).toBe('assessment');expect(tasks).toHaveLength(2);
  expect(primaryReviewTask([...tasks,{id:'appeal',kind:'appeal'}])?.id).toBe('appeal');
});
it('previews original text without rewriting amounts and leaves the source unchanged', () => {
  const text='Refund SGD 5.00. '+ 'The pickup evidence remains uncertain. '.repeat(20);
  const preview=assessmentExcerpt(text);expect(preview.length).toBeLessThanOrEqual(301);expect(preview).toContain('SGD 5.00');expect(text.startsWith(preview.slice(0,-1))).toBe(true);
});
it('takes an escalated AI assessment directly to the existing human workbench', async () => withStorageSession(randomUUID(), async () => {
  const run=await startRun('DISP-002','fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider()},randomUUID());
  expect(run.state).toBe('escalated');
  const task=primaryReviewTask(await listReviewTasksForCase('DISP-002'))!;
  await expect(ResolutionPage({params:Promise.resolve({id:'DISP-002'}),searchParams:Promise.resolve({run:run.id})})).rejects.toThrow(`REDIRECT:/reviews/${task.id}`);
}));
it('renders a single workbench action even when an old manual request is also open', async () => withStorageSession(randomUUID(), async () => {
  const run=await startRun('DISP-002','fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider()},randomUUID());
  await ensureReviewTask({caseId:'DISP-002',caseVersion:1,runId:run.id,kind:'party_request',reasonCodes:['manual_review'],reasonSummary:'Legacy review request.'});
  const packet=(await loadCasePacket('DISP-002'))!;
  const html=renderToStaticMarkup(React.createElement(CaseDetailView,{workflow:{status:'Needs review',decision:null,openTasks:packet.tasks.map(task=>({id:task.id,kind:task.kind}))},caseRecord:packet.caseRecord,evaluation:packet.evaluation,quality:packet.quality,pack:packet.pack,latest:packet.run,requestedMode:'fixture',runMatchesRequestedMode:true,requestedRunUnavailable:false,reviewMode:'fixture',snapshotNotice:null,collectionJob:packet.collectionJob,collectionPlan:packet.collectionPlan,sensitivity:packet.sensitivity,precedents:null,integrityAssessment:null}));
  expect(html.match(/Open reviewer workbench/g)).toHaveLength(1);expect(html).not.toContain('Escalate to a human reviewer');expect(html).toContain('Additional review request');
}));

