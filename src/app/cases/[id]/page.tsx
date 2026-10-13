import { paymentsForCase } from '@/lib/casePayments';
import { notFound } from 'next/navigation';
import { listRuns, selectRunForCase } from '@/repositories/runs';
import { listCaseVersions } from '@/repositories/cases';
import { CaseDetailView } from '@/components/CaseDetailView';
import { ReviewerWorkspace } from '@/components/workspace/ReviewerWorkspace';
import { ReviewTaskWorkbench } from '@/components/workspace/ReviewTaskWorkbench';
import { loadWorkspace } from '@/lib/workspace';
import { requireReviewerRole } from '@/lib/demoSession';
import type { ExecutionMode } from '@/domain/contracts';
import { CASE_STATUS_LABELS } from '@/domain/caseStatus';
import { formatSgd } from '@/domain/money';
import { healthSnapshot } from '@/lib/runtime';
import { reviewTaskLabel } from '@/domain/navigation';

/** `replay` is a viewing mode only — a fresh execution is always live or fixture. */
function parseRequestedMode(value: string | undefined): ExecutionMode {
  if (value === 'live') return 'live';
  if (value === 'replay') return 'replay';
  return 'fixture';
}

/**
 * Reviewer case workspace.
 *
 * One page for the whole reviewer journey: brief, assessment, the selected
 * task's decision surface, and the action rail. Retains reviewer-only access.
 */
export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; run?: string; task?: string; section?: string; notice?: string; error?: string }>;
}) {
  await requireReviewerRole();
  const { id } = await params;
  const {
    mode: modeParam,
    run: runParam,
    task: taskParam,
    section,
    notice,
    error,
  } = await searchParams;
  const requestedMode = parseRequestedMode(modeParam ?? (healthSnapshot().liveAvailable ? 'live' : 'fixture'));

  // A pinned run is rendered from its frozen snapshot, so the dossier shows the
  // case version and findings that run actually evaluated.
  const data = await loadWorkspace(id, {
    role: 'reviewer',
    runId: runParam ?? null,
    section,
    taskId: taskParam ?? null,
  });
  if (!data) notFound();

  const packet = data.packet;
  const { caseRecord, pack, evaluation, quality } = packet;

  // Show the run the visitor actually asked for. When the requested mode has no
  // recorded run we still show the newest one, but flagged as not matching so
  // the page never implies a fixture result came from a live execution.
  const selection = await selectRunForCase(id, {
    runId: runParam,
    mode: requestedMode,
    caseVersion: caseRecord.version,
  });

  const selectedTask = packet.tasks.find((task) => task.id === data.view.selectedTaskId) ?? null;
  const caseVersions = await listCaseVersions(id);

  return (
    <ReviewerWorkspace
      data={data}
      notice={notice}
      error={error}
      taskOptions={data.otherTasks.map((task) => ({
        id: task.id,
        label: reviewTaskLabel(task.label.replace(/ /g, '_')),
        status: task.status,
      }))}
      detailView={
        <CaseDetailView
          workflow={{
            status: CASE_STATUS_LABELS[packet.status],
            openTasks: packet.tasks
              .filter((task) => !['decided', 'closed_unresolved'].includes(task.status))
              .map((task) => ({ id: task.id, kind: task.kind })),
            decision: packet.effectiveDecision
              ? `${packet.effectiveDecision.disposition.replace(/_/g, ' ')}${packet.effectiveDecision.targetRefundCents == null ? '' : ` — ${formatSgd(packet.effectiveDecision.targetRefundCents)}`}`
              : null,
          }}
          caseRecord={caseRecord}
          evaluation={evaluation}
          quality={quality}
          pack={pack}
          latest={selection.run}
          requestedMode={requestedMode}
          runMatchesRequestedMode={selection.matchesRequestedMode}
          requestedRunUnavailable={selection.requestedRunUnavailable}
          reviewMode={requestedMode === 'live' ? 'live' : 'fixture'}
          collectionJob={packet.collectionJob}
          collectionPlan={packet.collectionPlan}
          sensitivity={packet.sensitivity}
          precedents={
            selection.run && packet.run?.id === selection.run.id ? packet.runPrecedents : null
          }
          integrityAssessment={
            selection.run && packet.run?.id === selection.run.id ? packet.integrityAssessment : null
          }
          snapshotNotice={
            packet.renderedFromSnapshot
              ? {
                  caseVersion: caseRecord.version,
                  currentCaseVersion: packet.currentCaseVersion,
                  supersededByNewerCase: packet.supersededByNewerCase,
                  policyChangedSinceRun: packet.policyChangedSinceRun,
                }
              : null
          }
        />
      }
      caseVersions={caseVersions}
      runs={await listRuns(id)}
      mode={requestedMode==='live'?'live':'fixture'}
      payments={await paymentsForCase(id,'reviewer')}
      workbench={
        selectedTask ? (
          <ReviewTaskWorkbench
            task={selectedTask}
            packet={packet}
            caseVersions={caseVersions}
            currentCaseVersion={packet.currentCaseVersion}
            selected
            historical={data.historical}
          />
        ) : (
          <section className="card">
            <div className="card__title">
              <h2>No open review task</h2>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              This case has no open task. The recorded decision and settlement are in the case record.
            </p>
          </section>
        )
      }
    />
  );
}
