import type { CaseRecord, EvidenceItem } from '@/domain/contracts';
import type { DemoRole } from '@/domain/demoAccess';
import { loadCasePacket, type CasePacket } from '@/lib/casePacket';
import {
  deriveWorkspaceView,
  selectWorkspaceTask,
  otherOpenTasks,
  stageProgress,
  type StageProgress,
  type WorkspaceView,
} from '@/domain/workspace';
import {
  buildActionRegistry,
  starterPrompts,
  type RegisteredAction,
} from '@/domain/workspaceActions';

/**
 * Server-side workspace loader.
 *
 * Combines the current packet, the selected task and the role-scoped DTOs the
 * screen actually needs. Data access and redaction stay on the server: a party
 * client component never receives a raw `CasePacket`, another party's private
 * evidence, or reviewer internals.
 */

export type WorkspaceSection =
  | 'brief'
  | 'assessment'
  | 'evidence'
  | 'decision'
  | 'outcome'
  | 'appeal'
  | 'history';

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  'brief',
  'assessment',
  'evidence',
  'decision',
  'outcome',
  'appeal',
  'history',
];

export function parseSection(value: string | undefined): WorkspaceSection {
  return WORKSPACE_SECTIONS.includes(value as WorkspaceSection)
    ? (value as WorkspaceSection)
    : 'brief';
}

/**
 * Evidence a role may see.
 *
 * History is review-routing context only and never reaches a party. Party chat
 * and call records are visible to their own author and to system messages;
 * everything else is reviewer-only.
 */
export function visibleEvidenceForRole(
  caseRecord: CaseRecord,
  role: DemoRole,
): EvidenceItem[] {
  if (role === 'reviewer') return caseRecord.evidence;
  return caseRecord.evidence.filter((item) => {
    if (item.kind === 'history') return false;
    if (item.kind === 'chat' || item.kind === 'call') {
      return item.payload.sender === role || item.payload.sender === 'system';
    }
    return true;
  });
}

export interface WorkspaceData {
  /** Server-only packet. Never pass this whole object to a party client component. */
  packet: CasePacket;
  view: WorkspaceView;
  role: DemoRole;
  section: WorkspaceSection;
  explicitSection: boolean;
  progress: StageProgress[];
  /** Evidence the viewer is authorized to see. */
  evidence: EvidenceItem[];
  /** Material findings, for the brief and the Navigator. */
  findings: { id: string; text: string; kind: string; material: boolean }[];
  /** Evidence requests the viewer may see. */
  requests: CasePacket['evidenceRequests'];
  /** Other open tasks, for a task selector. */
  otherTasks: { id: string; label: string; status: string }[];
  registry: { actions: RegisteredAction[]; byId: Record<string, RegisteredAction> };
  prompts: string[];
  gpsSamples: EvidenceItem[];
  /** True when the pinned historical run is being displayed. */
  historical: boolean;
}

export interface LoadWorkspaceOptions {
  role: DemoRole;
  runId?: string | null;
  section?: string;
  taskId?: string | null;
}

export async function loadWorkspace(
  caseId: string,
  options: LoadWorkspaceOptions,
): Promise<WorkspaceData | null> {
  const { role } = options;
  const packet = await loadCasePacket(caseId, { runId: options.runId ?? null });
  if (!packet) return null;

  const selectedTask = selectWorkspaceTask(packet.tasks, options.taskId ?? null);
  if (options.taskId && !packet.tasks.some(t=>t.id===options.taskId)) return null;
  if (options.runId && packet.run?.id !== options.runId) return null;
  const historical = Boolean(options.runId) && packet.renderedFromSnapshot;
  const hasRun = Boolean(packet.run);
  const runMissingForCurrentVersion = !historical && packet.runStaleAgainstCurrentVersion;

  const view = deriveWorkspaceView({
    caseId,
    role,
    currentCaseVersion: packet.currentCaseVersion,
    displayedCaseVersion: packet.caseRecord.version,
    historical,
    status: packet.status,
    runState: packet.run?.state ?? null,
    hasRun,
    runStaleAgainstCurrentVersion: packet.runStaleAgainstCurrentVersion,
    runMissingForCurrentVersion,
    tasks: packet.tasks,
    selectedTaskId: selectedTask?.id ?? null,
    evidenceRequests: packet.evidenceRequests,
    effectiveDecision: packet.effectiveDecision,
    settlements: packet.settlements,
    hasOpenAppeal: packet.hasOpenAppeal,
  });

  const evidence = visibleEvidenceForRole(packet.caseRecord, role);
  const findings = packet.evaluation.findings.map((finding) => ({
    id: finding.id,
    text: finding.text,
    kind: finding.kind,
    material: finding.material,
  }));

  // A party sees requests addressed to them, and a neutral note that a
  // platform record is outstanding. They never see a request to the other party.
  const requests =
    role === 'reviewer'
      ? packet.evidenceRequests
      : packet.evidenceRequests.filter(
          (request) => request.recipient === role,
        );

  const registry = buildActionRegistry({
    view,
    caseId,
    findings,
    evidenceIds: evidence.map((item) => item.id),
    policyIds: packet.pack.clauses.map((clause) => clause.id),
    tasks: packet.tasks,
    evidenceRequests: requests,
  });

  return {
    packet,
    view,
    role,
    section: parseSection(options.section),
    explicitSection: Boolean(options.section),
    progress: stageProgress({
      status: packet.status,
      hasDecision: Boolean(packet.effectiveDecision),
      hasAppeal: packet.hasOpenAppeal,
      hasOpenEvidenceRequest: requests.length>0,
    }),
    evidence,
    findings,
    requests,
    otherTasks: otherOpenTasks(packet.tasks, view.selectedTaskId).map((task) => ({
      id: task.id,
      label: task.kind.replace(/_/g, ' '),
      status: task.status,
    })),
    registry,
    prompts: starterPrompts({ view, findings, tasks: packet.tasks, evidenceRequests: requests }),
    gpsSamples: evidence.filter((item) => item.kind === 'gps'),
    historical,
  };
}
