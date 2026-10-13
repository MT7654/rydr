import { EvidenceBrief } from './EvidenceBrief';
import { AgentComparison } from './AgentComparison';
import Link from 'next/link';
import type {
  CaseRecord,
  ExecutionMode,
  Finding,
  IntegrityAssessment,
  JudgeOutput,
  PolicyPack,
  PrecedentManifest,
  Resolution,
  RunRecord,
} from '@/domain/contracts';
import type { DeterministicEvaluation } from '@/domain/policy';
import type { QualityScore } from '@/domain/confidence';
import type {
  CollectionJob,
  EvidencePlan,
  SensitivityScenario,
} from '@/domain/collection';
import { formatSgd } from '@/domain/money';
import { buildReasoningNarrative } from '@/agents/explanation';
import { isRunInFlight, runSourceLabel, runSourceTone } from '@/lib/runPresentation';
import { CitationDrawer } from './CitationDrawer';
import { CaseVisual } from './CaseVisuals';
import { Cite, CiteList } from './Cite';
import { CollectionPanel } from './CollectionPanel';
import { PrecedentPanel } from './PrecedentPanel';
import { DamageEvidencePanel } from './DamageEvidencePanel';
import { CaseTimeline } from './CaseTimeline';
import { ReadableText } from './ReadableText';
import { visionMode } from '@/providers/vision';
import { IntegrityPanel } from './IntegrityPanel';
import { JudgeReasoning } from './JudgeReasoning';
import { primaryReviewTask, reviewTaskLabel } from '@/domain/navigation';
import { RunLauncher } from './RunLauncher';
import { PolicyBasis } from './PolicyBasis';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  workflow: { status: string; openTasks: { id: string; kind: string }[]; decision: string | null };
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  quality: QualityScore;
  pack: PolicyPack;
  latest: RunRecord | null;
  /** Mode the visitor asked for via `?mode=`. */
  requestedMode: ExecutionMode;
  /** False when the displayed run is not the mode that was requested. */
  runMatchesRequestedMode: boolean;
  /** True when an explicit `?run=` id was requested but is unusable for this case. */
  requestedRunUnavailable: boolean;
  /** Mode used when starting a fresh run. */
  reviewMode: 'live' | 'fixture';
  /**
   * Set when the page is rendering a pinned run's frozen snapshot rather than
   * the case as it stands now.
   */
  snapshotNotice: {
    caseVersion: number;
    currentCaseVersion: number;
    supersededByNewerCase: boolean;
    policyChangedSinceRun: boolean;
  } | null;
  /** The frozen collection cycle behind the displayed case version, if any. */
  collectionJob: CollectionJob | null;
  /** The plan as it stands now — what collection would look for next. */
  collectionPlan: EvidencePlan;
  /** Read-only "would the outcome change if…" scenarios. */
  sensitivity: SensitivityScenario[];
  /** The precedent context this run was frozen with, if any was retrieved. */
  precedents: PrecedentManifest | null;
  /** Integrity assessment from the displayed run, if any. */
  integrityAssessment: IntegrityAssessment | null;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function CaseDetailView({
  workflow,
  caseRecord,
  evaluation,
  quality,
  pack,
  latest,
  requestedMode,
  runMatchesRequestedMode,
  requestedRunUnavailable,
  reviewMode,
  snapshotNotice,
  collectionJob,
  collectionPlan,
  sensitivity,
  precedents,
  integrityAssessment,
}: Props) {
  const hasRun = latest != null && latest.resolution != null && latest.judge != null;
  const reviewTask = primaryReviewTask(workflow.openTasks);
  const timed = caseRecord.evidence
    .filter(item => item.timestamp !== null)
    .sort((a, b) => Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? ''));

  return (
    <div className="case-detail">
      <PolicyBasis pack={pack} suppliedSample={caseRecord.suppliedPolicyId !== null} />
      <CaseHeader caseRecord={caseRecord} evaluation={evaluation} latest={latest} />
      <section className="case-section" aria-label="Current next step">
        <div className="section-label">Your next step</div>
        {reviewTask ? <p>{reviewTask.kind === 'appeal' ? 'An appeal needs your review; the current decision remains in force.' : 'The AI assessment needs your decision.'} Open the workbench to request missing evidence or record a resolution.</p> : workflow.decision ? <p className="recorded-decision"><span>Recorded outcome</span><strong>{workflow.decision}</strong>Open the outcome to check the final amount and receipt.</p> : <p>Start a review below to turn the evidence packet into a resolution.</p>}
        <div className="row">
          {reviewTask ? <Link className="btn btn--primary" href={`/cases/${caseRecord.id}?task=${reviewTask.id}&section=decision`}>Open reviewer workbench</Link> : null}
          {latest || workflow.decision || workflow.openTasks.length > 0 ? <Link className="btn btn--ghost" href={`/cases/${caseRecord.id}/outcome`}>View outcome</Link> : null}
        </div>
        {workflow.openTasks.length > 1 ? <details className="related-review-tasks"><summary>Related review records ({workflow.openTasks.length - 1})</summary><ul>{workflow.openTasks.filter(task => task.id !== reviewTask?.id).map(task => <li key={task.id}><Link href={`/cases/${caseRecord.id}?task=${task.id}&section=decision`}>{reviewTaskLabel(task.kind)}</Link></li>)}</ul></details> : null}
      </section>

      {requestedRunUnavailable ? (
        <div className="notice notice--danger" role="alert">
          The requested run could not be found for this case, so the latest available run is shown
          instead. Run ids are only valid for the case that produced them.
        </div>
      ) : null}

      {snapshotNotice ? (
        <div className="notice" role="status">
          Showing the recorded assessment against case{' '}
          <strong>v{snapshotNotice.caseVersion}</strong>. Findings and citations below are the frozen
          snapshot from that run, not a fresh evaluation.
          {snapshotNotice.supersededByNewerCase ? (
            <>
              {' '}
              The case has since moved to <strong>v{snapshotNotice.currentCaseVersion}</strong>; start
              a new run to review the added evidence.
            </>
          ) : null}
          {snapshotNotice.policyChangedSinceRun ? (
            <>
              {' '}
              The policy pack on disk no longer matches the one this run was judged against.
            </>
          ) : null}
        </div>
      ) : null}

      <EvidenceBrief record={caseRecord} evaluation={evaluation} pack={pack}/>

      <nav className="case-jump-nav" aria-label="Case sections">
        <a href="#recommendation">Recommendation</a><a href="#ride-timeline">Ride timeline</a><a href="#assessments">Both sides</a><a href="#decision-facts">Decision facts</a><a href="#supporting-records">Supporting records</a>
      </nav>
      {hasRun && latest?.resolution ? <section className="case-section" id="recommendation"><CompactResolution resolution={latest.resolution} evaluation={evaluation} caseRecord={caseRecord} runId={latest.id} recordedDecision={workflow.decision}/></section> : <StartReview caseId={caseRecord.id} mode={reviewMode} quality={quality}/>}

      {/* 01 / INCIDENT — EVIDENCE */}
      <section className="case-section" id="ride-timeline">
        <div className="section-label">Reconstruct the ride</div>
        <div className="case-two-col">
          <div>
            <h2 className="section-title">Ride timeline</h2>
            <CaseTimeline items={timed} />
<CaseVisual caseRecord={caseRecord} evaluation={evaluation} pack={pack} />
          </div>
          <aside className="case-sidebar">
            <PolicySidebar pack={pack} category={caseRecord.category} />
          </aside>
        </div>
      </section>

      <DamageEvidencePanel record={caseRecord} frozen={snapshotNotice != null} mode={visionMode()} />


      {hasRun && latest && latest.judge && latest.resolution ? (
        <>
          {/* 02 / EQUAL CONSIDERATION */}
          <section className="case-section" id="assessments">
            <div className="section-label">Consider both sides</div>
            <h2 className="section-title">Advocate findings</h2>
            <AgentComparison findings={evaluation.findings} rider={latest.advocates.rider} driver={latest.advocates.driver} judge={latest.judge}/>
            <AdvocateFindings
              rider={latest.advocates.rider}
              driver={latest.advocates.driver}
              findings={evaluation.findings}
            />
          </section>

          {/* 03 / JUDGE */}
          <section className="case-section" id="decision-facts">
            <div className="section-label">Apply the policy</div>
            <h2 className="section-title">Decision frame</h2>
            <DecisionFrame judge={latest.judge} findings={evaluation.findings} />
          </section>

        </>
      ) : null}

      <section id="supporting-records" className="case-section">
        <div className="section-label">Supporting records</div>
        <details className="supporting-disclosure"><summary>Evidence collection & missing records</summary>
          <CollectionPanel caseId={caseRecord.id} caseVersion={caseRecord.version} plan={collectionPlan} job={collectionJob} sensitivity={sensitivity}/>
        </details>
        {hasRun && latest ? <>
          <details className="supporting-disclosure"><summary>Similar cases & consistency check</summary><PrecedentPanel manifest={precedents}/></details>
          <details className="supporting-disclosure"><summary>Evidence integrity assessment</summary><IntegrityPanel assessment={integrityAssessment}/></details>
          <details className="supporting-disclosure"><summary>Execution audit & rerun controls</summary><RunProvenance caseId={caseRecord.id} run={latest} requestedMode={requestedMode} matchesRequestedMode={runMatchesRequestedMode} reviewMode={reviewMode}/></details>
        </> : null}
      </section>

      <p className="small muted" style={{ marginTop: '2rem' }}>
        <Link href="/worklist">Back to Worklist</Link>
      </p>

      {/* One drawer serves every citation on the page via click delegation. */}
      <CitationDrawer caseId={caseRecord.id} runId={latest?.id ?? null} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CaseHeader                                                         */
/* ------------------------------------------------------------------ */

function CaseHeader({
  caseRecord,
  evaluation,
  latest,
}: {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  latest: RunRecord | null;
}) {
  const title = generateTitle(caseRecord, evaluation);
  const subtitle = generateSubtitle(caseRecord);
  const incidentDate = caseRecord.trip.scheduledAt
    ? formatDateShort(caseRecord.trip.scheduledAt)
    : 'Date not recorded';

  return (
    <header className="case-header">
      <div className="case-header__top">
        <div className="case-header__labels">
          <span className="marker">
            <img
              src={
                caseRecord.category === 'no_show_charge'
                  ? '/illustrations/marker-no-show.jpg'
                  : '/illustrations/marker-route.jpg'
              }
              alt=""
            />
          </span>
          <span className="badge badge--neutral">
            {caseRecord.category === 'damage' ? 'Damage case' : caseRecord.category === 'no_show_charge' ? 'No-show case' : 'Route case'}
          </span>
          <span className="badge badge--neutral">
            {latest?.mode === 'live' ? 'Live assessment' : 'Sample assessment'} ·{' '}
            {caseRecord.provenance === 'supplied_sample' ? 'Supplied sample' : 'Synthetic record'}
          </span>
        </div>
      </div>

      <div className="case-header__body">
        <div className="case-header__main">
          <h1 className="case-header__title">{title}</h1>
          <p className="case-header__subtitle">{subtitle}</p>
        </div>

        <div className="case-header__meta">
          <div className="case-header__amount">
            <span className="case-header__amount-label">Disputed</span>
            <span className="case-header__amount-value">{formatSgd(caseRecord.disputedCents)}</span>
          </div>
          <div className="case-header__grid">
            <div>
              <span className="case-header__grid-label">Incident</span>
              <span className="case-header__grid-value">{incidentDate}</span>
            </div>
            <div>
              <span className="case-header__grid-label">Policy</span>
              <span className="case-header__grid-value">{caseRecord.policyVersion.startsWith('ryde-') ? 'Ryde public policy' : 'Rydr example rules'}</span>
            </div>
            <div>
              <span className="case-header__grid-label">Local time</span>
              <span className="case-header__grid-value">SGT · UTC+8</span>
            </div>
            <div>
              <span className="case-header__grid-label">Case</span>
              <span className="case-header__grid-value">
                {caseRecord.id} v{caseRecord.version}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  EvidenceSpine                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  PolicySidebar                                                      */
/* ------------------------------------------------------------------ */

function PolicySidebar({ pack, category }: { pack: PolicyPack; category: string }) {
  const clauses = pack.clauses.filter((c) => c.category === category);
  const clause = clauses[0];
  if (!clause) return null;
  const others = clauses.slice(1);

  return (
    <div className="policy-sidebar">
      <div className="policy-sidebar__label">
        Policy — <Cite kind="policy" id={clause.id} />
      </div>
      <h3 className="policy-sidebar__title">{clause.title}</h3>
      <p className="small muted">{clause.text}</p>
      {others.length > 0 ? (
        <p className="small muted" style={{ marginTop: '0.6rem' }}>
          Also governing: <CiteList kind="policy" ids={others.map((c) => c.id)} />
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AdvocateFindings                                                   */
/* ------------------------------------------------------------------ */

function AdvocateFindings({
  rider,
  driver,
  findings,
}: {
  rider: import('@/domain/contracts').AdvocateOutput | null;
  driver: import('@/domain/contracts').AdvocateOutput | null;
  findings: Finding[];
}) {
  const findingsById = new Map(findings.map((f) => [f.id, f]));

  return (
    <div className="advocate-findings">
      <AdvocateColumn
        side="Rider advocate"
        advocate={rider}
        findingsById={findingsById}
      />
      <AdvocateColumn
        side="Driver advocate"
        advocate={driver}
        findingsById={findingsById}
      />
    </div>
  );
}

function AdvocateColumn({
  side,
  advocate,
  findingsById,
}: {
  side: string;
  advocate: import('@/domain/contracts').AdvocateOutput | null;
  findingsById: Map<string, Finding>;
}) {
  if (!advocate) {
    return (
      <div className="advocate-col">
        <div className="advocate-col__header">
          <h3 className="advocate-col__title">{side}</h3>
          <span className="advocate-col__weight">Equal weight</span>
        </div>
        <p className="small muted">No case submitted.</p>
      </div>
    );
  }

  const supported = advocate.supportingFindingIds
    .map((id) => findingsById.get(id))
    .filter((f): f is Finding => Boolean(f));

  return (
    <div className="advocate-col">
      <div className="advocate-col__header">
        <h3 className="advocate-col__title">{side}</h3>
        <span className="advocate-col__weight">Equal weight</span>
      </div>
      <ReadableText text={advocate.summary}/>
      {advocate.nextAction?<p className="notice small"><strong>Next step:</strong> {advocate.nextAction.summary} · source owner: {advocate.nextAction.sourceOwner.replaceAll('_',' ')}</p>:null}
      {supported.length > 0 ? (
        <details className="supporting-disclosure"><summary>Supporting findings ({supported.length})</summary><ol className="advocate-col__list">
          {supported.map((finding, i) => (
            <li key={finding.id} className="advocate-col__item">
              <span className="advocate-col__num">{i + 1}</span>
              <span>{finding.text}</span>
              {finding.evidenceIds.map((eid) => (
                <Cite key={eid} kind="evidence" id={eid} className="evidence-badge" />
              ))}
            </li>
          ))}
        </ol></details>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DecisionFrame                                                      */
/* ------------------------------------------------------------------ */

function DecisionFrame({ judge, findings }: { judge: JudgeOutput; findings: Finding[] }) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const established = judge.establishedFindingIds
    .map((id) => byId.get(id))
    .filter((f): f is Finding => Boolean(f));
  const disputed = judge.disputedFindingIds
    .map((id) => byId.get(id))
    .filter((f): f is Finding => Boolean(f));
  const unknowns = judge.missingEvidence;

  return (
    <div className="decision-frame">
      <div className="decision-frame__row">
        <span className="decision-frame__label decision-frame__label--established">Established</span>
        <div className="decision-frame__content">
          {established.length > 0 ? (
            established.map((f) => (
              <span key={f.id} className="decision-frame__item">
                {f.text}
                {f.evidenceIds.length > 0 ? <details className="finding-sources"><summary>View {f.evidenceIds.length} sources</summary>{f.evidenceIds.map((eid) => (
                  <Cite key={eid} kind="evidence" id={eid} className="evidence-badge" />
                ))}</details> : null}
              </span>
            ))
          ) : (
            <span className="small muted">None recorded.</span>
          )}
        </div>
      </div>
      <div className="decision-frame__row">
        <span className="decision-frame__label decision-frame__label--disputed">Disputed</span>
        <div className="decision-frame__content">
          {disputed.length > 0 ? (
            disputed.map((f) => (
              <span key={f.id} className="decision-frame__item">
                {f.text}
                {f.evidenceIds.length > 0 ? <details className="finding-sources"><summary>View {f.evidenceIds.length} sources</summary>{f.evidenceIds.map((eid) => (
                  <Cite key={eid} kind="evidence" id={eid} className="evidence-badge" />
                ))}</details> : null}
              </span>
            ))
          ) : (
            <span className="small muted">None recorded.</span>
          )}
        </div>
      </div>
      <div className="decision-frame__row">
        <span className="decision-frame__label decision-frame__label--unknown">Unknown</span>
        <div className="decision-frame__content">
          {unknowns.length > 0 ? (
            unknowns.map((u) => (
              <span key={u} className="decision-frame__item">
                {u}
              </span>
            ))
          ) : (
            <span className="small muted">No material unknowns.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  RunProvenance                                                      */
/* ------------------------------------------------------------------ */

/**
 * States plainly where a displayed result came from. When the run on screen is
 * not the mode the visitor asked for, this keeps a fresh-run action visible
 * rather than letting a fixture result read as a live execution.
 */
function RunProvenance({
  caseId,
  run,
  requestedMode,
  matchesRequestedMode,
  reviewMode,
}: {
  caseId: string;
  run: RunRecord;
  requestedMode: ExecutionMode;
  matchesRequestedMode: boolean;
  reviewMode: 'live' | 'fixture';
}) {
  const inFlight = isRunInFlight(run);
  const when = run.updatedAt.replace('T', ' ').slice(0, 16);

  return (
    <div className="run-provenance">
      <div className="run-provenance__main">
        <span className={`badge badge--${runSourceTone(run)}`}>{runSourceLabel(run)}</span>
        <span className="run-provenance__meta">
          <span className="mono">{run.id}</span> · case v{run.caseVersion} · policy{' '}
          {run.policyVersion} · provider {run.provider} · {when} UTC
        </span>
      </div>

      {inFlight ? (
        <p className="small muted run-provenance__note" aria-live="polite">
          This run is still executing.{' '}
          <Link href={`/cases/${caseId}/review?run=${run.id}`}>Follow progress</Link>.
        </p>
      ) : null}

      {!matchesRequestedMode ? (
        <p className="small run-provenance__note run-provenance__note--warn">
          You asked for a <strong>{requestedMode}</strong> review, but no {requestedMode} run is
          recorded for this case version. The result below is a{' '}
          <strong>{runSourceLabel(run).toLowerCase()}</strong>, not a live agent execution.
        </p>
      ) : null}

      <div className="run-provenance__actions">
        <RunLauncher
          caseId={caseId}
          mode={reviewMode}
          label={`Run ${reviewMode} review`}
          variant="ghost"
          size="sm"
        />
        {matchesRequestedMode ? (
          <RunLauncher
            caseId={caseId}
            mode={reviewMode}
            label="Run again as new execution"
            variant="ghost"
            forceNew
            size="sm"
          />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CompactResolution                                                  */
/* ------------------------------------------------------------------ */

function CompactResolution({
  resolution,
  evaluation,
  caseRecord,
  runId,
  recordedDecision,
}: {
  recordedDecision: string | null;
  resolution: Resolution;
  evaluation: DeterministicEvaluation;
  caseRecord: CaseRecord;
  runId: string;
}) {
  const retained =
    resolution.recommendedRefundCents === null
      ? null
      : caseRecord.disputedCents - resolution.recommendedRefundCents;

  const narrative = buildReasoningNarrative(evaluation);

  const headline =
    resolution.disposition === 'refund'
      ? `Refund ${formatSgd(resolution.recommendedRefundCents ?? 0)}`
      : resolution.disposition === 'uphold'
        ? 'Fee upheld'
        : resolution.disposition === 'partial_refund'
          ? `Partial refund ${formatSgd(resolution.recommendedRefundCents ?? 0)}`
          : recordedDecision ? 'Human review was requested' : 'Human review needed';

  return (
    <div className="compact-resolution">
      <div className="compact-resolution__main">
        <div className="compact-resolution__label">{recordedDecision ? 'Original automated assessment · historical record' : 'Recommended resolution'}</div>
        <h2 className="compact-resolution__headline">{headline}</h2>
        {recordedDecision ? <><p className="resolution-recorded">The recorded outcome is <strong>{recordedDecision}</strong>. This earlier assessment is kept for the audit trail.</p><details><summary>Read the original assessment</summary><JudgeReasoning className="compact-resolution__reasoning" {...narrative}/></details></> : <JudgeReasoning className="compact-resolution__reasoning" {...narrative} />}
        <details className="resolution-sources"><summary>Sources behind this recommendation</summary><div className="compact-resolution__citations">
          {resolution.judge.materialEvidenceIds.map((eid) => (
            <Cite
              key={eid}
              kind="evidence"
              id={eid}
              className="evidence-badge evidence-badge--light"
            />
          ))}
          {resolution.judge.policyIds.map((pid) => (
            <Cite
              key={pid}
              kind="policy"
              id={pid}
              className="evidence-badge evidence-badge--light"
            />
          ))}
        </div></details>
      </div>

      <div className="compact-resolution__aside">
        <div className="compact-resolution__amounts">
          <div className="compact-resolution__amount-row">
            <span>Original charge</span>
            <span>{formatSgd(caseRecord.disputedCents)}</span>
          </div>
          <div className="compact-resolution__amount-row">
            <span>{recordedDecision ? "Originally proposed refund" : "Proposed refund"}</span>
            <span>
              {resolution.recommendedRefundCents === null
                ? 'Deferred'
                : formatSgd(resolution.recommendedRefundCents)}
            </span>
          </div>
          <div className="compact-resolution__amount-row">
            <span>Retained amount</span>
            <span>{retained === null ? 'TBD' : formatSgd(retained)}</span>
          </div>
        </div>

        <div className="compact-resolution__actions">
          {resolution.disposition !== 'human_review' || recordedDecision ? (
            <Link href={`/cases/${caseRecord.id}/outcome`} className="btn btn--primary">
              {recordedDecision ? 'View recorded outcome' : resolution.disposition === 'refund'
                ? 'View refund receipt'
                : resolution.disposition === 'uphold'
                  ? 'View recorded outcome'
                  : 'View partial-refund receipt'}
            </Link>
          ) : null}
          {resolution.disposition === 'human_review' && !recordedDecision ? <p className="small">This recommendation needs a human decision. Use the workbench at the top of this page to decide or request evidence.</p> : null}
        </div>

        <div className="compact-resolution__links">
          <Link href={`/api/runs/${runId}/export`} className="btn btn--ghost" style={{ fontSize: '0.8125rem' }}>
            Export JSON report
          </Link>
          <Link href={`/cases/${caseRecord.id}/review?run=${runId}`} className="btn btn--ghost" style={{ fontSize: '0.8125rem' }}>
            View investigation
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  StartReview (when no run exists)                                   */
/* ------------------------------------------------------------------ */

function StartReview({
  caseId,
  mode,
  quality,
}: {
  caseId: string;
  mode: 'live' | 'fixture';
  quality: QualityScore;
}) {
  return (
    <section className="case-section">
      <div className="section-label">Review</div>
      <div className="start-review">
        <div>
          <h2 className="section-title">Start a review</h2>
          <p className="small muted" style={{ maxWidth: '52ch' }}>
            Two advocates assess the rider and driver accounts. The judge then applies the policy. Uncertain cases go to a human reviewer.
          </p>
          <RunLauncher caseId={caseId} mode={mode} />
        </div>
        <div className="start-review__quality">
          <span className="start-review__score">{quality.total.toFixed(2)}</span>
          <span className="start-review__band">Evidence quality: {quality.band}</span>
          <span className="small muted">
            This is a heuristic score, not a calibrated probability.
          </span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateTitle(caseRecord: CaseRecord, evaluation: DeterministicEvaluation): string {
  if (caseRecord.category === 'damage') return 'What supports the damage charge?';
  if (caseRecord.category === 'no_show_charge') {
    if (evaluation.disposition === 'refund') return 'Was the pickup condition met?';
    return 'Was the no-show charge supported?';
  }
  return 'Was the route deviation justified?';
}

function generateSubtitle(caseRecord: CaseRecord): string {
  if (caseRecord.riderStatement) {
    return caseRecord.riderStatement;
  }
  return caseRecord.category === 'no_show_charge'
    ? 'A disputed no-show cancellation fee.'
    : 'A disputed route deviation charge.';
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' });
}

