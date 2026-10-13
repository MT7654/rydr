import Link from 'next/link';
import { selectCase } from '@/app/demoActions';

export interface CaseOption {
  id: string;
  label: string;
  status: string;
  disputedCents: number;
}

/**
 * Compact ride selector. Supports every accessible sample scenario, not just the
 * featured case, and stores only the selection identifier for this session.
 */
export function CaseSelector({
  options,
  selectedId,
  formatAmount,
}: {
  options: CaseOption[];
  selectedId: string | null;
  formatAmount: (cents: number) => string;
}) {
  const selected = options.find((option) => option.id === selectedId) ?? options[0] ?? null;
  return (
    <div className="workspace-selector" aria-label="Choose ride">
      <form action={selectCase} className="workspace-selector__form">
        <label className="small" htmlFor="case-select">
          Choose ride
        </label>
        <select id="case-select" name="caseId" defaultValue={selected?.id ?? ''} className="input">
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} — {formatAmount(option.disputedCents)} · {option.status}
            </option>
          ))}
        </select>
        <button className="btn btn--ghost btn--sm" type="submit">
          Open
        </button>
      </form>
      {options.length > 1 ? (
        <details className="workspace-selector__history">
          <summary>Ride history ({options.length})</summary>
          <ul>
            {options.map((option) => (
              <li key={option.id}>
                <Link href={`/rides?case=${option.id}`}>
                  {option.label} — {formatAmount(option.disputedCents)}
                </Link>
                <span className="small muted"> · {option.status}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
