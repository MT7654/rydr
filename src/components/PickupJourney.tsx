'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Checkpoint } from '@/domain/journeys';
import type { DemoRole } from '@/domain/demoAccess';
const labels: Record<Checkpoint['status'], string> = { awaiting_confirmation: 'Confirm pickup access', mismatch: 'Different entrances', meeting_proposed: 'Meeting point proposed', clarified: 'Both parties confirmed', picked_up: 'Pickup recorded', review_requested: 'Review requested' };
export function PickupJourney({ checkpoint: c, role, preview }: { checkpoint: Checkpoint; role: DemoRole; preview:{disposition:string;summary:string;findings:string[]} }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [entrance, setEntrance] = useState(role === 'driver' ? 'South entrance' : 'North entrance');
  const [meeting, setMeeting] = useState('Taxi stand');
  const closed = c.status === 'picked_up' || c.status === 'review_requested';
  async function act(action: string, value?: string, seconds?:number) { setBusy(true); setError('');
    try { const response = await fetch('/api/journeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'pickup', revision: c.revision, action, entrance: value, seconds }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.message); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Action failed.'); } finally { setBusy(false); }
  }
  return <section className="card pickup-journey"><div className="card__title"><div><p className="eyebrow">{c.id} · Sample active ride</p><h2>{c.pickup}</h2></div><span className={`badge badge--${c.status === 'mismatch' ? 'review' : 'neutral'}`}>{labels[c.status]}</span></div>
    <div className="pickup-diagram" role="img" aria-label={`Rider: ${c.riderEntrance ?? 'entrance not reported'}. Driver: ${c.driverEntrance ?? 'entrance not reported'}. Proposed meeting: ${c.meetingPoint ?? 'not set'}.`}>
      <div className="pickup-person"><span className="pickup-icon" aria-hidden="true">●</span><strong>Rider</strong><span>{c.riderEntrance ?? 'Not reported'}</span><small>{c.riderConfirmed ? 'Meeting confirmed' : 'Awaiting confirmation'}</small></div>
      <div className="pickup-building"><span aria-hidden="true">▥</span><strong>{c.meetingPoint ?? 'Find the same entrance'}</strong><small>Entrance reports · not verified GPS</small></div>
      <div className="pickup-person"><span className="pickup-icon pickup-icon--driver" aria-hidden="true">◆</span><strong>Driver</strong><span>{c.driverEntrance ?? 'Not reported'}</span><small>{c.driverConfirmed ? 'Meeting confirmed' : 'Awaiting confirmation'}</small></div>
    </div>
    <div className="notice"><strong>No no-show charge has been posted.</strong> {c.status === 'mismatch' ? 'You appear to be at different entrances. Clarify access before proceeding.' : c.status === 'picked_up' ? 'The meeting point was clarified before pickup.' : 'Confirmation helps distinguish a nearby vehicle from an accessible pickup.'}</div>
    {error ? <p className="notice notice--danger" role="alert">{error}</p> : null}
    {role !== 'reviewer' && !closed ? <div className="journey-grid" id="pickup-actions">
      <form className="stack" onSubmit={e => { e.preventDefault(); void act('entrance', entrance); }}><h3>1. Where are you?</h3><label htmlFor="entrance">Your entrance</label><select id="entrance" value={entrance} onChange={e => setEntrance(e.target.value)}>{['North entrance','South entrance','Taxi stand'].map(x => <option key={x}>{x}</option>)}</select><button className="btn btn--secondary" disabled={busy}>Record my entrance</button></form>
      <form className="stack" onSubmit={e => { e.preventDefault(); void act('propose', meeting); }}><h3>2. Agree a meeting point</h3><label htmlFor="meeting">Proposed entrance</label><select id="meeting" value={meeting} onChange={e => setMeeting(e.target.value)}>{['Taxi stand','North entrance','South entrance'].map(x => <option key={x}>{x}</option>)}</select><button className="btn btn--secondary" disabled={busy || !c.riderEntrance || !c.driverEntrance}>Propose meeting point</button></form>
      <div className="stack"><h3>3. Confirm and continue</h3><p className="small">Both parties confirm independently. Changing an entrance resets agreement.</p><button className="btn btn--primary" disabled={busy || !c.meetingPoint || (role === 'rider' ? c.riderConfirmed : c.driverConfirmed)} onClick={() => void act('confirm')}>Confirm meeting point</button>
        {role === 'driver' ? <button className="btn btn--primary" disabled={busy || c.status !== 'clarified'} onClick={() => void act('pickup')}>Record pickup</button> : null}</div>
    </div> : null}
    <section className="card stack"><div className="card__title"><h3>Arrival, contact and charge conditions</h3><span className="badge badge--neutral">{preview.disposition.replaceAll('_',' ')}</span></div><p>{preview.summary}</p><p className="small">On-demand sample · {c.contactAttempts} party-reported contact attempt(s) · {c.playbackSeconds ?? 'no'} seconds in source playback. No rider reply is not an admission.</p>
      {role === 'driver' && !closed ? <div className="row"><button className="btn btn--secondary" disabled={busy} onClick={()=>void act('contact')}>Record contact attempt</button><button className="btn btn--ghost" disabled={busy} onClick={()=>void act('playback',undefined,180)}>Play exact 3-minute boundary</button><button className="btn btn--ghost" disabled={busy} onClick={()=>void act('playback',undefined,181)}>Play 3 minutes + 1 second</button></div>:null}
      <details><summary>Policy and source checks</summary><p className="small">Synthetic source playback, not live tracking. Policy snapshot: {c.policyId}. Waiting rules remain separate from the proposed access safeguard.</p><ul>{preview.findings.map(f=><li key={f}>{f}</li>)}</ul><Link href={`/policies#${c.policyId}`}>Read the policy basis →</Link></details>
    </section>
    <div id="pickup-review" className="row" style={{ marginTop: '1rem' }}>{role !== 'reviewer' && !closed ? <><button className="btn btn--ghost" disabled={busy} onClick={() => void act('review')}>Unable to meet? Request review</button><button className="btn btn--ghost" disabled={busy} onClick={()=>void act('safety')}>Report a safety concern</button></> : null}
      {c.safetyReported?<p className="notice">Safety review requested. This app does not dispatch emergency help or notify Ryde. If there is immediate danger, contact local emergency services.</p>:null}
      {c.linkedCaseId ? <Link href={`/cases/${c.linkedCaseId}/outcome`}>Track pickup review →</Link> : null}
      <Link href="/">Switch role to see the other perspective →</Link></div>
    <details className="journey-history"><summary>Pickup history · {c.events.length} events</summary><ol>{c.events.map((e, i) => <li key={i}><span className="small muted">{new Date(e.at).toLocaleTimeString('en-SG')}</span> {e.text}</li>)}</ol></details>
    <p className="small muted">This sample ride uses party-entered access reports. It does not change Ryde waiting rules or connect to a live booking.</p>
  </section>;
}

