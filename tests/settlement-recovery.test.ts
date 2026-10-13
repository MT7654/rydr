import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUNTIME_DIR, readJson } from '../src/repositories/store';
import {
  chargeRefFor,
  listReceiptsForDecision,
  listSettlementsForCase,
  postedRefundCents,
  postSettlement,
  recordDecision,
} from '../src/repositories/ledger';
import { getCase } from '../src/repositories/cases';
import type { CaseRecord, Settlement } from '../src/domain/contracts';

/**
 * Settlement recovery.
 *
 * A posting touches three stores in order — the settlement record, the ledger
 * entries, then the receipts. A crash anywhere in that sequence used to leave
 * state nothing could repair: entries with no settlement, or a settlement with
 * no receipts, and an automatic completion step that stopped as soon as a
 * decision existed.
 *
 * These tests construct each interrupted state directly and then check that a
 * retry finishes the job **without posting a second credit**.
 */

const LEDGER_DIR = path.join(RUNTIME_DIR, 'ledger');
const SETTLEMENTS_DIR = path.join(LEDGER_DIR, 'settlements');
const RECEIPTS_DIR = path.join(LEDGER_DIR, 'receipts');
const ENTRIES_DIR = path.join(LEDGER_DIR, 'entries');

function settlementFile(id: string) {
  return path.join(SETTLEMENTS_DIR, `${id}.json`);
}
function receiptFile(id: string) {
  return path.join(RECEIPTS_DIR, `${id}.json`);
}
function entryFile(id: string) {
  return path.join(ENTRIES_DIR, `${id}.json`);
}

async function removeIfPresent(file: string) {
  await fs.rm(file, { force: true });
}

async function entryFilesFor(settlementId: string): Promise<string[]> {
  try {
    const names = await fs.readdir(ENTRIES_DIR);
    return names.filter((name) => name.startsWith(`led_${settlementId}`));
  } catch {
    return [];
  }
}

/** Records a refund decision without settling it. */
async function unsettledDecision(caseId: string, targetRefundCents: number) {
  const caseRecord = (await getCase(caseId))!;
  const decision = await recordDecision({
    caseId: caseRecord.id,
    caseVersion: caseRecord.version,
    runId: null,
    taskId: null,
    source: 'reviewer',
    disposition: 'refund',
    targetRefundCents,
    evidenceIds: [],
    policyIds: [],
    policyVersion: caseRecord.policyVersion,
    explanation: 'Recovery test decision.',
    differenceFromRecommendation: null,
    reviewerId: 'reviewer_demo_01',
    supersedesDecisionId: null,
    chargeRef: chargeRefFor(caseRecord),
  });
  return { caseRecord, decision };
}

