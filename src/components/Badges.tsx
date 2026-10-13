import type { CaseSummary, ExecutionMode } from '@/domain/contracts';

export function ModeBadge({ mode }: { mode: ExecutionMode }) {
  const label =
    mode === 'fixture' ? 'Sample assessment' : mode === 'replay' ? 'Recorded run' : 'Live';
  const variant = mode === 'live' ? 'success' : 'review';
  return (
    <span className={`badge badge--${variant}`} title={`Execution mode: ${mode}`}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function SyntheticNotice({ provenance }: { provenance: 'supplied_sample' | 'synthetic' }) {
  return (
    <span className="badge badge--neutral">
      {provenance === 'supplied_sample' ? 'Supplied sample' : 'Synthetic data'}
    </span>
  );
}

const DISPOSITION_LABEL: Record<string, string> = {
  refund: 'Fee refunded',
  uphold: 'Fee upheld',
  partial_refund: 'Partial refund recommended',
  human_review: 'Human review needed',
};

export function DispositionPill({ disposition }: { disposition: string }) {
  const variant =
    disposition === 'human_review'
      ? 'review'
      : disposition === 'refund' || disposition === 'partial_refund'
        ? 'success'
        : 'neutral';
  return (
    <span className={`badge badge--${variant}`}>
      {DISPOSITION_LABEL[disposition] ?? disposition}
    </span>
  );
}

export function StatusPill({ status }: { status: CaseSummary['status'] }) {
  const variant =
    status === 'escalated' ? 'review' : status === 'resolved' ? 'success' : 'neutral';
  const label =
    status === 'escalated'
      ? 'Needs review'
      : status === 'resolved'
        ? 'Resolved'
        : status === 'in_review'
          ? 'In review'
          : 'Open';
  return <span className={`badge badge--${variant}`}>{label}</span>;
}

export function RunStatePill({ state }: { state: string }) {
  const variant =
    state === 'failed'
      ? 'danger'
      : state === 'escalated'
        ? 'review'
        : state === 'completed'
          ? 'success'
          : 'accent';
  const label = ({ escalated: 'Needs human decision', completed: 'Assessment complete', failed: 'Assessment unavailable' } as Record<string,string>)[state] ?? state.replace(/_/g, ' ');
  return <span className={`badge badge--${variant}`}>{label}</span>;
}

