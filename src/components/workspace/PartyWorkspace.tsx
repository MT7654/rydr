import Link from 'next/link';
import {WorkspaceInteractions} from './WorkspaceInteractions';
import type { ReactNode } from 'react';
import type { WorkspaceData } from '@/lib/workspace';
import type { WorkspaceSection } from '@/lib/workspace';
import { navigatorReady } from '@/agents/navigator';
import { CitationDrawer } from '@/components/CitationDrawer';
import { RepairSupport } from '@/components/RepairSupport';
import { EvidenceRepair } from '@/components/EvidenceRepair';
import { listRepairs } from '@/repositories/journeys';
import { healthSnapshot } from '@/lib/runtime';
import { workspaceHref } from '@/domain/workspaceRoute';
import { PolicyBasis } from '@/components/PolicyBasis';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceProgress } from './WorkspaceProgress';
import { NextActionPanel } from './NextActionPanel';
import { PartyBrief } from './PartyBrief';
import { PartyEvidence } from './PartyEvidence';
import { PartyOutcome } from './PartyOutcome';
import { PartyHistory } from './PartyHistory';

const SECTION_LABELS: Record<WorkspaceSection, string> = {
  brief: 'Brief',
  assessment: 'Assessment',
  evidence: 'Evidence',
  decision: 'Decision',
  outcome: 'Outcome',
  appeal: 'Appeal',
  history: 'Case record',
};

const PARTY_SECTIONS: WorkspaceSection[] = ['brief', 'evidence', 'outcome', 'history'];

/**
 * Party workspace shell.
 *
 * One connected journey for the rider or driver: brief → evidence → outcome →
 * case record, with a single action rail beside it. The role decides what is
 * visible; the derived workflow state decides what is actionable.
 */
export async function PartyWorkspace({
  data,
  notice,
  error,
  selector,
  payments,
}: {
  data: WorkspaceData;
  notice?: string;
  error?: string;
  selector?: ReactNode;
  payments?: ReactNode;
}) {
  const { view, packet, role } = data;
  const basePath=workspaceHref(packet.caseRecord.id,role,'brief',{taskId:view.selectedTaskId,runId:data.historical?packet.run?.id:null});
  const repairs=await listRepairs(packet.caseRecord.id,role);
  const activeSection: WorkspaceSection =
    data.explicitSection ? data.section : packet.effectiveDecision ? 'outcome' : view.primaryAction?.section ?? 'brief';

  return (
    <main className="container stack workspace">
      <WorkspaceInteractions/><WorkspaceHeader
        view={view}
        caseRecord={packet.caseRecord}
        role={role}
        activeCaseId={packet.caseRecord.id}
        runId={data.historical?packet.run?.id:null}
      />

      {selector}

      <WorkspaceProgress progress={data.progress} basePath={basePath} />

      {notice ? <div className="notice notice--success" role="status">{notice}</div> : null}
      {error ? <div className="notice notice--danger" role="alert">{error}</div> : null}

      <nav className="workspace-sections" aria-label="Case sections">
        {PARTY_SECTIONS.map((section) => (
          <Link
            key={section}
            href={workspaceHref(packet.caseRecord.id,role,section,{taskId:view.selectedTaskId,runId:data.historical?packet.run?.id:null})}
            className="filter"
            aria-current={activeSection === section ? 'page' : undefined}
          >
            {SECTION_LABELS[section]}
          </Link>
        ))}
      </nav>

      <div className="workspace-grid">
        <div className="workspace-canvas">
          {activeSection==='brief' ? <PartyBrief
            caseRecord={packet.caseRecord}
            findings={packet.evaluation.findings}
            issues={packet.evaluation.issues}
            role={role}
            decided={Boolean(packet.effectiveDecision)}
          /> : null}

          <details className="card" id="policy-basis">
            <summary>Rules that apply to this case</summary>
            <PolicyBasis
              pack={packet.pack}
              suppliedSample={packet.caseRecord.suppliedPolicyId !== null}
            />
          </details>

          {activeSection === 'evidence' ? (
            <>
              <PartyEvidence
                caseId={packet.caseRecord.id}
                role={role}
                readOnly={data.historical}
                requests={data.requests}
                evidence={data.evidence}
                gpsSamples={data.gpsSamples as Extract<(typeof data.evidence)[number], { kind: 'gps' }>[]}
              />
              {!data.historical?<details className="card" id="repair-entry"><summary>Check evidence and next steps</summary><RepairSupport caseId={packet.caseRecord.id} version={packet.currentCaseVersion} role={role} requests={data.requests} gpsSamples={packet.caseRecord.evidence.filter(e=>e.kind==='gps')}/><EvidenceRepair caseId={packet.caseRecord.id} version={packet.currentCaseVersion} conditions={packet.collectionPlan.conditions} repairs={repairs} liveReady={healthSnapshot().liveAvailable} previousRun={packet.run?{state:packet.run.state,caseVersion:packet.run.caseVersion,mode:packet.run.mode}:null}/></details>:null}
            </>
          ) : null}

          {(activeSection === 'outcome' || activeSection === 'appeal') ? (
            <>
              <PartyOutcome
                caseRecord={packet.caseRecord}
                role={role}
                evaluation={packet.evaluation}
                effectiveDecision={packet.effectiveDecision}
                settlements={packet.settlements}
                allSettlements={packet.allSettlements}
                readOnly={data.historical}
                hasOpenAppeal={packet.hasOpenAppeal}
                hasOpenAppealByMe={packet.tasks.some(
                  (task) => task.kind === 'appeal' && task.submittedBy === role && ['queued','assigned','ready','awaiting_evidence'].includes(task.status),
                )}
              />
              {payments && !data.historical ? <div id="payments">{payments}</div> : null}
            </>
          ) : null}

          {activeSection === 'history' ? (
            <PartyHistory
              decisions={packet.decisions}
              tasks={packet.tasks}
              role={role}
              currentDecisionId={packet.effectiveDecision?.id ?? null}
              currentCaseVersion={packet.currentCaseVersion}
              displayedCaseVersion={packet.caseRecord.version}
            />
          ) : null}

          {data.section === 'assessment' || data.section === 'decision' ? (
            <p className="notice notice--info">
              That section belongs to the reviewer workspace. Your next action is shown beside the
              brief.
            </p>
          ) : null}
        </div>

        <NextActionPanel
          view={view}
          basePath={basePath}
          navigatorReady={navigatorReady()&&!data.historical}
          navigatorTarget="case"
          navigatorCaseId={packet.caseRecord.id}
          prompts={data.prompts}
          taskRevision={packet.tasks.find(t=>t.id===view.selectedTaskId)?.revision}
          runId={data.historical?packet.run?.id:undefined}
        />
      </div>

      <p className="small muted">
        <Link href="/rides?journey=pickup">Prevent a pickup dispute</Link> ·{' '}
        <Link href="/policies">Help &amp; policies</Link>
      </p>

      <CitationDrawer caseId={packet.caseRecord.id} runId={null} />
    </main>
  );
}
