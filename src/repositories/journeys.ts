import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readJson, writeJsonAtomic, withLock, RUNTIME_DIR } from './store';
import { getCase, getPolicyPack, createRuntimeCase } from './cases';
import { ensureReviewTask, createEvidenceRequest, listEvidenceRequests } from './reviewTasks';
import { collectForCase } from '../agents/collector';
import { evaluateCase } from '../domain/policy';
import { buildEvidencePlan } from '../domain/evidencePlan';
import { CheckpointSchema, initialCheckpoint, transitionPickup, RemedySchema, assertBalanced,
  CLEANING_CAPS, GOODWILL_CAP_CENTS, type Checkpoint, type PickupAction, type Remedy } from '../domain/journeys';
import type { DemoRole } from '../domain/demoAccess';

const checkpointFile = path.join(RUNTIME_DIR, 'journeys', 'pickup.json');
const remediesFile = path.join(RUNTIME_DIR, 'journeys', 'remedies.json');
const repairFile = path.join(RUNTIME_DIR, 'journeys', 'repairs.json');
export async function getCheckpoint(): Promise<Checkpoint> {
  const raw = await readJson(checkpointFile);
  return raw ? CheckpointSchema.parse(raw) : initialCheckpoint();
}
export async function updateCheckpoint(role: DemoRole, revision: number, input: PickupAction): Promise<Checkpoint> {
  return withLock('pickup-operation', async () => {
    const current = await getCheckpoint();
    if (current.revision !== revision) throw new Error('Pickup changed. Reload before responding.');
    const next = transitionPickup(current, role, input);
    if (input.action === 'review' || input.action === 'safety') {
      // Persist immutable checkpoint claims in a distinct case. No billed fare is fabricated.
      const id = 'PICKUP-001';
      if (!await getCase(id)) {
        const base = await getCase('SYN-011');
        if (!base) throw new Error('Pickup example is unavailable.');
        await createRuntimeCase({ ...base, id, trip: { ...base.trip, id: 'TRIP-PICKUP-001', bookingType: 'unknown' },
          disputedCents: 0, riderStatement: next.safetyReported ? 'Pickup safety report: party feels unsafe and reports a threat. Human safety review required.' : `Pickup access concern: rider reported ${next.riderEntrance ?? 'no entrance'}.`,
          driverStatement: `Driver reported ${next.driverEntrance ?? 'no entrance'}. No fee has been posted.`,
          evidence: next.events.map((e, i) => ({ id: `PICKUP-E-${i}`, kind: 'chat' as const, timestamp: e.at,
            source: { dataset: 'checkpoint/RIDE-001', jsonPointer: `/events/${i}`, provenance: 'synthetic' as const },
            qualityIssues: ['Party statement in a sample ride; not verified identity or telemetry.'],
            payload: { sender: e.actor === 'rider' || e.actor === 'driver' ? e.actor : 'system' as const, type: 'message' as const, content: e.text } })),
          changeLog: ['Pickup checkpoint submitted for access review without creating a charge.'] });
      }
      await ensureReviewTask({ caseId: id, caseVersion: 1, runId: null, kind: 'party_request',
        submittedBy: role === 'reviewer' ? undefined : role, reasonCodes: [next.safetyReported ? 'safety_report' : 'pickup_access'], reasonSummary: next.safetyReported ? 'Pickup safety report. Human safety review required; no charge or responsibility finding.' : 'Clarify access at the pickup point. No charge or responsibility finding has been made.', openQuestions: ['Review the recorded entrance statements and contact the parties within this workspace.'] });
      next.linkedCaseId = id;
    }
    await writeJsonAtomic(checkpointFile, next);
    return next;
  });
}

