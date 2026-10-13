'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { workspaceHref } from '@/domain/workspaceRoute';
import type { DemoRole } from '@/domain/demoAccess';
import type { Remedy } from '@/domain/journeys';
import { formatSgd } from '@/domain/money';
export type PaymentView = Pick<Remedy,'id'|'caseId'|'caseVersion'|'revision'|'kind'|'amountCents'|'status'|'recovery'|'createdAt'|'updatedAt'|'events'> & Partial<Pick<Remedy,'note'|'approvalNote'|'evidenceIds'|'entries'|'policyIds'>>;
export interface ClaimCase { id: string; version: number; evidence: { id: string; label: string }[] }
const statusLabels = { submitted: 'Awaiting approval', approved: 'Approved · ready to record', posted: 'Recorded in test ledger', rejected: 'Not approved' };
const recoveryLabels = { not_applicable: 'No rider recovery', pending: 'Recovery pending', received: 'Recovery recorded', failed: 'Recovery failed', disputed: 'Recovery paused for review' };
export function PaymentsJourney({ role, remedies, claimCases, goodwillCases, caseScoped = false }: { role: DemoRole; remedies: PaymentView[]; claimCases: ClaimCase[]; goodwillCases: { id: string; version: number }[]; caseScoped?: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function send(body: unknown) {
    setBusy(true); setError(''); setNotice('');
    try { const response = await fetch('/api/journeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Action failed.');
      setNotice('Saved. Payment and recovery tracks have been updated.'); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Action failed.'); } finally { setBusy(false); }
  }
  return <div className="stack"><p className="small"><a href="/api/journeys?export=journeys">Download your journey records</a></p><div aria-live="polite">{error ? <p className="notice notice--danger">{error}</p> : null}{notice ? <p className="notice notice--success">{notice}</p> : null}</div>
    {role === 'driver' ? <section className="card"><h2>Request cleaning reimbursement</h2><p className="small muted">Submit supporting records for review. Approval and driver reimbursement are separate from collecting payment from the rider.</p>
      <ClaimForm cases={claimCases} busy={busy} send={send} kind="cleaning" scoped={caseScoped} /></section> : null}
    {role === 'reviewer' ? <details className="card"><summary>Propose platform-funded goodwill</summary><p className="small">Rydr proposed rule · up to S$5 · reviewer authorization required. This credit does not establish either party's responsibility and is separate from a fare refund.</p>
      <ClaimForm cases={goodwillCases.map(c => ({ ...c, evidence: [] }))} busy={busy} send={send} kind="goodwill" scoped={caseScoped} /></details> : null}
    {!remedies.length ? <section className="card"><h2>No remedies submitted yet</h2><p>A driver can submit a cleaning claim. A reviewer checks the evidence before any ledger entry is recorded.</p><Link href="/">Change role →</Link></section> : null}
    {remedies.map(r => <article className="card remedy-card" key={r.id}><div className="card__title"><div><p className="eyebrow">{r.caseId} · {r.kind === 'cleaning' ? 'Cleaning reimbursement' : 'Platform goodwill'}</p><h2>{formatSgd(r.amountCents)}</h2></div><span className="badge badge--neutral">{statusLabels[r.status]}</span></div>
      <p className="small"><strong>Next:</strong> {r.status === 'submitted' ? 'Reviewer verifies the record and authorizes or rejects the remedy.' : r.status === 'approved' ? 'Reviewer records the approved remedy.' : r.status === 'rejected' ? 'A party can request review of the case outcome.' : r.recovery === 'disputed' ? 'Reviewer resolves the rider’s recovery challenge.' : r.recovery === 'pending' || r.recovery === 'failed' ? 'Platform reviewer manages recovery; driver reimbursement remains recorded.' : 'No payment action is pending.'}</p>
      <div className="journey-grid remedy-tracks">
        <div><h3>Driver</h3><strong>{r.kind === 'goodwill' ? 'No driver adjustment' : r.status === 'posted' ? 'Reimbursement recorded' : r.status === 'approved' ? 'Reimbursement approved' : r.status === 'rejected' ? 'Claim not approved' : 'Claim under review'}</strong><p className="small">{r.kind === 'cleaning' ? 'Approved reimbursement does not wait for rider recovery.' : 'Goodwill does not debit the driver.'}</p></div>
        <div><h3>Rider</h3><strong>{r.kind === 'goodwill' ? r.status === 'posted' ? 'Goodwill credit recorded' : 'Credit awaiting approval/execution' : recoveryLabels[r.recovery]}</strong><p className="small">{r.recovery === 'disputed' ? 'A reviewer must resolve the challenge before collection.' : 'Recovery has its own status and transaction.'}</p></div>
        <div><h3>Platform</h3><strong>{r.status === 'posted' ? r.recovery === 'received' ? 'Recovery recorded separately' : 'Remedy funded in test ledger' : 'No ledger movement yet'}</strong><p className="small">{r.kind === 'goodwill' ? 'Proposed goodwill authority' : 'Published Ryde cleaning policy'}</p></div>
      </div>
      <p className="small muted">Test ledger · No external money transferred. <Link href={workspaceHref(r.caseId,role,'outcome')}>View case</Link> · <a href={`/api/journeys?receipt=${encodeURIComponent(r.id)}`}>Download {role === 'reviewer' ? 'audit' : role} receipt</a></p>
      {role === 'reviewer' && r.status === 'submitted' ? <form className="stack reviewer-remedy" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void send({ operation: 'remedy', id: r.id, revision: r.revision, action: 'approve', tier: form.get('tier'), note: form.get('note'), verified: form.get('verified') === 'on' }); }}>
        <h3>Verify and authorize</h3>{r.kind === 'cleaning' ? <><label>Verified cleaning tier<select name="tier" required><option value="food">Food / drink / crumbs / sand · cap S$40</option><option value="stains">Bodily fluids / stains · cap S$120</option><option value="vomit">Vomit · cap S$200</option></select></label>
          <p className="small">Inspect the linked photos and professional receipt, vehicle/trip linkage, 24-hour cleaning and 48-hour submission, exclusions and responsibility. Images alone do not establish responsibility.</p>
          <details><summary>Supporting records</summary><ul>{r.evidenceIds?.map(id => <li key={id}>{id}</li>)}</ul><p>{r.note}</p><Link href={`/cases/${r.caseId}#evidence`}>Inspect case evidence and receipt →</Link></details></> : null}
        <label>Verification and authorization note<textarea name="note" required minLength={15} maxLength={1500} rows={2} placeholder="State what you verified, the basis and approved amount." /></label>
        <label className="check-row"><input type="checkbox" name="verified" required />{r.kind === 'cleaning' ? 'I checked the evidence, applicable policy and eligibility requirements.' : 'I authorize this proposed platform-funded goodwill credit without assigning blame.'}</label>
        <button className="btn btn--primary" disabled={busy}>Approve remedy</button>
        <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => { const note = window.prompt('Reason for rejecting this request (at least 10 characters)'); if (note) void send({ operation: 'remedy', id: r.id, revision: r.revision, action: 'reject', note }); }}>Reject request</button>
      </form> : null}
      {role === 'reviewer' && r.status === 'approved' ? <button className="btn btn--primary" disabled={busy} onClick={() => void send({ operation: 'remedy', id: r.id, revision: r.revision, action: 'post' })}>Record {r.kind === 'cleaning' ? 'driver reimbursement' : 'rider credit'} in test ledger</button> : null}
      {role === 'reviewer' && r.status === 'posted' && r.kind === 'cleaning' && ['pending','failed'].includes(r.recovery) ? <div className="row"><button className="btn btn--secondary" disabled={busy} onClick={() => void send({ operation: 'remedy', id: r.id, revision: r.revision, action: 'recover' })}>Record rider recovery in test ledger</button><button className="btn btn--ghost" disabled={busy || r.recovery === 'failed'} onClick={() => void send({ operation: 'remedy', id: r.id, revision: r.revision, action: 'fail_recovery' })}>Record failed recovery</button></div> : null}
      {role === 'rider' && r.kind === 'cleaning' && !['received','disputed','not_applicable'].includes(r.recovery) && r.status !== 'rejected' ? <form className="stack" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void send({ operation: 'remedy', id: r.id, revision: r.revision, action: 'dispute', note: form.get('note') }); }}><label>Dispute this recovery<textarea name="note" minLength={10} maxLength={1500} required rows={2} placeholder="Explain the fact or responsibility you dispute." /></label><button className="btn btn--secondary" disabled={busy}>Request recovery review</button></form> : null}
      {role === 'reviewer' && r.status === 'posted' ? <details className="reviewer-remedy"><summary>Resolve recovery or adjust the remedy</summary>
        <p className="small">Inspect the case and any recovery appeal first. Adjustments create new journal entries; original payments remain in history.</p><Link href="/review-queue">Open review queue →</Link>
        <form className="stack" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const action = f.get('action'); const raw = String(f.get('amount') ?? '');
          void send({ operation: 'remedy', id: r.id, revision: r.revision, action, note: f.get('note'), verified: f.get('verified') === 'on', tier: f.get('tier'), ...(action === 'adjust' ? { amountCents: Math.round(Number(raw)*100) } : {}) }); }}>
          <label>Action<select name="action">{r.kind === 'cleaning' && r.recovery !== 'received' ? <><option value="waive_recovery">Waive rider recovery; preserve driver reimbursement</option><option value="resume_recovery">Resolve challenge and resume recovery</option></> : null}<option value="adjust">Adjust the authorized remedy amount</option></select></label>
          <label>New target amount, for an adjustment only (SGD)<input name="amount" type="number" step="0.01" min="0.01" max={r.kind === 'goodwill' ? 5 : 200} defaultValue={(r.amountCents/100).toFixed(2)} /></label>
          <label>Reviewed tier<select name="tier"><option value="food">Food / drink · cap S$40</option><option value="stains">Stains / bodily fluids · cap S$120</option><option value="vomit">Vomit · cap S$200</option></select></label>
          <label>Reviewed basis<textarea name="note" minLength={15} maxLength={1500} required rows={2} /></label><label className="check-row"><input type="checkbox" name="verified" required />I reviewed the evidence, current case version and authority for this action.</label><button className="btn btn--secondary" disabled={busy}>Authorize correction in test ledger</button>
        </form></details> : null}
      <details className="journey-history"><summary>Receipt and history</summary><p className="small">Reference {r.id} · Updated {new Date(r.updatedAt).toLocaleString('en-SG')}</p><ol>{r.events.map((e,i) => <li key={i}>{e.text}</li>)}</ol>
        {role === 'reviewer' && r.entries?.length ? <table><thead><tr><th>Account</th><th>Direction</th><th>Amount</th></tr></thead><tbody>{r.entries.map(e => <tr key={e.id}><td>{e.account.replaceAll('_',' ')}</td><td>{e.direction}</td><td>{formatSgd(e.amountCents)}</td></tr>)}</tbody></table> : null}
      </details></article>)}
  </div>;
}
function ClaimForm({ cases, kind, busy, send, scoped = false }: { cases: ClaimCase[]; kind: 'cleaning' | 'goodwill'; busy: boolean; send: (body: unknown) => Promise<void>; scoped?: boolean }) {
  const [caseId,setCaseId] = useState(cases.find(c => c.id === 'SYN-015')?.id ?? cases[0]?.id ?? '');
  const selected = cases.find(c => c.id === caseId);
  return <form className="stack" onSubmit={e => { e.preventDefault(); if (!selected) return; const form = new FormData(e.currentTarget); const raw = String(form.get('amount') ?? '');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) return;
    void send({ operation: 'submit_remedy', kind, caseId, version: selected.version, amountCents: Math.round(Number(raw)*100), note: form.get('note'), evidenceIds: form.getAll('evidenceIds') }); }}>
    {scoped ? <p className="small muted" style={{ margin: 0 }}>For case <strong>{selected?.id}</strong> · v{selected?.version}</p> : <label>Related case<select value={caseId} onChange={e => setCaseId(e.target.value)} required>{cases.map(c => <option value={c.id} key={c.id}>{c.id} · v{c.version}</option>)}</select></label>}
    <label>{kind === 'cleaning' ? 'Requested reimbursement' : 'Proposed credit'} (SGD)<input name="amount" type="number" step="0.01" min="0.01" max={kind === 'goodwill' ? 5 : 200} defaultValue={kind === 'goodwill' ? '5.00' : '25.00'} required /></label>
    {kind === 'cleaning' ? <fieldset><legend>Supporting records</legend>{selected?.evidence.map(e => <label key={`${caseId}-${e.id}`} className="check-row"><input type="checkbox" name="evidenceIds" value={e.id} />{e.label}</label>)}</fieldset> : null}
    <label>{kind === 'cleaning' ? 'Claim details' : 'Platform correction and funding reason'}<textarea name="note" rows={2} minLength={10} maxLength={1500} required /></label>
    <button className="btn btn--primary" disabled={busy || !selected}>{kind === 'cleaning' ? 'Submit claim for review' : 'Submit goodwill proposal'}</button>
  </form>;
}


