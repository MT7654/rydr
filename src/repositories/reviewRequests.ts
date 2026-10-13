import path from 'node:path';
import { z } from 'zod';
import { readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';

export const ReviewRequestSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  runId: z.string().nullable(),
  reason: z.string().min(1, 'A reason is required to request review'),
  newEvidence: z.array(z.unknown()).default([]),
  recordedAt: z.string(),
  status: z.literal('pending_review'),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

const DIR = path.join(RUNTIME_DIR, 'review-requests');

/**
 * An appeal creates a new pending-review record. It never overwrites the previous
 * resolution and never claims a support team was contacted.
 */
export async function appendReviewRequest(input: {
  caseId: string;
  runId: string | null;
  reason: string;
  newEvidence?: unknown[];
}): Promise<ReviewRequest> {
  const record = ReviewRequestSchema.parse({
    id: `req_${Date.now().toString(36)}`,
    caseId: input.caseId,
    runId: input.runId,
    reason: input.reason,
    newEvidence: input.newEvidence ?? [],
    recordedAt: new Date().toISOString(),
    status: 'pending_review',
  });

  await withLock(`review-request:${input.caseId}`, async () => {
    const file = path.join(DIR, `${input.caseId}.json`);
    const existing = (await readJson<ReviewRequest[]>(file)) ?? [];
    await writeJsonAtomic(file, [...existing, record]);
  });

  return record;
}

export async function listReviewRequests(caseId: string): Promise<ReviewRequest[]> {
  const file = path.join(DIR, `${caseId}.json`);
  return (await readJson<ReviewRequest[]>(file)) ?? [];
}
