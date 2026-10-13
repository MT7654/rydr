import { redirect } from 'next/navigation';
import { requireReviewerRole } from '@/lib/demoSession';

/** Legacy filter → Worklist filter. Unsupported filters fall back to All. */
const FILTER_MAP: Record<string, string> = {
  evidence: 'waiting_evidence',
  ready: 'needs_decision',
  appeals: 'appeals',
};

/**
 * Legacy review queue.
 *
 * Resolves to Worklist, mapping the filters that have a Worklist equivalent.
 * Lanes (safety) and ownership (mine/unassigned) are properties of the case row
 * inside Worklist, not separate lists, so they map to All.
 */
export default async function ReviewQueueRedirect({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireReviewerRole();
  const { filter } = await searchParams;
  const mapped = filter ? FILTER_MAP[filter] : undefined;
  redirect(mapped ? `/worklist?filter=${mapped}` : '/worklist');
}
