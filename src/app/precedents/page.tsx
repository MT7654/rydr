import Link from 'next/link';
import { formatSgd } from '@/domain/money';
import { describeOutcome } from '@/domain/precedent';
import {
  loadCuratorWorkbench,
  listPromotableCases,
  type CandidateView,
} from '@/lib/precedentCurator';
import {
  approvePrecedentAction,
  authorExampleAction,
  rejectPrecedentAction,
  rollbackPrecedentAction,
} from './actions';

/**
 * The curator screen.
 *
 * The point of this page is that nothing on it is automatic. A reviewer's
 * correction arrives here as an inert proposal with the shadow-replay verdict
 * already run against it, and a person decides whether the company should learn
 * from it.
 */

export const dynamic = 'force-dynamic';

function OutcomeBadge({ disposition, refundCents }: { disposition: string; refundCents: number }) {
  const tone =
    disposition === 'refund'
      ? 'badge--danger'
      : disposition === 'uphold'
        ? 'badge--success'
        : 'badge--review';
  return <span className={`badge ${tone}`}>{describeOutcome({ disposition: disposition as never, refundCents })}</span>;
}

function GateChecks({ view }: { view: CandidateView }) {
  const { gate } = view;
  return (
    <ul className="precedent-checks">
      {gate.checks.map((check) => (
        <li key={check.id} className="precedent-check">
          <span className={`badge ${check.passed ? 'badge--success' : 'badge--danger'}`}>
            {check.passed ? 'pass' : 'fail'}
          </span>
          <div>
            <p className="precedent-check__label">{check.label}</p>
            <p className="small muted" style={{ margin: 0 }}>
              {check.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PrecedentCard({
  record,
  children,
}: {
  record: CandidateView['record'];
  children?: React.ReactNode;
}) {
  return (
    <li className="precedent-card">
      <div className="precedent-card__head">
        <span className="mono small muted">{record.id}</span>
        <span className="badge badge--neutral">{record.category.replace(/_/g, ' ')}</span>
        <OutcomeBadge disposition={record.disposition} refundCents={record.refundCents} />
        <span className="small muted mono">
          {record.caseId} v{record.caseVersion}
        </span>
        <span className="small muted">source: {record.source.replace(/_/g, ' ')}</span>
      </div>

      {record.priorRecommendation ? (
        <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
          <strong>Automated recommendation it departed from:</strong> {record.priorRecommendation}
        </p>
      ) : null}
      {record.correctionReason ? (
        <p className="small" style={{ margin: '0.35rem 0 0' }}>
          <strong>Reviewer&rsquo;s reason:</strong> {record.correctionReason}
        </p>
      ) : null}

      <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
        <strong>Conditions:</strong> {record.tags.map((tag) => tag.replace(/_/g, ' ')).join(', ')}
      </p>
      <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
        <strong>Cited clauses:</strong> {record.citedPolicyIds.join(', ') || 'none'}
      </p>

      <ul className="precedent-facts">
        {record.materialFacts.map((fact, index) => (
          <li key={index} className="small">
            {fact}
          </li>
        ))}
      </ul>

      {record.activationFailure ? (
        <div className="notice notice--danger" role="status" style={{ marginTop: '0.5rem' }}>
          <strong>Activation refused.</strong> {record.activationFailure}
        </div>
      ) : null}

      {children}
    </li>
  );
}

export default async function PrecedentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const workbench = await loadCuratorWorkbench();
  const { candidates, approved, rejected, retired } = workbench;
  const promotable = await listPromotableCases();

  return (
    <main className="container stack">
      <div className="card">
        <div className="card__title">
          <h1>Precedents and governed learning</h1>
          <div className="row">
            <span className="badge badge--neutral">{candidates.length} candidate(s)</span>
            <span className="badge badge--success">{approved.length} active</span>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0, maxWidth: '76ch' }}>
          A reviewer who departs from the automated recommendation produces a <strong>candidate</strong>,
          not a rule. Candidates are invisible to the Judge. They become retrievable context only after
          the shadow-replay gate passes <em>and</em> a curator approves them here. Policy always
          governs: a precedent is an example, never an amendment.
        </p>
        <p className="small muted" style={{ margin: '0.5rem 0 0', maxWidth: '76ch' }}>
          The gate replays each candidate against a held-out set of cases whose outcomes a human
          reviewed before the engine ever saw them. A candidate that would argue against a correct
          ruling on a materially comparable case is refused — that is the failure mode that matters,
          because a precedent only ever supplies context and cannot change a deterministic outcome.
        </p>
      </div>

      {notice ? <div className="notice notice--success">{notice}</div> : null}
      {error ? <div className="notice notice--danger">{error}</div> : null}

      <section className="card">
        <div className="card__title">
          <h2>Awaiting curation</h2>
          <span className="small muted">{candidates.length} proposal(s)</span>
        </div>
        {candidates.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No candidate is waiting. A candidate appears here when a reviewer records a decision that
            departs from a concrete automated recommendation.
          </p>
        ) : (
          <ul className="precedent-list">
            {candidates.map((view) => (
              <PrecedentCard key={view.record.id} record={view.record}>
                <div className="precedent-gate">
                  <p className="precedent-gate__verdict">
                    <span
                      className={`badge ${view.gate.passed ? 'badge--success' : 'badge--danger'}`}
                    >
                      {view.gate.passed ? 'Gate would pass' : 'Gate would refuse'}
                    </span>
                    <span className="small muted">
                      shadow-replay verdict, computed now against the held-out set
                    </span>
                  </p>
                  <GateChecks view={view} />
                </div>

                <div className="precedent-actions">
                  <form action={approvePrecedentAction} className="stack" style={{ gap: '0.4rem' }}>
                    <input type="hidden" name="precedentId" value={view.record.id} />
                    <label className="field">
                      <span className="field__label">Why this example is sound (required)</span>
                      <textarea
                        name="note"
                        className="input"
                        rows={2}
                        placeholder="What makes this correction right, and what it does not decide."
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      className="btn btn--primary btn--sm"
                      disabled={!view.gate.passed}
                    >
                      {view.gate.passed ? 'Approve and activate' : 'Activation refused by the gate'}
                    </button>
                  </form>

                  <form action={rejectPrecedentAction} className="stack" style={{ gap: '0.4rem' }}>
                    <input type="hidden" name="precedentId" value={view.record.id} />
                    <label className="field">
                      <span className="field__label">Reject — reason (required)</span>
                      <textarea
                        name="reason"
                        className="input"
                        rows={2}
                        placeholder="Why this correction should not shape future cases."
                        required
                      />
                    </label>
                    <button type="submit" className="btn btn--ghost btn--sm">
                      Reject candidate
                    </button>
                  </form>
                </div>
              </PrecedentCard>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card__title">
          <h2>Promote a resolved case</h2>
          <span className="small muted">{promotable.length} eligible</span>
        </div>
        <p className="small muted" style={{ margin: '0 0 0.6rem', maxWidth: '76ch' }}>
          Seeding the example set from real history is a curator&rsquo;s other tool. The outcome is
          read from the deterministic reading of that exact case version and cannot be edited here, so
          this promotes an example rather than publishing a ruling. Abstentions are not offered:
          there is nothing to promote. A promoted case still has to clear the gate.
        </p>
        {promotable.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No case version is eligible to promote.
          </p>
        ) : (
          <ul className="precedent-list">
            {promotable.map((entry) => (
              <li key={`${entry.caseId}-v${entry.caseVersion}`} className="precedent-card">
                <div className="precedent-card__head">
                  <span className="mono small">{entry.caseId}</span>
                  <span className="badge badge--neutral">v{entry.caseVersion}</span>
                  <span className="badge badge--neutral">
                    {entry.category.replace(/_/g, ' ')}
                  </span>
                  <OutcomeBadge
                    disposition={entry.disposition}
                    refundCents={entry.refundCents ?? 0}
                  />
                  <span className="small muted">
                    disputed {formatSgd(entry.disputedCents)}
                  </span>
                  {entry.existingPrecedentId ? (
                    <span className="badge badge--success">
                      already {entry.existingStatus} ({entry.existingPrecedentId})
                    </span>
                  ) : null}
                </div>
                {entry.existingPrecedentId ? null : (
                  <form
                    action={authorExampleAction}
                    className="stack"
                    style={{ gap: '0.4rem', marginTop: '0.5rem' }}
                  >
                    <input type="hidden" name="caseId" value={entry.caseId} />
                    <input type="hidden" name="caseVersion" value={entry.caseVersion} />
                    <label className="field">
                      <span className="field__label">Why this is a clear example (required)</span>
                      <textarea
                        name="note"
                        className="input"
                        rows={2}
                        placeholder="What makes this case worth showing to a later reviewer."
                        required
                      />
                    </label>
                    <button type="submit" className="btn btn--ghost btn--sm">
                      Promote as an example
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card__title">
          <h2>Active precedents</h2>
          <span className="small muted">{approved.length}</span>
        </div>
        {approved.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No precedent is active. Retrieval therefore returns nothing, and every case is decided from
            policy and evidence alone.
          </p>
        ) : (
          <ul className="precedent-list">
            {approved.map((record) => (
              <PrecedentCard key={record.id} record={record}>
                <p className="small muted" style={{ margin: '0.4rem 0 0' }}>
                  Approved by {record.approvedBy} at {record.approvedAt?.replace('T', ' ').slice(0, 16)}
                  {record.approvalNote ? ` — ${record.approvalNote}` : ''}
                </p>
                <form
                  action={rollbackPrecedentAction}
                  className="stack"
                  style={{ gap: '0.4rem', marginTop: '0.5rem' }}
                >
                  <input type="hidden" name="precedentId" value={record.id} />
                  <label className="field">
                    <span className="field__label">Roll back — reason (required)</span>
                    <textarea
                      name="reason"
                      className="input"
                      rows={2}
                      placeholder="Why this example should stop being shown."
                      required
                    />
                  </label>
                  <button type="submit" className="btn btn--ghost btn--sm">
                    Roll back
                  </button>
                </form>
              </PrecedentCard>
            ))}
          </ul>
        )}
      </section>

      {rejected.length > 0 || retired.length > 0 ? (
        <section className="card">
          <div className="card__title">
            <h2>History</h2>
            <span className="small muted">
              {rejected.length} rejected · {retired.length} retired
            </span>
          </div>
          <p className="small muted" style={{ margin: '0 0 0.6rem' }}>
            Refused and rolled-back proposals are kept, not deleted. A run that already recorded one as
            context must stay explainable.
          </p>
          <ul className="precedent-list">
            {[...rejected, ...retired].map((record) => (
              <PrecedentCard key={record.id} record={record}>
                <p className="small muted" style={{ margin: '0.4rem 0 0' }}>
                  {record.status === 'retired'
                    ? `Retired at ${record.retiredAt?.replace('T', ' ').slice(0, 16)} — ${record.retiredReason ?? 'no reason recorded'}`
                    : `Rejected — ${record.approvalNote ?? 'no reason recorded'}`}
                </p>
              </PrecedentCard>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="small muted">
        <Link href="/review-queue">← Review queue</Link>
      </p>
    </main>
  );
}

