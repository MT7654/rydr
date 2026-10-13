import Link from 'next/link';
import { DraftForm } from './DraftForm';
import { EvidenceAcceptanceButton } from '@/components/EvidenceAcceptanceButton';
import { displayText } from '@/domain/displayText';
import { DEMO_REVIEWER_NAME, type ReviewTask, type StructuredEvidenceResponse } from '@/domain/contracts';
import { formatSgd } from '@/domain/money';
import {
  LANE_DESCRIPTIONS,
  LANE_LABELS,
  classifyEscalation,
  deadlineLabel,
  isOverdue,
  type QueueLane,
} from '@/domain/routing';
import type { CasePacket } from '@/lib/casePacket';
import { DEFAULT_CONFIG } from '@/agents/orchestrator';
import { CiteList } from '@/components/Cite';
import { JudgeReasoning, parseReasoningSummary } from '@/components/JudgeReasoning';
import { PrecedentPanel } from '@/components/PrecedentPanel';
import { IntegrityPanel } from '@/components/IntegrityPanel';
import {
  acceptEvidenceResponse,
  assignTask,
  closeUnresolved,
  decideTask,
  requestEvidence,
  rerunTaskReview,
  retrySettlement,
} from '@/app/reviews/actions';

/** One line describing a structured offer, so the reviewer sees the actual value. */
function describeStructuredResponse(response: StructuredEvidenceResponse): string {
  if (response.kind === 'gps_accuracy') {
    return `GPS accuracy radius corrected to ${response.accuracyMeters} m for ${response.sampleIds.join(', ')}.`;
  }
  return `Fare ledger with ${response.components.length} component(s): ${response.components
    .map((component) => `${component.component} ${formatSgd(component.amountCents)}`)
    .join(', ')}.`;
}

const MISSING_EVIDENCE_OPTIONS = [
  { value: 'gps_accuracy', label: 'GPS accuracy radius for the recorded samples' },
  { value: 'fare_ledger', label: 'Reconciled fare ledger for this trip' },
  { value: 'detour_approval', label: 'Detour approval or road-closure record' },
  { value: 'contact_log', label: 'Full rider contact log with delivery status' },
  { value: 'policy_clarification', label: 'Which clock governs the waiting period' },
];

/**
 * The reviewer's decision surface for one selected task.
 *
 * Reuses the existing authoritative server actions (evidence acceptance,
 * decision, appeal resolution, re-run, settlement recovery). Nothing here
 * mutates on view; every mutation is an explicit submit against the task
 * revision.
 */
