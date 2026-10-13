'use client';
import { useState,useRef,useContext } from 'react';
import { useRouter } from 'next/navigation';
import { DraftScope } from './workspace/DraftForm';
import { ActionTargetSchema } from '@/domain/journeys';
import { Cite } from './Cite';
import Link from 'next/link';
import type { NavigatorAction, NavigatorOutput } from '@/domain/journeys';

export interface NavigatorRequestDraft {
  actionId: string;
  recipient: 'rider' | 'driver' | 'platform';
  question: string;
  whyItMatters: string;
  evidenceType: string;
}

interface NavigatorResult {
  output: NavigatorOutput & { requestDraft?: NavigatorRequestDraft | null };
  action: NavigatorAction | null;
  latencyMs: number;
}

/**
 * Case Navigator — optional assistance embedded in the action rail.
 *
 * It proposes a bounded action and, where the selected action supports a request
 * form, an editable draft. Nothing is sent: the user edits and submits the form
 * themselves. Deterministic controls stay usable when live assistance is not
 * configured or fails.
 */
export function NavigatorPanel({
  target,
  caseId,
  ready,
  prompts = [],
  /** Prefill target for a drafted request, resolved server-side. */
  taskId,runId,caseVersion,taskRevision,
}: {
  target: 'pickup' | 'case' | 'payments';
  caseId?: string;
  ready: boolean;
  prompts?: string[];

  taskId?:string;runId?:string;caseVersion?:number;taskRevision?:number;
}) {
  const router=useRouter();const scope=useContext(DraftScope);const inFlight=useRef(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<NavigatorResult | null>(null);
  const [draft, setDraft] = useState<NavigatorRequestDraft | null>(null);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [draftWhy, setDraftWhy] = useState('');

  async function ask(value: string) {
    if(inFlight.current)return;inFlight.current=true;
    setBusy(true);
    setError('');
    setResult(null);
    setDraft(null);
    try {
      const response = await fetch('/api/navigator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, caseId,taskId,runId,caseVersion,taskRevision, question: value, requestKey: crypto.randomUUID() }),
      });
      const data = (await response.json()) as NavigatorResult & { message?: string };
      if (!response.ok) throw new Error(data.message ?? 'Assistance failed.');
      setResult(data);
      const returned = data.output.requestDraft ?? null;
      if (returned) {
        setDraft(returned);
        setDraftQuestion(returned.question);
        setDraftWhy(returned.whyItMatters);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistance failed.');
    } finally {
      inFlight.current=false;setBusy(false);
    }
  }

  function openDraft(){if(!result?.action||!draft||!taskId||!scope)return;
    sessionStorage.setItem('rydr-draft:'+scope+':'+taskId+':request',JSON.stringify({question:[draftQuestion],whyItMatters:[draftWhy],recipient:[draft.recipient],evidenceType:[draft.evidenceType]}));
    router.push(result.action.href);router.refresh();
  }
  const destination=ActionTargetSchema.safeParse(result?.action?.target);
  const cite=destination.success&&destination.data.kind==='source'?{kind:'evidence' as const,id:destination.data.evidenceId}:destination.success&&destination.data.kind==='policy'?{kind:'policy' as const,id:destination.data.policyId}:null;
  return (
    <section className="card navigator-panel" aria-labelledby="navigator-heading">
      <div className="card__title">
        <h2 id="navigator-heading">Case Navigator</h2>
        <span className="badge badge--neutral">{ready ? 'Live AI available' : 'Assistance unavailable'}</span>
      </div>
      <p className="small muted">
        Ask about this case or prepare your next step. This is optional assistance — it never
        submits a decision, evidence or payment.
      </p>

      {prompts.length > 0 ? (
        <div className="navigator-prompts" role="group" aria-label="Suggested questions">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="filter"
              disabled={busy || !ready}
              onClick={() => {
                setQuestion(prompt);
                void ask(prompt);
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label className="small" htmlFor={`concern-${target}`}>
          What would you like help with?
        </label>
        <textarea
          id={`concern-${target}`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          minLength={3}
          maxLength={1500}
          required
          rows={2}
          placeholder={
            target === 'pickup'
              ? 'I am at a different entrance…'
              : target === 'payments'
                ? 'What happens while recovery is pending?'
                : 'The arrival record seems wrong…'
          }
        />
        <button className="btn btn--secondary" disabled={busy || !ready}>
          {busy ? 'Reading your concern…' : 'Ask Case Navigator'}
        </button>
      </form>

      <div aria-live="polite">
        {error ? <p className="notice notice--danger">{error}</p> : null}
        {result ? (
          <div className="navigator-response">
            <span className="badge badge--success">Live AI response · Tencent Cloud ADP</span>
            <p>{result.output.message}</p><div>{result.output.evidenceIds.map(id=><Cite key={id} kind="evidence" id={id}/>)}{result.output.policyIds.map(id=><Cite key={id} kind="policy" id={id}/>)}</div>
            {result.output.clarificationQuestion ? (
              <p>
                <strong>{result.output.clarificationQuestion}</strong>
              </p>
            ) : null}
            {result.action && !draft && cite ? <Cite kind={cite.kind} id={cite.id}>{result.action.label}</Cite> : result.action && !draft ? (
              <Link className="btn btn--primary" href={result.action.href}>
                {result.action.label}
              </Link>
            ) : null}

            {draft ? (
              <div className="navigator-draft">
                <h3>Drafted request — review before sending</h3>
                <p className="small muted">
                  The Navigator prepared this draft. Nothing has been sent. Edit it, then open the
                  request form to submit it yourself.
                </p>
                <p className="small">
                  <strong>Recipient:</strong> {draft.recipient} · <strong>Evidence type:</strong>{' '}
                  {draft.evidenceType}
                </p>
                <label className="field">
                  <span className="field__label">Question</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={500}
                    value={draftQuestion}
                    onChange={(event) => setDraftQuestion(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Why it matters</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={350}
                    value={draftWhy}
                    onChange={(event) => setDraftWhy(event.target.value)}
                  />
                </label>
                <button type="button" className="btn btn--primary btn--sm" onClick={openDraft}>Open the request form</button>
              </div>
            ) : null}

            <details>
              <summary>Response details</summary>
              <p className="small muted">
                Validated action and references · {(result.latencyMs / 1000).toFixed(1)} seconds. No
                action was submitted by this response.{' '}
                {result.output.requestDraft
                  ? 'A request draft was prepared but not sent.'
                  : result.output.schemaVersion === 'rydr-navigator-v1'
                    ? 'This response used the earlier v1 contract, so it contains no drafted request.'
                    : 'This response contains no drafted request.'}
              </p>
            </details>
          </div>
        ) : null}
      </div>
    </section>
  );
}
