import type { ExecutionMode, RunRecord, RunState } from '@/domain/contracts';

/**
 * A run reaches a terminal state once the three-agent pipeline has finished.
 * Anything else is still in flight and should be polled.
 */
const TERMINAL_STATES = new Set<RunState>(['completed', 'escalated', 'failed']);

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isRunInFlight(run: RunRecord): boolean {
  return !TERMINAL_STATES.has(run.state);
}

/**
 * Where a displayed result actually came from. The UI must never present a
 * fixture or a recorded run as if it were a fresh live execution.
 */
export type RunSourceKind = 'live_in_flight' | 'live_saved' | 'fixture' | 'replay';

export function runSourceKind(run: RunRecord): RunSourceKind {
  if (run.mode === 'replay') return 'replay';
  if (run.mode === 'fixture') return 'fixture';
  return isRunInFlight(run) ? 'live_in_flight' : 'live_saved';
}

const SOURCE_LABELS: Record<RunSourceKind, string> = {
  live_in_flight: 'Live run in progress',
  live_saved: 'Saved live result',
  fixture: 'Fixture simulation',
  replay: 'Recorded playback',
};

export function runSourceLabel(run: RunRecord): string {
  return SOURCE_LABELS[runSourceKind(run)];
}

/** Badge tone names already defined in `globals.css`. */
export function runSourceTone(run: RunRecord): 'accent' | 'review' | 'neutral' {
  switch (runSourceKind(run)) {
    case 'live_in_flight':
      return 'accent';
    case 'live_saved':
      return 'accent';
    case 'replay':
      return 'neutral';
    case 'fixture':
      return 'review';
  }
}

/**
 * True when the run on screen is not the result of the execution the visitor
 * asked for — e.g. they requested a live run but only a fixture exists. In that
 * case the page must keep a fresh-run action visible.
 */
export function needsFreshRun(options: {
  requestedMode: ExecutionMode;
  run: RunRecord | null;
}): boolean {
  const { requestedMode, run } = options;
  if (!run) return true;
  return run.mode !== requestedMode;
}

export function describeRunOrigin(run: RunRecord): string {
  const when = new Date(run.updatedAt).toISOString().replace('T', ' ').slice(0, 16);
  return `${runSourceLabel(run)} · case v${run.caseVersion} · policy ${run.policyVersion} · ${when} UTC`;
}
