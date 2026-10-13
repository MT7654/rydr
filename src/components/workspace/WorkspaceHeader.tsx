import Link from 'next/link';
import { workspaceHref } from '@/domain/workspaceRoute';
import type { CaseRecord } from '@/domain/contracts';
import type { DemoRole } from '@/domain/demoAccess';
import { formatSgd } from '@/domain/money';
import { CASE_STATUS_LABELS, caseStatusTone } from '@/domain/caseStatus';
import type { WorkspaceView } from '@/domain/workspace';

const ACTOR_LABELS: Record<string, string> = {
  rider: 'Rider',
  driver: 'Driver',
  reviewer: 'Reviewer',
  platform: 'Platform',
};

const CATEGORY_LABELS: Record<string, string> = {
  no_show_charge: 'No-show / cancellation charge',
  route_overcharge: 'Route deviation / overcharge',
  fare_dispute: 'Fare / surge-price dispute',
  damage: 'Damage charge',
};

/**
 * One page title, one stage line and one current actor. The raw case id stays as
 * secondary identification; the complete record is available from one control.
 */
export function WorkspaceHeader({
  view,
  caseRecord,
  role,
  activeCaseId,
  runId,
}: {
  view: WorkspaceView;
  caseRecord: CaseRecord;
  role: DemoRole;
  activeCaseId: string;runId?:string|null;
}) {
  const issue = CATEGORY_LABELS[caseRecord.category] ?? 'Ride dispute';
  return (
    <header className="workspace-header" id="workspace-header">
      <div className="workspace-header__main">
        <p className="eyebrow">
          {role === 'reviewer' ? 'Reviewer workspace' : role === 'driver' ? 'Driver workspace' : 'Rider workspace'}
          {view.historical ? ` · Recorded assessment · case v${view.displayedCaseVersion}` : ''}
        </p>
        <h1 className="workspace-header__title">{issue}</h1>
        <p className="workspace-header__meta">
          <span className="workspace-header__amount">{formatSgd(caseRecord.disputedCents)} disputed</span>
          <span aria-hidden="true"> · </span>
          <span>Case v{view.displayedCaseVersion}</span>
          <span aria-hidden="true"> · </span>
          <span>{view.stageLabel}</span>
          <span aria-hidden="true"> · </span>
          <span>
            Next: <strong>{view.nextActor ? ACTOR_LABELS[view.nextActor] : 'No action needed'}</strong>
          </span>
        </p>
        <p className="small muted workspace-header__ids">
          {caseRecord.id} · {caseRecord.provenance === 'supplied_sample' ? 'Supplied sample' : 'Synthetic sample'}
        </p>
      </div>
      <div className="workspace-header__aside">
        <span className={`badge badge--${caseStatusTone(view.businessStatus)}`}>
          {CASE_STATUS_LABELS[view.businessStatus]}
        </span>
        <Link
          className="btn btn--ghost btn--sm"
          href={workspaceHref(activeCaseId,role,'history',{taskId:view.selectedTaskId,runId})}
        >
          Case record
        </Link>
      </div>
    </header>
  );
}
