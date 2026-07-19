import { describe, it, expect } from "vitest";
import { DATA_DICTIONARY, type FieldSpec } from "@domain/schema/dictionary";
import { isSyntheticSource } from "@contracts/provenance";

/**
 * NO-UNLABELED-SYNTHETIC FENCE (ADR-0005, charter #3). Schema-level half of "no
 * unlabeled synthetic data, ever": any field whose source is synthetic
 * (estimate/default/fixture) MUST NOT be allowed to feed a compliance decision.
 * The DISPLAY-level half shipped in Phase E: FreshValue (app/presentation)
 * requires a provenance prop, so every rendered value carries its source/asOf
 * label. The CI displayed-metric->source trace remains deferred (Vale V12;
 * trigger: before any synthetic/estimated value renders).
 */

export function checkSyntheticLabeling(
  dictionary: Record<string, Record<string, FieldSpec>>,
): string[] {
  const out: string[] = [];
  for (const [entity, fields] of Object.entries(dictionary)) {
    for (const [field, spec] of Object.entries(fields)) {
      if (isSyntheticSource(spec.provenance.defaultSource) && spec.provenance.canFeedCompliance) {
        out.push(`${entity}.${field}: synthetic source '${spec.provenance.defaultSource}' must not feed a compliance decision (canFeedCompliance must be false)`);
      }
    }
  }
  return out;
}

describe("no-unlabeled-synthetic fence (schema policy)", () => {
  it("enforces: no synthetic-sourced field may feed a compliance decision", () => {
    const violations = checkSyntheticLabeling(DATA_DICTIONARY);
    expect(violations, `synthetic fields that can feed compliance:\n${violations.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a mislabeled synthetic field is caught", () => {
    it("flags a synthetic field with canFeedCompliance = true", () => {
      const v = checkSyntheticLabeling({
        Foo: {
          aum: { type: "number", nullable: false, provenance: { defaultSource: "estimate", survivorship: "manual", canFeedCompliance: true } },
        },
      });
      expect(v.length).toBe(1);
    });
    it("allows a synthetic field that cannot feed compliance", () => {
      const v = checkSyntheticLabeling({
        Foo: {
          aum: { type: "number", nullable: false, provenance: { defaultSource: "estimate", survivorship: "manual", canFeedCompliance: false } },
        },
      });
      expect(v).toEqual([]);
    });
  });
});