export interface RepairRecord {
  id: string; caseId: string; startingVersion: number; resultingVersion: number | null;
  requestedBy: DemoRole; conditionId: string; status: 'retrieved' | 'review_requested' | 'unavailable';
  note: string; taskId: string | null; createdAt: string;
  beforeIssueCount?: number; afterIssueCount?: number;
}
export async function listRepairs(caseId: string, role: DemoRole): Promise<RepairRecord[]> {
  const records = await readJson<RepairRecord[]>(repairFile) ?? [];
  return records.filter(r => r.caseId === caseId && (role === 'reviewer' || r.requestedBy === role));
}
export async function requestRepair(caseId: string, version: number, conditionId: string, role: DemoRole): Promise<RepairRecord> {
  return withLock('repair-operation', async () => {
    const records = await readJson<RepairRecord[]>(repairFile) ?? [];
    const existing = records.find(r => r.caseId === caseId && r.startingVersion === version && r.conditionId === conditionId && r.requestedBy === role);
    if (existing) return existing;
    const record = await getCase(caseId);
    if (!record || record.version !== version) throw new Error('Case changed. Reload before requesting evidence.');
    const pack = await getPolicyPack(record.policyVersion);
    const before = evaluateCase(record, pack);
    const plan = buildEvidencePlan(record, before);
    const condition = plan.conditions.find(c => c.id === conditionId);
    if (!condition && conditionId !== 'review') throw new Error('This finding is not an available repair option.');
    let resultingVersion: number | null = null;
    let note = 'A reviewer will check the missing record or clarify the governing policy.';
    let status: RepairRecord['status'] = 'review_requested';
    if (condition?.tool && condition.kind !== 'policy_ambiguity' && plan.hasWork) {
      const job = await collectForCase(caseId);
      resultingVersion = job.resultingVersion;
      note = job.note;
      status = resultingVersion ? 'retrieved' : 'unavailable';
    }
    let taskId: string | null = null;
    if (status !== 'retrieved') {
      const current = await getCase(caseId);
      const task = await ensureReviewTask({ caseId, caseVersion: current?.version ?? version, runId: null,
        kind: 'party_request', submittedBy: role === 'reviewer' ? undefined : role, reasonCodes: [condition?.kind ?? 'evidence_repair'],
        reasonSummary: condition?.summary ?? 'Review requested for an unresolved case finding.',
        openQuestions: [condition?.whyItMatters ?? 'Identify and verify the material record before deciding.'] });
      taskId = task.task.id;
      if (condition && !(await listEvidenceRequests(task.task.id)).some(r => r.question === condition.summary)) {
        await createEvidenceRequest({ taskId: task.task.id, caseId, recipient: 'platform',
          question: condition.summary, evidenceType: condition.tool ?? 'policy clarification', whyItMatters: condition.whyItMatters });
      }
    }
    const updated = await getCase(caseId);
    const after = updated ? evaluateCase(updated, pack) : before;
    const repair: RepairRecord = { id: randomUUID(), caseId, startingVersion: version, resultingVersion,
      beforeIssueCount: before.issues.length, afterIssueCount: after.issues.length,
      requestedBy: role, conditionId, status, note, taskId, createdAt: new Date().toISOString() };
    records.push(repair); await writeJsonAtomic(repairFile, records); return repair;
  });
}

export async function listRemedies(): Promise<Remedy[]> {
  const raw = await readJson<unknown[]>(remediesFile) ?? [];
  return z.array(RemedySchema).parse(raw);
}
export async function submitRemedy(role: DemoRole, input: { caseId: string; version: number; kind: 'cleaning' | 'goodwill'; amountCents: number; note: string; evidenceIds: string[] }): Promise<Remedy> {
  return withLock('remedy-operation', async () => {
    if ((input.kind === 'cleaning' && role !== 'driver') || (input.kind === 'goodwill' && role !== 'reviewer')) throw new Error('This role cannot submit that remedy.');
    const record = await getCase(input.caseId);
    if (!record || record.version !== input.version) throw new Error('Case changed. Reload before submitting.');
    const pack = await getPolicyPack(record.policyVersion);
    if (input.kind === 'cleaning' && (record.category !== 'damage' || pack.source !== 'ryde_official' || pack.officialScope !== 'cleaning')) throw new Error('This claim needs an applicable Ryde cleaning policy.');
    const amount = z.number().int().positive().max(input.kind === 'goodwill' ? GOODWILL_CAP_CENTS : 20000).parse(input.amountCents);
    const note = z.string().trim().min(10).max(1500).parse(input.note);
    if (input.evidenceIds.some(id => !record.evidence.some(e => e.id === id))) throw new Error('Unknown supporting evidence.');
    const records = await listRemedies();
    const existing = records.find(r => r.caseId === input.caseId && r.kind === input.kind);
    if (existing) return existing;
    const now = new Date().toISOString();
    const remedy = RemedySchema.parse({ id: `RM-${randomUUID()}`, caseId: input.caseId, caseVersion: input.version, revision: 1,
      kind: input.kind, amountCents: amount, status: 'submitted', recovery: input.kind === 'cleaning' ? 'pending' : 'not_applicable',
      policyIds: input.kind === 'cleaning' ? ['RYDE-CLEAN-EVIDENCE','RYDE-CLEAN-CAPS','RYDE-CLEAN-REVIEW'] : ['RYDR-GOODWILL-01'],
      policyVersion: input.kind === 'cleaning' ? pack.version : 'proposed-goodwill-v1', evidenceIds: input.evidenceIds,
      note, approvalNote: null, reviewer: null, createdAt: now, updatedAt: now, entries: [], events: [{ at: now, text: 'Remedy submitted for review. No money movement or liability finding.' }] });
    records.push(remedy); await writeJsonAtomic(remediesFile, records); return remedy;
  });
}

