import { NextResponse } from 'next/server';
import { beginRun } from '@/agents/orchestrator';
import { collectForCase } from '@/agents/collector';
import { orchestratorConfig, LiveProviderUnavailableError } from '@/lib/runtime';
import { getCase } from '@/repositories/cases';
import type { ExecutionMode } from '@/domain/contracts';
import type { CollectionJob } from '@/domain/collection';

/**
 * Starts a run and returns its persisted id immediately. Execution continues in
 * a bounded background worker so the monitor can observe real progress instead
 * of waiting for the whole pipeline. A duplicate request resolves to the same
 * run; pass an explicit `idempotencyKey` to deliberately start a new execution.
 *
 * Evidence collection runs first, so the three-agent pipeline is always frozen
 * against one settled case version. A `replay` must reproduce a recorded run
 * exactly, so it never collects.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let body: { mode?: string; idempotencyKey?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const mode: ExecutionMode =
    body.mode === 'live' || body.mode === 'replay' ? body.mode : 'fixture';

  const caseRecord = await getCase(id);
  if (!caseRecord) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  // Collect before the run exists. A failure here is reported as such: the run
  // is not started against a case whose collection silently did not happen.
  let collection: CollectionJob | null = null;
  if (mode !== 'replay') {
    try {
      collection = await collectForCase(id);
    } catch (error) {
      return NextResponse.json(
        {
          error: 'collection_failed',
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  }

  try {
    const config = orchestratorConfig(mode);
    const run = await beginRun(id, mode, config, body.idempotencyKey);
    // A failed run is returned as-is; the monitor shows the recorded failure.
    return NextResponse.json(
      { run, collection },
      { status: run.state === 'failed' ? 422 : 201 },
    );
  } catch (error) {
    if (error instanceof LiveProviderUnavailableError) {
      return NextResponse.json(
        { error: 'live_unavailable', message: error.message },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'run_failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

