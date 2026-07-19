import { describe, it, expect } from "vitest";
import {
  deriveArtifactProvenance,
  canFeedComplianceDecision,
  isDemonstration,
  DEMO_WATERMARK,
  SYNTHETIC_SOURCES,
  SOURCE_SYSTEMS,
  type RecordProvenance,
  type DerivedProvenance,
  type SourceSystem,
} from "@contracts/provenance";

/**
 * DERIVED-PROVENANCE FENCE (charter #3 EXTENSION; ADR-0022). The display-through-
 * derivation half of "synthetic can never feed a compliance decision": a value
 * DERIVED from labeled-synthetic input (a health score / compliance-scan result over
 * a demo household) is itself synthetic — a "demonstration" artifact — and must be
 * refused by every compliance decision point. This fence proves the derivation LAW
 * (`deriveArtifactProvenance` + `canFeedComplianceDecision`) mechanically, so the
 * charter #3 trace runs end-to-end through derived artifacts. The `no-unlabeled-
 * synthetic` fence covers the schema half; this one covers the derived half.
 *
 * Non-tautological: the check runs the REAL contract functions; the companion feeds
 * a BROKEN derivation to prove the check rejects a law that lets synthetic-derived
 * values feed compliance.
 */

type Derive = (inputs: readonly RecordProvenance[], asOf: string) => DerivedProvenance;
type CanFeed = (p: RecordProvenance | DerivedProvenance) => boolean;

const asOf = "2026-07-19T00:00:00.000Z";
const prov = (source: SourceSystem): RecordProvenance => ({ source, asOf, confidence: "high" });

/**
 * The derivation law (ADR-0022):
 *  1. ANY synthetic input  => derived artifact is a demonstration AND cannot feed compliance;
 *  2. all-real inputs      => NOT a demonstration AND may feed compliance;
 *  3. source of a derived artifact is always "computed" (the trace records what it was derived from).
 */
export function checkDerivationLaw(derive: Derive, canFeed: CanFeed): string[] {
  const out: string[] = [];
  const real: SourceSystem[] = SOURCE_SYSTEMS.filter((s) => !SYNTHETIC_SOURCES.includes(s));

  for (const syn of SYNTHETIC_SOURCES) {
    // one synthetic input alongside a real one still poisons the derived artifact
    const d = derive([prov(real[0]!), prov(syn)], asOf);
    if (!d.demonstration) out.push(`input '${syn}' must make the derived artifact a demonstration`);
    if (canFeed(d)) out.push(`a demonstration derived from '${syn}' must NOT feed a compliance decision`);
    if (d.source !== "computed") out.push(`derived artifact source must be 'computed', got '${d.source}'`);
  }

  const allReal = derive(real.map(prov), asOf);
  if (allReal.demonstration) out.push(`an all-real derivation must NOT be a demonstration`);
  if (!canFeed(allReal)) out.push(`an all-real derivation must be allowed to feed a compliance decision`);

  return out;
}

describe("derived-provenance fence (charter #3 extension)", () => {
  it("enforces: the derivation law holds for the real contract functions", () => {
    const violations = checkDerivationLaw(deriveArtifactProvenance, canFeedComplianceDecision);
    expect(violations, `derivation-law violations:\n${violations.join("\n")}`).toEqual([]);
  });

  it("enforces: a demonstration artifact is recognised and carries the watermark vocabulary", () => {
    const demo = deriveArtifactProvenance([prov("verin-crm"), prov("fixture")], asOf);
    expect(isDemonstration(demo)).toBe(true);
    expect(demo.derivedFrom).toEqual(["verin-crm", "fixture"]);
    expect(DEMO_WATERMARK.length).toBeGreaterThan(0);
  });

  describe("detects (companion): a broken derivation law is caught", () => {
    it("flags a derivation that never marks synthetic-derived artifacts as demonstrations", () => {
      const brokenDerive: Derive = (_inputs, at) => ({ source: "computed", asOf: at, confidence: "low", demonstration: false, derivedFrom: [] });
      const v = checkDerivationLaw(brokenDerive, canFeedComplianceDecision);
      expect(v.length).toBeGreaterThan(0);
    });
    it("flags a canFeed that lets a demonstration feed compliance", () => {
      const brokenCanFeed: CanFeed = (p) => !SYNTHETIC_SOURCES.includes(p.source); // ignores `demonstration`
      const v = checkDerivationLaw(deriveArtifactProvenance, brokenCanFeed);
      expect(v.some((m) => m.includes("must NOT feed"))).toBe(true);
    });
    it("passes the real, correct contract functions", () => {
      expect(checkDerivationLaw(deriveArtifactProvenance, canFeedComplianceDecision)).toEqual([]);
    });
  });
});
