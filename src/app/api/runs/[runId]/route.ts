import { NextResponse } from 'next/server';
import { getRun } from '@/repositories/runs';
import { listProviderCalls, summarizeProviderCalls } from '@/repositories/providerCalls';
import { getRunSnapshot } from '@/repositories/snapshots';

/**
 * Returns run status, safe events, validated outputs and call telemetry.
 *
 * Raw provider reasoning and secrets are never included. Call telemetry carries
 * only role, stage, request id, latency, reported token counts and errors — a
 * count the provider did not report stays null.
 */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const calls = await listProviderCalls(runId);
  const snapshot = await getRunSnapshot(runId);

  return NextResponse.json({
    run,
    calls,
    callSummary: summarizeProviderCalls(calls),
    snapshot: snapshot
      ? {
          capturedAt: snapshot.capturedAt,
          caseVersion: snapshot.caseVersion,
          policyVersion: snapshot.policyVersion,
          policyHash: snapshot.policyHash,
        }
      : null,
  });
}

