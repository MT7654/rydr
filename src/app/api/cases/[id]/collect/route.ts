import { NextResponse } from 'next/server';
import { collectForCase } from '@/agents/collector';
import { latestCollectionJob } from '@/repositories/collectionJobs';
import { getCase } from '@/repositories/cases';

/**
 * Runs one bounded evidence-collection cycle for a case.
 *
 * Collection is deliberately its own step, separate from starting a run: a
 * reviewer can see *what Rydr went and looked for* and *what came back* before
 * any model is invoked. It is idempotent — the same case version reuses the job
 * it already produced, so a double click never spends a second cycle.
 *
 * `GET` returns the most recent job without running one, which is what the case
 * page uses to render the trace.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const caseRecord = await getCase(id);
  if (!caseRecord) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  try {
    const job = await collectForCase(id);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    // A collection failure is surfaced rather than swallowed: the honest
    // outcome is "we could not look", not a silently adjudicated case.
    return NextResponse.json(
      {
        error: 'collection_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const caseRecord = await getCase(id);
  if (!caseRecord) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }
  return NextResponse.json({ job: await latestCollectionJob(id) });
}

