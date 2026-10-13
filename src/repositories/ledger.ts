import path from 'node:path';
import {
  CaseDecisionSchema,
  ChargeRecordSchema,
  LedgerEntrySchema,
  PartyReceiptSchema,
  SettlementSchema,
  type CaseDecision,
  type CaseRecord,
  type ChargeRecord,
  type LedgerEntry,
  type PartyReceipt,
  type Settlement,
} from '../domain/contracts';
import { formatSgd } from '../domain/money';
import { checkDecisionAmount } from '../domain/settlement';
import { listJsonFiles, readJson, RUNTIME_DIR, withLock, writeJsonAtomic } from './store';

const LEDGER_DIR = path.join(RUNTIME_DIR, 'ledger');
const CHARGES_FILE = path.join(LEDGER_DIR, 'charges.json');
const SETTLEMENTS_DIR = path.join(LEDGER_DIR, 'settlements');
const RECEIPTS_DIR = path.join(LEDGER_DIR, 'receipts');
const DECISIONS_DIR = path.join(RUNTIME_DIR, 'decisions');

/**
 * Demo allocation split, used only to produce balanced mock ledger entries.
 * This is a stated prototype assumption, not Ryde's real fare allocation.
 */
const MOCK_DRIVER_SHARE_BPS = 8000;

/* ------------------------------------------------------------------ */
/*  Charges                                                            */
/* ------------------------------------------------------------------ */

/** One charge per trip, shared by any dispute raised against that trip. */
export function chargeRefFor(caseRecord: CaseRecord): string {
  return `charge_${caseRecord.trip.id}`;
}

async function readCharges(): Promise<Record<string, ChargeRecord>> {
  return (await readJson<Record<string, ChargeRecord>>(CHARGES_FILE)) ?? {};
}

export async function getCharge(ref: string): Promise<ChargeRecord | null> {
  const all = await readCharges();
  return all[ref] ?? null;
}

export async function ensureCharge(caseRecord: CaseRecord): Promise<ChargeRecord> {
  const ref = chargeRefFor(caseRecord);
  const existing = await getCharge(ref);
  if (existing) return existing;

  const driverAllocationCents = Math.round(
    (caseRecord.disputedCents * MOCK_DRIVER_SHARE_BPS) / 10_000,
  );
  const record = ChargeRecordSchema.parse({
    ref,
    caseId: caseRecord.id,
    tripId: caseRecord.trip.id,
    originalChargeCents: caseRecord.disputedCents,
    driverAllocationCents,
    platformFeeCents: caseRecord.disputedCents - driverAllocationCents,
  });

  await withLock('ledger-charges', async () => {
    const all = await readCharges();
    if (all[ref]) return;
    all[ref] = record;
    await writeJsonAtomic(CHARGES_FILE, all);
  });

  return (await getCharge(ref)) ?? record;
}

/* ------------------------------------------------------------------ */
/*  Decisions                                                          */
/* ------------------------------------------------------------------ */

function decisionFile(id: string): string {
  return path.join(DECISIONS_DIR, `${id}.json`);
}

export async function getDecision(id: string): Promise<CaseDecision | null> {
  const raw = await readJson<unknown>(decisionFile(id));
  return raw ? CaseDecisionSchema.parse(raw) : null;
}

