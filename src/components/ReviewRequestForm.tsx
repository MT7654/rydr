'use client';

import { useState } from 'react';

/**
 * Records a demo review request. It creates a new pending-review record and never
 * overwrites the previous resolution, and it does not claim a support team was
 * contacted.
 */
export function ReviewRequestForm({ caseId, runId }: { caseId: string; runId: string | null }) {
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length === 0) {
      setState('error');
      setMessage('A reason is required to request review.');
      return;
    }
    setState('sending');
    setMessage(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/review-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId, reason }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setState('error');
        setMessage(payload.message ?? 'The request could not be recorded.');
        return;
      }
      setState('done');
      setMessage(payload.message ?? 'Review requested.');
    } catch (cause) {
      setState('error');
      setMessage(cause instanceof Error ? cause.message : 'Unexpected error.');
    }
  }

  return (
    <form className="stack" style={{ gap: '0.6rem' }} onSubmit={submit}>
      <label htmlFor="review-reason" className="small">
        Why does this need further review?
      </label>
      <textarea
        id="review-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        required
        style={{
          width: '100%',
          fontFamily: 'inherit',
          fontSize: '0.95rem',
          padding: '0.6rem',
          borderRadius: '10px',
          border: '1px solid var(--border-strong)',
        }}
      />
      <div className="row">
        <button type="submit" className="btn" disabled={state === 'sending'}>
          {state === 'sending' ? 'Recording…' : 'Send to reviewer queue'}
        </button>
        {message ? (
          <span
            className={state === 'error' ? 'small' : 'small'}
            role={state === 'error' ? 'alert' : 'status'}
          >
            {message}
          </span>
        ) : null}
      </div>
      {state === 'done' ? <a className="btn btn--primary" href="/review-queue">Open reviewer queue</a> : null}
      <p className="small muted" style={{ margin: 0 }}>
        This adds a request to the review queue. It does not contact a support team and does not
        overwrite the previous resolution.
      </p>
    </form>
  );
}

