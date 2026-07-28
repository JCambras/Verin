/** Money-movement arithmetic shared by demo presentation and semantic fences. */
export function reserveFloorMinor(monthlyWithdrawalMinor: number, reserveMonths: number): number {
  if (!Number.isSafeInteger(monthlyWithdrawalMinor) || monthlyWithdrawalMinor < 0) {
    throw new RangeError("monthlyWithdrawalMinor must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(reserveMonths) || reserveMonths < 0) {
    throw new RangeError("reserveMonths must be a non-negative safe integer");
  }
  const floor = monthlyWithdrawalMinor * reserveMonths;
  if (!Number.isSafeInteger(floor)) throw new RangeError("reserve floor exceeds safe integer range");
  return floor;
}
