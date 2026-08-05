import { describe, expect, it } from "vitest";
import { formatMetricValue, metric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";

const provenance: RecordProvenance = {
  source: "verin-crm",
  asOf: "2026-08-05T00:00:00.000Z",
  confidence: "high",
};

describe("metric formatting", () => {
  it.each([
    [0, "$0.00"],
    [-0, "-$0.00"],
    [1, "$0.01"],
    [1.5, "$0.02"],
    [123456789, "$1,234,567.89"],
    [-1050, "-$10.50"],
    [Number.NaN, "$NaN"],
    [Number.POSITIVE_INFINITY, "$∞"],
    [Number.NEGATIVE_INFINITY, "-$∞"],
  ])("formats %s minor units deterministically", (value, expected) => {
    expect(
      formatMetricValue(metric(value, "currency-minor", provenance)),
    ).toBe(expected);
  });
});
