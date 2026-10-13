import type {
  AdvocateOutput,
  JudgeOutput,
} from '../domain/contracts';

export type AgentRole = 'rider' | 'driver' | 'judge' | 'navigator' | 'vision';
export type AgentStage = 'select_evidence' | 'build_case' | 'judge' | 'navigate' | 'analyze_image';

export interface ProviderCapabilities {
  nativeTools: boolean;
  strictJson: boolean;
  parallelCalls: boolean;
}

export interface AgentInvocation {
  role: AgentRole;
  stage: AgentStage;
  runId: string;
  systemInstruction: string;
  input: unknown;
  allowedEvidenceIds: string[];
  timeoutMs: number;
  maxOutputTokens: number;
  imageUrls?:string[];
}

export interface AgentResult {
  output: unknown;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  /**
   * Whether invocations consume the shared external session budget.
   * Fixture mode makes no external calls.
   */
  readonly external: boolean;
  invoke(request: AgentInvocation): Promise<AgentResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'timeout'
      | 'invalid_output'
      | 'transport'
      | 'cap_exhausted'
      | 'unavailable',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type AdvocateSelection = { evidenceIds: string[]; reasonSummary: string };

export function isAdvocateSelection(value: unknown): value is AdvocateSelection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.evidenceIds) &&
    candidate.evidenceIds.every((id) => typeof id === 'string') &&
    typeof candidate.reasonSummary === 'string'
  );
}

export function parseAdvocateOutput(value: unknown): AdvocateOutput | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as AdvocateOutput;
}

export function parseJudgeOutput(value: unknown): JudgeOutput | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as JudgeOutput;
}
