import type { Finding } from '@/domain/contracts';

const KIND_LABEL: Record<Finding['kind'], string> = {
  observation: 'Observation',
  computed: 'Computed',
  claim: 'Claim',
  inference: 'Inference',
  unknown: 'Unknown',
};

export function FindingsList({
  findings,
  emptyLabel = 'No findings recorded.',
}: {
  findings: Finding[];
  emptyLabel?: string;
}) {
  if (findings.length === 0) {
    return <p className="muted small">{emptyLabel}</p>;
  }
  return (
    <ul className="findings">
      {findings.map((finding) => (
        <li key={finding.id} className={`finding finding--${finding.kind}`}>
          <div className="row" style={{ gap: '0.4rem' }}>
            <span className="badge badge--neutral">{KIND_LABEL[finding.kind]}</span>
            {finding.material ? <span className="badge badge--accent">Material</span> : null}
            <span className="mono muted">{finding.id}</span>
          </div>
          <p style={{ margin: '0.25rem 0 0' }}>{finding.text}</p>
          {finding.evidenceIds.length > 0 || finding.policyIds.length > 0 ? (
            <p className="small muted" style={{ margin: '0.25rem 0 0' }}>
              {finding.evidenceIds.length > 0 ? (
                <>
                  Evidence:{' '}
                  {finding.evidenceIds.map((id, index) => (
                    <span key={id}>
                      {index > 0 ? ', ' : ''}
                      <a href={`#evidence-${id}`} className="mono">
                        {id}
                      </a>
                    </span>
                  ))}
                </>
              ) : null}
              {finding.evidenceIds.length > 0 && finding.policyIds.length > 0 ? ' · ' : null}
              {finding.policyIds.length > 0 ? `Policy: ${finding.policyIds.join(', ')}` : null}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

