'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AdvocateOutput, ProviderCallRecord, RunRecord, Finding } from '@/domain/contracts';
import type { CallTelemetrySummary } from '@/repositories/providerCalls';
import { RunStatePill } from './Badges';


import { formatSgd } from '@/domain/money';
import { advocateHeadline } from '@/agents/explanation';

import { runSourceLabel } from '@/lib/runPresentation';
import { AgentComparison } from './AgentComparison';
import { InspectButton } from './InspectButton';

const TERMINAL = new Set(['completed', 'escalated', 'failed']);

/**
 * Polls only while a run is active and stops at a terminal state. Live reasoning
 * is shown only as final bounded output, never as a token stream.
 */
export function RunMonitor({
  caseId,
  runId,
  initialRun,
  findings = [],
  initialCalls = [],
  initialCallSummary = null,
  historical = false,
  comparison = true,
}: {
  caseId: string;
  runId: string;
  initialRun: RunRecord;
  findings?: Finding[];
  initialCalls?: ProviderCallRecord[];
  initialCallSummary?: CallTelemetrySummary | null;
  historical?: boolean;
  comparison?: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunRecord>(initialRun);
  const [calls, setCalls] = useState<ProviderCallRecord[]>(initialCalls);
  const [callSummary, setCallSummary] = useState<CallTelemetrySummary | null>(initialCallSummary);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (TERMINAL.has(initialRun.state)) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const payload = (await response.json()) as {
          run: RunRecord;
          calls?: ProviderCallRecord[];
          callSummary?: CallTelemetrySummary;
        };
        if (cancelled) return;
        setRun(payload.run);
        if (payload.calls) setCalls(payload.calls);
        if (payload.callSummary) setCallSummary(payload.callSummary);
        if (TERMINAL.has(payload.run.state)) { clearInterval(timer); router.refresh(); }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Polling failed');
          clearInterval(timer);
        }
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, initialRun.state, router]);

  const active = !TERMINAL.has(run.state);

  return (
    <div className="stack">
      <div className="card">
        <div className="card__title">
          <h2>Investigation</h2>
          <div className="row">
            <RunStatePill state={run.state} />
            <span className="badge badge--neutral">{runSourceLabel(run)}</span>


          </div>
        </div>
        <details className="audit-disclosure"><summary>Assessment version details</summary><p className="small muted" style={{ margin: 0 }}>
          Provider {run.provider} · {run.callCount} calls · Run <span className="mono">{run.id}</span> · case version {run.caseVersion} · policy{' '}
          {run.policyVersion} · prompts {run.promptVersion}
        </p></details>
        {active ? (
          <p className="small muted" style={{ margin: '0.4rem 0 0' }} aria-live="polite">
            Working: {run.state.replace(/_/g, ' ')}…
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="notice notice--danger" role="alert">
          Lost connection to the run: {error}. Reload to see the latest recorded state.
        </div>
      ) : null}

      {run.state === 'failed' ? (
        <div className="notice notice--danger" role="alert">
          <strong>Review unavailable.</strong>
          <div>
            {run.errorCode}: {run.errorMessage}
          </div>
          <p style={{ marginTop: '0.4rem' }}>
            No fixture output was substituted. You can retry within the call budget or route this case
            to a human reviewer.
          </p>
          <Link href={`/cases/${caseId}`} className="btn">
            Back to case
          </Link>
        </div>
      ) : null}

      <div className="assessment-team" role="region" aria-label="Assessment team">
        <AdvocatePanel side="rider" advocate={run.advocates.rider} state={run.state} />
        <AdvocatePanel side="driver" advocate={run.advocates.driver} state={run.state} />
        <JudgePanel run={run} />
      </div>
      {comparison?<AgentComparison findings={findings} rider={run.advocates.rider} driver={run.advocates.driver} judge={run.judge}/>:null}

      <details className="card audit-disclosure"><summary>Technical audit · provider calls & execution events</summary>
      {calls.length > 0 ? <CallLedger calls={calls} summary={callSummary} /> : null}

      <div className="card">
        <h3>Execution events</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          {run.events.map((event) => (
            <li key={event.seq}>
              <span className="mono muted">{event.actor}</span> · {event.type} — {event.summary}
            </li>
          ))}
        </ol>
      </div>

      </details>
      {comparison && !historical && (run.state === 'completed' || run.state === 'escalated') ? (
        <div className="row">
          <Link href={`/cases/${caseId}?section=${run.resolution?.disposition === 'human_review' || run.state === 'escalated' ? 'decision' : 'outcome'}`} className="btn btn--primary">
            {run.resolution?.disposition === 'human_review' || run.state === 'escalated' ? 'Continue to human review' : 'Review resolution'}
          </Link>
          <Link href={`/api/runs/${run.id}/export`} className="btn">
            Export JSON case report
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function AdvocatePanel({
  side,
  advocate,
  state,
}: {
  side: 'rider' | 'driver';
  advocate: AdvocateOutput | null;
  state: string;
}) {
  const submitted = advocate !== null;
  return <section className="assessment-lane" aria-label={side+' advocate'}><h3>{side==='rider'?'Rider advocate':'Driver advocate'}</h3><p className="small">{submitted?'Completed':state==='failed'?'Unavailable':state==='judging'?'Waiting for validated output':'Working / waiting'}</p>{advocate?<><p className="small muted">{advocateHeadline(advocate)}</p><InspectButton detail={{title:side==='rider'?'Rider advocate assessment':'Driver advocate assessment',text:advocate.summary,evidenceIds:advocate.evidenceIds,notes:advocate.uncertainties}}>Full assessment</InspectButton></>:<p className="small muted">Waiting for a validated advocate case.</p>}</section>;
}

function JudgePanel({ run }: { run: RunRecord }) {
  const judge = run.judge;
  return <section className="assessment-lane" aria-label="judge"><h3>Judge</h3><p className="small">{judge?'Completed':run.state==='failed'?'Unavailable':run.state==='judging'?'Evaluating':'Waiting for advocates'}</p>{judge?<><p className="small muted">{judge.disposition==='human_review'?'Human decision needed · no amount awarded':judge.disposition.replaceAll('_',' ')+(judge.recommendedRefundCents===null?'':' · '+formatSgd(judge.recommendedRefundCents))}</p><InspectButton detail={{title:'Judge assessment',text:judge.reasoningSummary,evidenceIds:judge.materialEvidenceIds,policyIds:judge.policyIds,notes:judge.missingEvidence}}>Full assessment</InspectButton></>:<p className="small muted">Begins after both advocates are validated.</p>}</section>;
}

/**
 * Call ledger. Shows only what the provider actually reported: no hidden
 * reasoning, and a token count that was not reported stays visibly unknown
 * rather than being estimated.
 */
function CallLedger({
  calls,
  summary,
}: {
  calls: ProviderCallRecord[];
  summary: CallTelemetrySummary | null;
}) {
  const tokens =
    summary === null || summary.reportedInputTokens === null
      ? 'not reported by provider'
      : `${summary.reportedInputTokens} in / ${summary.reportedOutputTokens ?? 0} out${
          summary.usageIncomplete ? ' (partial — some calls reported no usage)' : ''
        }`;

  return (
    <div className="card">
      <div className="card__title">
        <h3>Provider calls</h3>
        <span className="small muted">
          {summary ? `${summary.totalCalls} call(s) · ${Math.round(summary.totalLatencyMs)} ms` : ''}
        </span>
      </div>
      <p className="small muted" style={{ margin: '0 0 0.6rem' }}>
        Tokens: {tokens}. Provider reasoning content is never stored.
      </p>
      {summary && (summary.repairCalls > 0 || summary.failedCalls > 0) ? (
        <p className="small muted" style={{ margin: '0 0 0.6rem' }}>
          {summary.repairCalls} bounded repair call(s), {summary.failedCalls} failed call(s).
        </p>
      ) : null}
      <table className="case-table">
        <caption className="sr-only">Provider calls recorded for this run</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Role</th>
            <th scope="col">Stage</th>
            <th scope="col">Latency</th>
            <th scope="col">Tokens (reported)</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.seq}>
              <td className="mono small">{call.seq + 1}</td>
              <td>{call.role}</td>
              <td>
                {call.stage.replace(/_/g, ' ')}
                {call.repair ? <span className="badge badge--review">repair</span> : null}
              </td>
              <td className="mono small">{Math.round(call.latencyMs)} ms</td>
              <td className="mono small">
                {call.inputTokens === null && call.outputTokens === null
                  ? '—'
                  : `${call.inputTokens ?? '?'} / ${call.outputTokens ?? '?'}`}
              </td>
              <td>
                {call.ok ? (
                  <span className="badge badge--neutral">ok</span>
                ) : (
                  <span className="badge badge--danger" title={call.errorMessage ?? undefined}>
                    {call.errorCode ?? 'error'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
