import { describe, expect, it } from "vitest";
import { projectReserve } from "@domain/money-movement/reserve-projection";

describe("reserve projection", () => {
  it("derives the signed Firm A and Firm B floors from one monthly schedule", () => {
    const base = {
      availableMinor: 42_000_000,
      pendingMinor: 0,
      requestMinor: 7_500_000,
      plannedMonthlyMinor: 800_000,
    };

    expect(projectReserve({ ...base, reserveMonths: 6 })).toEqual({
      effectiveLiquidityMinor: 42_000_000,
      balanceAfterRequestMinor: 34_500_000,
      requiredReserveMinor: 4_800_000,
      headroomMinor: 29_700_000,
      reserveSatisfied: true,
    });
    expect(projectReserve({ ...base, reserveMonths: 12 })).toEqual({
      effectiveLiquidityMinor: 42_000_000,
      balanceAfterRequestMinor: 34_500_000,
      requiredReserveMinor: 9_600_000,
      headroomMinor: 24_900_000,
      reserveSatisfied: true,
    });
  });

  it("includes pending activity before deciding whether the reserve remains satisfied", () => {
    const lowHeadroom = {
      availableMinor: 16_000_000,
      pendingMinor: 2_000_000,
      requestMinor: 7_500_000,
      plannedMonthlyMinor: 800_000,
    };

    expect(projectReserve({ ...lowHeadroom, reserveMonths: 6 }).reserveSatisfied).toBe(true);
    expect(projectReserve({ ...lowHeadroom, reserveMonths: 12 })).toMatchObject({
      effectiveLiquidityMinor: 14_000_000,
      balanceAfterRequestMinor: 6_500_000,
      requiredReserveMinor: 9_600_000,
      headroomMinor: -3_100_000,
      reserveSatisfied: false,
    });
  });
});
