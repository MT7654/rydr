import { DraftForm } from './DraftForm';
import type { EvidenceItem, EvidenceRequest } from '@/domain/contracts';
import type { DemoRole } from '@/domain/demoAccess';
import { EvidenceResponseFields } from '@/components/EvidenceResponseFields';
import { Cite } from '@/components/Cite';
import { respondToEvidenceRequest } from '@/app/cases/[id]/actions';

const REQUEST_STATE: Record<EvidenceRequest['status'], { label: string; tone: string }> = {
  open: { label: 'Open — response needed', tone: 'review' },
  submitted: { label: 'Response received', tone: 'neutral' },
  accepted: { label: 'Accepted into the case', tone: 'success' },
  rejected: { label: 'Not accepted', tone: 'danger' },
};

/**
 * Evidence requests and the party's response.
 *
 * The recipient sees "Respond to request"; the other party never sees the
 * private response form. A statement stays a statement — the form says so, and
 * acceptance (a reviewer action) is what could promote a structured value.
 */
export function PartyEvidence({
  caseId,
  role,
  requests,
  evidence,
  gpsSamples,
  readOnly=false,
}: {
  readOnly?:boolean;
  caseId: string;
  role: DemoRole;
  requests: EvidenceRequest[];
  evidence: EvidenceItem[];
  gpsSamples: Extract<EvidenceItem, { kind: 'gps' }>[];
}) {
  const mine = requests.filter((request) => request.recipient === role);
  const openRequest = readOnly ? null : mine.find((request) => request.status === 'open') ?? null;
  const platformOpen = requests.filter((request) => request.recipient === 'platform' && request.status === 'open');

  return (
    <section className="card workspace-evidence" id="evidence" aria-labelledby="evidence-heading">
      <div className="card__title">
        <h2 id="evidence-heading">Evidence and requests</h2>
        {openRequest ? <span className="badge badge--review">Response needed</span> : null}
      </div>

      {openRequest ? (
        <div className="workspace-evidence__request">
          <h3>A reviewer needs something from you</h3>
          <p style={{ margin: 0 }}>{openRequest.question}</p>
          <p className="small muted">
            Requested from: {openRequest.recipient} · {openRequest.whyItMatters}
          </p>
          <DraftForm draftId={openRequest.id+':response'} action={respondToEvidenceRequest} className="stack" id="respond-form" style={{ gap: '0.5rem' }}>
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="taskId" value={openRequest.taskId} />
            <input type="hidden" name="requestId" value={openRequest.id} />
            <input type="hidden" name="as" value={role} />
            <label className="field">
              <span className="field__label">Your response</span>
              <textarea
                name="response"
                className="input"
                rows={3}
                placeholder="Describe what you can provide and where it comes from. Text alone is recorded as a statement, not as verified data."
                required
              />
            </label>
            <EvidenceResponseFields samples={gpsSamples} />
            <button type="submit" className="btn btn--primary btn--sm">
              Submit response
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              “Received” means the review record now holds your response. It is not the same as
              “verified”: a reviewer must check the source before a structured value governs the
              assessment.
            </p>
          </DraftForm>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          No response is required from you right now.
        </p>
      )}

      {platformOpen.length > 0 ? (
        <p className="notice notice--info" style={{ marginTop: '0.75rem' }}>
          <strong>A platform-owned record has been requested.</strong> This is not something you can
          supply; the review continues once it arrives.
        </p>
      ) : null}

      {mine.length > 0 ? (
        <div className="workspace-evidence__history">
          <h3>Your requests on this case</h3>
          <ul className="workspace-evidence__list">
            {mine.map((request) => {
              const state = REQUEST_STATE[request.status];
              return (
                <li key={request.id}>
                  <span className={`badge badge--${state.tone}`}>{state.label}</span>
                  <span>{request.question}</span>
                  {request.status === 'submitted' ? (
                    <span className="small muted">
                      {request.structuredResponse
                        ? 'A structured value was offered. It stays a party claim until a reviewer accepts it.'
                        : 'Recorded as a written statement. It cannot become structured evidence on its own.'}
                    </span>
                  ) : null}
                  {request.status === 'accepted' && request.acceptedIntoCaseVersion ? (
                    <span className="small muted">Accepted into case v{request.acceptedIntoCaseVersion}.</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <details className="workspace-evidence__sources">
        <summary>Records you can inspect ({evidence.length})</summary>
        <ul className="workspace-evidence__list">
          {evidence.map((item) => (
            <li key={item.id}>
              <Cite kind="evidence" id={item.id}>{item.kind.replaceAll('_',' ')} · {item.timestamp?new Date(item.timestamp).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore'}):'Undated record'}</Cite>
              <span className="small muted">
                {item.kind.replace(/_/g, ' ')}
                {item.timestamp ? ` · ${new Date(item.timestamp).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}` : ' · time not recorded'}
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">
          Inspecting a record is read-only. It does not change your selection or submit anything.
        </p>
      </details>
    </section>
  );
}
