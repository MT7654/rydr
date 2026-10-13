export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="skeleton"
          style={{ marginBottom: '0.5rem', width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  illustration,
}: {
  title: string;
  body: string;
  illustration?: { src: string; alt: string };
}) {
  if (illustration) {
    return (
      <div className="empty-state">
        <img className="empty-state__art" src={illustration.src} alt={illustration.alt} />
        <div className="empty-state__copy">
          <h3>{title}</h3>
          <p className="muted small">{body}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted small">{body}</p>
    </div>
  );
}

/**
 * Errors are always shown. A skeleton must never conceal a failure.
 */
export function ErrorState({ title, detail }: { title: string; detail?: string | null }) {
  return (
    <div className="notice notice--danger" role="alert">
      <strong>{title}</strong>
      {detail ? <div className="small">{detail}</div> : null}
    </div>
  );
}

export function MissingValue({ label }: { label: string }) {
  return (
    <p className="muted small">
      <em>{label}</em>
    </p>
  );
}

