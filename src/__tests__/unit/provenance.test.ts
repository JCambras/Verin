import { describe, it, expect } from "vitest";
import {
  canFeedComplianceDecision,
  isSyntheticSource,
  provenanceLabel,
  provenanced,
  type RecordProvenance,
} from "@contracts/provenance";

const p = (source: RecordProvenance["source"]): RecordProvenance => ({ source, asOf: "2026-07-18T12:00:00.000Z", confidence: "high" });

describe("provenance", () => {
  it("synthetic sources cannot feed a compliance decision (charter #3)", () => {
    for (const s of ["estimate", "default", "fixture"] as const) {
      expect(isSyntheticSource(s)).toBe(true);
      expect(canFeedComplianceDecision(p(s))).toBe(false);
    }
  });

  it("real sources can feed a compliance decision", () => {
    for (const s of ["verin-crm", "user-input", "salesforce"] as const) {
      expect(isSyntheticSource(s)).toBe(false);
      expect(canFeedComplianceDecision(p(s))).toBe(true);
    }
  });

  it("renders a human-visible source/asOf label", () => {
    expect(provenanceLabel(p("verin-crm"))).toBe("Verin CRM · as of 2026-07-18");
    expect(provenanceLabel(p("estimate"))).toBe("Estimated · as of 2026-07-18");
  });

  it("binds a value to its provenance", () => {
    const v = provenanced(42, p("verin-crm"));
    expect(v.value).toBe(42);
    expect(v.provenance.source).toBe("verin-crm");
  });
});