export function ReviewTaskWorkbench({
  task,
  packet,
  caseVersions,
  currentCaseVersion,
  selected,
  historical = false,
}: {
  task: ReviewTask;
  packet: CasePacket;
  caseVersions: { version: number; evidence: unknown[]; changeLog: string[] }[];
  currentCaseVersion: number;
  /** True when this task is the one the workspace selected. */
  selected: boolean;
  historical?: boolean;
}) {
  const { caseRecord, run, evaluation, effectiveDecision, settlements, evidenceRequests: allRequests } = packet;
  const evidenceRequests=allRequests.filter(request=>request.taskId===task.id);
  if(historical)return <section className="card"><h2>Recorded review</h2><p>{task.reasonSummary}</p><p>This assessment is read-only. Return to the current case to make changes.</p></section>;
  const hasNewerCaseVersion = currentCaseVersion > task.caseVersion;
  const runCallCap = DEFAULT_CONFIG.maxCallsPerRun;

  const effectiveSettlement = settlements[settlements.length - 1] ?? null;
  const needsSettlementRecovery = Boolean(
    effectiveDecision &&
      effectiveDecision.disposition !== 'insufficient_evidence' &&
      (!effectiveSettlement ||
        effectiveSettlement.status === 'pending' ||
        effectiveSettlement.status === 'failed'),
  );
  const judge = run?.judge ?? null;
  const recommendation = run?.resolution ?? null;
  const recommendedDisposition = recommendation?.disposition ?? null;

  const reviewComplete = historical || ['decided', 'closed_unresolved'].includes(task.status);
  const routing = task.routing;
  const lane: QueueLane = routing?.lane ?? 'standard';
  const routeLimit = packet.pack.source === 'hackathon_reference' ? packet.pack.thresholds.referenceRules?.routeAutoMaxMeters : undefined;
  const policyRequiredReview = task.kind === 'automatic_escalation' && routeLimit !== undefined && (evaluation.route?.comparison.excessMeters ?? 0) > routeLimit;
  const escalation = classifyEscalation([...task.reasonCodes, ...(policyRequiredReview ? ['policy_required_review'] : [])]);
  const now = Date.now();
  const overdue = routing ? isOverdue(routing.dueAt, now) : false;
  const isAppeal = task.kind === 'appeal';

  return (
    <div className="review-workbench" data-selected={selected ? 'true' : undefined}>
      <div className="card" id="task-summary">
        <div className="card__title">
          <h2>{isAppeal ? 'Appeal review' : 'Human review'} · {caseRecord.id}</h2>
          <div className="row">
            <span className={`badge badge--${task.status === 'closed_unresolved' ? 'neutral' : 'review'}`}>
              {task.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}
            </span>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {caseRecord.category === 'damage' ? 'Damage charge' : caseRecord.category === 'fare_dispute' ? 'Fare dispute' : caseRecord.category === 'no_show_charge' ? 'No-show charge' : 'Route charge'} · disputed {formatSgd(caseRecord.disputedCents)} ·
          case v{task.caseVersion} · owner {task.assigneeId ? DEMO_REVIEWER_NAME : 'unassigned'} ·
          {reviewComplete ? ' review complete' : ' reviewer workspace'}
        </p>
        <p style={{ margin: '0.6rem 0 0' }}>
          <strong>{reviewComplete ? 'Original reason for human review:' : 'Why this is with a reviewer:'}</strong>{' '}
          {policyRequiredReview ? `Section 6.2 requires a human decision because this deviation exceeds ${routeLimit} m. The recorded evidence includes calculated refund eligibility; a reviewer must decide before an award is posted.` : displayText(task.reasonSummary)}
        </p>

        {reviewComplete ? (
          <p className="review-complete-summary">
            <strong>Review complete.</strong> The decision and explanation are recorded.{' '}
            <Link href={`/cases/${caseRecord.id}/outcome`}>View outcome and receipt →</Link>
          </p>
        ) : (
          <>
            <div className="routing-summary">
              <span
                className={`badge badge--${
                  lane === 'safety' ? 'danger' : lane === 'integrity' ? 'review' : lane === 'high_value' ? 'accent' : 'neutral'
                }`}
              >
                {LANE_LABELS[lane]} lane
              </span>
              <span className="badge badge--neutral">{escalation.label}</span>
              {routing ? (
                <>
                  <span className="badge badge--neutral">{routing.urgency}</span>
                  <span className={overdue ? 'queue-overdue small' : 'small muted'}>
                    {deadlineLabel(routing.dueAt, now)}
                  </span>
                  <span className="small muted">{routing.serviceTargetLabel}</span>
                </>
              ) : (
                <span className="small muted">This task predates routing, so it has no recorded lane or target.</span>
              )}
              <p className="routing-summary__reason">
                <strong>Next action:</strong> {escalation.nextAction}
              </p>
              <p className="small muted routing-summary__priority">
                <strong>Queue priority:</strong> {routing?.reason} {LANE_DESCRIPTIONS[lane]}
              </p>
            </div>
          </>
        )}

        {task.challenge ? (
          <div className="notice" role="status" style={{ marginTop: '0.75rem' }}>
            <strong>Targeted factual challenge.</strong> The party contests{' '}
            <span className="mono">{task.challenge.findingId}</span>: {task.challenge.findingText} Their
            proposed correction: “{task.challenge.proposedCorrection}”. It stays a claim until it is
            verified against a source, and the case is only re-reviewed against a new version.
          </div>
        ) : null}

        {packet.renderedFromSnapshot ? (
          <p className="small muted" style={{ margin: '0.5rem 0 0' }}>
            Evidence and findings show the recorded assessment at case v{caseRecord.version}
            {packet.supersededByNewerCase
              ? ` — the case is now at v${packet.currentCaseVersion}, so this review is against the older version.`
              : '.'}
            {packet.policyChangedSinceRun
              ? ' The policy pack on disk no longer matches the pack this run was judged against.'
              : ''}
          </p>
        ) : null}
      </div>

      <details className="audit-disclosure">
        <summary>Task audit reference</summary>
        <p className="mono small">
          {task.id} · revision {task.revision} · run {run?.id ?? 'none'}
        </p>
      </details>

      {judge ? (
        <section className="card" id="review-judge">
          <div className="card__title">
            <h2>Judge synthesis</h2>
            <span className="badge badge--neutral">{judge.disposition.replace(/_/g, ' ')}</span>
          </div>
          <JudgeReasoning {...parseReasoningSummary(judge.reasoningSummary, judge.missingEvidence)} />
          <p className="small muted" style={{ marginTop: '0.75rem' }}>
            Cited policy: <CiteList kind="policy" ids={judge.policyIds} /> · evidence{' '}
            {judge.materialEvidenceIds.length} item(s)
          </p>
        </section>
      ) : null}

      <details className="card">
        <summary>Similar cases &amp; consistency check</summary>
        <PrecedentPanel manifest={packet.runPrecedents} variant="card" />
      </details>

      <details className="card">
        <summary>Evidence integrity assessment</summary>
        <IntegrityPanel assessment={packet.integrityAssessment} variant="card" />
      </details>

      {/* Evidence requests and responses */}
      <section className="card" id="review-requests">
        <div className="card__title">
          <h2>Evidence requests</h2>
        </div>
        {evidenceRequests.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No evidence has been requested yet.
          </p>
        ) : (
          <ul className="review-requests">
            {evidenceRequests.map((request) => (
              <li key={request.id}>
                <span className={`badge badge--${request.status === 'open' ? 'review' : 'neutral'}`}>
                  {request.status}
                </span>
                <div>
                  <p style={{ margin: 0 }}>{request.question}</p>
                  <p className="small muted" style={{ margin: 0 }}>
                    To {request.recipient} · {request.evidenceType} · {request.whyItMatters}
                  </p>
                  {request.responseNote ? (
                    <p className="small" style={{ margin: '0.35rem 0 0' }}>
                      <strong>Response (party statement):</strong> {request.responseNote}
                    </p>
                  ) : null}
                  {request.structuredResponse ? (
                    <div className="small" style={{ margin: '0.35rem 0 0' }}>
                      <strong>Structured offer:</strong> {describeStructuredResponse(request.structuredResponse)}
                    </div>
                  ) : null}
                  {request.acceptedIntoCaseVersion !== null ? (
                    <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
                      Accepted into case v{request.acceptedIntoCaseVersion} · evidence{' '}
                      {request.responseEvidenceIds.join(', ') || 'none'}
                      {request.responseVerification
                        ? request.responseVerification.status === 'verified'
                          ? ` · verified against ${request.responseVerification.source ?? 'an unnamed source'}`
                          : ' · recorded as an unverified claim'
                        : ''}
                    </p>
                  ) : request.status === 'submitted' ? (
                    <DraftForm
                      action={acceptEvidenceResponse}
                      className="stack"
                      id="response-review"
                      style={{ marginTop: '0.5rem', gap: '0.5rem' }}
                    >
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="revision" value={task.revision} />

                      {request.structuredResponse ? (
                        <>
                          <label className="field">
                            <span className="field__label">How should the supplied value be treated?</span>
                            <select name="verificationStatus" className="input" defaultValue="unverified_claim">
                              <option value="unverified_claim">Record it as an unverified claim</option>
                              <option value="verified">I checked it against a source — let it govern</option>
                            </select>
                          </label>
                          <label className="field">
                            <span className="field__label">
                              Source you checked it against (needed only to verify)
                            </span>
                            <input
                              name="verificationSource"
                              className="input"
                              placeholder="Trip replay export, ops ticket, original device log…"
                            />
                          </label>
                          <p className="small muted" style={{ margin: 0 }}>
                            Accepting is not verifying. Recorded as a claim, the supplied value sits beside
                            the measurement without changing it, and the review can proceed on a reasoned
                            manual ruling. Verified, it replaces the measurement the policy engine reads —
                            so it needs a source.
                          </p>
                        </>
                      ) : (
                        <p className="small muted" style={{ margin: 0 }}>
                          A written statement alone cannot become case evidence. This records the statement
                          only.
                        </p>
                      )}

                      <EvidenceAcceptanceButton
                        structured={Boolean(request.structuredResponse)}
                        current={!hasNewerCaseVersion}
                        open={!reviewComplete}
                      />
                    </DraftForm>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Decision history, settlement recovery and versions */}
      <section className="card" id="review-history">
        <div className="card__title">
          <h2>Decision history</h2>
        </div>
        {packet.decisions.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            No decision has been recorded for this case yet.
          </p>
        ) : (
          <details>
            <summary>View recorded decisions and audit references</summary>
            <ul className="review-history">
              {packet.decisions.map((decision) => (
                <li key={decision.id}>
                  <span className="mono small">{decision.id}</span>
                  <strong>{decision.disposition.replace(/_/g, ' ')}</strong>
                  <span>{decision.targetRefundCents === null ? 'no amount' : formatSgd(decision.targetRefundCents)}</span>
                  <span className="small muted">
                    {decision.source === 'ai' ? 'automated' : `reviewer (${decision.reviewerId})`}
                    {decision.supersedesDecisionId ? ` · supersedes ${decision.supersedesDecisionId}` : ''}
                    {effectiveDecision?.id === decision.id ? ' · in force' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {settlements.length > 0 ? (
          <details className="small muted" style={{ marginTop: '0.75rem' }}>
            <summary>Settlement audit</summary>
            {settlements.map((settlement) => (
              <p key={settlement.id} style={{ margin: '0.2rem 0' }}>
                <span className="mono">{settlement.id}</span> · {settlement.status} · refund{' '}
                {formatSgd(settlement.deltaRefundCents)} · retained {formatSgd(settlement.retainedCents)}{' '}
                (simulation)
              </p>
            ))}
          </details>
        ) : null}

        {needsSettlementRecovery ? (
          <div className="notice" role="status" style={{ marginTop: '0.75rem' }}>
            <p className="small" style={{ margin: '0 0 0.4rem' }}>
              {effectiveSettlement
                ? `The settlement for the decision in force is ${effectiveSettlement.status.replace(/_/g, ' ')}.`
                : 'The decision in force has no settlement recorded.'}{' '}
              {effectiveSettlement?.failureReason ??
                'Retrying completes the posting without issuing a second refund.'}
            </p>
            <DraftForm action={retrySettlement}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="revision" value={task.revision} />
              <button type="submit" className="btn btn--primary btn--sm">
                Retry the settlement
              </button>
            </DraftForm>
          </div>
        ) : null}

        <h3>Case versions</h3>
        <p className="small muted" style={{ margin: '0 0 0.6rem' }}>
          Each version is immutable. A run is always judged against one exact version, and an accepted
          evidence response creates a new one rather than editing the old.
        </p>
        <ul className="review-history">
          {caseVersions.map((version) => {
            const isCurrent = version.version === currentCaseVersion;
            return (
              <li key={version.version}>
                <span className="mono small">v{version.version}</span>
                <strong>{version.evidence.length} evidence item(s)</strong>
                <span className="small muted">{isCurrent ? 'current' : 'retained for history'}</span>
                <span className="small muted">
                  {version.changeLog[version.changeLog.length - 1] ?? 'Seed version.'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {!reviewComplete ? (
        <>
          <section className="card" id="review-next">
            <div className="card__title">
              <h2>Recommended next action</h2>
            </div>
            <p className="small" style={{ margin: 0 }}>
              {isAppeal
                ? 'Review the party’s appeal and the existing decision. Accept the appeal with a revised outcome, or reject it and keep the decision. Request evidence if needed.'
                : recommendation && recommendation.disposition !== 'human_review'
                  ? `The automated review recommends ${recommendation.disposition.replace(/_/g, ' ')} at ${
                      recommendation.recommendedRefundCents === null
                        ? 'no amount'
                        : formatSgd(recommendation.recommendedRefundCents)
                    }. Confirm it, change it with a reason, or request the missing evidence below.`
                  : 'The automated review reached no recommendation and handed this case to you. Decide it, request the missing evidence, or close it as unresolved.'}
            </p>
            {task.openQuestions.length > 0 ? (
              <>
                <p className="reasoning__heading" style={{ marginTop: '0.75rem' }}>
                  Suggested missing evidence
                </p>
                <ul className="reasoning__list">
                  {task.openQuestions.slice(0, 4).map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <details className="card">
            <summary>Re-run the review</summary>
            <p className="small" style={{ margin: 0 }}>
              {hasNewerCaseVersion
                ? `The case is now at v${currentCaseVersion}. This task is still pinned to the run against v${task.caseVersion}.`
                : `The case is at v${task.caseVersion}, the same version this run evaluated.`}
            </p>
            <p className="small muted" style={{ margin: '0.5rem 0 0.6rem' }}>
              A re-run is never automatic: it invokes the three roles again and spends up to {runCallCap}{' '}
              provider calls from the same session budget. Fixture mode makes no external call.
            </p>
            <DraftForm action={rerunTaskReview} className="stack" style={{ gap: '0.5rem' }}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="revision" value={task.revision} />
              <label className="field">
                <span className="field__label">Mode</span>
                <select name="mode" className="input" defaultValue="fixture">
                  <option value="fixture">Sample assessment (no external call)</option>
                  <option value="live">Live provider (uses the call budget)</option>
                </select>
              </label>
              <button type="submit" className="btn btn--primary btn--sm">
                Re-run review against the current case
              </button>
            </DraftForm>
          </details>

          <section className="card">
            <div className="card__title">
              <h2>Take ownership</h2>
            </div>
            <DraftForm action={assignTask}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="revision" value={task.revision} />
              <button type="submit" className="btn btn--primary btn--sm">
                {task.assigneeId ? 'Reassign to me' : 'Assign to me'}
              </button>
            </DraftForm>
          </section>

          <details className="card" id="request-form">
            <summary>Request evidence</summary>
            <DraftForm draftId={task.id+':request'} action={requestEvidence} className="stack" style={{ gap: '0.5rem' }}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="revision" value={task.revision} />
              <label className="field">
                <span className="field__label">What is missing</span>
                <select name="evidenceType" className="input" defaultValue="gps_accuracy">
                  {MISSING_EVIDENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Who must answer</span>
                <select name="recipient" className="input" defaultValue="platform">
                  <option value="platform">Platform records</option>
                  <option value="rider">Rider</option>
                  <option value="driver">Driver</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Question</span>
                <textarea name="question" className="input" rows={2} required />
              </label>
              <label className="field">
                <span className="field__label">Why it matters</span>
                <textarea name="whyItMatters" className="input" rows={2} required />
              </label>
              <button type="submit" className="btn btn--ghost btn--sm">
                Send request
              </button>
            </DraftForm>
          </details>

          <section className="card" id="decision-form">
            <div className="card__title">
              <h2>{isAppeal ? 'Resolve the appeal' : 'Record a decision'}</h2>
            </div>
            <DraftForm draftId={task.id+':decision'} action={decideTask} className="stack" style={{ gap: '0.5rem' }}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="revision" value={task.revision} />
              <input type="hidden" name="recommendedDisposition" value={recommendedDisposition ?? ''} />
              <label className="field">
                <span className="field__label">
                  {isAppeal ? 'Outcome if the appeal is accepted' : 'Outcome'}
                </span>
                <select
                  name="disposition"
                  className="input"
                  required
                  defaultValue={recommendedDisposition === 'human_review' ? '' : recommendedDisposition ?? ''}
                >
                  <option value="" disabled>
                    Select an outcome
                  </option>
                  <option value="refund">Refund the disputed charge</option>
                  <option value="partial_refund">Partial refund</option>
                  <option value="uphold">Uphold the charge</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Refund amount (SGD)</span>
                <input
                  type="text"
                  name="targetRefund"
                  defaultValue={
                    recommendation?.recommendedRefundCents == null
                      ? ''
                      : (recommendation.recommendedRefundCents / 100).toFixed(2)
                  }
                  className="input"
                  placeholder="e.g. 5.00"
                  inputMode="decimal"
                />
              </label>
              <label className="field">
                <span className="field__label">Reason (required)</span>
                <textarea name="reason" className="input" rows={3} required />
              </label>
              {!isAppeal && recommendedDisposition && recommendedDisposition !== 'human_review' ? (
                <label className="field">
                  <span className="field__label">Difference from the automated recommendation</span>
                  <textarea
                    name="differenceFromRecommendation"
                    className="input"
                    rows={2}
                    placeholder="Required only if you depart from the recommendation."
                  />
                </label>
              ) : null}
              {isAppeal ? (
                <>
                  <p className="small">
                    <strong>Accept appeal</strong> records the revised outcome and supersedes the original
                    decision. <strong>Reject appeal</strong> upholds the original decision. Your written
                    reason is shared in the outcome.
                  </p>
                  <div className="row">
                    <button disabled={hasNewerCaseVersion} type="submit" name="appealOutcome" value="accept" className="btn btn--primary">
                      Accept appeal and record outcome
                    </button>
                    <button
                      type="submit"
                      name="appealOutcome"
                      value="reject" disabled={hasNewerCaseVersion}
                      formNoValidate
                      className="btn"
                    >
                      Uphold original decision
                    </button>
                  </div>
                </>
              ) : (
                <button disabled={hasNewerCaseVersion} type="submit" className="btn btn--primary btn--sm">
                  Record decision and settle
                </button>
              )}
            </DraftForm>
          </section>

          {!isAppeal ? (
            <details className="card">
              <summary>Close without a ruling</summary>
              <p className="small muted" style={{ marginTop: 0 }}>
                Use this when the evidence genuinely cannot settle the case. It records no liability
                finding and posts no settlement.
              </p>
              <DraftForm action={closeUnresolved} className="stack" style={{ gap: '0.5rem' }}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="revision" value={task.revision} />
                <label className="field">
                  <span className="field__label">Why the evidence cannot settle this (required)</span>
                  <textarea
                    name="reason"
                    className="input"
                    rows={2}
                    placeholder="Why the evidence cannot settle this"
                    required
                  />
                </label>
                <button type="submit" className="btn btn--ghost btn--sm">
                  Close as unresolved
                </button>
              </DraftForm>
            </details>
          ) : null}
        </>
      ) : (
        <section className="card">
          <div className="card__title">
            <h2>Task closed</h2>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            This task is {task.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}. The
            decision and settlement are shown in the history above.
          </p>
        </section>
      )}

      <p className="small muted">
        Findings for this task are shown in the assessment above.{' '}
        <span className="mono small">{evaluation.findings.length} findings</span>
      </p>
    </div>
  );
}


