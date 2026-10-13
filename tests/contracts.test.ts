import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CaseRecordSchema } from '../src/domain/contracts';
import { buildDisp002Case } from '../src/domain/sourceAdapter';
import { getAllCases, getPolicyPack, loadPolicyPacks } from '../src/repositories/cases';
import { clone, loadCase } from './helpers';

// SYN-006/007/008 are the evidence-collection fixtures added for the stretch
// program: an unresolved data gap, a policy-clock ambiguity and an unavailable
// source respectively. Pinning the full set here keeps the seed list deliberate.
const SEED_IDS = [
  'SYN-001',
  'SYN-002',
  'SYN-003',
  'SYN-004',
  'SYN-005',
  'SYN-006',
  'SYN-007',
  'SYN-008',
  'SYN-009',
  'SYN-010',
  'SYN-011',
  'SYN-012',
  'SYN-013',
  'SYN-014',
  'SYN-015',
  'DISP-001',
  'DISP-002',
  'DISP-003',
];

describe('contracts', () => {
  it('every seed case validates', async () => {
    const cases = await getAllCases();
    expect(cases.map((c) => c.id).sort()).toEqual([...SEED_IDS].sort());
    for (const record of cases) {
      expect(() => CaseRecordSchema.parse(record)).not.toThrow();
    }
  });

  it('rejects negative money', async () => {
    const base = await loadCase('SYN-001');
    base.disputedCents = -1;
    expect(() => CaseRecordSchema.parse(base)).toThrow();
  });

  it('rejects a timestamp without an offset', async () => {
    const base = await loadCase('SYN-001');
    base.trip.scheduledAt = '2026-09-14T09:00:00';
    expect(() => CaseRecordSchema.parse(base)).toThrow();
  });

  it('rejects out-of-range coordinates', async () => {
    const base = await loadCase('SYN-001');
    base.trip.pickup.lat = 120;
    expect(() => CaseRecordSchema.parse(base)).toThrow();
  });

  it('rejects duplicate evidence IDs', async () => {
    const base = await loadCase('SYN-001');
    base.evidence[1]!.id = base.evidence[0]!.id;
    expect(() => CaseRecordSchema.parse(base)).toThrow();
  });

  it('rejects an empty evidence set', async () => {
    const base = await loadCase('SYN-001');
    base.evidence = [];
    expect(() => CaseRecordSchema.parse(base)).toThrow();
  });

  it('rejects a non-integer money value', async () => {
    const base = await loadCase('SYN-004');
    const payment = base.evidence.find((item) => item.kind === 'payment');
    if (payment && payment.kind === 'payment') payment.payload.amountCents = 12.5;
    expect(() => CaseRecordSchema.parse(base)).toThrow();
  });
});

describe('DISP-002 source adapter', () => {
  it('preserves missing fields rather than inventing them', async () => {
    const record = await loadCase('DISP-002');
    expect(record.driverStatement).toBeNull();
    const gps = record.evidence.filter((item) => item.kind === 'gps');
    expect(gps.length).toBe(8);
    for (const item of gps) {
      if (item.kind === 'gps') expect(item.payload.accuracyMeters).toBeNull();
    }
  });

  it('keeps a stable ID and original JSON pointer on every item', async () => {
    const record = await loadCase('DISP-002');
    const ids = record.evidence.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of record.evidence) {
      expect(item.source.jsonPointer.startsWith('/')).toBe(true);
      expect(item.source.dataset).toBe('reference/DISP-002.source.json');
      expect(item.source.provenance).toBe('supplied_sample');
    }
  });

  it('never carries an advertised expected ruling into the case record', async () => {
    const record = await loadCase('DISP-002');
    const serialised = JSON.stringify(record).toLowerCase();
    expect(serialised).not.toContain('expected_outcome');
    expect(serialised).not.toContain('advertised');
    expect(serialised).not.toContain('advertised expected');
  });

  it('isolates history as its own evidence kind', async () => {
    const record = await loadCase('DISP-002');
    const history = record.evidence.filter((item) => item.kind === 'history');
    expect(history).toHaveLength(2);
    const riderHistory = history.find(
      (item) => item.kind === 'history' && item.payload.subject === 'rider',
    );
    expect(riderHistory).toBeDefined();
  });

  it('is pure and leaves the source file untouched', async () => {
    const file = path.join(process.cwd(), 'reference', 'DISP-002.source.json');
    const before = await readFile(file, 'utf8');
    const first = buildDisp002Case(JSON.parse(before));
    const second = buildDisp002Case(JSON.parse(before));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('records the supplied policy separately from the governing pack', async () => {
    const record = await loadCase('DISP-002');
    expect(record.suppliedPolicyId).toBe('supplied-sample-policy');
    expect(record.policyVersion).toBe('rydr-demo-policy-v1');

    const supplied = await getPolicyPack('supplied-sample-policy');
    expect(supplied.source).toBe('supplied_sample');
    if (supplied.source === 'supplied_sample') {
      expect(supplied.unresolved.length).toBeGreaterThan(0);
    }
  });

  it('cannot merge a supplied pack into the demo pack shape', async () => {
    const packs = await loadPolicyPacks();
    const demo = packs.get('rydr-demo-policy-v1');
    const supplied = packs.get('supplied-sample-policy');
    expect(demo?.source).toBe('rydr_demo');
    expect(supplied?.source).toBe('supplied_sample');
    // @ts-expect-error a supplied pack structurally lacks demo thresholds
    expect(supplied?.thresholds).toBeUndefined();
  });
});

describe('derived synthetic fixtures', () => {
  it('labels SYN-002 as derived with an explicit change log', async () => {
    const record = await loadCase('SYN-002');
    expect(record.provenance).toBe('synthetic');
    expect(record.derivedFrom).toBe('DISP-002');
    expect(record.changeLog.length).toBeGreaterThan(0);
  });

  it('does not attribute synthetic accuracy readings to the source sample', async () => {
    const source = await loadCase('DISP-002');
    const derived = await loadCase('SYN-002');
    const sourceAccuracy = source.evidence
      .filter((item) => item.kind === 'gps')
      .map((item) => (item.kind === 'gps' ? item.payload.accuracyMeters : null));
    const derivedAccuracy = derived.evidence
      .filter((item) => item.kind === 'gps')
      .map((item) => (item.kind === 'gps' ? item.payload.accuracyMeters : null));
    expect(sourceAccuracy.every((value) => value === null)).toBe(true);
    expect(derivedAccuracy.every((value) => typeof value === 'number')).toBe(true);
  });

  it('keeps every case in SGD with integer cents', async () => {
    const cases = await getAllCases();
    for (const record of cases) {
      expect(record.currency).toBe('SGD');
      expect(Number.isInteger(record.disputedCents)).toBe(true);
      for (const item of record.evidence) {
        if (item.kind === 'payment') {
          expect(Number.isInteger(item.payload.amountCents)).toBe(true);
        }
      }
    }
  });

  it('cloning a case does not mutate the fixture', async () => {
    const base = await loadCase('SYN-004');
    const copy = clone(base);
    copy.disputedCents = 999;
    expect(base.disputedCents).toBe(500);
  });
});
