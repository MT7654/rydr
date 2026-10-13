import { NextResponse } from 'next/server';
import { z } from 'zod';
import { appendReviewRequest, listReviewRequests } from '@/repositories/reviewRequests';
import { getCase } from '@/repositories/cases';

const BodySchema = z.object({
  runId: z.string().nullable().optional(),
  reason: z.string().trim().min(1, 'A reason is required'),
  newEvidence: z.array(z.unknown()).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const caseRecord = await getCase(id);
  if (!caseRecord) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  let parsed;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: 'invalid_request', message: error instanceof Error ? error.message : 'Invalid body' },
      { status: 400 },
    );
  }

  const record = await appendReviewRequest({
    caseId: id,
    runId: parsed.runId ?? null,
    reason: parsed.reason,
    newEvidence: parsed.newEvidence,
  });

  return NextResponse.json({
    recorded: true,
    request: record,
    message: 'Review requested.',
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return NextResponse.json({ requests: await listReviewRequests(id) });
}

