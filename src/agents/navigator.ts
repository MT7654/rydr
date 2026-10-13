import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { NAVIGATOR_PROMPT, NAVIGATOR_PROMPT_V2 } from './navigatorPrompt';
import { createAdpProvider } from '../providers/adp';
import { validateNavigatorAny, type NavigatorAction } from '../domain/journeys';
import { reserveCalls } from '../repositories/runs';
import { recordProviderCall } from '../repositories/providerCalls';
import { readJson, writeJsonAtomic, withLock, RUNTIME_DIR, currentStorageSession } from '../repositories/store';
import { loadWorkspace } from '../lib/workspace';
import { getCheckpoint, listRemedies } from '../repositories/journeys';
import type { DemoRole } from '../domain/demoAccess';

export function navigatorReady() { return Boolean(process.env.RYDR_ADP_ENDPOINT && process.env.RYDR_ADP_NAVIGATOR_APPKEY); }

/**
 * Recipients and evidence kinds a drafted request may name. The server owns
 * these; the model may only choose from them.
 */
export const NAVIGATOR_REQUEST_RECIPIENTS = ['rider', 'driver', 'platform'] as const;
export const NAVIGATOR_REQUEST_KINDS = [
  'gps_accuracy',
  'fare_ledger',
  'detour_approval',
  'contact_log',
  'policy_clarification',
] as const;

export async function navigatorContext(role: DemoRole, target: 'pickup' | 'case' | 'payments', caseId?: string, selection: {taskId?:string;runId?:string;caseVersion?:number;taskRevision?:number} = {}) {
  let actions: NavigatorAction[] = [];
  let findings: { id: string; text: string }[] = [];
  let evidenceIds: string[] = []; let policyIds: string[] = [];
  let context: unknown;
  let permittedRecipients: string[] = [];
  if (target === 'pickup') {
    const checkpoint = await getCheckpoint();
    findings = [{ id: 'pickup-access', text: `Rider entrance: ${checkpoint.riderEntrance ?? 'not reported'}; driver entrance: ${checkpoint.driverEntrance ?? 'not reported'}. Status: ${checkpoint.status}. Party reports are not verified telemetry.` }];
    if (role !== 'reviewer' && !['picked_up','review_requested'].includes(checkpoint.status)) actions = [
      { id: 'clarify-pickup', label: 'Clarify the meeting point', href: '/rides?journey=pickup#pickup-actions', sourceOwner: role, findingIds: ['pickup-access'] },
      { id: 'pickup-review', label: 'Request pickup review', href: '/rides?journey=pickup#pickup-review', sourceOwner: 'reviewer', findingIds: ['pickup-access'] },
    ];
    context = { dataOrigin: 'sample_ride', checkpoint };
  } else if (target === 'payments') {
    const remedies = (await listRemedies()).filter(r => !caseId || r.caseId === caseId);
    // No claimant notes, private appeals, verification notes or account journal are sent to a party navigator.
    context = { remedies: remedies.map(r => ({ id: r.id, caseId: r.caseId, kind: r.kind, amountCents: r.amountCents, status: r.status, recovery: r.recovery, execution: 'test_ledger' })) };
    actions = [{ id: 'view-payments', label: 'View payment and recovery status', href: caseId ? `/rides?case=${caseId}&section=outcome#payments` : '/payments', sourceOwner: 'platform', findingIds: [] }];
  } else {
    if (!caseId || !/^[A-Za-z0-9_-]{1,80}$/.test(caseId)) throw new Error('Select an available case.');
    // The same authorized workspace loader that drives the screen supplies the
    // Navigator context, so the UI and the agent cannot reason about different
    // versions or tasks.
    const workspace = await loadWorkspace(caseId, { role,taskId:selection.taskId,runId:selection.runId });
    if (!workspace) throw new Error('Case not found.');
    if(selection.caseVersion!==undefined&&selection.caseVersion!==workspace.view.currentCaseVersion)throw new Error('This case has changed. Refresh the next steps.');
    const packet = workspace.packet;
    const view = workspace.view;
    findings = workspace.findings.map(f => ({ id: f.id, text: f.text }));
    evidenceIds = workspace.evidence.map(e => e.id);
    policyIds = packet.pack.clauses.map(c => c.id);

    const selected = packet.tasks.find(task => task.id === view.selectedTaskId) ?? null;
    if(selection.taskRevision!==undefined&&selected?.revision!==selection.taskRevision)throw new Error('This task has changed. Refresh the next steps.');
    const privateTask=role==='reviewer'||selected?.submittedBy===role;
    const relevantRequests = workspace.requests.filter(request => request.taskId === (selected?.id ?? ''));
    const appeal = packet.tasks.find(task => task.kind === 'appeal' && ['queued','assigned','awaiting_evidence','ready'].includes(task.status)) ?? null;

    context = {
      caseId,
      version: packet.caseRecord.version,
      dataOrigin: packet.caseRecord.provenance,
      viewerRole: role,
      userStatement: role === 'driver' ? packet.caseRecord.driverStatement : role === 'rider' ? packet.caseRecord.riderStatement : null,
      findings,
      evidenceIds,
      policy: packet.pack.clauses,
      conditions: packet.collectionPlan.conditions,
      businessStatus: packet.status,
      nextActor: view.nextActor,
      selectedTask: selected ? {
        id: selected.id, kind: selected.kind, status: selected.status, revision: selected.revision,
        reasonSummary: privateTask ? selected.reasonSummary : null, openQuestions: privateTask ? selected.openQuestions : [],
        challenge: privateTask && selected.challenge ? { findingId: selected.challenge.findingId, proposedCorrection: selected.challenge.proposedCorrection } : null,
      } : null,
      pendingRequests: relevantRequests.map(request => ({
        id: request.id, recipient: request.recipient, question: request.question,
        evidenceType: request.evidenceType, status: request.status,
        hasStructuredResponse: request.structuredResponse !== null,
      })),
      appeal: appeal ? { id: appeal.id, status: appeal.status, hasTargetedChallenge: Boolean(appeal.challenge) } : null,
      outcome: packet.effectiveDecision ? { disposition: packet.effectiveDecision.disposition, explanation: packet.effectiveDecision.explanation } : null,
      settlement: packet.settlements.length > 0 ? { status: packet.settlements[packet.settlements.length - 1]!.status, simulated: true } : null,
    };

    actions = workspace.registry.actions.map(a => ({
      id: a.id, label: a.label, href: a.href, sourceOwner: a.sourceOwner, findingIds: a.findingIds, target: a.target,
    }));
    // A request form is the only action a draft may attach to.
    if (role === 'reviewer' && actions.some(a => (a.target as { kind?: string } | undefined)?.kind === 'request-form')) {
      permittedRecipients = [...NAVIGATOR_REQUEST_RECIPIENTS];
    }
  }
  return { role, target, context, findings, evidenceIds, policyIds, actions, permittedRecipients };
}