describe('an interrupted posting is completed rather than duplicated', () => {
  it('finishes a settlement left in the pending state', async () => {
    const { caseRecord, decision } = await unsettledDecision('SYN-002', 500);
    const chargeRef = chargeRefFor(caseRecord);
    const settlementId = `set_${decision.id}`;

    // The crash happened after the intent was persisted but before any entry.
    const pending: Settlement = {
      id: settlementId,
      caseId: caseRecord.id,
      decisionId: decision.id,
      chargeRef,
      mode: 'simulation',
      status: 'pending',
      originalChargeCents: caseRecord.disputedCents,
      targetRefundCents: 500,
      deltaRefundCents: 500,
      retainedCents: 0,
      ledgerEntryIds: [`led_${settlementId}_0`, `led_${settlementId}_1`],
      idempotencyKey: `${chargeRef}:${decision.id}`,
      failureReason: null,
      postedAt: null,
      createdAt: new Date().toISOString(),
    };
    await fs.mkdir(SETTLEMENTS_DIR, { recursive: true });
    await fs.writeFile(settlementFile(settlementId), JSON.stringify(pending, null, 2), 'utf8');

    // The charge is created lazily by the settlement, so nothing has been posted.
    expect(await postedRefundCents(chargeRef)).toBe(0);
    expect(await entryFilesFor(settlementId)).toHaveLength(0);

    const recovered = await postSettlement({ caseRecord, decision });

    expect(recovered.recovered).toBe(true);
    expect(recovered.settlement.status).toBe('posted');
    expect(recovered.settlement.deltaRefundCents).toBe(500);
    expect(await postedRefundCents(chargeRef)).toBe(500);

    // The entries exist, exactly once.
    expect(await entryFilesFor(settlementId)).toHaveLength(2);
    expect(await listReceiptsForDecision(decision.id)).toHaveLength(2);

    // Pressing again is a replay, not a second credit.
    const again = await postSettlement({ caseRecord, decision });
    expect(again.replayed).toBe(true);
    expect(again.recovered).toBe(false);
    expect(await postedRefundCents(chargeRef)).toBe(500);
    expect(await entryFilesFor(settlementId)).toHaveLength(2);
  });

  it('rebuilds receipts lost after the money was posted', async () => {
    const { caseRecord, decision } = await unsettledDecision('SYN-005', 500);
    const chargeRef = chargeRefFor(caseRecord);

    const first = await postSettlement({ caseRecord, decision });
    expect(first.settlement.status).toBe('posted');
    expect(await postedRefundCents(chargeRef)).toBe(500);

    // The receipts never made it to disk.
    for (const receipt of await listReceiptsForDecision(decision.id)) {
      await removeIfPresent(receiptFile(receipt.id));
    }
    expect(await listReceiptsForDecision(decision.id)).toHaveLength(0);

    const repaired = await postSettlement({ caseRecord, decision });

    expect(repaired.recovered).toBe(true);
    expect(repaired.receipts).toHaveLength(2);
    expect(await listReceiptsForDecision(decision.id)).toHaveLength(2);
    // Repairing a receipt must not move money.
    expect(await postedRefundCents(chargeRef)).toBe(500);
    expect(await listSettlementsForCase(caseRecord.id)).toHaveLength(1);
  });

  it('overwrites orphan ledger entries instead of crediting twice', async () => {
    const { caseRecord, decision } = await unsettledDecision('SYN-004', 500);
    const chargeRef = chargeRefFor(caseRecord);
    const settlementId = `set_${decision.id}`;

    // Entries from a posting whose settlement record was never written. The
    // entry ids are derived from the decision, so a retry targets the same files.
    await fs.mkdir(ENTRIES_DIR, { recursive: true });
    for (const suffix of ['0', '1']) {
      await fs.writeFile(
        entryFile(`led_${settlementId}_${suffix}`),
        JSON.stringify(
          {
            id: `led_${settlementId}_${suffix}`,
            settlementId,
            account: 'rider',
            direction: 'credit',
            amountCents: 500,
            note: 'Orphaned entry from an interrupted posting.',
          },
          null,
          2,
        ),
        'utf8',
      );
    }
    expect(await entryFilesFor(settlementId)).toHaveLength(2);
    expect(await listSettlementsForCase(caseRecord.id)).toHaveLength(0);

    const settled = await postSettlement({ caseRecord, decision });

    expect(settled.settlement.status).toBe('posted');
    expect(await entryFilesFor(settlementId)).toHaveLength(2);
    expect(await postedRefundCents(chargeRef)).toBe(500);

    // The orphan was overwritten with the correct entry, not added to.
    const credit = await readJson<{ amountCents: number; note: string }>(
      entryFile(`led_${settlementId}_0`),
    );
    expect(credit?.amountCents).toBe(500);
    expect(credit?.note).not.toContain('Orphaned');
  });

  it('leaves a manual-adjustment flag alone on retry', async () => {
    const { caseRecord, decision } = await unsettledDecision('SYN-001', 500);
    const chargeRef = chargeRefFor(caseRecord);

    const first = await postSettlement({ caseRecord, decision });
    expect(first.settlement.status).toBe('posted');
    expect(await postedRefundCents(chargeRef)).toBe(500);

    // A later decision asking for less than has already been refunded.
    const reduced = await recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: 'partial_refund',
      targetRefundCents: 200,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Reduced.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: decision.id,
      chargeRef,
    });

    const flagged = await postSettlement({ caseRecord, decision: reduced });
    expect(flagged.settlement.status).toBe('manual_adjustment_required');

    // Retrying must not turn a deliberate flag into a posting.
    const again = await postSettlement({ caseRecord, decision: reduced });
    expect(again.replayed).toBe(true);
    expect(again.settlement.status).toBe('manual_adjustment_required');
    expect(await postedRefundCents(chargeRef)).toBe(500);
  });
});

/**
 * Partial receipt loss and the cumulative position.
 *
 * Receipts are two independent writes, so a crash can leave one party with a
 * preview and the other with nothing. And recovery must reproduce what *that*
 * decision recorded, not today's ledger — otherwise a later appeal silently
 * rewrites the meaning of an earlier receipt.
 */
