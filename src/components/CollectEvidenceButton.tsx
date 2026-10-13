'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Runs one bounded evidence-collection cycle.
 *
 * Idempotent on the server: collecting the same case version twice reuses the
 * job it already produced, so a double click never spends a second cycle.
 */
export function CollectEvidenceButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function collect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/collect`, { method: 'POST' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? 'Collection could not be completed.');
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unexpected error during collection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <button type="button" className="btn btn--ghost" onClick={collect} disabled={busy}>
        {busy ? 'Collecting…' : 'Collect evidence'}
      </button>
      <span className="small muted" style={{ maxWidth: '56ch' }}>
        Consults at most four allowlisted simulated sources. A missing record is reported as
        missing; nothing is fabricated to fill a gap.
      </span>
      {error ? (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

