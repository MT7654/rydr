import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { StructuredEvidenceResponseSchema } from '../domain/contracts';
import type { DemoRole } from '../domain/demoAccess';
import { getCase } from './cases';
import { createEvidenceRequest, ensureReviewTask, updateEvidenceRequest, listEvidenceRequestsForCase } from './reviewTasks';
import { readJson, writeJsonAtomic, RUNTIME_DIR, withLock } from './store';
export async function supportingRequests(caseId: string, role: DemoRole) {
  return (await listEvidenceRequestsForCase(caseId)).filter(r => role === 'reviewer' || r.recipient === role);
}
type Attachment = { owner: DemoRole; caseId: string; mime: string; bytes: string; hash: string };
const attachmentPath = (id: string) => path.join(RUNTIME_DIR,'repair-attachments',`${id}.json`);
export async function submitSupportingRecord(caseId: string, version: number, role: DemoRole, note: string, key: string, structured?: unknown, file?: File) {
  if (role === 'reviewer') throw new Error('Choose a party role to submit a supporting record.');
  z.string().uuid().parse(key); z.string().trim().min(10).max(3000).parse(note);
  return withLock(`support:${caseId}:${role}`,async () => {
    const receiptPath = path.join(RUNTIME_DIR,'repair-submissions',`${role}-${key}.json`);
    const previous = await readJson<{ caseId: string; taskId: string; requestId: string }>(receiptPath);
    if (previous) { if (previous.caseId !== caseId) throw new Error('Submission key belongs to another case.'); return previous; }
    const record = await getCase(caseId);
    if (!record || record.version !== version) throw new Error('Case changed. Reload before submitting.');
    const response = structured === undefined ? null : StructuredEvidenceResponseSchema.parse(structured);
    let attachmentId: string | undefined;
    if (file && file.size) {
      if (file.size > 5*1024*1024) throw new Error('Supporting PDF must be at most 5 MB.');
      const bytes = Buffer.from(await file.arrayBuffer());
      if (file.type !== 'application/pdf' || bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('Use a PDF document. No scripts or arbitrary file types are accepted.');
      const pending = await supportingRequests(caseId,role);
      if (pending.filter(r => r.responseEvidenceIds.some(id => id.startsWith('attachment-'))).length >= 4) throw new Error('At most four supporting documents per case and role.');
      attachmentId = `attachment-${randomUUID()}`;
      await writeJsonAtomic(attachmentPath(attachmentId),{ owner:role, caseId, mime:'application/pdf', bytes:bytes.toString('base64'), hash:createHash('sha256').update(bytes).digest('hex') });
    }
    const { task } = await ensureReviewTask({ caseId, caseVersion:version, runId:null, kind:'party_request', submittedBy:role,
      reasonCodes:['evidence_repair_submission'], reasonSummary:'Party supplied a supporting record for evidence verification.', openQuestions:['Check relevance, source and any proposed correction before changing a finding.'] });
    const request = await createEvidenceRequest({ taskId:task.id, caseId, recipient:role, question:'Verify the party’s proposed correction and supporting record.', evidenceType:response?.kind ?? 'supporting statement/document', whyItMatters:'Submission is a claim; only independently verified relevant evidence can change an authoritative finding.' });
    await updateEvidenceRequest(task.id,request.id,r => ({ ...r,status:'submitted',responseNote:note,structuredResponse:response,responseEvidenceIds:attachmentId ? [attachmentId] : [] }));
    const receipt = { caseId,taskId:task.id,requestId:request.id }; await writeJsonAtomic(receiptPath,receipt); return receipt;
  });
}
export async function readSupportingAttachment(id: string, caseId: string, role: DemoRole) {
  if (!/^attachment-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid attachment.');
  const item = await readJson<Attachment>(attachmentPath(id));
  if (!item || item.caseId !== caseId || (role !== 'reviewer' && item.owner !== role)) throw new Error('This attachment is unavailable to your role.');
  const bytes = Buffer.from(item.bytes,'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== item.hash) throw new Error('Attachment differs from the stored hash.');
  return bytes;
}
