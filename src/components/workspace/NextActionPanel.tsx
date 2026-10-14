import Link from 'next/link';
import type { WorkspaceView } from '@/domain/workspace';
import { actionAnchor } from '@/domain/workspaceActions';


const ACTOR_LABELS: Record<string, string> = {
  rider: 'Rider',
  driver: 'Driver',
  reviewer: 'Reviewer',
  platform: 'Platform',
};

function hrefFor(basePath: string, section: string, actionId: string): string {
  const [p,q]=basePath.split('?');const params=new URLSearchParams(q);params.set('section',section);if(actionId==='return-to-current'){params.delete('run');params.delete('task');}
  return p+'?'+params.toString()+actionAnchor(actionId);
}

/**
 * Action rail: one prominent action for the selected actionable task, the reason
 * it is next, and the embedded Case Navigator. In a waiting state it names the
 * next actor and the expected event instead of showing a fake disabled button.
 */
export function NextActionPanel({
  view,
  basePath,
}: {
  view: WorkspaceView;
  basePath: string;
  navigatorReady: boolean;
  navigatorTarget: 'pickup' | 'case' | 'payments';
  navigatorCaseId?: string;
  prompts: string[];
  taskRevision?:number;runId?:string|null;
}) {
  const primary = view.primaryAction;

  return (
    <aside className="workspace-current-step" aria-label="Next action">
      <section className="card workspace-rail__next">
        <div className="card__title">
          <h2>Current step</h2>
          <span className="badge badge--neutral">
            {view.nextActor ? ACTOR_LABELS[view.nextActor] : 'No action needed'}
          </span>
        </div>
        <p className="workspace-rail__why">{view.nextActionExplanation}</p>

        {primary && primary.enabled && !['run-assessment','reassess'].includes(primary.id) ? (
          <Link
            className="btn btn--primary workspace-rail__primary"
            href={hrefFor(basePath,primary.section,primary.id)}
          >
            {primary.label}
          </Link>
        ) : primary && !primary.enabled ? (
          <p className="workspace-rail__waiting" role="status">
            <strong>{primary.label}</strong>
            <span className="small muted">{primary.disabledReason}</span>
          </p>
        ) : null}

        {view.secondaryActions.length > 0 ? (
          <ul className="workspace-rail__secondary">
            {view.secondaryActions.filter(action=>(!primary||hrefFor(basePath,action.section,action.id)!==hrefFor(basePath,primary.section,primary.id))&&(action.id!=='view-payments'||['settled','settlement_pending','settlement_failed','appeal_pending'].includes(view.businessStatus))).map((action) => (
              <li key={action.id}>
                <Link href={hrefFor(basePath, action.section, action.id)}>{action.label}</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>


    </aside>
  );
}
