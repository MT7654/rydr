import { redirect } from 'next/navigation';
import { getCase } from '@/repositories/cases';
import { selectRunForCase } from '@/repositories/runs';
import { isOpenTask, listReviewTasksForCase } from '@/repositories/reviewTasks';
import { primaryReviewTask } from '@/domain/navigation';

/**
 * Resolution view is now integrated into the case detail page.
 * Redirect to the unified case view, preserving the selected run so a
 * historical decision keeps pointing at the run that produced it.
 */
export default async function ResolutionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { id } = await params;
  const { run } = await searchParams;
  const caseRecord = await getCase(id);
  if (!caseRecord) {
    return (
      <main className="container">
        <h1>Case not found</h1>
        <p className="small muted">The requested case does not exist.</p>
      </main>
    );
  }
  const selection = await selectRunForCase(id, { runId: run });
  const task = primaryReviewTask((await listReviewTasksForCase(id)).filter(isOpenTask));
  if (task && (!run || task.runId === run || selection.run?.resolution?.disposition === 'human_review')) redirect(`/reviews/${task.id}`);
  redirect(run ? `/cases/${id}?run=${run}#recommendation` : `/cases/${id}#recommendation`);
}