describe('partial receipt loss and frozen financial position', () => {
  /** A case on its own trip, so it gets its own charge and cannot collide. */
  async function recoveryCase(tag: string): Promise<CaseRecord> {
    const base = (await getCase('SYN-002'))!;
    return { ...base, id: `REC-${tag}`, trip: { ...base.trip, id: `TRIP-REC-${tag}` } };
  }

  async function decisionFor(
    caseRecord: CaseRecord,
    targetRefundCents: number,
    options: { supersedes?: string; disposition?: 'refund' | 'partial_refund' } = {},
  ) {
    return recordDecision({
      caseId: caseRecord.id,
      caseVersion: caseRecord.version,
      runId: null,
      taskId: null,
      source: 'reviewer',
      disposition: options.disposition ?? 'refund',
      targetRefundCents,
      evidenceIds: [],
      policyIds: [],
      policyVersion: caseRecord.policyVersion,
      explanation: 'Recovery test decision.',
      differenceFromRecommendation: null,
      reviewerId: 'reviewer_demo_01',
      supersedesDecisionId: options.supersedes ?? null,
      chargeRef: chargeRefFor(caseRecord),
    });
  }

  /** Writes the intent exactly as `postSettlement` would, then stops. */
  async function writeInterruptedIntent(input: {
    caseRecord: CaseRecord;
    decisionId: string;
    chargeRef: string;
    targetRefundCents: number;
    deltaRefundCents: number;
    priorPostedCents: number;
  }) {
    const settlementId = `set_${input.decisionId}`;
    const pending: Settlement = {
      id: settlementId,
      caseId: input.caseRecord.id,
      decisionId: input.decisionId,
      chargeRef: input.chargeRef,
      mode: 'simulation',
      status: 'pending',
      originalChargeCents: input.caseRecord.disputedCents,
      targetRefundCents: input.targetRefundCents,
      deltaRefundCents: input.deltaRefundCents,
      retainedCents: input.caseRecord.disputedCents - input.targetRefundCents,
      ledgerEntryIds: [`led_${settlementId}_0`, `led_${settlementId}_1`],
      idempotencyKey: `${input.chargeRef}:${input.decisionId}`,
      failureReason: null,
      postedAt: null,
      createdAt: new Date().toISOString(),
      priorPostedCents: input.priorPostedCents,
      totalRefundedCents: input.priorPostedCents + input.deltaRefundCents,
    };
    await fs.mkdir(SETTLEMENTS_DIR, { recursive: true });
    await fs.writeFile(settlementFile(settlementId), JSON.stringify(pending, null, 2), 'utf8');
    return settlementId;
  }

  it('rebuilds a missing driver receipt when the rider receipt survived', async () => {
    const caseRecord = await recoveryCase('driver-lost');
    const chargeRef = chargeRefFor(caseRecord);
    const decision = await decisionFor(caseRecord, 500);

    await postSettlement({ caseRecord, decision });
    const riderBefore = (await listReceiptsForDecision(decision.id)).find(
      (receipt) => receipt.recipient === 'rider',
    )!;

    await removeIfPresent(receiptFile(`rcpt_${decision.id}_driver`));
    const left = await listReceiptsForDecision(decision.id);
    expect(left).toHaveLength(1);
    expect(left[0].recipient).toBe('rider');

    const repaired = await postSettlement({ caseRecord, decision });

    expect(repaired.recovered).toBe(true);
    const after = await listReceiptsForDecision(decision.id);
    expect(after.map((receipt) => receipt.recipient).sort()).toEqual(['driver', 'rider']);
    // Repair is receipt-only: no second credit, no second settlement.
    expect(await postedRefundCents(chargeRef)).toBe(500);
    expect(await listSettlementsForCase(caseRecord.id)).toHaveLength(1);
    // The receipt that did survive was left exactly as it was.
    expect(after.find((receipt) => receipt.recipient === 'rider')!.createdAt).toBe(
      riderBefore.createdAt,
    );
  });

  it('rebuilds a missing rider receipt when the driver receipt survived', async () => {
    const caseRecord = await recoveryCase('rider-lost');
    const chargeRef = chargeRefFor(caseRecord);
    const decision = await decisionFor(caseRecord, 500);

    await postSettlement({ caseRecord, decision });
    const driverBefore = (await listReceiptsForDecision(decision.id)).find(
      (receipt) => receipt.recipient === 'driver',
    )!;

    await removeIfPresent(receiptFile(`rcpt_${decision.id}_rider`));
    const left = await listReceiptsForDecision(decision.id);
    expect(left).toHaveLength(1);
    expect(left[0].recipient).toBe('driver');

    const repaired = await postSettlement({ caseRecord, decision });

    expect(repaired.recovered).toBe(true);
    const after = await listReceiptsForDecision(decision.id);
    expect(after.map((receipt) => receipt.recipient).sort()).toEqual(['driver', 'rider']);
    expect(await postedRefundCents(chargeRef)).toBe(500);
    expect(after.find((receipt) => receipt.recipient === 'driver')!.createdAt).toBe(
      driverBefore.createdAt,
    );
  });

  it('completes an interrupted SGD 2 -> SGD 5 posting without understating the total', async () => {
    const caseRecord = await recoveryCase('p2f');
    const chargeRef = chargeRefFor(caseRecord);

    const first = await decisionFor(caseRecord, 200, { disposition: 'partial_refund' });
    const firstSettled = await postSettlement({ caseRecord, decision: first });
    expect(firstSettled.settlement.deltaRefundCents).toBe(200);
    expect(await postedRefundCents(chargeRef)).toBe(200);

    // The raise to SGD 5 crashes after the intent is written.
    const second = await decisionFor(caseRecord, 500, { supersedes: first.id });
    const settlementId = await writeInterruptedIntent({
      caseRecord,
      decisionId: second.id,
      chargeRef,
      targetRefundCents: 500,
      deltaRefundCents: 300,
      priorPostedCents: 200,
    });
    expect(await postedRefundCents(chargeRef)).toBe(200);

    const recovered = await postSettlement({ caseRecord, decision: second });

    expect(recovered.recovered).toBe(true);
    expect(recovered.settlement.status).toBe('posted');
    // Only the increment is posted, and the running total is right.
    expect(recovered.settlement.deltaRefundCents).toBe(300);
    expect(await postedRefundCents(chargeRef)).toBe(500);
    expect(await entryFilesFor(settlementId)).toHaveLength(2);

    const rider = recovered.receipts.find((receipt) => receipt.recipient === 'rider')!;
    expect(rider.body).toContain('Total refunded to date: SGD 5.00');
    expect(rider.body).toContain('Retained: SGD 0.00');
    const driver = recovered.receipts.find((receipt) => receipt.recipient === 'driver')!;
    expect(driver.body).toContain('Total simulated refund: SGD 5.00');
  });

  it('completes an interrupted SGD 2 -> SGD 3 posting with the correct increment', async () => {
    const caseRecord = await recoveryCase('p2p');
    const chargeRef = chargeRefFor(caseRecord);

    const first = await decisionFor(caseRecord, 200, { disposition: 'partial_refund' });
    await postSettlement({ caseRecord, decision: first });
    expect(await postedRefundCents(chargeRef)).toBe(200);

    const second = await decisionFor(caseRecord, 300, {
      supersedes: first.id,
      disposition: 'partial_refund',
    });
    await writeInterruptedIntent({
      caseRecord,
      decisionId: second.id,
      chargeRef,
      targetRefundCents: 300,
      deltaRefundCents: 100,
      priorPostedCents: 200,
    });

    const recovered = await postSettlement({ caseRecord, decision: second });

    expect(recovered.recovered).toBe(true);
    expect(recovered.settlement.deltaRefundCents).toBe(100);
    expect(await postedRefundCents(chargeRef)).toBe(300);

    const rider = recovered.receipts.find((receipt) => receipt.recipient === 'rider')!;
    expect(rider.headline).toBe('Refund recorded: SGD 1.00');
    expect(rider.body).toContain('Total refunded to date: SGD 3.00');
    expect(rider.body).toContain('Retained: SGD 2.00');
  });

  it('rebuilds an older receipt from that decision\u2019s frozen position, not today\u2019s total', async () => {
    const caseRecord = await recoveryCase('frozen');
    const chargeRef = chargeRefFor(caseRecord);

    const first = await decisionFor(caseRecord, 200, { disposition: 'partial_refund' });
    await postSettlement({ caseRecord, decision: first });

    const second = await decisionFor(caseRecord, 300, {
      supersedes: first.id,
      disposition: 'partial_refund',
    });
    await postSettlement({ caseRecord, decision: second });

    const third = await decisionFor(caseRecord, 500, { supersedes: second.id });
    await postSettlement({ caseRecord, decision: third });
    expect(await postedRefundCents(chargeRef)).toBe(500);

    // The second decision's driver receipt is lost *after* a later appeal moved
    // the charge on. Its rebuild must describe SGD 3.00, the position that
    // decision actually recorded — not today's SGD 5.00.
    await removeIfPresent(receiptFile(`rcpt_${second.id}_driver`));
    const repaired = await postSettlement({ caseRecord, decision: second });

    expect(repaired.recovered).toBe(true);
    const driver = repaired.receipts.find((receipt) => receipt.recipient === 'driver')!;
    expect(driver.body).toContain('SGD 3.00');
    expect(driver.body).not.toContain('SGD 5.00');

    // And the money did not move.
    expect(await postedRefundCents(chargeRef)).toBe(500);
    expect(await listSettlementsForCase(caseRecord.id)).toHaveLength(3);
  });
});
