import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({useRouter: () => ({push:vi.fn(),refresh:vi.fn()})}));
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceAcceptanceButton } from '../src/components/EvidenceAcceptanceButton';
import { GpsSamplePicker } from '../src/components/GpsSamplePicker';
import { ReadableText } from '../src/components/ReadableText';
import { RunMonitor } from '../src/components/RunMonitor';
import { loadCase } from './helpers';
import { loadCasePacket } from '../src/lib/casePacket';
import { startRun, DEFAULT_CONFIG } from '../src/agents/orchestrator';
import { createFixtureProvider } from '../src/providers/fixture';
import { CaseDetailView } from '../src/components/CaseDetailView';

it('disables evidence acceptance for statements, completed reviews and old versions', () => {
 for (const props of [{structured:false,current:true,open:true},{structured:true,current:false,open:true},{structured:true,current:true,open:false}]) {
  const html=renderToStaticMarkup(createElement(EvidenceAcceptanceButton,props));
  expect(html).toContain('disabled=""');
 }
 expect(renderToStaticMarkup(createElement(EvidenceAcceptanceButton,{structured:true,current:true,open:true}))).not.toContain('disabled');
});

it('shows GPS record context and an independent citation button before choosing a correction', async () => {
 const record=await loadCase('DISP-002');
 const samples=record.evidence.filter(e=>e.kind==='gps');
 const html=renderToStaticMarkup(createElement(GpsSamplePicker,{samples}));
 expect(html).toContain('SGT');
 expect(html).toContain('Accuracy not reported');
 expect(html).toContain('Inspect record');
 for(const sample of samples) expect(html).toContain(`data-cite="evidence:${sample.id}"`);
 // Inspecting must not toggle the record checkbox via its label.
 expect(html).toMatch(/<\/label><button[^>]+data-cite=/);
});

it('keeps every sentence visible in expanded agent summaries', () => {
 const html=renderToStaticMarkup(createElement(ReadableText,{text:'First fact. Second fact. Third fact. Fourth fact. Final material conflict remains unresolved.',expanded:true}));
 expect(html).toContain('Final material conflict remains unresolved.');
 expect(html).not.toContain('<details');
 expect(html).toContain('<li>');
});

it('keeps the assessment team above newly arriving comparison results', async () => {
 const run=await startRun('DISP-002','fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider()},'stable-team-ui');
 const packet=(await loadCasePacket('DISP-002',{runId:run.id}))!;
 const html=renderToStaticMarkup(createElement(RunMonitor,{caseId:run.caseId,runId:run.id,initialRun:run,findings:packet.evaluation.findings}));
 expect(html.indexOf('aria-label="Assessment team"')).toBeLessThan(html.indexOf('aria-label="Agent evidence comparison"'));
 const pending=renderToStaticMarkup(createElement(RunMonitor,{caseId:run.caseId,runId:run.id,initialRun:{...run,state:'judging',advocates:{rider:null,driver:null},judge:null},findings:packet.evaluation.findings}));
 expect(pending).toContain('aria-label="Assessment team"');
 expect(pending).not.toContain('aria-label="Agent evidence comparison"');
});

it('separates a recorded partial refund from the original human-review recommendation',async()=>{
 const run=await startRun('DISP-002','fixture',{...DEFAULT_CONFIG,provider:createFixtureProvider()},'recorded-outcome-ui');
 const packet=(await loadCasePacket('DISP-002',{runId:run.id}))!;
 const html=renderToStaticMarkup(createElement(CaseDetailView,{workflow:{status:'Settled',decision:'partial refund — SGD 2.00',openTasks:[]},caseRecord:packet.caseRecord,evaluation:packet.evaluation,quality:packet.quality,pack:packet.pack,latest:packet.run,requestedMode:'fixture',runMatchesRequestedMode:true,requestedRunUnavailable:false,reviewMode:'fixture',snapshotNotice:null,collectionJob:packet.collectionJob,collectionPlan:packet.collectionPlan,sensitivity:packet.sensitivity,precedents:null,integrityAssessment:null}));
 expect(html).toContain('Recorded outcome');
 expect(html).toContain('partial refund — SGD 2.00');
 expect(html).toContain('Original automated assessment · historical record');
 expect(html).toContain('Human review was requested');
 expect(html).not.toContain('This recommendation needs a human decision.');
 expect(html).not.toContain('Human review needed');
});