export async function listDecisionsForCase(caseId: string): Promise<CaseDecision[]> {
  const files = await listJsonFiles(DECISIONS_DIR);
  const decisions: CaseDecision[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readJson<unknown>(path.join(DECISIONS_DIR, file));
    if (!raw) continue;
    const parsed = CaseDecisionSchema.safeParse(raw);
    if (parsed.success && parsed.data.caseId === caseId) decisions.push(parsed.data);
  }
  return decisions.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function recordDecision(
  input: Omit<CaseDecision, 'id' | 'createdAt'> & { id?: string },
): Promise<CaseDecision> {
  const decision = CaseDecisionSchema.parse({
    ...input,
    id: input.id ?? `dec_${input.caseId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  });
  await withLock(`decision:${decision.id}`, async () => {
    await writeJsonAtomic(decisionFile(decision.id), decision);
  });
  return decision;
}

/**
 * The decision currently in force: the newest decision that no later decision
 * supersedes. Superseded decisions are kept for history.
 */
export async function effectiveDecisionForCase(caseId: string): Promise<CaseDecision | null> {
  const decisions = await listDecisionsForCase(caseId);
  if (decisions.length === 0) return null;
  const superseded = new Set(
    decisions.map((decision) => decision.supersedesDecisionId).filter((id): id is string => Boolean(id)),
  );
  const live = decisions.filter((decision) => !superseded.has(decision.id));
  return live[live.length - 1] ?? decisions[decisions.length - 1] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Settlements and receipts                                           */
/* ------------------------------------------------------------------ */

function settlementFile(id: string): string {
  return path.join(SETTLEMENTS_DIR, `${id}.json`);
}

export async function getSettlement(id: string): Promise<Settlement | null> {
  const raw = await readJson<unknown>(settlementFile(id));
  return raw ? SettlementSchema.parse(raw) : null;
}

export async function listSettlements(): Promise<Settlement[]> {
  const files = await listJsonFiles(SETTLEMENTS_DIR);
  const settlements: Settlement[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readJson<unknown>(path.join(SETTLEMENTS_DIR, file));
    if (!raw) continue;
    const parsed = SettlementSchema.safeParse(raw);
    if (parsed.success) settlements.push(parsed.data);
  }
  return settlements.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export async function listSettlementsForCase(caseId: string): Promise<Settlement[]> {
  const all = await listSettlements();
  return all.filter((settlement) => settlement.caseId === caseId);
}

export async function listReceiptsForDecision(decisionId: string): Promise<PartyReceipt[]> {
  const files = await listJsonFiles(RECEIPTS_DIR);
  const receipts: PartyReceipt[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readJson<unknown>(path.join(RECEIPTS_DIR, file));
    if (!raw) continue;
    const parsed = PartyReceiptSchema.safeParse(raw);
    if (parsed.success && parsed.data.decisionId === decisionId) receipts.push(parsed.data);
  }
  return receipts;
}

/**
 * Total refund already posted against a charge. Used so an appeal or a
 * duplicate dispute posts only the difference, never the same money twice.
 */
export async function postedRefundCents(chargeRef: string): Promise<number> {
  const all = await listSettlements();
  return all
    .filter((settlement) => settlement.chargeRef === chargeRef && settlement.status === 'posted')
    .reduce((total, settlement) => total + settlement.deltaRefundCents, 0);
}

/**
 * The canonical charge for a case, read without creating it.
 *
 * `ensureCharge` seeds the charge from the first case to dispute the trip, so
 * once it exists it — not the case record — is the authority on what was
 * charged. Callers use this to validate against the same figure the settlement
 * service will use.
 */
export async function canonicalChargeCents(caseRecord: CaseRecord): Promise<number> {
  const existing = await getCharge(chargeRefFor(caseRecord));
  return existing?.originalChargeCents ?? caseRecord.disputedCents;
}

export interface SettlementResult {
  settlement: Settlement;
  receipts: PartyReceipt[];
  /** True when an identical settlement already existed and was not re-posted. */
  replayed: boolean;
  /** True when a retry completed a posting that had been left incomplete. */
  recovered: boolean;
}

/**
 * Posts the simulated settlement for a decision.
 *
 * Idempotent on `chargeRef + decisionId`, and cumulative across decisions on the
 * same charge: a superseding decision posts only `target - alreadyPosted`. A
 * negative difference is flagged for manual adjustment rather than silently
 * recharging a rider. No payment provider is contacted.
 *
 * Recoverable by construction. The settlement record is written as `pending`
 * *before* any ledger entry, so a crash mid-post leaves a findable record rather
 * than orphan entries. Entry and receipt ids are derived from the decision id,
 * so retrying rewrites the same files instead of posting a second credit.
 */
export async function postSettlement(input: {
  caseRecord: CaseRecord;
  decision: CaseDecision;
}): Promise<SettlementResult> {
  const { caseRecord, decision } = input;

  if (decision.disposition === 'insufficient_evidence') {
    throw new Error('An insufficient-evidence closure carries no financial ruling and cannot settle.');
  }

  const charge = await ensureCharge(caseRecord);

  // Second line of defence, and the authoritative one. The reviewer form also
  // checks, but the ledger must be unable to post more than was charged no
  // matter which path reached it — including a decision recorded by a script or
  // by the automatic completion path.
  const checked = checkDecisionAmount({
    disposition: decision.disposition,
    targetRefundCents: decision.targetRefundCents,
    chargeCents: charge.originalChargeCents,
  });
  if (!checked.ok) throw new Error(checked.reason);

  const target = checked.targetRefundCents ?? 0;
  const idempotencyKey = `${charge.ref}:${decision.id}`;
  // Stable, derived from the decision: a retry targets the same record.
  const settlementId = `set_${decision.id}`;

  return withLock(`charge-settlement:${charge.ref}`, async () => {
    const existing = (await listSettlements()).find(
      (settlement) => settlement.idempotencyKey === idempotencyKey,
    );
    if (existing) return resumeSettlement({ caseRecord, decision, charge, existing });

    const alreadyPosted = await postedRefundCents(charge.ref);
    const delta = target - alreadyPosted;
    const retainedCents = Math.max(0, charge.originalChargeCents - target);
    const now = new Date().toISOString();

    const base = {
      id: settlementId,
      caseId: caseRecord.id,
      decisionId: decision.id,
      chargeRef: charge.ref,
      mode: 'simulation' as const,
      originalChargeCents: charge.originalChargeCents,
      targetRefundCents: target,
      deltaRefundCents: Math.max(0, delta),
      retainedCents,
      idempotencyKey,
      createdAt: now,
      // Frozen now, while the ledger still describes this decision's position.
      // Recovery reads these instead of re-deriving from a ledger that later
      // appeals will have moved on from.
      priorPostedCents: alreadyPosted,
      totalRefundedCents: alreadyPosted + Math.max(0, delta),
    };

    // A negative difference means the decision asks for less than what is
    // already posted. This MVP never claws money back automatically.
    if (delta < 0) {
      const flagged = SettlementSchema.parse({
        ...base,
        status: 'manual_adjustment_required',
        ledgerEntryIds: [],
        failureReason: `Decision target ${formatSgd(target)} is below the ${formatSgd(alreadyPosted)} already posted for this charge. A human must adjust the ledger.`,
        postedAt: null,
      });
      await writeJsonAtomic(settlementFile(flagged.id), flagged);
      return { settlement: flagged, receipts: [], replayed: false, recovered: false };
    }

    // Intent is persisted before any ledger write, so a crash between here and
    // the `posted` flip is recoverable rather than invisible.
    const pending = SettlementSchema.parse({
      ...base,
      status: 'pending',
      ledgerEntryIds: ledgerEntryIdsFor(settlementId, delta),
      failureReason: null,
      postedAt: null,
    });
    await writeJsonAtomic(settlementFile(pending.id), pending);

    return completePosting({
      caseRecord,
      decision,
      charge,
      pending,
      recovered: false,
    });
  });
}

/** Both parties must be able to read the same financial effect. */
const REQUIRED_RECEIPTS: PartyReceipt['recipient'][] = ['rider', 'driver'];

/**
 * The refund already posted before this settlement.
 *
 * Settlements written before the frozen field existed fall back to posted
 * history, which is correct for them: a legacy `posted` settlement's increment
 * is included in `postedRefundCents`, whereas a legacy `pending` one is not
 * (that function only counts posted settlements), so no double subtraction is
 * possible either way.
 */
async function priorPostedFor(settlement: Settlement): Promise<number> {
  if (typeof settlement.priorPostedCents === 'number') return settlement.priorPostedCents;
  const posted = await postedRefundCents(settlement.chargeRef);
  return settlement.status === 'posted' ? Math.max(0, posted - settlement.deltaRefundCents) : posted;
}

/**
 * Picks up a settlement that already exists: repairs an incomplete posting, or
 * rebuilds receipts that were lost after the money was posted.
 */
async function resumeSettlement(input: {
  caseRecord: CaseRecord;
  decision: CaseDecision;
  charge: ChargeRecord;
  existing: Settlement;
}): Promise<SettlementResult> {
  const { caseRecord, decision, charge, existing } = input;

  // Terminal states need no repair. Receipts for a manual-adjustment flag are
  // deliberately empty — nothing was posted, so there is nothing to tell a party.
  if (existing.status === 'manual_adjustment_required' || existing.status === 'failed') {
    return {
      settlement: existing,
      receipts: await listReceiptsForDecision(decision.id),
      replayed: true,
      recovered: false,
    };
  }

  if (existing.status === 'posted') {
    // Money is posted. Receipts are two separate writes, so one can exist while
    // the other does not — a partial set must be completed, not treated as done.
    // Only receipts linked to *this* settlement count; a receipt from another
    // decision on the same case cannot satisfy this one.
    const linked = (await listReceiptsForDecision(decision.id)).filter(
      (receipt) => receipt.settlementId === existing.id,
    );
    const missing = REQUIRED_RECEIPTS.filter(
      (recipient) => !linked.some((receipt) => receipt.recipient === recipient),
    );
    if (missing.length === 0) {
      return { settlement: existing, receipts: linked, replayed: true, recovered: false };
    }
    // Rebuild only what is missing, reusing the stable receipt ids. This writes
    // no ledger entry, so it cannot post a second credit.
    const rebuilt = await writeReceipts({
      caseRecord,
      decision,
      settlement: existing,
      charge,
      only: missing,
    });
    return { settlement: existing, receipts: rebuilt, replayed: true, recovered: true };
  }

  // status === 'pending': the posting was interrupted. Redo it from the intent,
  // using the position frozen into that intent. The pending increment is not in
  // `postedRefundCents`, so re-deriving here would subtract it twice.
  return completePosting({
    caseRecord,
    decision,
    charge,
    pending: existing,
    recovered: true,
  });
}

/** Writes the ledger entries, flips the settlement to posted, then issues receipts. */
async function completePosting(input: {
  caseRecord: CaseRecord;
  decision: CaseDecision;
  charge: ChargeRecord;
  pending: Settlement;
  recovered: boolean;
}): Promise<SettlementResult> {
  const { caseRecord, decision, charge, pending, recovered } = input;
  const delta = pending.deltaRefundCents;
  const alreadyPosted = await priorPostedFor(pending);
  const now = pending.postedAt ?? new Date().toISOString();

  for (const entry of ledgerEntriesFor({ settlement: pending, delta, alreadyPosted })) {
    await writeLedgerEntry(entry);
  }

  const posted = SettlementSchema.parse({ ...pending, status: 'posted', failureReason: null, postedAt: now });
  await writeJsonAtomic(settlementFile(posted.id), posted);

  const receipts = await writeReceipts({
    caseRecord,
    decision,
    settlement: posted,
    charge,
  });
  return { settlement: posted, receipts, replayed: false, recovered };
}

/** Stable ids derived from the settlement, so a retry overwrites rather than duplicates. */
function ledgerEntryIdsFor(settlementId: string, delta: number): string[] {
  return delta === 0 ? [`led_${settlementId}_0`] : [`led_${settlementId}_0`, `led_${settlementId}_1`];
}

function ledgerEntriesFor(input: {
  settlement: Settlement;
  delta: number;
  alreadyPosted: number;
}): LedgerEntry[] {
  const { settlement, delta, alreadyPosted } = input;

  if (delta === 0) {
    // Uphold, or a decision already fully satisfied: an auditable
    // zero-adjustment completion event rather than a fake refund.
    return [
      LedgerEntrySchema.parse({
        id: `led_${settlement.id}_0`,
        settlementId: settlement.id,
        account: 'rider',
        direction: 'zero_adjustment',
        amountCents: 0,
        note:
          alreadyPosted > 0
            ? `No further adjustment: ${formatSgd(alreadyPosted)} already posted for this charge.`
            : 'No adjustment to the disputed charge.',
      }),
    ];
  }

  return [
    LedgerEntrySchema.parse({
      id: `led_${settlement.id}_0`,
      settlementId: settlement.id,
      account: 'rider',
      direction: 'credit',
      amountCents: delta,
      note: `Simulated refund for ${settlement.chargeRef}.`,
    }),
    LedgerEntrySchema.parse({
      id: `led_${settlement.id}_1`,
      settlementId: settlement.id,
      account: 'platform_fee_clearing',
      direction: 'debit',
      amountCents: delta,
      note: `Reverse simulated fee allocation for ${settlement.chargeRef}.`,
    }),
  ];
}

async function writeLedgerEntry(entry: LedgerEntry): Promise<void> {
  await writeJsonAtomic(path.join(LEDGER_DIR, 'entries', `${entry.id}.json`), entry);
}

/**
 * Party receipts, written from the **cumulative** position rather than this
 * decision's increment alone.
 *
 * The wording trap this avoids: a superseding decision that adds nothing (an
 * appeal confirming the same outcome) has a zero increment, and a zero increment
 * is not the same thing as "the fee stands". It means the refund already
 * recorded remains in force.
 *
 * Receipt ids are derived from the decision, so rebuilding a missing receipt
 * overwrites the same file and cannot double-count.
 *
 * The financial position comes from the settlement's own frozen figures, never
 * from today's ledger: a later appeal must not rewrite what an earlier decision
 * told the parties.
 */
async function writeReceipts(input: {
  caseRecord: CaseRecord;
  decision: CaseDecision;
  settlement: Settlement;
  charge: ChargeRecord;
  /** Write only these recipients. The others are still returned to the caller. */
  only?: PartyReceipt['recipient'][];
}): Promise<PartyReceipt[]> {
  const { decision, settlement, charge } = input;
  const priorPostedCents = await priorPostedFor(settlement);
  const now = new Date().toISOString();

  const thisAdjustment = settlement.deltaRefundCents;
  const totalRefunded = priorPostedCents + thisAdjustment;
  const retained = Math.max(0, charge.originalChargeCents - totalRefunded);
  const source = decision.source === 'ai' ? 'automated review' : 'human reviewer';

  const priorLine =
    priorPostedCents > 0
      ? ` A refund of ${formatSgd(priorPostedCents)} was already recorded before this decision.`
      : '';

  let riderHeadline: string;
  let riderBody: string;
  let driverHeadline: string;
  let driverBody: string;

  if (totalRefunded === 0) {
    riderHeadline = 'The disputed fee stands';
    riderBody = `No change to the disputed charge. The full ${formatSgd(charge.originalChargeCents)} stands. Decision source: ${source}.`;
    driverHeadline = 'Disputed fee upheld';
    driverBody = `The disputed ${formatSgd(charge.originalChargeCents)} fee stands. No adjustment was applied to the simulated driver allocation.`;
  } else if (thisAdjustment === 0) {
    // Zero additional money after a refund is the refund continuing, not the
    // fee standing. Saying otherwise would contradict the ledger.
    riderHeadline = `Refund stands: ${formatSgd(totalRefunded)}`;
    riderBody = `This decision adds nothing further.${priorLine} Total refunded to date: ${formatSgd(totalRefunded)}. Retained: ${formatSgd(retained)}. Decision source: ${source}.`;
    driverHeadline = `No further adjustment: ${formatSgd(totalRefunded)} refunded`;
    driverBody = `This decision changes nothing on the ledger.${priorLine} Total simulated refund against ${charge.ref}: ${formatSgd(totalRefunded)}. The driver allocation of ${formatSgd(charge.driverAllocationCents)} is unaffected by this prototype ledger.`;
  } else {
    riderHeadline = `Refund recorded: ${formatSgd(thisAdjustment)}`;
    riderBody = `Original charge ${formatSgd(charge.originalChargeCents)}.${priorLine} Refund recorded by this decision: ${formatSgd(thisAdjustment)}. Total refunded to date: ${formatSgd(totalRefunded)}. Retained: ${formatSgd(retained)}. Decision source: ${source}.`;
    driverHeadline = `Refund recorded: ${formatSgd(thisAdjustment)}`;
    driverBody = `A simulated refund of ${formatSgd(thisAdjustment)} was recorded against ${charge.ref}.${priorLine} Total simulated refund: ${formatSgd(totalRefunded)}. Driver allocation of ${formatSgd(charge.driverAllocationCents)} is unaffected by this prototype ledger.`;
  }

  const rider = PartyReceiptSchema.parse({
    id: `rcpt_${decision.id}_rider`,
    decisionId: decision.id,
    settlementId: settlement.id,
    recipient: 'rider',
    mode: 'local_preview',
    headline: riderHeadline,
    body: riderBody,
    createdAt: now,
  });

  const driver = PartyReceiptSchema.parse({
    id: `rcpt_${decision.id}_driver`,
    decisionId: decision.id,
    settlementId: settlement.id,
    recipient: 'driver',
    mode: 'local_preview',
    headline: driverHeadline,
    body: driverBody,
    createdAt: now,
  });

  for (const receipt of [rider, driver]) {
    if (input.only && !input.only.includes(receipt.recipient)) continue;
    await writeJsonAtomic(path.join(RECEIPTS_DIR, `${receipt.id}.json`), receipt);
  }
  return [rider, driver];
}
