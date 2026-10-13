import type { ExecutionMode } from '../domain/contracts';
import type { OrchestratorConfig } from '../agents/orchestrator';
import { DEFAULT_CONFIG } from '../agents/orchestrator';
import { createFixtureProvider } from '../providers/fixture';
import { createAdpProvider } from '../providers/adp';

function adpCredentialsPresent(): boolean {
  return Boolean(
    process.env.RYDR_ADP_ENDPOINT &&
      process.env.RYDR_ADP_RIDER_APPKEY &&
      process.env.RYDR_ADP_DRIVER_APPKEY &&
      process.env.RYDR_ADP_JUDGE_APPKEY,
  );
}

export const PROVIDER_STATUS = {
  fixture: 'available',
  adp: adpCredentialsPresent() ? 'available' : 'blocked_no_credentials',
  cloud: 'not_implemented',
} as const;

export function agentMode(): ExecutionMode {
  const raw = (process.env.RYDR_AGENT_MODE ?? 'fixture').toLowerCase();
  return raw === 'live' || raw === 'replay' ? raw : 'fixture';
}

export function selectedProvider(): string {
  return (process.env.RYDR_AGENT_PROVIDER ?? 'adp').toLowerCase();
}

export class LiveProviderUnavailableError extends Error {
  constructor(provider: string, detail?: string) {
    super(
      `Live mode is not configured. Provider "${provider}" is unavailable (${PROVIDER_STATUS[provider as keyof typeof PROVIDER_STATUS] ?? 'unknown'}).${detail ? ` ${detail}` : ''} No fixture output was substituted.`,
    );
    this.name = 'LiveProviderUnavailableError';
  }
}

export function orchestratorConfig(mode: ExecutionMode = agentMode()): OrchestratorConfig {
  const maxCallsPerRun = Number(process.env.RYDR_MAX_CALLS_PER_RUN ?? DEFAULT_CONFIG.maxCallsPerRun);
  const maxCallsPerSession = Number(
    process.env.RYDR_MAX_CALLS_PER_SESSION ?? DEFAULT_CONFIG.maxCallsPerSession,
  );

  if (mode === 'live') {
    const provider = selectedProvider();
    if (provider === 'adp') {
      const endpoint = process.env.RYDR_ADP_ENDPOINT;
      if (!endpoint || !adpCredentialsPresent()) {
        throw new LiveProviderUnavailableError(
          provider,
          'ADP endpoint or AppKeys are missing. Set RYDR_ADP_ENDPOINT and all three RYDR_ADP_*_APPKEY variables.',
        );
      }
      return {
        ...DEFAULT_CONFIG,
        localEvidenceSelection: process.env.RYDR_EVIDENCE_SELECTION !== 'model',
        maxCallsPerRun: Number.isFinite(maxCallsPerRun) ? maxCallsPerRun : DEFAULT_CONFIG.maxCallsPerRun,
        maxCallsPerSession: Number.isFinite(maxCallsPerSession)
          ? maxCallsPerSession
          : DEFAULT_CONFIG.maxCallsPerSession,
        provider: createAdpProvider(endpoint),
      };
    }
    throw new LiveProviderUnavailableError(provider);
  }

  return {
    ...DEFAULT_CONFIG,
    localEvidenceSelection: process.env.RYDR_EVIDENCE_SELECTION !== 'model',
    maxCallsPerRun: Number.isFinite(maxCallsPerRun) ? maxCallsPerRun : DEFAULT_CONFIG.maxCallsPerRun,
    maxCallsPerSession: Number.isFinite(maxCallsPerSession)
      ? maxCallsPerSession
      : DEFAULT_CONFIG.maxCallsPerSession,
    provider: createFixtureProvider(),
  };
}

export function healthSnapshot() {
  const adpReady = adpCredentialsPresent();
  return {
    mode: agentMode(),
    provider: selectedProvider(),
    providerStatus: PROVIDER_STATUS[selectedProvider() as keyof typeof PROVIDER_STATUS] ?? 'unknown',
    fixtureAvailable: true,
    liveAvailable: adpReady,
    liveBlocker: adpReady
      ? undefined
      : 'ADP endpoint or AppKeys are missing. Set RYDR_ADP_ENDPOINT and all three RYDR_ADP_*_APPKEY variables.',
    maxCallsPerRun: DEFAULT_CONFIG.maxCallsPerRun,
    maxCallsPerSession: DEFAULT_CONFIG.maxCallsPerSession,
  };
}
