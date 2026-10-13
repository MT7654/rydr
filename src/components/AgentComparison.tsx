import type { AdvocateOutput, Finding, JudgeOutput } from '@/domain/contracts';
import { displayText } from '@/domain/displayText';
import { Cite } from './Cite';

function stance(agent: AdvocateOutput | null, id: string) {
  if (!agent) return 'Awaiting assessment';
  const uses=agent.supportingFindingIds.includes(id), challenges=agent.contradictoryFindingIds.includes(id);
  return uses && challenges ? 'Uses · also challenges' : challenges ? 'Acknowledges contradiction' : uses ? 'Uses in case' : 'Not cited';
}
/** Shows only explicit finding references. Never infers agreement from missing citations. */
export function AgentComparison({ findings, rider, driver, judge }: { findings: Finding[]; rider: AdvocateOutput | null; driver: AdvocateOutput | null; judge: JudgeOutput | null }) {
  if (!rider && !driver) return null;
  const referenced = new Set([...(rider?.supportingFindingIds??[]),...(rider?.contradictoryFindingIds??[]),...(driver?.supportingFindingIds??[]),...(driver?.contradictoryFindingIds??[]),...(judge?.establishedFindingIds??[]),...(judge?.disputedFindingIds??[])]);
  const rows=findings.filter(f=>f.material || referenced.has(f.id));
  if (!rows.length) return null;
  return <section className="position-comparison" aria-label="Agent evidence comparison"><div className="section-heading"><div><p className="eyebrow">Same evidence. Separate perspectives.</p><h2>Where the assessments meet</h2></div><span className="small muted">{rows.length} findings</span></div><p className="small muted">These labels show each agent’s explicit references. “Not cited” does not mean agreement.</p><div className="comparison-scroll"><table><thead><tr><th>Finding & source</th><th>Rider advocate</th><th>Driver advocate</th><th>Judge</th></tr></thead><tbody>{rows.map(f=><tr key={f.id}><td><span className={`fact-kind fact-kind--${f.kind}`}>{f.kind==='computed'?'Calculated':f.kind==='unknown'?'Unresolved':f.kind==='claim'?'Party claim':f.kind==='observation'?'Recorded':'Inference'}</span><p>{displayText(f.text)}</p><div className="fact-sources">{f.evidenceIds.map((id,i)=><Cite kind="evidence" id={id} key={id}>Source {i+1}</Cite>)}{f.policyIds.map((id,i)=><Cite kind="policy" id={id} key={id}>Rule {i+1}</Cite>)}</div></td><td>{stance(rider,f.id)}</td><td>{stance(driver,f.id)}</td><td>{!judge?'Awaiting assessment':judge.establishedFindingIds.includes(f.id)&&judge.disputedFindingIds.includes(f.id)?'Established · disputed':judge.disputedFindingIds.includes(f.id)?'Disputed':judge.establishedFindingIds.includes(f.id)?'Established':'Not selected'}</td></tr>)}</tbody></table></div></section>;
}
