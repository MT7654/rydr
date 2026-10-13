import path from 'node:path';
import {
  RunSnapshotSchema,
  type CaseRecord,
  type ExecutionMode,
  type PolicyPack,
  type RunSnapshot,
} from '../domain/contracts';
import { fingerprint } from '../lib/hash';
import { visionReceiptFile } from '../lib/damageEvidence';
import { readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';

/**
 * Immutable per-run snapshots.
 *
 * A run reads exactly one case version and one policy pack. Freezing both at run
 * start means an old report keeps showing what the run actually evaluated, even
 * after the case is edited or the policy pack is revised. Nothing downstream may
 * recompute findings against the latest case to render a historical run.
 */

/**
 * Snapshots live beside the runs but in their own directory: `listRuns` reads
 * every `*.json` in the runs directory, so a sidecar file there would be parsed
 * as a run record.
 */
const SNAPSHOTS_DIR = path.join(RUNTIME_DIR, 'run-snapshots');

export function snapshotFile(runId: string): string {
  return path.join(SNAPSHOTS_DIR, `${runId}.json`);
}

export async function getRunSnapshot(runId: string): Promise<RunSnapshot | null> {
  const raw = await readJson<unknown>(snapshotFile(runId));
  if (!raw) return null;
  const parsed = RunSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface CaptureSnapshotInput {
  runId: string;
  mode: ExecutionMode;
  provider: string;
  promptVersion: string;
  inputHash: string;
  caseRecord: CaseRecord;
  policyPack: PolicyPack;
  evaluation: RunSnapshot['evaluation'];
  quality: RunSnapshot['quality'];
  catalog: RunSnapshot['catalog'];
  /**
   * The precedent context retrieval returned for this run. Omitted means
   * retrieval was not consulted — which is different from "found nothing".
   */
  precedents?: RunSnapshot['precedents'];
}

/**
 * Writes the snapshot once. A second call for the same run is a no-op: a run's
 * frozen inputs must never be rewritten, even if the caller retries.
 */
export async function captureRunSnapshot(input: CaptureSnapshotInput): Promise<RunSnapshot> {
  const snapshot = RunSnapshotSchema.parse({
    runId: input.runId,
    caseId: input.caseRecord.id,
    caseVersion: input.caseRecord.version,
    capturedAt: new Date().toISOString(),
    inputHash: input.inputHash,
    policyVersion: input.policyPack.version,
    policyHash: fingerprint(input.policyPack),
    promptVersion: input.promptVersion,
    provider: input.provider,
    mode: input.mode,
    caseRecord: input.caseRecord,
    policyPack: input.policyPack,
    evaluation: input.evaluation,
    quality: input.quality,
    catalog: input.catalog,
    ...(input.precedents ? { precedents: input.precedents } : {}),
    ...(input.caseRecord.category === 'damage' ? { visionReceipts: {
      fixture: await readJson(visionReceiptFile(input.caseRecord.id, input.caseRecord.version, 'fixture')),
      live: await readJson(visionReceiptFile(input.caseRecord.id, input.caseRecord.version, 'live')),
    } } : {}),
  });

  await withLock(`snapshot:${input.runId}`, async () => {
    const existing = await getRunSnapshot(input.runId);
    if (existing) return;
    await writeJsonAtomic(snapshotFile(input.runId), snapshot);
  });

  return (await getRunSnapshot(input.runId)) ?? snapshot;
}

/**
 * True when the snapshot still matches the pack it names. A policy pack edited
 * in place without a version bump is caught here rather than silently changing
 * what a recorded run appears to have been judged against.
 */
export function snapshotPolicyIntact(snapshot: RunSnapshot, current: PolicyPack | null): boolean {
  if (!current) return false;
  return fingerprint(current) === snapshot.policyHash;
}