export async function actOnRemedy(role: DemoRole, id: string, revision: number,
  input: { action: 'approve' | 'reject' | 'post' | 'recover' | 'fail_recovery' | 'dispute' | 'waive_recovery' | 'resume_recovery' | 'adjust'; note?: string; tier?: string; verified?: boolean; amountCents?: number }): Promise<Remedy> {
  return withLock('remedy-operation', async () => {
    const records = await listRemedies();
    const remedy = records.find(r => r.id === id);
    if (!remedy) throw new Error('Unknown remedy.');
    if (input.action !== 'dispute' && role !== 'reviewer') throw new Error('Only a reviewer can authorize or execute a financial action.');
    // Read-only retry of completed financial operations is safe and idempotent.
    if (input.action === 'post' && remedy.status === 'posted') return remedy;
    if (input.action === 'recover' && remedy.recovery === 'received') return remedy;
    if (remedy.revision !== revision) throw new Error('Remedy changed. Reload before acting.');
    if (input.action === 'dispute') {
      if (role !== 'rider' || remedy.kind !== 'cleaning' || remedy.recovery === 'received' || remedy.status === 'rejected') throw new Error('This recovery cannot be disputed here.');
      const note = z.string().trim().min(10).max(1500).parse(input.note);
      await ensureReviewTask({ caseId: remedy.caseId, caseVersion: remedy.caseVersion, runId: null, kind: 'appeal', submittedBy: role,
        reasonCodes: ['cleaning_recovery_disputed'], reasonSummary: 'Rider disputes a cleaning recovery. Inspect the party response before collection.', openQuestions: [note] });
      remedy.recovery = 'disputed';
    } else {
      if (role !== 'reviewer') throw new Error('Only a reviewer can authorize or execute a financial action.');
      const current = await getCase(remedy.caseId);
      if (!current) throw new Error('Case no longer available.');
      if (current.version !== remedy.caseVersion && !['resume_recovery','waive_recovery','adjust'].includes(input.action)) throw new Error('Case changed since submission. Review the new evidence before processing.');
      if (input.action === 'approve') {
        if (remedy.status !== 'submitted') throw new Error('Only a submitted remedy can be approved.');
        const note = z.string().trim().min(15).max(1500).parse(input.note);
        if (!input.verified) throw new Error('Verification and applicable policy checks are required.');
        if (remedy.kind === 'cleaning') {
          if (!Object.hasOwn(CLEANING_CAPS, input.tier ?? '')) throw new Error('Select the verified cleaning tier.');
          if (remedy.amountCents > CLEANING_CAPS[input.tier as keyof typeof CLEANING_CAPS]) throw new Error('Requested amount exceeds the selected cleaning tier cap.');
          if (!remedy.evidenceIds.some(id => current.evidence.some(e => e.id === id && e.kind === 'image')) ||
            !remedy.evidenceIds.some(id => current.evidence.some(e => e.id === id && e.kind === 'trip_event' && e.payload.eventType === 'professional_cleaning_receipt'))) {
            throw new Error('Link an image and a professional cleaning receipt record before approval.');
          }
        }
        remedy.status = 'approved'; remedy.approvalNote = note; remedy.reviewer = 'workspace-reviewer';
      } else if (input.action === 'reject') {
        if (remedy.status !== 'submitted') throw new Error('Only a submitted remedy can be rejected.');
        remedy.approvalNote = z.string().trim().min(10).max(1500).parse(input.note); remedy.status = 'rejected';
      } else if (input.action === 'post') {
        if (remedy.status !== 'approved') throw new Error('Reviewer approval is required first.');
        const transaction = `${remedy.id}-payment`;
        remedy.entries.push({ id: `${transaction}-debit`, transaction, account: remedy.kind === 'cleaning' ? 'platform_cleaning_expense' : 'platform_goodwill_expense', direction: 'debit', amountCents: remedy.amountCents },
          { id: `${transaction}-credit`, transaction, account: remedy.kind === 'cleaning' ? 'driver' : 'rider', direction: 'credit', amountCents: remedy.amountCents });
        remedy.status = 'posted';
      } else if (input.action === 'recover') {
        if (remedy.kind !== 'cleaning' || remedy.status !== 'posted' || !['pending','failed'].includes(remedy.recovery)) throw new Error('Recovery must wait for an approved, posted, undisputed cleaning claim.');
        const recovered = remedy.entries.filter(e => e.account === 'platform_recovery').reduce((n,e) => n + (e.direction === 'credit' ? e.amountCents : -e.amountCents),0);
        const remaining = remedy.amountCents - recovered;
        if (remaining <= 0) throw new Error('No recovery remains due.');
        const transaction = `${remedy.id}-recovery-${remedy.revision}`;
        remedy.entries.push({ id: `${transaction}-debit`, transaction, account: 'rider', direction: 'debit', amountCents: remaining },
          { id: `${transaction}-credit`, transaction, account: 'platform_recovery', direction: 'credit', amountCents: remaining });
        remedy.recovery = 'received';
      } else if (input.action === 'waive_recovery' || input.action === 'resume_recovery') {
        if (remedy.kind !== 'cleaning' || remedy.status !== 'posted' || remedy.recovery === 'received') throw new Error('This recovery is not awaiting resolution.');
        const note = z.string().trim().min(15).max(1500).parse(input.note);
        if (!input.verified) throw new Error('A reviewed basis is required to resolve recovery.');
        remedy.approvalNote = note; remedy.caseVersion = current.version;
        remedy.recovery = input.action === 'waive_recovery' ? 'not_applicable' : 'pending';
      } else if (input.action === 'adjust') {
        if (remedy.status !== 'posted') throw new Error('Only a posted remedy can be adjusted.');
        const note = z.string().trim().min(15).max(1500).parse(input.note);
        if (!input.verified) throw new Error('Review and authorization are required for an adjustment.');
        const cap = remedy.kind === 'goodwill' ? GOODWILL_CAP_CENTS : CLEANING_CAPS[input.tier as keyof typeof CLEANING_CAPS];
        if (cap === undefined) throw new Error('Select the reviewed tier.');
        const target = z.number().int().positive().max(cap).parse(input.amountCents);
        const delta = target - remedy.amountCents;
        if (delta === 0) return remedy;
        const transaction = `${remedy.id}-adjust-${remedy.revision}`;
        const expense = remedy.kind === 'cleaning' ? 'platform_cleaning_expense' as const : 'platform_goodwill_expense' as const;
        const recipient = remedy.kind === 'cleaning' ? 'driver' as const : 'rider' as const;
        remedy.entries.push({ id: `${transaction}-expense`, transaction, account: expense, direction: delta > 0 ? 'debit' : 'credit', amountCents: Math.abs(delta) },
          { id: `${transaction}-recipient`, transaction, account: recipient, direction: delta > 0 ? 'credit' : 'debit', amountCents: Math.abs(delta) });
        const recovered = remedy.entries.filter(e => e.account === 'platform_recovery').reduce((n,e) => n + (e.direction === 'credit' ? e.amountCents : -e.amountCents),0);
        if (remedy.kind === 'cleaning' && recovered > target) {
          const reversal = `${transaction}-recovery-reversal`;
          remedy.entries.push({ id: `${reversal}-debit`, transaction: reversal, account: 'platform_recovery', direction: 'debit', amountCents: recovered-target },
            { id: `${reversal}-credit`, transaction: reversal, account: 'rider', direction: 'credit', amountCents: recovered-target });
        }
        if (remedy.kind === 'cleaning' && recovered > 0) remedy.recovery = recovered >= target ? 'received' : 'pending';
        remedy.amountCents = target; remedy.caseVersion = current.version; remedy.approvalNote = note;
      } else {
        if (remedy.kind !== 'cleaning' || remedy.status !== 'posted' || remedy.recovery === 'received' || remedy.recovery === 'disputed') throw new Error('Cannot mark this recovery failed.');
        remedy.recovery = 'failed';
      }
    }
    assertBalanced(remedy.entries);
    const now = new Date().toISOString(); remedy.updatedAt = now; remedy.revision += 1;
    remedy.events.push({ at: now, text: ({ approve: 'Reviewer approved the documented remedy.', reject: 'Reviewer rejected the request.', post: 'Payment recorded in test ledger. No external money transfer.', recover: 'Recovery recorded separately in test ledger; no second driver payment.', fail_recovery: 'Rider recovery failed; approved driver payment remains recorded.', dispute: 'Rider requested review. Recovery is on hold; driver payment is unchanged.', waive_recovery: 'Reviewer waived rider recovery. Driver reimbursement remains recorded.', resume_recovery: 'Reviewer resolved the recovery challenge. Recovery may proceed separately.', adjust: 'Reviewer authorized an adjustment. New balanced entries preserve the original journal and correct any excess recovery.' })[input.action] });
    await writeJsonAtomic(remediesFile, records); return remedy;
  });
}

