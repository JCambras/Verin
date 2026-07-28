import { describe, expect, it } from "vitest";
import {
  MINOR_UNITS_PER_MAJOR,
  isMoneyQuantity,
  minorFromMajor,
  reserveFloorMinor,
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

  it("renders money through the same divisor the arithmetic counts in", () => {
    const floor = reserveFloorMinor(800_000, 6);
    const rendered = formatMetricValue(metric(floor, "currency-minor", { source: "computed", asOf: "2026-07-26", confidence: "high" }));
    expect(rendered).toBe("$48,000.00");
    expect(floor / Number(rendered.replace(/[^0-9.]/g, ""))).toBe(MINOR_UNITS_PER_MAJOR);
  });
});
