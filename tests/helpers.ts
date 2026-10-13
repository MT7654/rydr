import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CaseRecord, PolicyPack } from '../src/domain/contracts';
import { CaseRecordSchema, PolicyPackSchema } from '../src/domain/contracts';

export async function loadCase(id: string): Promise<CaseRecord> {
  if (id === 'DISP-002') {
    const raw = await readFile(
      path.join(process.cwd(), 'reference', 'DISP-002.source.json'),
      'utf8',
    );
    const { buildDisp002Case } = await import('../src/domain/sourceAdapter');
    return buildDisp002Case(JSON.parse(raw));
  }
  const raw = await readFile(
    path.join(process.cwd(), 'fixtures', 'cases', `${id}.json`),
    'utf8',
  );
  return CaseRecordSchema.parse(JSON.parse(raw));
}

export async function loadDemoPack(): Promise<PolicyPack> {
  const raw = await readFile(
    path.join(process.cwd(), 'fixtures', 'policies', 'rydr-demo-policy-v1.json'),
    'utf8',
  );
  return PolicyPackSchema.parse(JSON.parse(raw));
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Rewrites no-show timing fields on a cloned case. */
export function withTiming(
  base: CaseRecord,
  timing: {
    scheduled?: string;
    arrival?: string;
    timerStart?: string;
    cancellation?: string;
  },
): CaseRecord {
  const next = clone(base);
  if (timing.scheduled) next.trip.scheduledAt = timing.scheduled;
  for (const item of next.evidence) {
    if (item.kind !== 'trip_event') continue;
    if (timing.arrival && item.payload.eventType === 'driver_arrived') item.timestamp = timing.arrival;
    if (timing.timerStart && item.payload.eventType === 'wait_timer_started') {
      item.timestamp = timing.timerStart;
    }
    if (timing.cancellation && item.payload.eventType === 'cancellation_fee_applied') {
      item.timestamp = timing.cancellation;
    }
  }
  return next;
}
