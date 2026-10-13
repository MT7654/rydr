/**
 * Route comparison. Uses supplied planned/actual road-path lengths, in metres,
 * with provenance preserved. GPS segment sums are estimates only, and a
 * straight-line pickup/dropoff distance is not an optimal driving route.
 */

export interface RouteFacts {
  plannedDistanceM: number | null;
  actualDistanceM: number | null;
  gpsSegmentSumM: number | null;
}

export interface RouteComparison {
  plannedDistanceM: number | null;
  actualDistanceM: number | null;
  excessMeters: number | null;
  excessPercent: number | null;
  /** Requires BOTH thresholds to be exceeded; equality does not exceed. */
  deviationFlagged: boolean;
  measurable: boolean;
}

export function compareRoutes(
  facts: RouteFacts,
  thresholds: { excessPercent: number; excessMeters: number },
): RouteComparison {
  const { plannedDistanceM, actualDistanceM } = facts;
  const measurable =
    plannedDistanceM !== null && actualDistanceM !== null && plannedDistanceM > 0;

  if (!measurable) {
    return {
      plannedDistanceM,
      actualDistanceM,
      excessMeters: null,
      excessPercent: null,
      deviationFlagged: false,
      measurable: false,
    };
  }

  const planned = plannedDistanceM as number;
  const actual = actualDistanceM as number;
  const excessMeters = actual - planned;
  const excessPercent = (excessMeters / planned) * 100;

  return {
    plannedDistanceM: planned,
    actualDistanceM: actual,
    excessMeters,
    excessPercent,
    deviationFlagged:
      excessMeters > thresholds.excessMeters &&
      excessPercent > thresholds.excessPercent,
    measurable: true,
  };
}

/**
 * Fare ledger reconciliation. Components must sum to the final charged fare;
 * otherwise the inconsistency is surfaced rather than silently absorbed.
 */
export interface LedgerLine {
  component: string;
  amountCents: number;
}

export interface LedgerCheck {
  finalFareCents: number;
  componentSumCents: number;
  reconciled: boolean;
  differenceCents: number;
}

export function reconcileLedger(
  lines: LedgerLine[],
  finalFareCents: number,
): LedgerCheck {
  const componentSumCents = lines.reduce((total, line) => total + line.amountCents, 0);
  const differenceCents = componentSumCents - finalFareCents;
  return {
    finalFareCents,
    componentSumCents,
    reconciled: differenceCents === 0,
    differenceCents,
  };
}
