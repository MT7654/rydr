import type { IntegrityAssessment } from '@/domain/contracts';

interface Props {
  assessment: IntegrityAssessment | null;
  variant?: 'default' | 'card';
}

export function IntegrityPanel({ assessment, variant = 'default' }: Props) {
  if (!assessment) {
    return (
      <section className={variant === 'card' ? 'card' : ''}>
        <h3 className="section-heading">Integrity assessment</h3>
        <p className="text-secondary">No integrity assessment was recorded for this run.</p>
      </section>
    );
  }

  if (assessment.signals.length === 0) {
    return (
      <section className={variant === 'card' ? 'card' : ''}>
        <h3 className="section-heading">Integrity assessment</h3>
        <p className="text-secondary">No configured integrity or behavioral signals detected. This does not certify authenticity.</p>
      </section>
    );
  }

  const severityTone: Record<string, string> = {
    low: 'badge--low',
    medium: 'badge--moderate',
    high: 'badge--high',
  };

  return (
    <section className={variant === 'card' ? 'card' : ''}>
      <h3 className="section-heading">
        Integrity assessment{' '}
        <span className={`badge ${severityTone[assessment.overallSeverity] ?? 'badge--low'}`}>
          {assessment.overallSeverity}
        </span>
      </h3>
      <ul className="signal-list">
        {assessment.signals.map((signal) => (
          <li key={signal.code} className={`signal-item signal-item--${signal.severity}`}>
            <div className="signal-header">
              <span className={`badge ${severityTone[signal.severity] ?? 'badge--low'}`}>
                {signal.severity}
              </span>
              <span className="signal-code">{signal.code.replaceAll('_',' ')}</span>
            </div>
            <p className="signal-explanation">{signal.explanation}</p>
            {signal.evidenceIds.length > 0 && (
              <p className="signal-ids">
                Evidence: {signal.evidenceIds.join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
      {assessment.triggersReview && (
        <p className="integrity-notice">
          These inspection signals require human review; they are not a fraud verdict. A reviewer examines them before
          the case is settled.
        </p>
      )}
    </section>
  );
}

