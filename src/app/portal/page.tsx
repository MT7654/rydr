import { redirect } from 'next/navigation';
import { requirePartyRole, getSelectedCaseId } from '@/lib/demoSession';

/**
 * Legacy party portal.
 *
 * Resolves to My rides, preserving a valid explicit selection or the session's
 * remembered case. The workspace applies the same selection priority, so an
 * invalid id falls back without revealing whether an inaccessible case exists.
 */
export default async function PartyPortalRedirect({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  await requirePartyRole();
  const { case: caseParam } = await searchParams;
  const explicit = caseParam && /^[A-Za-z0-9_-]{1,80}$/.test(caseParam) ? caseParam : null;
  const selected = explicit ?? (await getSelectedCaseId());
  redirect(selected ? `/rides?case=${encodeURIComponent(selected)}` : '/rides');
}
