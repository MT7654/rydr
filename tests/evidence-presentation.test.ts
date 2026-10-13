import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { AgentComparison } from '../src/components/AgentComparison';
import { EvidenceBrief } from '../src/components/EvidenceBrief';
import { loadCasePacket } from '../src/lib/casePacket';
import type { AdvocateOutput, Finding } from '../src/domain/contracts';

it('distinguishes explicit use, contradiction and absent citations without inventing agreement', () => {
 const finding: Finding={id:'F-1',kind:'unknown',text:'Accuracy is unknown. This final sentence must remain visible.',evidenceIds:['GPS-1'],policyIds:[],material:true};
 const rider:AdvocateOutput={side:'rider',position:'review',summary:'Review needed.',supportingFindingIds:['F-1'],contradictoryFindingIds:['F-1'],evidenceIds:[],policyIds:[],uncertainties:[],requestedEvidenceIds:[],modelConfidence:0.5};
 const driver:AdvocateOutput={...rider,side:'driver',supportingFindingIds:[],contradictoryFindingIds:[]};
 const html=renderToStaticMarkup(React.createElement(AgentComparison,{findings:[finding],rider,driver,judge:null}));
 expect(html).toContain('Uses · also challenges');
 expect(html).toContain('Not cited');
 expect(html).toContain('Awaiting assessment');
 expect(html).toContain('This final sentence must remain visible.');
 expect(html).toContain('GPS-1');
});

it('keeps competing clocks and unresolved evidence visible in the supplied case', async () => {
 const packet=(await loadCasePacket('DISP-002'))!;
 const html=renderToStaticMarkup(React.createElement(EvidenceBrief,{record:packet.caseRecord,evaluation:packet.evaluation,pack:packet.pack}));
 expect(html).toContain('Effective clock');
 expect(html).toContain('Earliest candidate');
 expect(html).toContain('Policy threshold: 5 min.');
 expect(html).toContain('not a final liability decision');
 for(const issue of packet.evaluation.issues) expect(html).toContain(issue.replace(/&/g,'&amp;').replace(/'/g,'&#x27;'));
 expect(html).toContain('Source 1');
});
