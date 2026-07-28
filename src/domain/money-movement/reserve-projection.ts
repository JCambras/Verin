/**
 * Deterministic reserve projection shared by the demo and the future evaluator.
 * Money stays in integer minor units. Policy supplies the horizon and household
 * evidence supplies the monthly schedule.
 */
export interface ReserveProjectionInput {
  readonly availableMinor: number;
  readonly pendingMinor: number;
  readonly requestMinor: number;
  readonly plannedMonthlyMinor: number;
  readonly reserveMonths: number;
}

export interface ReserveProjection {
  readonly requiredReserveMinor: number;
  readonly headroomMinor: number;
  readonly reserveSatisfied: boolean;
}

export function projectReserve(input: ReserveProjectionInput): ReserveProjection {
  const effectiveLiquidityMinor = input.availableMinor - input.pendingMinor;
  const balanceAfterRequestMinor = effectiveLiquidityMinor - input.requestMinor;
  const requiredReserveMinor = input.plannedMonthlyMinor * input.reserveMonths;
  const headroomMinor = balanceAfterRequestMinor - requiredReserveMinor;
  return {
    requiredReserveMinor,
    headroomMinor,
    reserveSatisfied: headroomMinor >= 0,
  };
}
