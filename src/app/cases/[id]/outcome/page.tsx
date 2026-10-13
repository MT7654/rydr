import { EvidenceResponseFields } from '@/components/EvidenceResponseFields';
import { RideScene } from '@/components/RideScene';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getDemoRole } from '@/lib/demoSession';
import type { DemoRole } from '@/domain/demoAccess';
import { CaseProgress } from '@/components/CaseProgress';
import { ReadableText } from '@/components/ReadableText';
import { PolicyBasis } from '@/components/PolicyBasis';
import { formatSgd } from '@/domain/money';
import { CASE_STATUS_LABELS, caseStatusTone } from '@/domain/caseStatus';
import { loadCasePacket } from '@/lib/casePacket';
import { JudgeReasoning, parseReasoningSummary } from '@/components/JudgeReasoning';
import { CitationDrawer } from '@/components/CitationDrawer';
import { CiteList } from '@/components/Cite';
import { respondToEvidenceRequest, submitAppeal } from '../actions';
import { isOpenTask } from '@/repositories/reviewTasks';

const DISPOSITION_LABELS: Record<string, string> = {
  refund: 'Refund',
  uphold: 'Charge upheld',
  partial_refund: 'Partial refund',
  insufficient_evidence: 'Closed — unresolved',
};

/**
 * Where a non-reviewer visitor belongs.
 *
 * Returns a target instead of redirecting, so the caller's `role` is not
 * narrowed by the guard and the reviewer-only code below keeps its original
 * (party-aware) shape.
 */
function partyWorkspaceTarget(
  role: DemoRole,
  caseId: string,
  notice?: string,
  error?: string,
): string | null {
  if (role === 'reviewer') return null;
  const query = new URLSearchParams({ case: caseId, section: 'outcome' });
  if (notice) query.set('notice', notice);
  if (error) query.set('error', error);
  return `/rides?${query.toString()}`;
}

