import type { ReactNode } from 'react';

/**
 * A canonical citation reference.
 *
 * Renders the real id, never an alias, and marks it so the citation drawer picks
 * up the click. It is a real button, so it is keyboard reachable and announces
 * itself as an action rather than looking like inert text.
 */
export function Cite({
  kind,
  id,
  children,
  className,
}: {
  kind: 'evidence' | 'policy';
  id: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ? `cite ${className}` : 'cite'}
      data-cite={`${kind}:${id}`}
      title={kind === 'evidence' ? `Show evidence ${id}` : `Show policy ${id}`}
    >
      {children ?? id}
    </button>
  );
}

/** A run of citations separated by a comma, with no alias indirection. */
export function CiteList({
  kind,
  ids,
  empty = 'none',
}: {
  kind: 'evidence' | 'policy';
  ids: string[];
  empty?: string;
}) {
  if (ids.length === 0) return <span className="muted">{empty}</span>;
  return (
    <>
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 ? ', ' : ''}
          <Cite kind={kind} id={id} />
        </span>
      ))}
    </>
  );
}

