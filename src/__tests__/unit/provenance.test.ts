import { describe, it, expect } from "vitest";
import {
  canFeedComplianceDecision,
  deriveArtifactProvenance,
  foldStoredProvenance,
  isSyntheticSource,
  provenanceLabel,
  provenanced,
  syntheticBadgeLabel,
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

  it("badges a synthetic value with its OWN class, never one fixed class", () => {
    expect(syntheticBadgeLabel(p("estimate"))).toBe("estimate");
    expect(syntheticBadgeLabel(p("default"))).toBe("default");
    expect(syntheticBadgeLabel(p("fixture"))).toBe("synthetic fixture");
    expect(syntheticBadgeLabel(p("verin-crm"))).toBeNull();
  });

  it("badges a derivation from the synthetic leaves that made it a demonstration", () => {
    const asOf = "2026-07-18T12:00:00.000Z";
    const estimated = deriveArtifactProvenance([p("verin-crm"), p("estimate")], asOf);
    expect(syntheticBadgeLabel(estimated)).toBe("estimate");
    expect(syntheticBadgeLabel(deriveArtifactProvenance([estimated, p("fixture")], asOf)))
      .toBe("estimate · synthetic fixture");
    expect(syntheticBadgeLabel(deriveArtifactProvenance([p("verin-crm")], asOf))).toBeNull();
  });

  it("folds stored facts onto the LATEST asOf, and withholds an empty fold", () => {
    const folded = foldStoredProvenance([
      { source: "fixture", asOf: "2026-07-18T12:00:00.000Z", confidence: "high" },
      { source: "verin-crm", asOf: "2026-07-20T12:00:00.000Z", confidence: "low" },
    ]);
    expect(folded).toMatchObject({ asOf: "2026-07-20T12:00:00.000Z", demonstration: true });
    expect(foldStoredProvenance([])).toBeNull();
  });

  it("binds a value to its provenance", () => {
    const v = provenanced(42, p("verin-crm"));
    expect(v.value).toBe(42);
    expect(v.provenance.source).toBe("verin-crm");
  });
});
