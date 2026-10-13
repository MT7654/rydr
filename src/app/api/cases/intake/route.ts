import { NextResponse } from 'next/server';
import { CaseRecordSchema } from '@/domain/contracts';
import { createRuntimeCase } from '@/repositories/cases';

/**
 * Intake endpoint for new cases.
 * Accepts a JSON payload that must validate against CaseRecordSchema.
 * The version number is assigned here, not accepted from the caller, and the
 * record is written as the immutable version 1 of a new case.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const parsed = CaseRecordSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return NextResponse.json(
      { error: 'validation_failed', message: 'Case does not match the required schema.', issues },
      { status: 422 },
    );
  }

  try {
    const record = await createRuntimeCase(parsed.data);
    return NextResponse.json(
      { caseId: record.id, version: record.version, message: 'Case recorded.' },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'save_failed',
        message: error instanceof Error ? error.message : 'Could not save the case.',
      },
      { status: 500 },
    );
  }
}

