import { notFound, redirect } from 'next/navigation';
import { requireReviewerRole } from '@/lib/demoSession';
import { getReviewTask } from '@/repositories/reviewTasks';

/**
 * Legacy task entry.
 *
 * Resolves the task server-side, verifies reviewer access, then opens that case
 * with the task selected. An unknown task produces a not-found state rather than
 * silently opening a different case.
 */
export default async function ReviewTaskRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireReviewerRole();
  const { taskId } = await params;
  const { notice, error } = await searchParams;

  const task = await getReviewTask(taskId);
  if (!task) notFound();

  const query = new URLSearchParams({ task: task.id, section: notice?.startsWith('Re-review started')?'assessment':'decision' });
  if (notice) query.set('notice', notice);
  if (error) query.set('error', error);
  redirect(`/cases/${task.caseId}?${query.toString()}`);
}
