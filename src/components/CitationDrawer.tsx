'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Citation drawer.
 *
 * Click any canonical evidence id or policy clause anywhere on the page to see
 * what it actually is: type, time, source pointer and provenance, original
 * contents, quality issues, and the findings that cite it.
 *
 * Built on a native <dialog>, so focus trapping, Escape and the backdrop come
 * from the platform rather than being reimplemented. Clicks are handled by
 * delegation, so any element carrying `data-cite` works without wiring.
 */

interface FindingRef {
  id: string;
  kind: string;
  material: boolean;
  text: string;
}

interface ClaimRef {
  id: string;
  field: string;
  value: number;
  suppliedBy: string;
  requestId: string;
  suppliedAt: string;
  note: string;
  verification: {
    status: 'unverified_claim' | 'verified';
    source: string | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
  };
}

interface EvidenceCitation {
  id: string;
  kind: string;
  timestamp: string | null;
  summary: string | null;
  source: { dataset: string; jsonPointer: string; provenance: string };
  qualityIssues: string[];
  claims: ClaimRef[];
  payload: unknown;
  findings: FindingRef[];
}

interface PolicyCitation {
  authority: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  id: string;
  title: string;
  text: string;
  category: string;
  policyVersion: string;
  policyId: string;
  findings: FindingRef[];
}

interface CitationIndex {
  caseId: string;
  caseVersion: number;
  policyId: string;
  policyVersion: string;
  evidence: EvidenceCitation[];
  policy: PolicyCitation[];
}

