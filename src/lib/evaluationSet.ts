import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CaseRecord, Disposition, EvidenceItem, PolicyPack } from '@/domain/contracts';
import type { HeldOutCase } from '@/domain/precedentGate';
import { getPolicyPack } from '@/repositories/cases';

/**
 * The synthetic evaluation set.
 *
 * Two files, deliberately split:
 *  - `fixtures/evaluation/set.json` describes derived cases and holds no outcome;
 *  - `fixtures/evaluation/labels.json` holds the reviewed outcomes.
 *
 * Only the evaluation report and the precedent activation gate read the labels.
 * Nothing under `src/agents` or `src/providers` may import this module — a test
 * enforces that, because a runtime agent that could read the expected label
 * would be marking its own homework.
 */

interface Modifications {
  gpsAccuracyMeters?: number | null;
  /** Shifts every GPS fix by this many metres north, to move a case off-zone. */
  gpsOffsetMeters?: number;
  setStatements?: { rider?: string; driver?: string };
  dropEvidenceIds?: string[];
  dropTripEventTypes?: string[];
}

interface SetEntry {
  id: string;
  base: string;
  label: string;
  modifications: Modifications;
}

interface LabelEntry {
  caseId: string;
  expectedDisposition: Disposition | 'insufficient_evidence';
  rationale: string;
}

const EVAL_DIR = path.join(process.cwd(), 'fixtures', 'evaluation');
const CASES_DIR = path.join(process.cwd(), 'fixtures', 'cases');

/** One degree of latitude is ~111.32 km, so this converts metres to degrees. */
const METERS_PER_DEGREE_LAT = 111_320;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

function derive(base: CaseRecord, entry: SetEntry): CaseRecord {
  const mods = entry.modifications ?? {};
  let evidence: EvidenceItem[] = base.evidence.map((item) => ({ ...item }));

  if (mods.dropEvidenceIds?.length) {
    const drop = new Set(mods.dropEvidenceIds);
    evidence = evidence.filter((item) => !drop.has(item.id));
  }

  if (mods.dropTripEventTypes?.length) {
    const drop = new Set(mods.dropTripEventTypes);
    evidence = evidence.filter(
      (item) => !(item.kind === 'trip_event' && drop.has(item.payload.eventType)),
    );
  }

  if (mods.gpsAccuracyMeters !== undefined) {
    const accuracy = mods.gpsAccuracyMeters;
    evidence = evidence.map((item) =>
      item.kind === 'gps' ? { ...item, payload: { ...item.payload, accuracyMeters: accuracy } } : item,
    );
  }

  if (mods.gpsOffsetMeters !== undefined) {
    const deltaLat = mods.gpsOffsetMeters / METERS_PER_DEGREE_LAT;
    evidence = evidence.map((item) =>
      item.kind === 'gps'
        ? { ...item, payload: { ...item.payload, lat: item.payload.lat + deltaLat } }
        : item,
    );
  }

  const riderStatement = mods.setStatements?.rider ?? base.riderStatement;
  const driverStatement =
    mods.setStatements?.driver !== undefined ? mods.setStatements.driver : base.driverStatement;

  return {
    ...base,
    id: entry.id,
    version: 1,
    trip: { ...base.trip, id: `TRIP-${entry.id}` },
    riderStatement,
    driverStatement,
    evidence,
    derivedFrom: base.id,
    provenance: 'synthetic',
    changeLog: [
      `Derived for the synthetic evaluation set from ${base.id}.`,
      entry.label,
      'Generated from the base fixture by fixtures/evaluation/set.json; the reviewed outcome lives in fixtures/evaluation/labels.json.',
    ],
  };
}

export interface EvaluationCase extends HeldOutCase {
  /** Why this case exists in the set. */
  description: string;
  /** The reviewer's reason for the label. */
  rationale: string;
}

/**
 * Builds the evaluation set. The case records are derived in memory so the
 * derivation stays readable and the base fixtures are never modified.
 */
export async function loadEvaluationSet(): Promise<EvaluationCase[]> {
  const set = await readJson<{ cases: SetEntry[] }>(path.join(EVAL_DIR, 'set.json'));
  const labels = await readJson<{ labels: LabelEntry[] }>(path.join(EVAL_DIR, 'labels.json'));
  const byId = new Map(labels.labels.map((label) => [label.caseId, label]));

  const cases: EvaluationCase[] = [];
  for (const entry of set.cases) {
    const base = await readJson<CaseRecord>(path.join(CASES_DIR, `${entry.base}.json`));
    const caseRecord = derive(base, entry);
    const pack: PolicyPack = await getPolicyPack(caseRecord.policyVersion);
    const label = byId.get(entry.id);
    if (!label) throw new Error(`Evaluation case ${entry.id} has no reviewed label`);
    cases.push({
      caseId: entry.id,
      caseRecord,
      pack,
      expectedDisposition: label.expectedDisposition,
      description: entry.label,
      rationale: label.rationale,
    });
  }
  return cases;
}

/** The labelled subset the precedent gate replays against. */
export async function loadHeldOutCases(): Promise<HeldOutCase[]> {
  return (await loadEvaluationSet()).map((entry) => ({
    caseId: entry.caseId,
    caseRecord: entry.caseRecord,
    pack: entry.pack,
    expectedDisposition: entry.expectedDisposition,
  }));
}
