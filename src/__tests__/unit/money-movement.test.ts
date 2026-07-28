import { describe, expect, it } from "vitest";
import { reserveFloorMinor } from "@contracts/money-movement";

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
});
