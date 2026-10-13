import Link from 'next/link';
import { workspaceHref } from '@/domain/workspaceRoute';
import { DraftForm } from './DraftForm';
import type { CaseDecision, CaseRecord, Settlement } from '@/domain/contracts';
import type { DemoRole } from '@/domain/demoAccess';
import type { DeterministicEvaluation } from '@/domain/policy';
import { formatSgd } from '@/domain/money';
import { JudgeReasoning, parseReasoningSummary } from '@/components/JudgeReasoning';
import { ReadableText } from '@/components/ReadableText';
import { CiteList } from '@/components/Cite';
import { submitAppeal } from '@/app/cases/[id]/actions';

const DISPOSITION_LABELS: Record<string, string> = {
  refund: 'Refund',
  uphold: 'Charge upheld',
  partial_refund: 'Partial refund',
  insufficient_evidence: 'Closed — unresolved',
};

/**
 * The party's outcome: effective decision, reason and financial effect.
 *
 * A decision to refund is not proof a payment posted. Posted, pending, failed
 * and manual-adjustment states are shown distinctly, and the appeal form is
 * inline. The current decision remains effective while an appeal is open.
 */
export function PartyOutcome({
  caseRecord,
  role,
  evaluation,
  effectiveDecision,
  settlements,
  allSettlements,
  hasOpenAppeal,
  hasOpenAppealByMe,
  readOnly=false,
}: {
  caseRecord: CaseRecord;
  role: DemoRole;
  evaluation: DeterministicEvaluation;
  effectiveDecision: CaseDecision | null;
  settlements: Settlement[];
  allSettlements: Settlement[];
  hasOpenAppeal: boolean;
  hasOpenAppealByMe: boolean;
  readOnly?:boolean;
}) {
  const settlement = settlements[settlements.length - 1] ?? null;
  const isUnresolved = effectiveDecision?.disposition === 'insufficient_evidence';
  const postedSettlements = allSettlements.filter((entry) => entry.status === 'posted');
  const totalRefundedCents = postedSettlements.reduce((total, entry) => total + entry.deltaRefundCents, 0);
  const thisAdjustmentCents = isUnresolved ? 0 : settlement?.deltaRefundCents ?? 0;
  const priorRefundedCents = Math.max(0, totalRefundedCents - thisAdjustmentCents);
  const originalChargeCents =
    settlement?.originalChargeCents ??
    postedSettlements[postedSettlements.length - 1]?.originalChargeCents ??
    caseRecord.disputedCents;
  const retainedCents = Math.max(0, originalChargeCents - totalRefundedCents);
  const needsManualAdjustment = settlement?.status === 'manual_adjustment_required';
  const isDriver = role === 'driver';

  return (
    <section className="card workspace-outcome" id="outcome" aria-labelledby="outcome-heading">
      <div className="card__title">
        <h2 id="outcome-heading">
          {!effectiveDecision
            ? 'No final decision yet'
            : isUnresolved
              ? 'Closed — no ruling was made'
              : DISPOSITION_LABELS[effectiveDecision.disposition] ?? effectiveDecision.disposition}
        </h2>
        {effectiveDecision ? (
          <span className="badge badge--neutral">
            {effectiveDecision.source === 'ai' ? 'Automated decision' : 'Reviewer decision'}
          </span>
        ) : null}
      </div>

      {!effectiveDecision ? (
        <p className="small muted" style={{ margin: 0 }}>
          Your case is still being reviewed. The decision will appear here, with the reason and the
          financial effect, as soon as a reviewer records it.
        </p>
      ) : (
        <>
          {isUnresolved ? (
            <p className="small muted" style={{ margin: 0 }}>
              This dispute was closed without deciding who was responsible. No refund was made and
              no part of the charge was confirmed as owed — neither party owes the other anything as
              a result of it.
            </p>
          ) : (
            <>
              <details className="money-breakdown" open>
                <summary>Charge breakdown</summary>
                <div className="outcome-amounts">
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
                </div>
              </details>

              <p className="outcome-highlight">
                <span>{role==='reviewer'?'Total returned to the rider':isDriver ? 'Total returned to the rider' : 'Your total refund'}</span>
                <strong>{formatSgd(totalRefundedCents)}</strong>
                <span className="small">
                  {formatSgd(retainedCents)} of the original charge remains · simulated payment
                </span>
              </p>
            </>
          )}

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

          <div className="workspace-outcome__why">
            <h3>Why this decision</h3>
            <JudgeReasoning {...parseReasoningSummary(effectiveDecision.explanation, [])} />
            <details className="supporting-disclosure">
              <summary>Evidence and rules used</summary>
              <h4>Evidence considered</h4>
              <ul className="reasoning__list">
                {evaluation.findings
                  .filter(
                    (finding) =>
                      finding.material &&
                      finding.kind !== 'claim' &&
                      finding.evidenceIds.some((id) => effectiveDecision.evidenceIds.includes(id)),
                  )
                  .map((finding) => (
                    <li key={finding.id}>{finding.text}</li>
                  ))}
              </ul>
              {evaluation.policyIds.length > 0 ? (
                <p className="small muted">
                  Policy applied: <CiteList kind="policy" ids={effectiveDecision.policyIds} />
                </p>
              ) : null}
            </details>
          </div>
        </>
      )}

      {effectiveDecision && role!=='reviewer' && !readOnly ? (
        <div className="workspace-outcome__appeal" id="appeal-form">
          <h3>Appeal this decision</h3>
          {hasOpenAppeal ? (
            <p className="small muted" style={{ margin: 0 }}>
              {hasOpenAppealByMe
                ? 'Your appeal is being reviewed. Your current decision still applies until a reviewer confirms or changes it.'
                : 'An appeal is already open on this case. The current decision still applies while it is reviewed.'}
            </p>
          ) : (
            <details className="appeal-disclosure">
              <summary>Disagree with the decision? Start an appeal</summary>
              <p className="small muted" style={{ marginTop: 0 }}>
                An appeal does not reverse the decision or the settlement on its own. It asks a
                reviewer to confirm or supersede it. You will need a reason.
              </p>
              <DraftForm draftId={caseRecord.id+':'+role+':appeal'} action={submitAppeal} className="stack" style={{ gap: '0.5rem' }}>
                <input type="hidden" name="caseId" value={caseRecord.id} />
                <input type="hidden" name="as" value={role} />
                <label className="field">
                  <span className="field__label">Reason for the appeal</span>
                  <textarea name="reason" className="input" rows={3} required />
                </label>
                <details>
                  <summary>Challenge a specific fact or add evidence (optional)</summary>
                  {evaluation.findings.filter((finding) => finding.material && finding.kind !== 'claim').length > 0 ? (
                    <fieldset className="field" style={{ border: '1px solid var(--line)', padding: '0.6rem' }}>
                      <legend className="field__label">Challenge a specific finding (optional)</legend>
                      <label className="field" style={{ marginTop: 0 }}>
                        <span className="field__label">Which finding do you contest?</span>
                        <select name="findingId" className="input">
                          <option value="">— Generic appeal, no specific finding —</option>
                          {evaluation.findings
                            .filter((finding) => finding.material && finding.kind !== 'claim')
                            .map((finding) => (
                              <option key={finding.id} value={finding.id}>
                                {finding.text.slice(0, 110)}
                                {finding.text.length > 110 ? '…' : ''}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field__label">What do you believe is the correct fact?</span>
                        <textarea name="proposedCorrection" className="input" rows={2} />
                      </label>
                      <label className="field">
                        <span className="field__label">What source could verify this? (optional)</span>
                        <input type="text" name="contestedSource" className="input" />
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
              </DraftForm>
            </details>
          )}
        </div>
      ) : null}

      {caseRecord.category === 'damage' ? (
        <p className="small">
          <Link className="btn btn--secondary btn--sm" href={workspaceHref(caseRecord.id,role,'outcome',{},'#payments')}>
            Reimbursement &amp; recovery
          </Link>
        </p>
      ) : null}

      <details className="supporting-disclosure">
        <summary>What a refund decision does and does not mean</summary>
        <ReadableText
          text={
            'A refund decision records what should be returned against this charge. It is not evidence that money has moved. In this prototype the ledger is simulated, so a posted entry means the simulated settlement ran — not that a bank or Ryde transfer completed.'
          }
        />
      </details>
    </section>
  );
}

