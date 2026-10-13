import { ReadableText } from '@/components/ReadableText';
import type { CaseDecision, ReviewTask } from '@/domain/contracts';
import type { DemoRole } from '@/domain/demoAccess';
import { formatSgd } from '@/domain/money';

const DISPOSITION_LABELS: Record<string, string> = {
  refund: 'Refund',
  uphold: 'Charge upheld',
  partial_refund: 'Partial refund',
  insufficient_evidence: 'Closed — unresolved',
};

/**
 * Complete case history on demand: every recorded decision and the viewer's own
 * appeal tasks. Immutable records are listed, never edited.
 */
export function PartyHistory({
  decisions,
  tasks,
  role,
  currentDecisionId,
  currentCaseVersion,
  displayedCaseVersion,
}: {
  decisions: CaseDecision[];
  tasks: ReviewTask[];
  role: DemoRole;
  currentDecisionId: string | null;
  currentCaseVersion: number;
  displayedCaseVersion: number;
}) {
  const myAppeals = tasks.filter(
    (task) =>
      task.kind === 'appeal' &&
      (role==='reviewer' || task.submittedBy === role ||
        (!task.submittedBy && task.reasonSummary.startsWith(role === 'driver' ? 'Driver appeal' : 'Rider appeal'))),
  );

  return (
    <section className="card workspace-history" id="history" aria-labelledby="history-heading">
      <div className="card__title">
        <h2 id="history-heading">Case record</h2>
        <span className="badge badge--neutral">
          Viewing v{displayedCaseVersion} of {currentCaseVersion}
        </span>
      </div>

      <h3>Decisions ({decisions.length})</h3>
      {decisions.length === 0 ? (
        <p className="small muted">No decision has been recorded on this case.</p>
      ) : (
        <ol className="friendly-history">
          {decisions.map((decision, index) => (
            <li key={decision.id}>
              <span className="history-dot" aria-hidden="true" />
              <div>
                <strong>{DISPOSITION_LABELS[decision.disposition] ?? decision.disposition}</strong>
                <p className="small muted">
                  Decision {index + 1} ·{' '}
                  {new Date(decision.createdAt).toLocaleDateString('en-SG', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'Asia/Singapore',
                  })}{' '}
                  · {currentDecisionId === decision.id ? 'Current decision' : 'Earlier decision'}
                </p>
                <details><summary>Decision reason</summary><ReadableText text={decision.explanation}/></details>
              </div>
              <span>
                {decision.targetRefundCents == null ? 'No amount decided' : formatSgd(decision.targetRefundCents)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {myAppeals.length > 0 ? (
        <>
          <h3>{role==='reviewer'?'Appeal history':'Your appeals'}</h3>
          <ol className="friendly-history">
            {myAppeals.map((task) => (
              <li key={task.id}>
                <span className="history-dot" aria-hidden="true" />
                <div>
                  <strong>{role==='reviewer'?task.submittedBy+' appeal':'Your appeal'}</strong><details><summary>Submitted grounds</summary><ReadableText text={task.reasonSummary}/></details>
                  <p className="small muted">
                    {task.status.replace(/_/g, ' ')} ·{' '}
                    {new Date(task.createdAt).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore' })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
