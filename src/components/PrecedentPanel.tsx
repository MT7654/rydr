import type { PrecedentManifest } from '@/domain/contracts';

/**
 * What precedent context this run was actually shown.
 *
 * The manifest is frozen in the run snapshot, so this panel never re-runs
 * retrieval: a precedent approved — or rolled back — after the run cannot
 * rewrite what an already-recorded run appears to have read. Exclusions are
 * shown too, because "why was this example *not* used" is as much a part of the
 * record as "which one was".
 */
export function PrecedentPanel({
  manifest,
  variant = 'section',
}: {
  manifest: PrecedentManifest | null;
  variant?: 'section' | 'card';
}) {
  const body = (
    <>
      <p className="small muted" style={{ maxWidth: '72ch' }}>
        Precedents are resolved examples, never rules. Retrieval is local and lexical — same
        governing pack, same dispute category, and a minimum condition overlap — so a reviewer can
        read exactly why two cases were considered similar.
      </p>

      {!manifest ? (
        <p className="small muted" style={{ margin: 0 }}>
          No precedent context was recorded for this run. Either none was retrieved, or the run
          predates precedent retrieval. Absent means &ldquo;not retrieved&rdquo;, never &ldquo;retrieved and
          empty&rdquo;.
        </p>
      ) : (
        <>
          <div className="collection-status">
            <span
              className={`badge ${manifest.contexts.length > 0 ? 'badge--accent' : 'badge--neutral'}`}
            >
              {manifest.contexts.length > 0
                ? `${manifest.contexts.length} precedent(s) shown`
                : 'No relevant precedent'}
            </span>
            <span className="badge badge--neutral">{manifest.strategy.replace(/_/g, ' ')}</span>
            <span className="small muted">
              {manifest.considered} considered · case v{manifest.caseVersion} ·{' '}
              {manifest.retrievedAt.replace('T', ' ').slice(0, 16)}
            </span>
          </div>

          <p className="collection-note">{manifest.note}</p>

          {manifest.contexts.length > 0 ? (
            <div className="collection-block">
              <h3 className="collection-block__title">Examples shown to the Judge</h3>
              <ul className="precedent-list">
                {manifest.contexts.map((context) => (
                  <li key={context.precedentId} className="precedent-card">
                    <div className="precedent-card__head">
                      <span className="mono small muted">{context.precedentId}</span>
                      <span className="badge badge--neutral">
                        {context.category.replace(/_/g, ' ')}
                      </span>
                      <span className="badge badge--neutral">{context.outcome}</span>
                      <span className="small muted">
                        relevance {context.relevanceScore.toFixed(2)}
                      </span>
                    </div>
                    <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
                      Approved by {context.approvedBy} · source case{' '}
                      <span className="mono">{context.caseId}</span> · clauses{' '}
                      {context.citedPolicyIds.join(', ') || 'none'}
                    </p>
                    <div className="precedent-split">
                      <div>
                        <p className="precedent-split__title">Similarities</p>
                        <ul className="reasoning__list">
                          {context.similarities.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="precedent-split__title">Differences</p>
                        {context.differences.length === 0 ? (
                          <p className="small muted" style={{ margin: 0 }}>
                            No material difference was found on the recorded conditions.
                          </p>
                        ) : (
                          <ul className="reasoning__list">
                            {context.differences.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {manifest.excluded.length > 0 ? (
            <div className="collection-block">
              <h3 className="collection-block__title">Considered and excluded</h3>
              <ul className="collection-human">
                {manifest.excluded.map((exclusion, index) => (
                  <li key={`${exclusion.precedentId}-${index}`} className="small">
                    <span className="mono small muted">{exclusion.precedentId}</span> — {exclusion.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </>
  );

  if (variant === 'card') {
    return (
      <section className="card">
        <div className="card__title">
          <h2>Precedent context</h2>
          <span className="small muted">what this run was shown</span>
        </div>
        {body}
      </section>
    );
  }

  return (
    <section className="case-section">
      <div className="section-label">03b / Precedent — Governed learning</div>
      <h2 className="section-title">Governed learning</h2>
      {body}
    </section>
  );
}

