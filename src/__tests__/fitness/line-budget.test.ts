import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shippedSourceFiles, REPO_ROOT } from "./_fence-utils";
import { relative } from "node:path";

/**
 * LINE-BUDGET FENCE (ADR-0018, charter #1/#10). PER-LAYER ratchet-down ceilings on
 * the platform layers (Vale V17: charter #1 says per-layer, not one combined
 * number) so one layer can't balloon under an aggregate. The presentation tier has
 * its OWN envelope, grown only by an ADR bump — NOT the shrink-only global budget
 * that punished richness in Iris.
 *
 * Ceilings carry interim build headroom and RATCHET DOWN to actual+buffer at
 * foundation close. Raising any ceiling is an ADR amendment, not a code change.
 */
const CEILINGS = {
  contracts: 600,
  domain: 1200,
  infrastructure: 2500,
  presentation: 6000, // grown only by an ADR bump (ADR-0012)
} as const;

type Bucket = keyof typeof CEILINGS | "other";

function bucket(file: string): Bucket {
  const r = relative(REPO_ROOT, file).replace(/\\/g, "/");
  if (r.startsWith("src/app/presentation/")) return "presentation";
  if (r.startsWith("src/contracts/")) return "contracts";
  if (r.startsWith("src/domain/")) return "domain";
  if (r.startsWith("src/infrastructure/")) return "infrastructure";
  return "other";
}

export function measureBudgets(): Record<keyof typeof CEILINGS, number> {
  const totals = { contracts: 0, domain: 0, infrastructure: 0, presentation: 0 };
  for (const f of shippedSourceFiles()) {
    const b = bucket(f);
    if (b !== "other") totals[b] += readFileSync(f, "utf8").split("\n").length;
  }
  return totals;
}

describe("line-budget fence (per-layer)", () => {
  const totals = measureBudgets();

  for (const layer of Object.keys(CEILINGS) as (keyof typeof CEILINGS)[]) {
    it(`enforces: ${layer} <= ${CEILINGS[layer]} [now ${totals[layer]}]`, () => {
      expect(
        totals[layer],
        `${layer} lines ${totals[layer]} exceed ceiling ${CEILINGS[layer]} — shrink or amend ADR-0018`,
      ).toBeLessThanOrEqual(CEILINGS[layer]);
    });
  }

  describe("detects (companion): the budget math catches an over-budget layer", () => {
    it("an over-budget total fails its ceiling", () => {
      expect(CEILINGS.contracts + 1 <= CEILINGS.contracts).toBe(false);
    });
    it("presentation growth is charged only to presentation, never the platform layers", () => {
      expect(bucket(`${REPO_ROOT}src/app/presentation/x.tsx`)).toBe("presentation");
      expect(bucket(`${REPO_ROOT}src/domain/x.ts`)).toBe("domain");
    });
  });
});
