import Link from 'next/link';
import { policyLabel } from '@/domain/journeyPresentation';
import { loadPolicyPacks } from '@/repositories/cases';
import { withStorageSession } from '@/repositories/store';
const examples: Record<string, string> = { on_demand_no_show: 'SYN-011', advance_no_show: 'SYN-012', fixed_fare: 'SYN-013', cleaning: 'SYN-014' };
const descriptions: Record<string, string> = {
  on_demand_no_show: 'For driver no-show cancellations on on-demand bookings. Exactly three minutes does not meet the published condition. Cancellation and completed-trip waiting fees are different charges.',
  advance_no_show: 'For advance bookings. Rider cancellation windows differ from driver no-shows. Arrival before scheduled pickup remains a review question.',
  fixed_fare: 'Check the quote, receipt, service type and accepted changes. A route deviation alone does not prove a charge is wrong. These cases require review.',
  cleaning: 'Professional-cleaning claims need verified photos, trip linkage and a receipt. Caps are maximums, not automatic awards. These cases require review.',
};
export default async function PoliciesPage() {
  // Public reference page reads immutable policy files, never visitor records.
  const packs = [...(await withStorageSession(null, loadPolicyPacks)).values()];
  return <main className="container policies-page">
    <header className="portal-heading"><p className="eyebrow">Policy library</p><h1>What grounds a fair resolution?</h1><p>Published Ryde rules guide applicable cases. Rydr checks the evidence and refers uncertain cases to a reviewer.</p></header>
    <section className="policy-layers" aria-label="Three policy layers">
      <article className="card"><span className="badge badge--success">Official sources</span><h2>Ryde’s published rules</h2><p>Cancellation conditions, fixed fares and cleaning claims, linked to the original pages.</p></article>
      <article className="card"><span className="badge badge--neutral">Evidence safeguards</span><h2>Rydr’s checks</h2><p>GPS accuracy, gaps, image integrity and review thresholds are prototype choices, not published Ryde rules.</p></article>
      <article className="card"><span className="badge badge--review">Sample history</span><h2>Preserved example rules</h2><p>DISP-002 and SYN-001–010 keep their sample or example policy basis. Website updates do not rewrite recorded decisions.</p></article>
    </section>
    <div className="notice"><strong>Sources checked 2 October 2026.</strong> Public-policy paraphrases, with effective dates unconfirmed. Older trips, unknown booking types and conflicting rules need review. Rydr is not endorsed by Ryde.</div>
    <nav className="case-jump-nav" aria-label="Policy sections">{packs.filter(p => p.source === 'ryde_official').map(p => <a key={p.id} href={`#${p.id}`}>{p.label.split(' · ')[0]}</a>)}<a href="#demo-rules">Sample &amp; example rules</a></nav>
    {packs.filter(p => p.source === 'ryde_official').map(pack => <section className="card policy-pack" id={pack.id} key={pack.id}>
      <div className="card__title"><h2>{pack.label.split(' · ')[0]}</h2><span className="badge badge--success">Public Ryde sources</span></div>
      <p className="small muted">Snapshot {pack.retrievedAt} · version {pack.version} · effective date unconfirmed</p>
      <p>{descriptions[pack.officialScope ?? '']}</p>
      <ul className="policy-rules">{pack.clauses.filter(c => c.authority === 'official_ryde').map(c => <li key={c.id}><strong>{c.title}</strong><p>{c.text}</p><a href={c.sourceUrl} target="_blank" rel="noreferrer">Read original Ryde policy ↗</a></li>)}</ul>
      <details><summary>How Rydr checks the evidence</summary><ul className="policy-rules">{pack.clauses.filter(c => c.authority === 'rydr_safeguard').map(c => <li key={c.id}><strong>{c.title.replace('Rydr safeguard: ', '')}</strong><p>{c.text}</p></li>)}</ul></details>
      <p className="small muted">{pack.applicability}</p><p className="small">Example: {examples[pack.officialScope ?? '']} · synthetic ride data. <Link href="/">Choose your workspace →</Link></p>
    </section>)}
    <section id="proposed-goodwill" className="card policy-pack"><span className="badge badge--review">Rydr proposed rule</span><h2>Platform-funded goodwill</h2><p>In the test ledger, a reviewer may authorize a separate rider credit up to S$5 for a documented platform issue or unresolved inconvenience. This is not a published Ryde entitlement, does not assign blame and does not debit the driver. Every credit requires a reason and authorization.</p><p className="small muted">Authority: RYDR-GOODWILL-01 · proposed-goodwill-v1. Cleaning reimbursement uses the separate published policy above.</p></section>
    <section id="demo-rules" className="card policy-pack"><h2>Supplied sample &amp; example rules</h2><p>DISP-002 supplies a S$5 fee, five-minute free wait and eight-minute no-show threshold. Its unresolved clock remains visible. Original examples use a 50 m GPS radius and a 20% / 1 km route trigger. These numbers are not attributed to Ryde’s website policy.</p>
      {packs.filter(p => p.source !== 'ryde_official').map(pack => <details key={pack.id} id={pack.id}><summary>{policyLabel(pack.label)}</summary><ul className="policy-rules">{pack.clauses.map(c => <li key={c.id}><strong>{c.title}</strong><p>{c.text}</p></li>)}</ul></details>)}
    </section>
  </main>;
}

