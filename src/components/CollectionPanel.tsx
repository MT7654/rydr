import type {
  CollectionJob,
  DisputedCondition,
  EvidencePlan,
  SensitivityScenario,
  SourceResult,
} from '@/domain/collection';
import { CollectEvidenceButton } from './CollectEvidenceButton';

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                               */
/* ------------------------------------------------------------------ */

const CONDITION_LABELS: Record<DisputedCondition['kind'], string> = {
  evidence_gap: 'Evidence gap',
  policy_ambiguity: 'Policy ambiguity',
  integrity: 'Integrity',
  runtime_failure: 'Runtime failure',
  safety: 'Safety',
};

const CONDITION_TONES: Record<DisputedCondition['kind'], string> = {
  evidence_gap: 'badge--neutral',
  policy_ambiguity: 'badge--review',
  integrity: 'badge--danger',
  runtime_failure: 'badge--danger',
  safety: 'badge--danger',
};

const SOURCE_LABELS: Record<SourceResult['tool'], string> = {
  trip_telemetry: 'Trip telemetry',
  communications: 'Communications log',
  fare_ledger: 'Fare ledger',
  effective_policy: 'Effective policy',
};

const STATUS_TONES: Record<SourceResult['status'], string> = {
  found: 'badge--success',
  unavailable: 'badge--review',
  conflict: 'badge--danger',
  not_applicable: 'badge--neutral',
};

const STOP_REASON_TEXT: Record<CollectionJob['stopReason'], string> = {
  resolved: 'Resolved by the records retrieved',
  no_conditions: 'Nothing an allowlisted source could settle',
  unavailable: 'Source held no record — reported honestly',
  conflict: 'Sources disagreed — stopped rather than averaged',
  policy_ambiguity: 'Escalated: needs a policy owner',
  budget_exhausted: 'Cycle budget reached',
  safety_routing: 'Routed to a human reviewer',
};

/* ------------------------------------------------------------------ */
/*  CollectionPanel                                                    */
/* ------------------------------------------------------------------ */

/**
 * What Rydr went and looked for, what came back, and what would change the
 * answer.
 *
 * Everything here is read-only. When a collection job exists its frozen
 * conditions and source results are shown, so the panel never recomputes
 * history against a case that has since resolved; only when no cycle has run
 * does it preview the plan as it stands now.
 */
