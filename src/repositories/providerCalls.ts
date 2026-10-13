import path from 'node:path';
import {
  ProviderCallRecordSchema,
  type AgentRoleName,
  type ProviderCallRecord,
} from '../domain/contracts';
import { readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';

/**
 * Provider call telemetry.
 *
 * Stores what the provider actually reported: role, stage, request id, latency,
 * token usage and the error when a call failed. Provider hidden reasoning is
 * deliberately never persisted, and a token count the provider did not report
 * stays `null` rather than being estimated from text length.
 */

const CALLS_DIR = path.join(RUNTIME_DIR, 'provider-calls');

function callsFile(runId: string): string {
  return path.join(CALLS_DIR, `${runId}.json`);
}

export async function listProviderCalls(runId: string): Promise<ProviderCallRecord[]> {
  const raw = await readJson<unknown[]>(callsFile(runId));
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => ProviderCallRecordSchema.safeParse(entry))
    .filter((result) => result.success)
    .map((result) => result.data);
}

export interface RecordProviderCallInput {
  runId: string;
  role: AgentRoleName;
  stage: string;
  requestId?: string | null;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  repair: boolean;
  ok: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function recordProviderCall(
  input: RecordProviderCallInput,
): Promise<ProviderCallRecord> {
  return withLock(`provider-calls:${input.runId}`, async () => {
    const existing = await listProviderCalls(input.runId);
    const record = ProviderCallRecordSchema.parse({
      runId: input.runId,
      seq: existing.length,
      role: input.role,
      stage: input.stage,
      requestId: input.requestId ?? null,
      latencyMs: input.latencyMs,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      repair: input.repair,
      ok: input.ok,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      at: new Date().toISOString(),
    });
    await writeJsonAtomic(callsFile(input.runId), [...existing, record]);
    return record;
  });
}

export interface CallTelemetrySummary {
  totalCalls: number;
  repairCalls: number;
  failedCalls: number;
  /** Sum of reported tokens only; null when no call reported usage. */
  reportedInputTokens: number | null;
  reportedOutputTokens: number | null;
  /** True when at least one call did not report usage, so totals are partial. */
  usageIncomplete: boolean;
  totalLatencyMs: number;
  byRole: Record<AgentRoleName, { calls: number; latencyMs: number }>;
}

/** Rolls call records up for the run monitor. Never invents missing usage. */
export function summarizeProviderCalls(calls: ProviderCallRecord[]): CallTelemetrySummary {
  const byRole: CallTelemetrySummary['byRole'] = {
    rider: { calls: 0, latencyMs: 0 },
    driver: { calls: 0, latencyMs: 0 },
    judge: { calls: 0, latencyMs: 0 },
    navigator: { calls: 0, latencyMs: 0 },
    vision: { calls: 0, latencyMs: 0 },
  };

  let reportedInputTokens = 0;
  let reportedOutputTokens = 0;
  let anyInputReported = false;
  let anyOutputReported = false;
  let usageIncomplete = false;
  let totalLatencyMs = 0;

  for (const call of calls) {
    byRole[call.role].calls += 1;
    byRole[call.role].latencyMs += call.latencyMs;
    totalLatencyMs += call.latencyMs;

    if (call.inputTokens === null) usageIncomplete = true;
    else {
      reportedInputTokens += call.inputTokens;
      anyInputReported = true;
    }
    if (call.outputTokens === null) usageIncomplete = true;
    else {
      reportedOutputTokens += call.outputTokens;
      anyOutputReported = true;
    }
  }

  return {
    totalCalls: calls.length,
    repairCalls: calls.filter((call) => call.repair).length,
    failedCalls: calls.filter((call) => !call.ok).length,
    reportedInputTokens: anyInputReported ? reportedInputTokens : null,
    reportedOutputTokens: anyOutputReported ? reportedOutputTokens : null,
    usageIncomplete,
    totalLatencyMs,
    byRole,
  };
}
