import { NextResponse } from 'next/server';
import { getRun } from '@/repositories/runs';
import { getCase, getCaseVersion, getPolicyPack } from '@/repositories/cases';
import { getRunSnapshot } from '@/repositories/snapshots';
import { listProviderCalls, summarizeProviderCalls } from '@/repositories/providerCalls';
import { formatSingapore } from '@/domain/time';

/**
 * Exports one recorded run.
 *
 * The report is built from the run's frozen snapshot whenever one exists, so an
 * exported historical report never silently describes the case as it looks now.
 * Call telemetry is included without any provider reasoning.
 */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await getRun(runId);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const snapshot = await getRunSnapshot(runId);
  const currentCase = await getCase(run.caseId);
  const caseRecord = snapshot
    ? snapshot.caseRecord
    : (await getCaseVersion(run.caseId, run.caseVersion)) ?? currentCase;
  const pack = snapshot ? snapshot.policyPack : await getPolicyPack(run.policyVersion);
  const calls = await listProviderCalls(runId);

  const report = {
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Singapore (+08:00)',
    notice:
      'This export uses sample ride data. No payment has been made and no account has been penalised.',
    reportBasis: snapshot
      ? 'Frozen run snapshot: the case version, policy pack and findings this run evaluated.'
      : 'No snapshot was recorded for this run (created by an earlier build); the report uses the case version recorded on the run.',
    run: {
      id: run.id,
      mode: run.mode,
      state: run.state,
      provider: run.provider,
      caseVersion: run.caseVersion,
      policyVersion: run.policyVersion,
      promptVersion: run.promptVersion,
      callCount: run.callCount,
      createdAt: formatSingapore(run.createdAt),
      updatedAt: formatSingapore(run.updatedAt),
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
    },
    snapshot: snapshot
      ? {
          capturedAt: formatSingapore(snapshot.capturedAt),
          caseVersion: snapshot.caseVersion,
          policyVersion: snapshot.policyVersion,
          policyHash: snapshot.policyHash,
          inputHash: snapshot.inputHash,
        }
      : null,
    case: caseRecord
      ? {
          id: caseRecord.id,
          version: caseRecord.version,
          category: caseRecord.category,
          currency: caseRecord.currency,
          disputedCents: caseRecord.disputedCents,
          provenance: caseRecord.provenance,
          derivedFrom: caseRecord.derivedFrom,
          changeLog: caseRecord.changeLog,
          policyVersion: caseRecord.policyVersion,
          suppliedPolicyId: caseRecord.suppliedPolicyId,
          evidenceCount: caseRecord.evidence.length,
        }
      : null,
    currentCaseVersion: currentCase?.version ?? null,
    caseEditedSinceRun: Boolean(currentCase && caseRecord && currentCase.version > caseRecord.version),
    deterministicFindings: snapshot?.evaluation.findings ?? null,
    quality: snapshot?.quality ?? null,
    precedents: snapshot?.precedents ?? null,
    visionReceipts: snapshot?.visionReceipts ?? null,
    integrity: run.integrityAssessment ?? null,
    evidence: caseRecord?.evidence ?? [],
    advocates: run.advocates,
    judge: run.judge,
    resolution: run.resolution,
    policyClauses: pack.clauses.map((clause) => ({
      id: clause.id,
      title: clause.title,
      text: clause.text,
    })),
    providerCalls: calls.map((call) => ({
      seq: call.seq,
      role: call.role,
      stage: call.stage,
      requestId: call.requestId,
      latencyMs: call.latencyMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      repair: call.repair,
      ok: call.ok,
      errorCode: call.errorCode,
      errorMessage: call.errorMessage,
      at: formatSingapore(call.at),
    })),
    providerCallSummary: summarizeProviderCalls(calls),
    events: run.events.map((event) => ({
      seq: event.seq,
      at: formatSingapore(event.at),
      actor: event.actor,
      type: event.type,
      summary: event.summary,
    })),
  };

  return new NextResponse(JSON.stringify(report, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="rydr-${run.caseId}-${run.id}.json"`,
    },
  });
}

