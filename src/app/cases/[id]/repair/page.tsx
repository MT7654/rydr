import Link from 'next/link';
import { CitationDrawer } from '@/components/CitationDrawer';
import { redirect, notFound } from 'next/navigation';
import { getDemoRole } from '@/lib/demoSession';
import { loadCasePacket } from '@/lib/casePacket';
import { listRepairs } from '@/repositories/journeys';
import { latestRunForCase } from '@/repositories/runs';
import { navigatorReady } from '@/agents/navigator';
import { healthSnapshot } from '@/lib/runtime';
import { EvidenceRepair } from '@/components/EvidenceRepair';
import { NavigatorPanel } from '@/components/NavigatorPanel';
import { PolicyBasis } from '@/components/PolicyBasis';
import { RepairSupport } from '@/components/RepairSupport';
import { supportingRequests } from '@/repositories/repairSupport';
import { repairComparison } from '@/repositories/repairComparison';
export default async function RepairPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getDemoRole(); if (!role) redirect('/'); const { id } = await params;
  const packet = await loadCasePacket(id); if (!packet) notFound();
  const run = await latestRunForCase(id);
  const comparison = await repairComparison(id,role);
  return <main className="container stack"><header><Link href={`/cases/${id}/outcome`}>← Case outcome</Link><p className="eyebrow">{id} · Case v{packet.currentCaseVersion}</p><h1>Challenge a fact. Find the right record.</h1><p className="page-intro">Ask for evidence that matters, track verification, and see whether the result changes.</p></header>
    <PolicyBasis pack={packet.pack} suppliedSample={packet.caseRecord.suppliedPolicyId !== null} />
    <RepairSupport caseId={id} version={packet.currentCaseVersion} role={role} requests={await supportingRequests(id,role)} gpsSamples={packet.caseRecord.evidence.filter(e=>e.kind === 'gps')} />
    <EvidenceRepair caseId={id} version={packet.currentCaseVersion} conditions={packet.collectionPlan.conditions} repairs={await listRepairs(id,role)} liveReady={healthSnapshot().liveAvailable}
      previousRun={run ? { state: run.state, caseVersion: run.caseVersion, mode: run.mode } : null} />
    {comparison ? <section className="card stack"><h2>What changed after the record arrived?</h2><p className="small">Case v{comparison.beforeVersion} → v{comparison.afterVersion}. Source availability and findings are separate from a final decision.</p>
      {comparison.changes.map(c=><details key={c.findingId}><summary>Changed finding · {c.findingId}</summary><p><strong>Before:</strong> {c.before}</p><p><strong>After:</strong> {c.after}</p><p className="small">Policy references: {c.policyIds.join(', ')}</p></details>)}
      {!comparison.changes.length?<p>No comparable finding changed. A new record does not guarantee a new ruling.</p>:null}
      <div className="journey-grid"><div><h3>Previous assessment</h3><p>{comparison.beforeDisposition?.replaceAll('_',' ') ?? 'Not assessed'}</p></div><div><h3>Updated assessment</h3><p>{comparison.afterDisposition?.replaceAll('_',' ') ?? 'Awaiting reassessment'}{comparison.mode ? ` · ${comparison.mode === 'live' ? 'live AI' : 'sample output'}`:''}</p></div></div>
      {comparison.beforeDisposition && comparison.afterDisposition ? <p className="notice">{comparison.beforeDisposition === comparison.afterDisposition ? 'The assessment outcome stayed the same.' : 'The assessment outcome changed after the new evidence.'}</p>:null}
    </section>:null}
    <NavigatorPanel target="case" caseId={id} ready={navigatorReady()} /><CitationDrawer caseId={id}/></main>;
}

