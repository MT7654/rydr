'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Starts a review run.
 *
 * By default the request is idempotent: duplicate clicks, reloads and repeat
 * submissions share one execution for the same case version, mode and input.
 * `forceNew` deliberately starts a separate execution by supplying a unique
 * idempotency key — the session call budget still applies.
 */
export function RunLauncher({
  caseId,
  mode = 'fixture',
  label,
  variant = 'primary',
  forceNew = false,
  size,
}: {
  caseId: string;
  mode?: string;
  label?: string;
  variant?: 'primary' | 'ghost';
  forceNew?: boolean;
  size?: 'sm';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buttonLabel = label ?? (mode === 'live' ? 'Run live review' : 'Start review');

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          idempotencyKey: forceNew
            ? `${caseId}:intent:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
            : undefined,
        }),
      });
      const payload = (await response.json()) as { run?: { id: string }; message?: string };
      if (!response.ok || !payload.run) {
        setError(
          payload.message ??
            'The run could not be started. No fixture result was substituted for a live failure.',
        );
        return;
      }
      router.push(`/cases/${caseId}?section=assessment&mode=${mode}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unexpected error starting the run.');
    } finally {
      setBusy(false);
    }
  }

  const className = size === 'sm' ? `btn btn--${variant} btn--sm` : `btn btn--${variant}`;

  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <button type="button" className={className} onClick={start} disabled={busy}>
        {busy ? 'Starting…' : buttonLabel}
      </button>
      {error ? (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

