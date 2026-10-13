import type { DecisionDisposition } from './contracts';
import { formatSgd } from './money';

/**
 * The financial invariant for a decision.
 *
 * A dispute is raised against exactly one charged fare, and the only thing a
 * decision may do is give some of that charge back. So the permitted outcomes are
 * closed:
 *
 *   uphold              → refund nothing
 *   refund              → refund the whole disputed charge
 *   partial_refund      → refund a positive amount strictly below the charge
 *   insufficient_evidence → no financial ruling at all
 *
 * This is enforced in the domain, called from the reviewer action *and* again
 * from the settlement service. A form-level check alone is not a guarantee: the
 * ledger must be unable to post more than was charged no matter who calls it.
 *
 * Goodwill compensation is deliberately not modelled here. It is not a refund of
 * the charge, and paying it out of the disputed fare would make the ledger lie
 * about what was charged. If it is ever wanted it needs its own funding source.
 */

export interface AmountCheckInput {
  disposition: DecisionDisposition;
  targetRefundCents: number | null;
  /** The canonical charged fare for this dispute, in integer cents. */
  chargeCents: number;
}

export type AmountCheck =
  | { ok: true; targetRefundCents: number | null }
  | { ok: false; reason: string };

export function checkDecisionAmount(input: AmountCheckInput): AmountCheck {
  const { disposition, targetRefundCents, chargeCents } = input;

  if (!Number.isInteger(chargeCents) || chargeCents <= 0) {
    return {
      ok: false,
      reason: `The disputed charge must be a positive integer number of cents, received ${chargeCents}.`,
    };
  }

  if (disposition === 'insufficient_evidence') {
    if (targetRefundCents !== null) {
      return {
        ok: false,
        reason: 'A closure without a liability ruling cannot carry a refund amount.',
      };
    }
    return { ok: true, targetRefundCents: null };
  }

  if (disposition === 'uphold') {
    if (targetRefundCents !== null && targetRefundCents !== 0) {
      return {
        ok: false,
        reason: `Upholding the charge means refunding nothing, but ${formatSgd(targetRefundCents)} was recorded.`,
      };
    }
    return { ok: true, targetRefundCents: 0 };
  }

  // refund / partial_refund
  if (targetRefundCents === null) {
    return { ok: false, reason: 'A refund needs an amount.' };
  }
  if (!Number.isFinite(targetRefundCents) || !Number.isInteger(targetRefundCents)) {
    return {
      ok: false,
      reason: 'A refund must be a whole number of cents. Check the amount and try again.',
    };
  }
  if (targetRefundCents < 0) {
    return { ok: false, reason: 'A refund cannot be negative.' };
  }
  if (targetRefundCents > chargeCents) {
    return {
      ok: false,
      reason: `A refund cannot exceed the ${formatSgd(chargeCents)} disputed charge, but ${formatSgd(targetRefundCents)} was recorded.`,
    };
  }

  if (disposition === 'refund' && targetRefundCents !== chargeCents) {
    return {
      ok: false,
      reason: `A full refund must be the whole ${formatSgd(chargeCents)} disputed charge, but ${formatSgd(targetRefundCents)} was recorded. Record a partial refund instead.`,
    };
  }

  if (disposition === 'partial_refund' && targetRefundCents === chargeCents) {
    return {
      ok: false,
      reason: `A partial refund must be below the ${formatSgd(chargeCents)} disputed charge. Record a full refund instead.`,
    };
  }

  if (disposition === 'partial_refund' && targetRefundCents === 0) {
    return {
      ok: false,
      reason: 'A partial refund must be above zero. Uphold the charge instead.',
    };
  }

  return { ok: true, targetRefundCents };
}

/**
 * A superseding decision may only ever move the refund up. Moving it down would
 * mean clawing money back from a party, which this prototype never does
 * automatically — it is surfaced for manual adjustment instead.
 */
export function additionalRefundCents(target: number, alreadyPosted: number): number {
  return Math.max(0, target - alreadyPosted);
}
