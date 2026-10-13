import type { EvidenceItem } from '@/domain/contracts';
import { formatSingapore } from '@/domain/time';

/**
 * Every evidence item shows its stable ID, source dataset, original JSON pointer
 * and provenance. A citation click reveals this source, never a paraphrase.
 */
export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) {
    return (
      <p className="muted small">
        No evidence of this kind is recorded for this case. Nothing is inferred to fill the gap.
      </p>
    );
  }

  return (
    <div className="evidence">
      {items.map((item) => (
        <article
          key={item.id}
          className="evidence__item"
          id={`evidence-${item.id}`}
          tabIndex={-1}
        >
          <div className="evidence__head">
            <span className="evidence__id">{item.id}</span>
            <span className="badge badge--neutral">{item.kind}</span>
          </div>
          <EvidenceText item={item} />
          <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
            {item.timestamp ? formatSingapore(item.timestamp) : 'No timestamp'} ·{' '}
            <span className="mono">{item.source.dataset}</span> ·{' '}
            <span className="mono">{item.source.jsonPointer}</span> ·{' '}
            {item.source.provenance === 'supplied_sample' ? 'supplied sample' : 'synthetic'}
          </p>
          {item.qualityIssues.map((issue) => (
            <p key={issue} className="evidence__issue">
              {issue}
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}

function EvidenceText({ item }: { item: EvidenceItem }) {
  switch (item.kind) {
    case 'gps':
      return (
        <p className="evidence__summary">
          GPS sample: status {item.payload.status}, coordinates {item.payload.lat.toFixed(4)},{' '}
          {item.payload.lng.toFixed(4)}, accuracy{' '}
          {item.payload.accuracyMeters === null ? 'not reported' : `${item.payload.accuracyMeters} m`}
          .
        </p>
      );
    case 'chat':
      return (
        <p className="evidence__summary">
          {item.payload.sender === 'rider' ? 'Rider' : item.payload.sender === 'driver' ? 'Driver' : 'System'}
          : “{item.payload.content}”
        </p>
      );
    case 'call':
      return (
        <p className="evidence__summary">
          {item.payload.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} call from{' '}
          {item.payload.sender}: answered{' '}
          {item.payload.answered === null ? 'unknown' : String(item.payload.answered)}
          {item.payload.ringSeconds !== null ? `, rang ${item.payload.ringSeconds}s` : ''}. “
          {item.payload.content}”
        </p>
      );
    case 'trip_event':
      return (
        <p className="evidence__summary">
          <strong>{item.payload.eventType}</strong> — {item.payload.details}
        </p>
      );
    case 'payment':
      return (
        <p className="evidence__summary">
          {item.payload.component}: {item.payload.amountCents} cents ({item.payload.direction},{' '}
          {item.payload.status}) via {item.payload.method}.
        </p>
      );
    case 'route':
      return (
        <p className="evidence__summary">
          Planned {item.payload.plannedDistanceM ?? '—'} m, actual{' '}
          {item.payload.actualDistanceM ?? '—'} m, justification{' '}
          <strong>{item.payload.justification.replace(/_/g, ' ')}</strong>.{' '}
          {item.payload.justificationNote ?? ''}
        </p>
      );
    case 'fare':
      return <p className="evidence__summary">Quote S${(item.payload.quotedCents/100).toFixed(2)} at {item.payload.quoteMultiplier}×; charged S${(item.payload.chargedCents/100).toFixed(2)} at {item.payload.startMultiplier}×. Pre-pickup notification: {item.payload.notifiedBeforePickup === null ? 'unknown' : item.payload.notifiedBeforePickup ? 'sent' : 'not sent'}. Fixed fee S${(item.payload.fixedFeeCents/100).toFixed(2)} remains outside surge.</p>;
    case 'history':
      return (
        <p className="evidence__summary">
          {item.payload.subject === 'rider' ? 'Rider' : 'Driver'} account history: rating{' '}
          {item.payload.avgRating ?? '—'}, trips {item.payload.totalTrips ?? '—'}, disputes{' '}
          {item.payload.disputeCount ?? '—'}, risk flags {item.payload.fraudFlags ?? '—'}.
        </p>
      );
  }
}

