import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutationRole } from '@/lib/journeyApi';
import { getDemoRole } from '@/lib/demoSession';
import { getCheckpoint, updateCheckpoint, listRemedies, submitRemedy, actOnRemedy } from '@/repositories/journeys';
import { remedyReceipt } from '@/domain/remedyReceipt';

const Input = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('pickup'), revision: z.number().int().positive(), action: z.enum(['entrance','propose','confirm','pickup','review','contact','playback','safety']), entrance: z.string().optional(), seconds:z.number().int().min(0).max(900).optional() }).strict(),
  z.object({ operation: z.literal('submit_remedy'), caseId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), version: z.number().int().positive(), kind: z.enum(['cleaning','goodwill']), amountCents: z.number().int().positive(), note: z.string().min(10).max(1500), evidenceIds: z.array(z.string()).max(20) }).strict(),
  z.object({ operation: z.literal('remedy'), id: z.string().max(80), revision: z.number().int().positive(), action: z.enum(['approve','reject','post','recover','fail_recovery','dispute','waive_recovery','resume_recovery','adjust']), note: z.string().max(1500).optional(), tier: z.string().optional(), verified: z.boolean().optional(), amountCents: z.number().int().positive().optional() }).strict(),
]);
export async function GET(request: Request) {
  const role = await getDemoRole();
  if (!role) return NextResponse.json({ message: 'Select a role.' }, { status: 403 });
  const remedies = await listRemedies();
  const receiptId = new URL(request.url).searchParams.get('receipt');
  if (new URL(request.url).searchParams.get('export') === 'journeys') {
    const checkpoint = await getCheckpoint();
    const data = { exportedAt:new Date().toISOString(),role,execution:'test_ledger',identity:'role preview; not verified identity',checkpoint,receipts:remedies.map(r=>remedyReceipt(r,role)) };
    return new Response(JSON.stringify(data,null,2),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Content-Disposition':`attachment; filename="rydr-${role}-journeys.json"`}});
  }
  if (receiptId) {
    const remedy = remedies.find(r => r.id === receiptId);
    if (!remedy) return NextResponse.json({ message: 'Receipt not found.' }, { status: 404 });
    return new Response(JSON.stringify(remedyReceipt(remedy,role),null,2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${remedy.id}-${role}-receipt.json"` } });
  }
  return NextResponse.json({ checkpoint: await getCheckpoint(), remedies: remedies.map(r => role === 'reviewer' ? r :
    { id: r.id, caseId: r.caseId, kind: r.kind, amountCents: r.amountCents, revision: r.revision, status: r.status, recovery: r.recovery, createdAt: r.createdAt, updatedAt: r.updatedAt }) });
}
export async function POST(request: Request) {
  try {
    const role = await mutationRole(request); const input = Input.parse(await request.json());
    if (input.operation === 'pickup') {
      const checkpoint = await updateCheckpoint(role, input.revision, input);
      return NextResponse.json({ checkpoint });
    }
    const result = input.operation === 'submit_remedy' ? await submitRemedy(role, input) : await actOnRemedy(role, input.id, input.revision, input);
    return NextResponse.json({ id: result.id, status: result.status });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Action failed.' }, { status: 422 });
  }
}

