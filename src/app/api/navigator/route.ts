import { NextResponse } from 'next/server';
import { z } from 'zod';
import { askNavigator } from '@/agents/navigator';
import { mutationRole } from '@/lib/journeyApi';
const Input = z.object({ question: z.string().min(3).max(1500), target: z.enum(['pickup','case','payments']), caseId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(), taskId:z.string().max(100).optional(),runId:z.string().max(100).optional(),caseVersion:z.number().int().positive().optional(),taskRevision:z.number().int().nonnegative().optional(), requestKey: z.string().regex(/^[A-Za-z0-9-]{8,80}$/) }).strict();
export async function POST(request: Request) {
  try {
    const role = await mutationRole(request);
    const input = Input.parse(await request.json());
    return NextResponse.json(await askNavigator(role, input.question, input.target, input.caseId, input.requestKey,{taskId:input.taskId,runId:input.runId,caseVersion:input.caseVersion,taskRevision:input.taskRevision}));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Assistance failed.' }, { status: 422 });
  }
}