export function CollectionPanel({
  caseId,
  caseVersion,
  plan,
  job,
  sensitivity,
}: {
  caseId: string;
  caseVersion: number;
  plan: EvidencePlan;
  job: CollectionJob | null;
  sensitivity: SensitivityScenario[];
}) {
  const conditions = job ? job.conditions : plan.conditions;
  const needsHumanInput = conditions
    .filter(
      (condition) => condition.tool === null || condition.kind === 'policy_ambiguity',
    )
    .map((condition) => condition.summary);
  const canCollect = !job && plan.hasWork;

  if (conditions.length === 0 && !job && sensitivity.length === 0) return null;

  return (
    <section className="case-section">
      <div className="section-label">Collection — what Rydr looked for</div>
      <h2 className="section-title">Disputed facts</h2>

      <p className="small muted" style={{ maxWidth: '68ch' }}>
        Collection runs before any agent is invoked. It consults only allowlisted simulated
        sources, applies what it actually retrieved as one new case version, and stops honestly
        when a record is missing, contradictory, or a question only a policy owner can answer.
      </p>

      {job ? (
        <div className="collection-status">
          <span
            className={`badge ${
              job.status === 'completed'
                ? 'badge--success'
                : job.status === 'blocked'
                  ? 'badge--review'
                  : 'badge--danger'
            }`}
          >
            {job.status === 'completed' ? 'Collection complete' : job.status}
          </span>
          <span className="badge badge--neutral">{STOP_REASON_TEXT[job.stopReason]}</span>
          <span className="small muted mono">{job.id}</span>
          <span className="small muted">
            case v{job.startingVersion}
            {job.resultingVersion ? ` → v${job.resultingVersion}` : ' (unchanged)'} ·{' '}
            {job.toolCallCount} source call{job.toolCallCount === 1 ? '' : 's'}
          </span>
        </div>
      ) : (
        <div className="collection-status">
          <span className="badge badge--neutral">No collection cycle yet</span>
          <span className="small muted">
            case v{caseVersion} · this is the plan as it stands now, not a record of a past cycle
          </span>
        </div>
      )}

      {job ? <p className="collection-note">{job.note}</p> : null}

      {conditions.length > 0 ? (
        <div className="collection-block">
          <h3 className="collection-block__title">
            {job ? 'Conditions identified' : 'Unresolved conditions'}
          </h3>
          <ul className="collection-conditions">
            {conditions.map((condition) => (
              <li key={condition.id} className="collection-condition">
                <div className="collection-condition__head">
                  <span className={`badge ${CONDITION_TONES[condition.kind]}`}>
                    {CONDITION_LABELS[condition.kind]}
                  </span>
                  <span className="mono small muted">{condition.id}</span>
                  {condition.policyIds.map((policyId) => (
                    <span key={policyId} className="badge badge--neutral">
                      {policyId}
                    </span>
                  ))}
                </div>
                <p className="collection-condition__summary">{condition.summary}</p>
                <p className="small muted">
                  <strong>Why it matters:</strong> {condition.whyItMatters}
                </p>
                <p className="small muted">
                  <strong>Can be settled by:</strong>{' '}
                  {condition.tool ? (
                    <span className="mono">{SOURCE_LABELS[condition.tool]}</span>
                  ) : (
                    'No allowlisted source — a person must resolve it'
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {job && job.results.length > 0 ? (
        <div className="collection-block">
          <h3 className="collection-block__title">Source reads</h3>
          <table className="case-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Records</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {job.results.map((result) => (
                <tr key={result.requestId}>
                  <td>
                    {SOURCE_LABELS[result.tool]}
                    <span className="small muted mono collection-hash">
                      {result.toolVersion} · {result.payloadHash.slice(0, 8)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_TONES[result.status]}`}>
                      {result.status.replace('_', ' ')}
                    </span>
                    <span className="small muted mono collection-hash">{result.sourceType}</span>
                  </td>
                  <td className="mono small">
                    {result.sourceRecordIds.length > 0 ? result.sourceRecordIds.join(', ') : '—'}
                  </td>
                  <td className="small muted">{result.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {needsHumanInput.length > 0 ? (
        <div className="collection-block">
          <h3 className="collection-block__title">Needs a human</h3>
          <ul className="collection-human">
            {needsHumanInput.map((summary) => (
              <li key={summary} className="small">
                {summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sensitivity.length > 0 ? (
        <div className="collection-block">
          <h3 className="collection-block__title">
            Sensitivity — what would change the answer
          </h3>
          <p className="small muted">
            Each line re-runs the same deterministic engine on a hypothetical variant. Nothing
            here writes a case version, a ledger entry or a settlement; the variants are
            discarded. A line only claims to change the decision when the engine actually returns
            a different outcome.
          </p>
          <ul className="collection-scenarios">
            {sensitivity.map((scenario) => (
              <li key={scenario.id} className="collection-scenario">
                <div className="collection-condition__head">
                  <span
                    className={`badge ${scenario.changesDecision ? 'badge--review' : 'badge--neutral'}`}
                  >
                    {scenario.changesDecision ? 'Would change the outcome' : 'Would not change it'}
                  </span>
                  <span className="collection-scenario__label">{scenario.label}</span>
                  <span className="mono small muted">{scenario.id}</span>
                </div>
                <p className="small">{scenario.hypothetical}</p>
                <p className="small">
                  <strong>Then:</strong> {scenario.outcome}
                </p>
                <p className="small muted">
                  <strong>Baseline:</strong> {scenario.baselineOutcome} · controlling condition:{' '}
                  {scenario.controllingCondition}
                </p>
                {scenario.missingSource ? (
                  <p className="small muted">
                    <strong>Settled by:</strong> {scenario.missingSource}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canCollect ? (
        <div className="collection-action">
          <CollectEvidenceButton caseId={caseId} />
        </div>
      ) : null}
    </section>
  );
}

