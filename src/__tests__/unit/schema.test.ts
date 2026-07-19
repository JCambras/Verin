import { describe, it, expect } from "vitest";
import { DATA_DICTIONARY } from "@domain/schema/dictionary";
import { ENTITY_NAMES } from "@domain/schema/entities";
import { SF_MAPPING } from "@domain/schema/sf-mapping";
import { resolveConflict, type Candidate } from "@domain/schema/golden-record";
import type { RecordProvenance } from "@contracts/provenance";

const prov = (source: RecordProvenance["source"], asOf: string, confidence: RecordProvenance["confidence"] = "high"): RecordProvenance => ({ source, asOf, confidence });

describe("data dictionary", () => {
  it("covers every entity name", () => {
    expect(Object.keys(DATA_DICTIONARY).sort()).toEqual([...ENTITY_NAMES].sort());
  });
});

describe("sf-mapping (documentation) references only modeled fields", () => {
  it("every mapped field exists in the data dictionary (no speculative fields)", () => {
    const bad: string[] = [];
    for (const [entity, fields] of Object.entries(SF_MAPPING)) {
      const dict = DATA_DICTIONARY[entity as keyof typeof DATA_DICTIONARY];
      for (const field of Object.keys(fields ?? {})) {
        if (!dict || !(field in dict)) bad.push(`${entity}.${field}`);
      }
    }
    expect(bad, `SF mapping references unmodeled fields: ${bad.join(", ")}`).toEqual([]);
  });
});

describe("golden-record survivorship", () => {
  const c = (value: string, p: RecordProvenance): Candidate<string> => ({ value, provenance: p });

  it("source-precedence: verin-crm beats salesforce", () => {
    const r = resolveConflict("source-precedence", [
      c("sf", prov("salesforce", "2026-07-01")),
      c("house", prov("verin-crm", "2026-01-01")),
    ]);
    expect(r.winner.value).toBe("house");
    expect(r.needsManual).toBe(false);
  });

  it("most-recent: newest asOf wins", () => {
    const r = resolveConflict("most-recent", [
      c("old", prov("verin-crm", "2026-01-01")),
      c("new", prov("verin-crm", "2026-07-01")),
    ]);
    expect(r.winner.value).toBe("new");
  });

  it("highest-confidence: high beats low", () => {
    const r = resolveConflict("highest-confidence", [
      c("lo", prov("verin-crm", "2026-07-01", "low")),
      c("hi", prov("verin-crm", "2026-01-01", "high")),
    ]);
    expect(r.winner.value).toBe("hi");
  });

  it("manual: flags for human resolution", () => {
    const r = resolveConflict("manual", [
      c("a", prov("verin-crm", "2026-07-01")),
      c("b", prov("salesforce", "2026-07-02")),
    ]);
    expect(r.needsManual).toBe(true);
  });

  it("single candidate resolves without manual", () => {
    const r = resolveConflict("manual", [c("only", prov("verin-crm", "2026-07-01"))]);
    expect(r.needsManual).toBe(false);
    expect(r.winner.value).toBe("only");
  });
});
