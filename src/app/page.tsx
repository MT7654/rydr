import Link from 'next/link';

import { enterDemo } from './demoActions';
import { getDemoRole } from '@/lib/demoSession';
import { redirect } from 'next/navigation';
import { healthSnapshot } from '@/lib/runtime';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;

  // Legacy `?view=queue` links resolve to Worklist for reviewers.
  if (view === 'queue') {
    if ((await getDemoRole()) !== 'reviewer') redirect('/');
    redirect('/worklist');
  }

  return <LandingPage />;
}

async function LandingPage() {
  const health = healthSnapshot();
  return <main className="container demo-entry">
    <section className="landing-hero">
      <div className="landing-hero__copy">
        <p className="eyebrow">Ride + Resolve</p>
        <h1 className="landing-hero__title">Fair resolutions for every ride</h1>
        <p className="landing-hero__lede">Prevent a pickup misunderstanding. Challenge the right fact. Get a fair resolution for both sides.</p>
        <p className="small muted">Choose your workspace. No account or password needed.</p>
      </div>
      <div className="landing-hero__art"><img src="/illustrations/pickup-concept.webp" width={960} height={640} alt="Conceptual illustration of a rose car at a covered pickup curb"/></div>
    </section>
    <section aria-labelledby="entry-title" className="demo-role-section">
      <h2 id="entry-title">How are you using Rydr?</h2>
      <div className="demo-role-grid">
        {([
          ['rider','I’m a rider','Open your rides: check a disputed charge, answer a reviewer’s question, or appeal a decision.','01'],
          ['driver','I’m a driver','Open your rides: understand a trip decision, supply a record, track reimbursement, or appeal.','02'],
          ['reviewer','I’m a reviewer','Open the Worklist: assess both sides, request evidence, and record a fair resolution.','03'],
        ] as const).map(([role,title,description,number]) => <article className="card demo-role-card" key={role}>
          <span className="role-symbol" aria-hidden="true">{number}</span><h3>{title}</h3><p>{description}</p>
          <form action={enterDemo}><input type="hidden" name="role" value={role}/><button className="btn btn--primary" type="submit">{role === 'reviewer' ? 'Open Worklist' : 'Open my rides'}</button></form>
        </article>)}
      </div>
      <p className="small muted">{health.liveAvailable ? 'Live AI available through Tencent Cloud ADP. ' : ''}Sample rides · Financial actions use a test ledger.</p>
      <details><summary className="small">Access and session details</summary><p className="small muted">Role selection is not verified identity. Each visitor gets fresh sample cases. Changing roles keeps your progress and the case you were viewing; Start fresh session begins again with every case open. Review requests stay in this workspace and do not notify Ryde support.</p></details>
    </section>
    <section className="journey-explainer" aria-label="How a dispute is resolved">
      <div><strong>1. Prevent a dispute</strong><p>Clarify pickup access together.</p></div>
      <div><strong>2. Challenge a fact</strong><p>Find the relevant record and reassess it.</p></div>
      <div><strong>3. Resolve for both sides</strong><p>Track reimbursement separately from recovery.</p></div>
    </section>
    <p className="small muted" style={{ marginTop: '1.5rem' }}>
      <Link href="/policies">Policies and sources</Link>
    </p>
  </main>;
}
