import { RideScene } from '@/components/RideScene';
import { redirect } from 'next/navigation';
import { getDemoRole } from '@/lib/demoSession';
import { getAllCases, getPolicyPack } from '@/repositories/cases';
import { listRemedies } from '@/repositories/journeys';
import { PaymentsJourney, type ClaimCase } from '@/components/PaymentsJourney';
import { NavigatorPanel } from '@/components/NavigatorPanel';
import { navigatorReady } from '@/agents/navigator';
export default async function PaymentsPage() {
  const role = await getDemoRole(); if (!role) redirect('/');
  const cases = await getAllCases(); const claimCases: ClaimCase[] = [];
  for (const c of cases.filter(c => c.category === 'damage')) {
    const pack = await getPolicyPack(c.policyVersion);
    if (pack.source === 'ryde_official' && pack.officialScope === 'cleaning') claimCases.push({ id: c.id, version: c.version,
      evidence: c.evidence.filter(e => e.kind === 'image' || e.kind === 'trip_event' && e.payload.eventType === 'professional_cleaning_receipt').map(e => ({ id: e.id, label: e.kind === 'image' ? `Image · ${e.id}` : `Professional cleaning receipt · ${e.id}` })) });
  }
  const remedies = (await listRemedies()).map(r => role === 'reviewer' ? r : { id: r.id, caseId: r.caseId, caseVersion: r.caseVersion, revision: r.revision, kind: r.kind, amountCents: r.amountCents, status: r.status, recovery: r.recovery, createdAt: r.createdAt, updatedAt: r.updatedAt, events: r.events });
  return <main className="container stack"><header className="journey-hero"><div><p className="eyebrow">Independent remedies</p><h1>{role === 'driver' ? 'Your reimbursements' : role === 'rider' ? 'Your payments and recovery' : 'Payments & recovery'}</h1><p className="page-intro">A driver’s approved reimbursement can proceed while rider recovery remains pending.</p><p className="small muted">Test ledger · No external money transferred. <a href="/policies#ryde-cleaning-20261002">Policy and sources</a></p></div><RideScene variant="payments" compact/></header>
    <PaymentsJourney role={role} remedies={remedies} claimCases={claimCases} goodwillCases={cases.map(c => ({ id: c.id, version: c.version }))} />
    <NavigatorPanel target="payments" ready={navigatorReady()} /></main>;
}

