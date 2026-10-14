export const maxDuration = 300;
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutationRole } from '@/lib/journeyApi';
import { getDemoRole } from '@/lib/demoSession';
import { listRepairs, requestRepair } from '@/repositories/journeys';
import { beginRun } from '@/agents/orchestrator';
import { getCase } from '@/repositories/cases';
import { latestRunForCase } from '@/repositories/runs';
import { orchestratorConfig } from '@/lib/runtime';
import { supportingRequests, submitSupportingRecord, readSupportingAttachment } from '@/repositories/repairSupport';
const Input = z.object({ operation: z.enum(['request','assess']), version: z.number().int().positive(), conditionId: z.string().max(80).optional(), mode: z.enum(['live','fixture']).optional() }).strict();
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const role = await getDemoRole(); if (!role) return NextResponse.json({ message: 'Select a role.' }, { status: 403 });
  const { id } = await context.params; if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return NextResponse.json({}, { status: 400 });
  const attachment = new URL(request.url).searchParams.get('attachment');
  if (attachment) { try { return new Response(new Uint8Array(await readSupportingAttachment(attachment,id,role)), { headers: { 'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename="supporting-record.pdf"', 'Cache-Control':'no-store' } }); } catch { return NextResponse.json({ message:'Attachment unavailable.' }, { status:403 }); } }
  const run = await latestRunForCase(id);
  return NextResponse.json({ repairs: await listRepairs(id, role), requests:await supportingRequests(id,role), run: run ? { id: run.id, state: run.state, mode: run.mode, caseVersion: run.caseVersion } : null });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const role = await mutationRole(request); const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid case.');
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      if (Number(request.headers.get('content-length') ?? 0) > 6*1024*1024) throw new Error('Request too large.');
      const data = await request.formData(); const structured = data.get('structured'); const file = data.get('document');
      return NextResponse.json(await submitSupportingRecord(id,Number(data.get('version')),role,String(data.get('note') ?? ''),String(data.get('key')),structured ? JSON.parse(String(structured)) : undefined,file instanceof File ? file : undefined));
    }
    const input = Input.parse(await request.json());
    if (input.operation === 'request') return NextResponse.json({ repair: await requestRepair(id, input.version, input.conditionId ?? 'review', role) });
    const record = await getCase(id); if (!record || record.version !== input.version) throw new Error('Case changed. Reload first.');
    const mode = input.mode ?? 'live';
    const previous = await latestRunForCase(id);
    const retry = previous?.caseVersion === record.version && previous.mode === mode && ['failed','cancelled'].includes(previous.state) ? `:retry:${previous.id}` : '';
    const run = await beginRun(id, mode, orchestratorConfig(mode), `repair-assessment:${id}:${record.version}:${mode}${retry}`);
    return NextResponse.json({ run: { id: run.id, state: run.state, mode: run.mode, caseVersion: run.caseVersion } });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Action failed.' }, { status: 422 }); }
}

