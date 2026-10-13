import { getCase, getPolicyPack } from '@/repositories/cases';
import { listRemedies } from '@/repositories/journeys';
import { PaymentsJourney,type ClaimCase } from '@/components/PaymentsJourney';
export async function paymentsForCase(caseId: string, role: 'rider' | 'driver' | 'reviewer') {
  const caseRecord = await getCase(caseId);
  if (!caseRecord) return null;

  const claimCases: ClaimCase[] = [];
  if (caseRecord.category === 'damage') {
    const pack = await getPolicyPack(caseRecord.policyVersion);
    if (pack.source === 'ryde_official' && pack.officialScope === 'cleaning') {
      claimCases.push({
        id: caseRecord.id,
        version: caseRecord.version,
        evidence: caseRecord.evidence
          .filter(
            (item) =>
              item.kind === 'image' ||
              (item.kind === 'trip_event' && item.payload.eventType === 'professional_cleaning_receipt'),
          )
          .map((item) => ({
            id: item.id,
            label: item.kind === 'image' ? `Image · ${item.id}` : `Professional cleaning receipt · ${item.id}`,
          })),
      });
    }
  }

  const all = await listRemedies();
  const scoped = all.filter((remedy) => remedy.caseId === caseId);
  if (role!=='reviewer' && scoped.length === 0 && claimCases.length === 0) return null;

  const remedies =
    role === 'reviewer'
      ? scoped
      : scoped.map((remedy) => ({
          id: remedy.id,
          caseId: remedy.caseId,
          caseVersion: remedy.caseVersion,
          revision: remedy.revision,
          kind: remedy.kind,
          amountCents: remedy.amountCents,
          status: remedy.status,
          recovery: remedy.recovery,
          createdAt: remedy.createdAt,
          updatedAt: remedy.updatedAt,
          events: remedy.events,
        }));

  return (
    <section className="card" aria-labelledby="payments-heading">
      <div className="card__title">
        <h2 id="payments-heading">Payments and recovery for this case</h2>
        <span className="badge badge--neutral">Test ledger</span>
      </div>
      <p className="small muted">
        A driver’s approved reimbursement is tracked separately from rider recovery. No external
        money is transferred in this prototype.
      </p>
      <PaymentsJourney
        role={role}
        remedies={remedies}
        claimCases={claimCases}
        goodwillCases={[{id:caseRecord.id,version:caseRecord.version}]}
        caseScoped
      />
    </section>
  );
}