export function CitationDrawer({ caseId, runId }: { caseId: string; runId?: string | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState<CitationIndex | null>(null);
  const [open, setOpen] = useState<{ kind: 'evidence' | 'policy'; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastTrigger = useRef<Element | null>(null);

  const load = useCallback(async () => {
    if (index) return index;
    const query = runId ? `?run=${encodeURIComponent(runId)}` : '';
    const response = await fetch(`/api/cases/${caseId}/citations${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load citations (${response.status}).`);
    const payload = (await response.json()) as CitationIndex;
    setIndex(payload);
    return payload;
  }, [caseId, index, runId]);

  // Delegated clicks, so any `data-cite` element works.
  useEffect(() => {
    const onClick = async (event: MouseEvent) => {
      const target = event.target as Element | null;
      const trigger = target?.closest?.('[data-cite]');
      if (!trigger) return;
      const value = trigger.getAttribute('data-cite');
      if (!value) return;
      const [kind, id] = value.split(':');
      if ((kind !== 'evidence' && kind !== 'policy') || !id) return;

      event.preventDefault();
      lastTrigger.current = trigger;
      setError(null);
      setOpen({ kind, id });
      try {
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load citations.');
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [load]);

  // Drive the native dialog from React state, and restore focus on close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      dialog.close();
      const trigger = lastTrigger.current;
      if (trigger instanceof HTMLElement) trigger.focus();
    }
  }, [open]);

  const evidence = open?.kind === 'evidence' ? index?.evidence.find((e) => e.id === open.id) : undefined;
  const policy = open?.kind === 'policy' ? index?.policy.find((p) => p.id === open.id) : undefined;
  const missing = open && index && !evidence && !policy;

  return (
    <dialog
      ref={dialogRef}
      className="citation-dialog"
      aria-labelledby="citation-title"
      onClose={() => setOpen(null)}
      onClick={(event) => {
        // A click on the backdrop (outside the panel) closes the drawer.
        if (event.target === dialogRef.current) setOpen(null);
      }}
    >
      <div className="citation-panel">
        <div className="citation-panel__head">
          <h2 id="citation-title" className="citation-panel__title">
            {open ? open.id : 'Citation'}
          </h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setOpen(null)}
            aria-label="Close citation"
          >
            Close
          </button>
        </div>

        {error ? <div className="notice notice--danger">{error}</div> : null}

        {open && !index && !error ? (
          <p className="small muted">Loading the citation…</p>
        ) : null}

        {missing ? (
          <p className="small muted">
            This id is not part of case {index?.caseId} v{index?.caseVersion}. Citations only resolve
            against the case that produced them.
          </p>
        ) : null}

        {evidence ? (
          <>
            <dl className="citation-meta">
              <div>
                <dt>Type</dt>
                <dd>{evidence.kind.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd className="mono">{evidence.timestamp ?? 'not recorded'}</dd>
              </div>
              <div>
                <dt>Provenance</dt>
                <dd>{evidence.source.provenance.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd className="mono">
                  {evidence.source.dataset} {evidence.source.jsonPointer}
                </dd>
              </div>
            </dl>

            {evidence.summary ? (
              <p className="small" style={{ marginTop: '0.6rem' }}>
                {evidence.summary}
              </p>
            ) : null}

            {evidence.claims.length > 0 ? (
              <>
                <p className="reasoning__heading" style={{ marginTop: '0.9rem' }}>
                  Party claims about this item
                </p>
                <ul className="citation-claims">
                  {evidence.claims.map((claim) => (
                    <li key={claim.id}>
                      <span className={`badge badge--${claim.verification.status === 'verified' ? 'success' : 'review'}`}>
                        {claim.verification.status === 'verified' ? 'verified' : 'unverified claim'}
                      </span>
                      <span className="mono small">
                        {claim.field.replace(/_/g, ' ')} = {claim.value}
                      </span>
                      <p className="small" style={{ margin: '0.25rem 0 0' }}>
                        {claim.note}
                      </p>
                      <p className="small muted" style={{ margin: '0.15rem 0 0' }}>
                        Supplied by the {claim.suppliedBy} · request{' '}
                        <span className="mono">{claim.requestId}</span>
                        {claim.verification.verifiedBy
                          ? ` · verified by ${claim.verification.verifiedBy}`
                          : ' · not verified by anyone'}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {evidence.qualityIssues.length > 0 ? (
              <>
                <p className="reasoning__heading" style={{ marginTop: '0.9rem' }}>
                  Quality issues
                </p>
                <ul className="reasoning__list">
                  {evidence.qualityIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="small muted" style={{ marginTop: '0.6rem' }}>
                No quality issues recorded.
              </p>
            )}

            <p className="reasoning__heading" style={{ marginTop: '0.9rem' }}>
              Original contents
            </p>
            <pre className="citation-json">{JSON.stringify(evidence.payload, null, 2)}</pre>

            <p className="reasoning__heading" style={{ marginTop: '0.9rem' }}>
              Cited by these findings
            </p>
            <FindingList findings={evidence.findings} />
          </>
        ) : null}

        {policy ? (
          <>
            <dl className="citation-meta">
              <div>
                <dt>Clause</dt>
                <dd>{policy.title}</dd>
              </div>
              <div>
                <dt>Applies to</dt>
                <dd>{policy.category.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt>Policy pack</dt>
                <dd className="mono">
                  {policy.policyId} v{policy.policyVersion}
                </dd>
              </div>
            </dl>
            <p className="reasoning__heading" style={{ marginTop: '0.9rem' }}>
              Governing text
            </p>
            <p className="small">{policy.text}</p>
            <p className="small muted">{policy.authority === 'official_ryde' ? 'Published Ryde policy · paraphrase' : policy.authority === 'rydr_safeguard' ? 'Rydr evidence safeguard · not an official Ryde rule' : 'Rydr example rules'}</p>
            {policy.sourceUrl ? <p className="small"><a href={policy.sourceUrl} target="_blank" rel="noreferrer">Original Ryde source ↗</a> · checked {policy.retrievedAt}</p> : null}
            <p className="reasoning__heading" style={{ marginTop: '0.9rem' }}>
              Cited by these findings
            </p>
            <FindingList findings={policy.findings} />
          </>
        ) : null}
      </div>
    </dialog>
  );
}

function FindingList({ findings }: { findings: FindingRef[] }) {
  if (findings.length === 0) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        No finding cites this. It is recorded but was not material to the outcome.
      </p>
    );
  }
  return (
    <ul className="citation-findings">
      {findings.map((finding) => (
        <li key={finding.id}>
          <span className="mono small">{finding.id}</span>
          <span className={`badge badge--${finding.kind === 'claim' ? 'review' : 'neutral'}`}>
            {finding.kind}
          </span>
          {finding.material ? null : <span className="small muted">not material</span>}
          <p className="small" style={{ margin: '0.25rem 0 0' }}>
            {finding.text}
          </p>
        </li>
      ))}
    </ul>
  );
}

