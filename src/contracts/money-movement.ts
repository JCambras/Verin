/**
 * Money-movement arithmetic and the money-unit vocabulary shared by demo
 * presentation, metric rendering, and the semantic fences. These constants are the
 * SINGLE authority: `formatMetricValue` divides by `MINOR_UNITS_PER_MAJOR` and
 * renders `MONEY_CURRENCY`, and the golden-case semantic fence projects the same
 * values out of the demo, so a unit or currency change cannot pass unnoticed.
 */

/** Minor units (cents) in one major unit - the divisor every money render uses. */
export const MINOR_UNITS_PER_MAJOR = 100;
/** The ISO currency every money metric renders in. */
export const MONEY_CURRENCY = "USD";
/** The metric format money-class values carry (see `MetricFormat`). */
export const MONEY_METRIC_FORMAT = "currency-minor";
/** The cadence `reserveFloorMinor`'s horizon counts - reserves are months of withdrawals. */
export const RESERVE_CADENCE = "month";

/**
 * Whether a value is a quantity the arithmetic below accepts. Callers validating
 * untrusted input (fixtures, parsed documents) guard with this instead of
 * restating the rules, so a guard can never drift from what the authority throws on.
 */
export function isMoneyQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function reserveFloorMinor(monthlyWithdrawalMinor: number, reserveMonths: number): number {
  if (!isMoneyQuantity(monthlyWithdrawalMinor)) {
    throw new RangeError("monthlyWithdrawalMinor must be a non-negative safe integer");
  }
  if (!isMoneyQuantity(reserveMonths)) {
    throw new RangeError("reserveMonths must be a non-negative safe integer");
  }
  const floor = monthlyWithdrawalMinor * reserveMonths;
  if (!Number.isSafeInteger(floor)) throw new RangeError("reserve floor exceeds safe integer range");
  return floor;
}

/** Liquidity left for a movement after pending activity and the reserve floor. The
 * single authority for "available after reserve": a movement may proceed only when
 * its amount does not exceed this figure. Malformed quantities are refused here
 * rather than rendered as NaN. */
export function headroomMinor(availableMinor: number, pendingMinor: number, floorMinor: number): number {
  for (const quantity of [availableMinor, pendingMinor, floorMinor]) {
    if (!isMoneyQuantity(quantity)) throw new RangeError("headroom inputs must be non-negative safe integers");
  }
  return availableMinor - pendingMinor - floorMinor;
}

/** Convert a whole major-unit amount (dollars) to minor units, or null when the
 * input is not a quantity this vocabulary can express. */
export function minorFromMajor(amountMajor: unknown): number | null {
  if (!isMoneyQuantity(amountMajor)) return null;
  const minor = amountMajor * MINOR_UNITS_PER_MAJOR;
  return Number.isSafeInteger(minor) ? minor : null;
}