export async function askNavigator(role: DemoRole, question: string, target: 'pickup' | 'case' | 'payments', caseId: string | undefined, requestKey: string, selection: {taskId?:string;runId?:string;caseVersion?:number;taskRevision?:number} = {}) {
  if (!navigatorReady()) throw new Error('Live assistance is not configured. Use the available action cards.');
  if (question.trim().length < 3 || question.length > 1500) throw new Error('Enter a concern between 3 and 1500 characters.');
  if (!/^[A-Za-z0-9-]{8,80}$/.test(requestKey)) throw new Error('Invalid request key.');
  const session = await currentStorageSession();
  const context = await navigatorContext(role, target, caseId,selection);
  // The fingerprint includes the request key, so duplicate clicks reuse one
  // call but a new key is never served another request's answer.
  const fingerprint = createHash('sha256').update(JSON.stringify([NAVIGATOR_PROMPT_V2, session, role, target, caseId, question, requestKey, context])).digest('hex');
  const file = path.join(RUNTIME_DIR, 'navigator', `${fingerprint}.json`);
  return withLock(`navigator:${fingerprint}`, async () => {
    const cached = await readJson<Awaited<ReturnType<typeof invoke>>>(file);
    if (cached) return cached;
    const result = await invoke(context);
    await writeJsonAtomic(file, result); return result;
  });
  async function invoke(context: Awaited<ReturnType<typeof navigatorContext>>) {
    const limit = Math.min(300, Math.max(1, Number(process.env.RYDR_MAX_CALLS_PER_SESSION ?? 60)));
    if (!await reserveCalls(1, Number.isFinite(limit) ? limit : 60)) throw new Error('Session AI allowance reached. You can still use the action cards.');
    // One request at a time per visitor; bounded quota and no automatic retries.
    return withLock('navigator-inflight', async () => {
      const runId = `navigator_${randomUUID()}`;
      const started = Date.now();
      try {
        const reply = await createAdpProvider(process.env.RYDR_ADP_ENDPOINT!).invoke({ role: 'navigator', stage: 'navigate', runId,
          systemInstruction: NAVIGATOR_PROMPT_V2, input: { role, concern: question, target, context: context.context,
            findings: context.findings, visibleEvidenceIds: context.evidenceIds, visiblePolicyIds: context.policyIds, allowedActions: context.actions,
            permittedRequestRecipients: context.permittedRecipients, permittedRequestEvidenceTypes: [...NAVIGATOR_REQUEST_KINDS] },
          allowedEvidenceIds: context.evidenceIds, timeoutMs: 45000, maxOutputTokens: 1400 });
        const output = validateNavigatorAny(reply.output, {
          actions: context.actions,
          findingIds: context.findings.map(f => f.id),
          evidenceIds: context.evidenceIds,
          policyIds: context.policyIds,
          permittedRecipients: context.permittedRecipients as ('rider' | 'driver' | 'platform')[],
          permittedEvidenceTypes: [...NAVIGATOR_REQUEST_KINDS],
        });
        await recordProviderCall({ runId, role: 'navigator', stage: 'navigate', requestId: reply.providerRequestId,
          latencyMs: Date.now() - started, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, repair: false, ok: true });
        return { output, action: context.actions.find(a => a.id === output.recommendedActionId) ?? null, runId, mode: 'live' as const, latencyMs: Date.now() - started };
      } catch {
        await recordProviderCall({ runId, role: 'navigator', stage: 'navigate', latencyMs: Date.now() - started, repair: false, ok: false,
          errorCode: 'navigator_failed', errorMessage: 'Live assistance failed or returned an invalid recommendation.' });
        throw new Error('Live assistance could not complete. No sample answer was substituted. Use the action cards or retry.');
      }
    });
  }
}

/** The v1 prompt is retained for compatibility checks and older agent configs. */
export { NAVIGATOR_PROMPT };
