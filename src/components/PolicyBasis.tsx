import Link from 'next/link';
import type { PolicyPack } from '@/domain/contracts';
export function PolicyBasis({ pack, suppliedSample = false }: { pack: PolicyPack; suppliedSample?: boolean }) {
  const official = pack.source === 'ryde_official';
  return <aside className="policy-basis" aria-label="Policy basis">
    <div><span className={`badge badge--${official ? 'success' : 'neutral'}`}>{official ? 'Ryde public policy' : 'Rydr example rules'}</span> <Link href={`/policies#${pack.id}`}>Policy &amp; sources →</Link></div>
    <p className="small">{official ? `${pack.label}. Sources checked ${pack.retrievedAt}; GPS and evidence-quality checks are Rydr safeguards.` : suppliedSample ? 'This supplied case keeps its sample rules and unresolved policy questions. Current website rules do not replace its history.' : 'This example uses Rydr example rules, separate from examples applying published Ryde policies.'}</p>
  </aside>;
}

