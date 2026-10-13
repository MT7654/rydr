import Link from 'next/link';
import { getAllCases } from '@/repositories/cases';
import { buildOperationsInsight } from '@/domain/operationsInsight';
import { remedyMetrics, crossCaseEvidenceSignals } from '@/domain/journeyMetrics';
import { listRemedies, getCheckpoint } from '@/repositories/journeys';
import { formatSgd } from '@/domain/money';

export const metadata = {
  title: 'Operations insight — Rydr',
};

export default async function OperationsPage() {
  const cases = await getAllCases();
  const insight = await buildOperationsInsight(cases);
  const metrics = remedyMetrics(await listRemedies()); const checkpoint = await getCheckpoint(); const patterns = crossCaseEvidenceSignals(cases);

  return (
    <main className="container stack operations-page">
      <div className="card">
        <div className="card__title">
          <h1>Operations insight</h1>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Read-only summary across {insight.totalCases} case(s). Generated{' '}
          {insight.generatedAt.replace('T', ' ').slice(0, 16)} UTC.
        </p>
      </div>

      <section className="card"><h2>Journey outcomes in this session</h2><p className="small">Observed prototype state, not a business-savings estimate or production accuracy measure.</p><div className="journey-grid"><div><h3>Pickup</h3><strong>{checkpoint.status.replaceAll('_',' ')}</strong><p>{checkpoint.events.length} recorded steps · no posted charge</p></div><div><h3>Driver remedies</h3><strong>{formatSgd(metrics.driverCreditsCents)}</strong><p>{metrics.postedBeforeRecovery} posted claim(s) with recovery still separate</p></div><div><h3>Unrecovered cleaning exposure</h3><strong>{formatSgd(metrics.unrecoveredCleaningCents)}</strong><p>{metrics.pausedRecoveries} recovery challenge(s) · test ledger only</p></div></div></section>
      {patterns.length?<section className="card"><h2>Cross-case evidence patterns</h2><p className="small">Review signals only. Account ratings and repetition do not establish liability.</p><ul>{patterns.map(p=><li key={p.hash}><p>{p.explanation}</p>{p.references.map(r=><p key={`${r.caseId}:${r.evidenceId}`}><Link href={`/cases/${r.caseId}`}>{r.caseId}</Link> · {r.evidenceId}</p>)}</li>)}</ul></section>:null}

      {insight.groups.length === 0 ? (
        <section className="card">
          <p className="small muted" style={{ margin: 0 }}>
            No supported cause patterns detected in the current case set.
          </p>
        </section>
      ) : (
        insight.groups.map((group) => (
          <section key={group.cause} className="card">
            <div className="card__title">
              <h2>
                {group.cause.replace(/_/g, ' ')}
                <span className="badge badge--neutral" style={{ marginLeft: '0.5rem' }}>
                  {group.count}
                </span>
              </h2>
            </div>
            <p style={{ margin: '0 0 0.5rem' }}>{group.description}</p>
            <p className="small" style={{ margin: '0 0 0.75rem' }}>
              <strong>Suggested prevention:</strong> {group.prevention}
            </p>
            <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
              {group.caseIds.map((caseId) => (
                <Link
                  key={caseId}
                  href={`/cases/${caseId}`}
                  className="btn btn--ghost btn--sm"
                >
                  {caseId}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <p className="small muted">
        <Link href="/">← Back to case queue</Link>
      </p>
    </main>
  );
}
export const dynamic = 'force-dynamic';

