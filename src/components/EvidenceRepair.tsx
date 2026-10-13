'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DisputedCondition } from '@/domain/collection';
import type { RepairRecord } from '@/repositories/journeys';
export function EvidenceRepair({ caseId, version, conditions, repairs, liveReady, previousRun }: {
  caseId: string; version: number; conditions: DisputedCondition[]; repairs: RepairRecord[]; liveReady: boolean;
  previousRun: { state: string; caseVersion: number; mode: string } | null;
}) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [run, setRun] = useState(previousRun);
  useEffect(() => { setRun(previousRun); }, [previousRun]);
  useEffect(() => {
    if (!run || ['completed','escalated','failed','cancelled'].includes(run.state)) return;
    const timer = setInterval(() => { void fetch(`/api/cases/${caseId}/repair`).then(r => r.json()).then(data => { setRun(data.run); if (data.run && ['completed','escalated','failed','cancelled'].includes(data.run.state)) router.refresh(); }).catch(() => setError('Could not refresh assessment status. Reload to check progress.')); }, 2500);
    return () => clearInterval(timer);
  }, [caseId, run, router]);
  async function act(operation: 'request' | 'assess', conditionId?: string, mode?: string) {
    setBusy(true); setError(''); try {
      const response = await fetch(`/api/cases/${caseId}/repair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, version, conditionId, mode }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Request failed.');
      if (data.run) setRun(data.run); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Request failed.'); } finally { setBusy(false); }
  }
  const running = !!run && !['completed','escalated','failed','cancelled'].includes(run.state);
  return <section className="stack">
    {error ? <p role="alert" className="notice notice--danger">{error}</p> : null}
    <div className="journey-grid">{conditions.slice(0,3).map(c => <article className="card repair-card" key={c.id}><span className="badge badge--neutral">{c.kind === 'policy_ambiguity' ? 'Policy owner' : c.tool ? 'Platform record' : 'Reviewer'}</span><h2>{c.kind === 'policy_ambiguity' ? 'Clarify the governing rule' : c.tool === 'trip_telemetry' ? 'Check the trip record' : c.tool === 'communications' ? 'Check contact attempts' : c.tool === 'fare_ledger' ? 'Check the fare breakdown' : 'Check this finding'}</h2>
      <p>{c.summary}</p><details><summary>Why this matters</summary><p className="small">{c.whyItMatters}</p></details>
      <button className="btn btn--primary" disabled={busy || running} onClick={() => void act('request',c.id)}>{c.kind === 'policy_ambiguity' || !c.tool ? 'Request clarification' : 'Request source record'}</button></article>)}</div>
    {!conditions.length ? <div className="card"><h2>No specific missing source identified</h2><p>The current evidence does not identify a retrievable gap. A reviewer can inspect a disputed finding or policy requirement.</p><button className="btn btn--secondary" disabled={busy || running} onClick={() => void act('request','review')}>Request a finding review</button></div> : null}
    {repairs.length ? <section className="card"><h2>Your evidence requests</h2><ul className="repair-progress">{repairs.map(r => <li key={r.id}><strong>{r.status === 'retrieved' ? 'Source record retrieved' : r.status === 'unavailable' ? 'Source unavailable · reviewer requested' : 'Review requested'}</strong><p className="small">{r.note}</p><span className="small muted">Case v{r.startingVersion}{r.resultingVersion ? ` → v${r.resultingVersion}` : ' · no evidence version created'}</span></li>)}</ul></section> : null}
    <section className="card"><div className="card__title"><h2>Reassess the current evidence</h2><span className="badge badge--neutral">Case v{version}</span></div>
      <p className="small">The Rider Advocate, Driver Advocate and Judge assess this version. Requests and unverified claims do not guarantee a different outcome.</p>
      <div className="row"><button className="btn btn--primary" disabled={busy || running || !liveReady} onClick={() => void act('assess',undefined,'live')}>Assess with live AI</button>
        <button className="btn btn--ghost" disabled={busy || running} onClick={() => void act('assess',undefined,'fixture')}>Use sample assessment</button></div>
      {repairs.some(r => r.resultingVersion && r.beforeIssueCount !== undefined) ? <p className="small">Latest retrieval: unresolved checks {repairs.filter(r => r.resultingVersion && r.beforeIssueCount !== undefined).at(-1)?.beforeIssueCount} → {repairs.filter(r => r.resultingVersion && r.beforeIssueCount !== undefined).at(-1)?.afterIssueCount}. Reassessment determines whether the outcome changes.</p> : null}
      {run ? <div aria-live="polite" className="notice" style={{ marginTop: '1rem' }}><strong>{run.mode === 'live' ? 'Live AI assessment' : 'Sample assessment'}</strong> · {run.state.replaceAll('_',' ')} · case v{run.caseVersion}
        {['completed','escalated'].includes(run.state) ? <p>{run.state === 'escalated' ? 'Evidence assessed; a reviewer must resolve the remaining questions. ' : ''}<Link className="btn btn--secondary" href={`/cases/${caseId}/outcome`}>See the updated outcome</Link></p> : run.state === 'failed' ? <p>The assessment failed. No sample result was substituted for a live failure.</p> : <p>Assessment activity is being recorded. You can stay here or return later.</p>}</div> : null}
    </section>
  </section>;
}

