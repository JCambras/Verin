import { describe, expect, it } from "vitest";
import {
  MINOR_UNITS_PER_MAJOR,
  headroomMinor,
  isMoneyQuantity,
  minorFromMajor,
  reserveFloorMinor,
  tryHeadroomMinor,
  tryReserveFloorMinor,
} from "@contracts/money-movement";
import { formatMetricValue, metric } from "@contracts/metric";

describe("money-movement arithmetic", () => {
  it("derives the signed six-month and twelve-month reserve floors", () => {
    expect(reserveFloorMinor(800_000, 6)).toBe(4_800_000);
    expect(reserveFloorMinor(800_000, 12)).toBe(9_600_000);
  });

  it("refuses invalid minor-unit inputs and unsafe results", () => {
    expect(() => reserveFloorMinor(-1, 6)).toThrow(/non-negative safe integer/);
    expect(() => reserveFloorMinor(800_000, 6.5)).toThrow(/non-negative safe integer/);
    expect(() => reserveFloorMinor(Number.MAX_SAFE_INTEGER, 12)).toThrow(/safe integer range/);
  });

  it("reports invalid and overflowing derived arithmetic without throwing", () => {
    expect(tryReserveFloorMinor(800_000, 12)).toBe(9_600_000);
    expect(tryReserveFloorMinor(Number.MAX_SAFE_INTEGER, 12)).toBeNull();
    expect(tryReserveFloorMinor(800_000, 6.5)).toBeNull();
    expect(tryHeadroomMinor(42_000_000, 0, 4_800_000)).toBe(37_200_000);
    expect(tryHeadroomMinor(0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(tryHeadroomMinor(42_000_000, -1, 4_800_000)).toBeNull();
  });

  it("exposes the SAME predicate it throws on, so guards cannot drift from it", () => {
    for (const bad of [undefined, null, "6", -1, 6.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(isMoneyQuantity(bad), String(bad)).toBe(false);
      expect(() => reserveFloorMinor(800_000, bad as number)).toThrow(RangeError);
    }
    expect(isMoneyQuantity(0)).toBe(true);
    expect(isMoneyQuantity(12)).toBe(true);
  });

  it("converts whole-dollar amounts to minor units and reports, never throws, on the rest", () => {
    expect(minorFromMajor(75_000)).toBe(7_500_000);
    expect(minorFromMajor(null)).toBeNull();
    expect(minorFromMajor("8000")).toBeNull();
    expect(minorFromMajor(8_000.5)).toBeNull();
  });

  it("derives headroom from available liquidity, pending activity, and the floor", () => {
    // GC-02: $420,000 available, no pending activity, twelve-month floor $96,000.
    expect(headroomMinor(42_000_000, 0, reserveFloorMinor(800_000, 12))).toBe(32_400_000);
    // GC-10's $160,000 pool: clears Firm A's floor, not Firm B's, at a $75,000 request.
    expect(headroomMinor(16_000_000, 0, reserveFloorMinor(800_000, 6))).toBeGreaterThanOrEqual(7_500_000);
    expect(headroomMinor(16_000_000, 0, reserveFloorMinor(800_000, 12))).toBeLessThan(7_500_000);
    // A breach is a negative figure, not a thrown error - it is a real thing to display.
    expect(headroomMinor(4_000_000, 0, 9_600_000)).toBe(-5_600_000);
  });

  it("refuses headroom inputs that are not money quantities", () => {
    for (const bad of [undefined, null, "0", -1, 1.5, Number.NaN]) {
      expect(() => headroomMinor(42_000_000, bad as number, 4_800_000)).toThrow(/non-negative safe integers/);
      expect(() => headroomMinor(bad as number, 0, 4_800_000)).toThrow(/non-negative safe integers/);
      expect(() => headroomMinor(42_000_000, 0, bad as number)).toThrow(/non-negative safe integers/);
    }
    expect(() => headroomMinor(0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(/safe integer range/);
  });

  it("renders money through the same divisor the arithmetic counts in", () => {
    const floor = reserveFloorMinor(800_000, 6);
    const rendered = formatMetricValue(metric(floor, "currency-minor", { source: "computed", asOf: "2026-07-26", confidence: "high" }));
    expect(rendered).toBe("$48,000.00");
    expect(floor / Number(rendered.replace(/[^0-9.]/g, ""))).toBe(MINOR_UNITS_PER_MAJOR);
  });
});
