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
      requiredReserveMinor: 4_800_000,
      headroomMinor: 29_700_000,
      reserveSatisfied: true,
    });
    expect(projectReserve({ ...base, reserveMonths: 12 })).toEqual({
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

    expect(projectReserve({ ...lowHeadroom, reserveMonths: 6 })).toEqual({
      requiredReserveMinor: 4_800_000,
      headroomMinor: 1_700_000,
      reserveSatisfied: true,
    });
    expect(projectReserve({ ...lowHeadroom, reserveMonths: 12 })).toEqual({
      requiredReserveMinor: 9_600_000,
      headroomMinor: -3_100_000,
      reserveSatisfied: false,
    });
  });

  it("moves headroom by exactly the pending amount, so dropping a pending term overstates liquidity", () => {
    const base = {
      availableMinor: 16_000_000,
      requestMinor: 7_500_000,
      plannedMonthlyMinor: 800_000,
      reserveMonths: 12,
    };
    const counted = projectReserve({ ...base, pendingMinor: 2_000_000 });
    const dropped = projectReserve({ ...base, pendingMinor: 0 });
    expect(dropped.headroomMinor - counted.headroomMinor).toBe(2_000_000);
  });

  it("omitting the request term overstates headroom by the request amount", () => {
    const base = {
      availableMinor: 42_000_000,
      pendingMinor: 0,
      plannedMonthlyMinor: 800_000,
      reserveMonths: 6,
    };
    const counted = projectReserve({ ...base, requestMinor: 7_500_000 });
    const omitted = projectReserve({ ...base, requestMinor: 0 });
    expect(omitted.headroomMinor - counted.headroomMinor).toBe(7_500_000);
  });
});