export default async function OutcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ as?: string; notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const role = await getDemoRole();
  if (!role) redirect('/');

  // Parties resolve to the outcome section of their own workspace, so there is
  // one implementation of the response/outcome/appeal loop. Reviewers keep this
  // shared-decision preview.
  const partyTarget = partyWorkspaceTarget(role, id, notice, error);
  if (partyTarget) redirect(partyTarget);

  const isReviewer = role === 'reviewer';

  const packet = await loadCasePacket(id);
  if (!packet) notFound();

  const {
    caseRecord,
    evaluation,
    status,
    effectiveDecision,
    settlements,
    allSettlements,
    decisions,
    evidenceRequests,
    tasks,
    hasOpenAppeal,
    run,
  } = packet;

  const settlement = settlements[settlements.length - 1] ?? null;
  const openRequest = evidenceRequests.find((request) => request.status === 'open' && request.recipient === role) ?? null;
  const isDriver = role === 'driver';
  const openAppeal = tasks.find(task => task.kind === 'appeal' && isOpenTask(task));
  // GPS samples the party may correct, so the form names real catalogue ids
  // instead of asking them to type an identifier.
  const gpsSamples = caseRecord.evidence.filter((item) => item.kind === 'gps');

  /**
   * Money is reported cumulatively, not as this decision's increment.
   *
   * An appeal that confirms the same outcome adds nothing, and "nothing added"
   * is not the same as "the fee stands" — the earlier refund is still in force.
   * So the totals are computed across every posted settlement on the case.
   */
  const isUnresolved = effectiveDecision?.disposition === 'insufficient_evidence';
  const postedSettlements = allSettlements.filter((entry) => entry.status === 'posted');
  const totalRefundedCents = postedSettlements.reduce(
    (total, entry) => total + entry.deltaRefundCents,
    0,
  );
  const thisAdjustmentCents = isUnresolved ? 0 : (settlement?.deltaRefundCents ?? 0);
  const priorRefundedCents = Math.max(0, totalRefundedCents - thisAdjustmentCents);
  const originalChargeCents =
    settlement?.originalChargeCents ??
    postedSettlements[postedSettlements.length - 1]?.originalChargeCents ??
    caseRecord.disputedCents;
  const retainedCents = Math.max(0, originalChargeCents - totalRefundedCents);
  const needsManualAdjustment = settlement?.status === 'manual_adjustment_required';

  return (
    <main className="container stack outcome-page">
      <header className="outcome-header journey-hero">
        <div><Link href={isReviewer ? '/worklist' : '/portal'} className="small">← {isReviewer ? 'Worklist' : 'Your disputes'}</Link>
          <p className="eyebrow">{caseRecord.id} · {isReviewer ? 'Reviewer preview' : `${role} outcome`}</p><h1>Your case outcome</h1></div>
        <div className="outcome-hero-art"><span className={`badge badge--${caseStatusTone(status)}`}>{CASE_STATUS_LABELS[status]}</span><RideScene variant="payments" compact/></div>
      </header>
      <CaseProgress status={status} hasDecision={!!effectiveDecision} hasAppeal={hasOpenAppeal} />
      <PolicyBasis pack={packet.pack} suppliedSample={caseRecord.suppliedPolicyId !== null} />
      {isReviewer && openAppeal ? <section className="card appeal-card"><h2>Review {openAppeal.submittedBy === 'driver' ? 'driver' : 'rider'} appeal</h2><p>{openAppeal.reasonSummary.replace(/against dec_[^:]+:/, 'against the recorded decision:')}</p><p>The current decision remains in force until you resolve this appeal.</p><Link className="btn btn--primary" href={`/reviews/${openAppeal.id}`}>Review appeal</Link></section> : null}


      {notice ? <div className="notice notice--success">{notice}</div> : null}
      {error ? <div className="notice notice--danger">{error}</div> : null}

      {!effectiveDecision ? (
        <section className="card">
          <div className="card__title">
            <h2>No final decision yet</h2>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            This case is currently <strong>{CASE_STATUS_LABELS[status]}</strong>.
            {packet.openTask
              ? ' A reviewer is working on it. You will see the decision here once it is recorded.'
              : ' Your case is waiting for assessment. A decision will appear here when the review is complete.'}
          </p>
        </section>
      ) : (
        <>
          {/* The decision */}
          <section className="card outcome-decision">
            <div className="card__title">
              <h2>
              {isUnresolved
                ? 'Closed — no ruling was made'
                : isDriver
                  ? totalRefundedCents === 0
                    ? 'The disputed fee stands'
                    : 'A refund was recorded against this trip'
                  : DISPOSITION_LABELS[effectiveDecision.disposition] ??
                    effectiveDecision.disposition}
            </h2>
              <span className="badge badge--neutral">
                {effectiveDecision.source === 'ai' ? 'Automated decision' : 'Reviewer decision'}
              </span>
            </div>

            {isUnresolved ? (
              <p className="small muted" style={{ margin: 0 }}>
                This dispute was closed without deciding who was responsible. No refund was made and
                no part of the charge was confirmed as owed — neither party owes the other anything
                as a result of it.
              </p>
            ) : (
              <details className="money-breakdown"><summary>View charge breakdown</summary><div className="outcome-amounts">
                <div className="outcome-amounts__row">
                  <span>Original disputed charge</span>
                  <span>{formatSgd(originalChargeCents)}</span>
                </div>
                {priorRefundedCents > 0 ? (
                  <div className="outcome-amounts__row">
                    <span>Already refunded before this decision</span>
                    <span>{formatSgd(priorRefundedCents)}</span>
                  </div>
                ) : null}
                <div className="outcome-amounts__row">
                  <span>
                    {priorRefundedCents > 0
                      ? 'Adjustment from this decision'
                      : 'Refund recorded in test ledger'}
                  </span>
                  <span>{formatSgd(thisAdjustmentCents)}</span>
                </div>
                <div className="outcome-amounts__row">
                  <span>Total refunded</span>
                  <span>{formatSgd(totalRefundedCents)}</span>
                </div>
                <div className="outcome-amounts__row">
                  <span>{isDriver ? 'Fee retained' : 'Amount retained'}</span>
                  <span>{formatSgd(retainedCents)}</span>
                </div>
              </div></details>
            )}

            {!isUnresolved ? <p className="outcome-highlight"><span>{isDriver ? 'Total returned to the rider' : isReviewer ? 'Total rider refund' : 'Your total refund'}</span><strong>{formatSgd(totalRefundedCents)}</strong><span className="small">{formatSgd(retainedCents)} of the original charge remains · simulated payment</span></p> : null}

            {!isUnresolved && thisAdjustmentCents === 0 && priorRefundedCents > 0 ? (
              <p className="small" style={{ marginTop: '0.75rem' }}>
                This decision adds nothing further. The {formatSgd(priorRefundedCents)} already
                refunded remains in force.
              </p>
            ) : null}

            {needsManualAdjustment ? (
              <p className="small" style={{ marginTop: '0.75rem', color: 'var(--amber)' }}>
                <strong>This settlement needs manual adjustment.</strong>{' '}
                {settlement?.failureReason ??
                  'The decision asks for less than has already been refunded, and this prototype never claws money back automatically.'}
              </p>
            ) : null}

            <p className="small muted" style={{ marginTop: '0.75rem' }}>
              This is a simulated ledger. No funds moved through Ryde or any payment provider, and no
              notification was sent.

            </p>
          </section>

          {/* Why */}
          <section className="card">
            <div className="card__title">
              <h2>Why this decision</h2>
            </div>
            <JudgeReasoning {...parseReasoningSummary(effectiveDecision.explanation, [])} />
            {!isReviewer ? <details className="supporting-disclosure"><summary>Evidence and rules used</summary>
              <h3>Evidence considered</h3>
              <ul className="reasoning__list">{evaluation.findings.filter(finding => finding.material && finding.kind !== 'claim' && finding.evidenceIds.some(evidenceId => effectiveDecision.evidenceIds.includes(evidenceId))).map(finding => <li key={finding.id}>{finding.text}</li>)}</ul>
              {packet.pack.clauses.filter(clause => effectiveDecision.policyIds.includes(clause.id)).map(clause => <div className="party-policy" key={clause.id}><h3>{clause.title}</h3><ReadableText text={clause.text}/></div>)}
            </details> : null}
            {effectiveDecision.differenceFromRecommendation ? (
              <p className="small" style={{ marginTop: '0.75rem' }}>
                <strong>Reviewer departure from the automated recommendation:</strong>{' '}
                {effectiveDecision.differenceFromRecommendation}
              </p>
            ) : null}
            {isReviewer ? <details className="audit-disclosure"><summary>Decision audit details</summary><p className="small muted" style={{ marginTop: '0.75rem' }}>
              Policy: <CiteList kind="policy" ids={effectiveDecision.policyIds} /> (v
              {effectiveDecision.policyVersion}) · evidence cited{' '}
              <CiteList kind="evidence" ids={effectiveDecision.evidenceIds} /> · recorded{' '}
              {effectiveDecision.createdAt.replace('T', ' ').slice(0, 16)} UTC
              {effectiveDecision.reviewerId ? ` · reviewer ${effectiveDecision.reviewerId}` : ''}
            </p>
            {run ? (
              <p className="small muted" style={{ margin: 0 }}>
                Based on run <span className="mono">{run.id}</span> · case v{effectiveDecision.caseVersion}
              </p>
            ) : null}</details> : null}
          </section>
        </>
      )}

      {/* Open evidence request the party can answer */}
      {openRequest ? (
        <section className="card">
          <div className="card__title">
            <h2>A reviewer needs something from you</h2>
            <span className="badge badge--review">Open request</span>
          </div>
          <p style={{ margin: 0 }}>{openRequest.question}</p>
          <p className="small muted">
            Requested from: {openRequest.recipient} · {openRequest.whyItMatters}
          </p>
          <form action={respondToEvidenceRequest} className="stack" style={{ gap: '0.5rem' }}>
            <input type="hidden" name="caseId" value={caseRecord.id} />
            <input type="hidden" name="taskId" value={openRequest.taskId} />
            <input type="hidden" name="requestId" value={openRequest.id} />
            <input type="hidden" name="as" value={role} />
            <label className="field">
              <span className="field__label">Your response</span>
              <textarea
                name="response"
                className="input"
                rows={3}
                placeholder="Describe what you can provide and where it comes from. Text alone is recorded as a statement, not as verified data."
                required
              />
            </label>
            <EvidenceResponseFields samples={gpsSamples}/>

            <button type="submit" className="btn btn--primary btn--sm">
              Submit response
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              Statements stay in the review record. Structured values can be added to a new case version;
              a reviewer must verify their source before they govern the assessment.
            </p>
          </form>
        </section>
      ) : null}


      <section className="card journey-entry"><h2>Something in the record seems wrong?</h2><p>Identify the disputed fact, request the relevant source record and track a reassessment.</p><Link className="btn btn--secondary" href={`/cases/${id}/repair`}>Check evidence and next steps</Link>{caseRecord.category === 'damage' ? <Link className="btn btn--ghost" href="/payments">Reimbursement & recovery →</Link> : null}</section>
      {isReviewer ? <div className="notice"><strong>Reviewer preview.</strong> This is the shared decision. Party actions appear only after choosing a rider or driver role. <Link href={`/cases/${id}`}>Open assessment</Link></div> : null}

      {/* Appeal */}
      {effectiveDecision && !isReviewer ? (
        <section className="card appeal-card">
          <div className="card__title">
            <h2>Appeal this decision</h2>
            {hasOpenAppeal ? <span className="badge badge--review">Appeal pending</span> : null}
          </div>
          {hasOpenAppeal ? (
            <p className="small muted" style={{ margin: 0 }}>
              An appeal is already open for this decision. The original decision stands until a
              reviewer confirms or supersedes it.
            </p>
          ) : (
            <details className="appeal-disclosure"><summary>Disagree with the decision? Start an appeal</summary>
              <p className="small muted" style={{ marginTop: 0 }}>
                An appeal does not reverse the decision or the settlement on its own. It asks a
                reviewer to confirm or supersede it.
              </p>
              <form action={submitAppeal} className="stack" style={{ gap: '0.5rem' }}>
                <input type="hidden" name="caseId" value={caseRecord.id} />
                <input type="hidden" name="as" value={role} />
                <label className="field">
                  <span className="field__label">Reason for the appeal</span>
                  <textarea name="reason" className="input" rows={3} required />
                </label>

                <details><summary>Challenge a specific fact or add evidence (optional)</summary>
                {/* Targeted factual challenge */}
                {evaluation.findings.filter((f) => f.material && f.kind !== 'claim').length > 0 ? (
                  <fieldset className="field" style={{ border: '1px solid var(--line)', padding: '0.6rem' }}>
                    <legend className="field__label">Challenge a specific finding (optional)</legend>
                    <label className="field" style={{ marginTop: 0 }}>
                      <span className="field__label">Which finding do you contest?</span>
                      <select name="findingId" className="input">
                        <option value="">— Generic appeal, no specific finding —</option>
                        {evaluation.findings
                          .filter((f) => f.material && f.kind !== 'claim')
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.text.slice(0, 110)}{f.text.length > 110 ? '…' : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field__label">What do you believe is the correct fact?</span>
                      <textarea
                        name="proposedCorrection"
                        className="input"
                        rows={2}
                        placeholder="Describe the correction you are proposing."
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">What source could verify this? (optional)</span>
                      <input
                        type="text"
                        name="contestedSource"
                        className="input"
                        placeholder="e.g. telco delivery receipt, platform trip log"
                      />
                    </label>
                  </fieldset>
                ) : null}

                <label className="field">
                  <span className="field__label">New evidence you can offer (optional)</span>
                  <textarea name="newEvidence" className="input" rows={2} />
                </label>
                </details>
                <button type="submit" className="btn btn--primary btn--sm">
                  Submit appeal
                </button>
              </form>
            </details>
          )}
        </section>
      ) : null}

      <details className="card history-disclosure"><summary>Case history · {decisions.length} {decisions.length === 1 ? 'decision' : 'decisions'}</summary>
        <ol className="friendly-history">{decisions.map((decision,index) => <li key={decision.id}>
          <span className="history-dot" aria-hidden="true"/><div><strong>{DISPOSITION_LABELS[decision.disposition] ?? decision.disposition}</strong>
          <p className="small muted">Decision {index+1} · {new Date(decision.createdAt).toLocaleDateString('en-SG',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Singapore'})} · {effectiveDecision?.id === decision.id ? 'Current decision' : 'Earlier decision'}</p></div>
          <span>{decision.targetRefundCents == null ? 'No amount decided' : formatSgd(decision.targetRefundCents)}</span>
        </li>)}{tasks.filter(task => task.kind === 'appeal' && (isReviewer || task.submittedBy === role || (!task.submittedBy && task.reasonSummary.startsWith(role === 'driver' ? 'Driver appeal' : 'Rider appeal')))).map(task => <li key={task.id}><span className="history-dot" aria-hidden="true"/><div><strong>{isReviewer ? 'Party appeal' : 'Your appeal'}</strong><p className="small muted">{task.status.replace(/_/g,' ')} · {new Date(task.createdAt).toLocaleDateString('en-SG',{timeZone:'Asia/Singapore'})}</p></div></li>)}</ol>
      </details>

      <p className="small muted">
        <Link href={isReviewer ? '/worklist' : '/portal'}>← {isReviewer ? 'Worklist' : 'Your disputes'}</Link>
      </p>

      <CitationDrawer caseId={caseRecord.id} runId={isReviewer ? run?.id ?? null : null} />
    </main>
  );
}

