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
// ADR-0033 amended these to the smallest rounded envelopes that leave BOUNDED room
// for correction; ADR-0034 and ADR-0036 raised infrastructure alone,
// ADR-0035 raised contracts alone for normalized failure snapshots,
// ADR-0037 raised domain alone for pre-load runtime tenant validation, and
// ADR-0038 raised domain and infrastructure for identifier provenance, and
// ADR-0039 raised contracts for the signed-money authorities. Before
// ADR-0033, domain and infrastructure sat at exactly ZERO headroom, so one added
// line in either failed `pnpm test` on an unrelated ceiling and the only remedy was
// an ADR amendment rather than a code change - which is what compressed doc comments
// across contracts/metric.ts and contracts/provenance.ts and deleted the
// migrations.ts header AGENTS.md still points readers at. A ceiling that cannot
// absorb a correction buys no discipline; it just converts review findings into
// documentation deletions.
//
// MEASURED after D-121, with this file's own algorithm: contracts 4111/4150
// (39), domain 1298/1350 (52), infrastructure 3484/3550 (66). These are
// the real figures, not a stale decision-table row. Any FURTHER increase is still a
// measured ADR amendment, never a code change.
const CEILINGS = {
  contracts: 4150, // ADR-0039, on a re-measured 4,111 baseline
  domain: 1350, // ADR-0038, on a re-measured 1,298 baseline
  infrastructure: 3550, // ADR-0038, on a re-measured 3,484 baseline
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

/** The real budget check, callable with synthetic totals by the companion. */
export function budgetViolations(totals: Record<keyof typeof CEILINGS, number>): string[] {
  const out: string[] = [];
  for (const layer of Object.keys(CEILINGS) as (keyof typeof CEILINGS)[]) {
    // A ZERO total means the bucket's path pattern went stale (a renamed layer
    // path silently drops its envelope) — fail loudly, never pass vacuously.
    if (totals[layer] === 0) out.push(`${layer}: 0 lines measured — bucket path went stale (charter #4)`);
    if (totals[layer] > CEILINGS[layer]) out.push(`${layer}: ${totals[layer]} lines exceed ceiling ${CEILINGS[layer]} — shrink or amend ADR-0018`);
  }
  return out;
}

describe("line-budget fence (per-layer)", () => {
  const totals = measureBudgets();

  it(`enforces: every layer is measured (non-zero) and within its ceiling [now ${JSON.stringify(totals)}]`, () => {
    const violations = budgetViolations(totals);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  describe("detects (companion): the REAL check fails synthetic violations", () => {
    it("an over-budget layer total fails through budgetViolations", () => {
      const v = budgetViolations({ ...totals, contracts: CEILINGS.contracts + 1 });
      expect(v.some((m) => m.startsWith("contracts:") && m.includes("exceed"))).toBe(true);
    });
    it("an EMPTY bucket (renamed layer path) fails instead of passing vacuously", () => {
      const v = budgetViolations({ ...totals, presentation: 0 });
      expect(v.some((m) => m.startsWith("presentation:") && m.includes("stale"))).toBe(true);
    });
    it("the current real measurement passes (the companion is not asserting on a broken baseline)", () => {
      expect(budgetViolations(totals)).toEqual([]);
    });
    it("presentation growth is charged only to presentation, never the platform layers", () => {
      expect(bucket(`${REPO_ROOT}src/app/presentation/x.tsx`)).toBe("presentation");
      expect(bucket(`${REPO_ROOT}src/domain/x.ts`)).toBe("domain");
    });
  });
});
