import type { CaseRecord, Finding } from '@/domain/contracts';
import type { DemoRole } from '@/domain/demoAccess';
import { Cite } from '@/components/Cite';
import { ReadableText } from '@/components/ReadableText';

/**
 * The brief: what is disputed, what the record supports, what remains
 * unresolved.
 *
 * Display limits apply to this overview, never to stored content. Complete text
 * is always available behind an explicit control, and nothing is cut mid-sentence.
 */
export function PartyBrief({
  caseRecord,
  findings,
  issues,
  role,
  decided=false,
}: {
  caseRecord: CaseRecord;
  findings: Finding[];
  issues: string[];
  role: DemoRole;
  decided?:boolean;
}) {
  const material = findings.filter((finding) => finding.material);
  const supported = material.filter(f=>f.kind!=='claim').slice(0,3);
  const unresolved = issues.slice(0, 3);
  const ownStatement = role === 'driver' ? caseRecord.driverStatement : caseRecord.riderStatement;
  const otherStatement = role === 'driver' ? caseRecord.riderStatement : caseRecord.driverStatement;

  return (
    <section className="card workspace-brief" id="brief" aria-labelledby="brief-heading">
      <div className="card__title">
        <h2 id="brief-heading">What is disputed</h2>
      </div>

      <div className="workspace-brief__block">
        <h3 className="workspace-brief__label">Your account</h3>
        <ReadableText text={ownStatement ?? 'No statement was recorded on this sample case.'} />
        {role === 'driver' && otherStatement ? (
          <details className="supporting-disclosure">
            <summary>The rider’s complaint on this case</summary>
            <ReadableText text={otherStatement} />
          </details>
        ) : null}
      </div>

      <div className="workspace-brief__block">
        <h3 className="workspace-brief__label">What the record supports</h3>
        {supported.length === 0 ? (
          <p className="small muted">No material fact has been established from the records yet.</p>
        ) : (
          <ul className="workspace-brief__facts">
            {supported.map((finding) => (
              <li key={finding.id}>
                {finding.text}
                {finding.evidenceIds.length > 0 ? (
                  <span className="workspace-brief__cites">
                    {finding.evidenceIds.map((id) => (
                      <Cite key={id} kind="evidence" id={id} />
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {material.length > supported.length ? (
          <details className="supporting-disclosure">
            <summary>View all findings ({material.length})</summary>
            <ul className="workspace-brief__facts">
              {material.map((finding) => (
                <li key={finding.id}>{finding.text}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="workspace-brief__block">
        <h3 className="workspace-brief__label">{decided?'Uncertainty considered in the decision':'What remains unresolved'}</h3>
        {unresolved.length === 0 ? (
          <p className="small muted">Nothing material is outstanding on this case.</p>
        ) : (
          <ul className="workspace-brief__gaps">
            {unresolved.slice(0, 3).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {issues.length > unresolved.length ? (
          <details className="supporting-disclosure">
            <summary>View all unresolved points ({issues.length})</summary>
            <ul className="workspace-brief__gaps">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {unresolved.length > 0 ? (
          <p className="small muted">
            {decided?'The recorded decision explains how the reviewer handled these uncertainties. They do not mean the decision is still pending.':'These gaps affect the decision. A reviewer can request the source record or decide on the available evidence.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}

