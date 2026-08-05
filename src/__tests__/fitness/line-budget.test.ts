import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  shippedSourceFiles,
  REPO_ROOT,
  toolingSourceFiles,
} from "./_fence-utils";
import { join, relative } from "node:path";

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
// ADR-0037 raised domain alone for pre-load runtime tenant validation,
// ADR-0038 raised domain and infrastructure for identifier provenance,
// ADR-0040 raised contracts for the prompt-8 primitive catalog, and
// ADR-0041 raised all three for the prompt-7 decision ledger. Before
// ADR-0033, domain and infrastructure sat at exactly ZERO headroom, so one added
// line in either failed `pnpm test` on an unrelated ceiling and the only remedy was
// an ADR amendment rather than a code change - which is what compressed doc comments
// across contracts/metric.ts and contracts/provenance.ts and deleted the
// migrations.ts header AGENTS.md still points readers at. A ceiling that cannot
// absorb a correction buys no discipline; it just converts review findings into
// documentation deletions.
//
// ADR-0048 restored the migration prose an earlier correction had compressed away to
// fit this ceiling - the exact anti-pattern the paragraph above names - and raised
// infrastructure to absorb it. ADR-0051 then raised contracts and infrastructure together
// for the scoped rebuild preview, the whole-chain counted provenance, and the shared
// decision-id extractor the dedup moved INTO contracts. MEASURED on the composed tree that
// also carries ADR-0040's prompt-8 primitive catalog: contracts 6064/6110 (46), domain
// 1581/1650 (69), infrastructure 7780/7840 (60), presentation 928/6000. A figure recorded
// here is a MEASUREMENT, so
// re-measure it in the commit that changes a layer - ADR-0049's import hoist left this
// line reading a stale figure while the layer had moved, and the whole ratchet chain rests
// on the recorded figure being the measured one. Any FURTHER increase remains a measured
// ADR amendment rather than a silent fence edit, and no correction is ever paid for by
// deleting documentation - nor, per ADR-0050, by folding readable code onto fewer lines.
const CEILINGS = {
  contracts: 6110, // ADR-0051, on the shared decision-id extractor and provenance fold
  domain: 1650, // ADR-0041, on ADR-0038's baseline plus the pure ledger projection
  infrastructure: 7840, // ADR-0051, on the scoped rebuild preview and counted provenance
  presentation: 6000, // grown only by an ADR bump (ADR-0012)
  // BUILD-TIME TOOLING under scripts/** (ADR-0034 amendment to ADR-0018). Until
  // v3 prompt 11 this tree was invisible to BOTH budget fences, so moving the
  // corpus generator out of src/ would have been evasion rather than
  // discipline. Measured 3636 at introduction; 3818 after the PR-11a review
  // round (D-078/D-080 split observation from business instants and replaced
  // substring resolution with structured parses), then 4254 after D-081 closed
  // the graph, intake, signoff, and measurement review findings. ADR-0034 raises
  // the ceiling from 4000 to 4300 with 46 lines of explicit headroom. D-082
  // raises it to 4900; D-084 records 4900 measured lines after the final
  // replay-intake review. D-085 raises it to 5900 against 5747 measured lines.
  // D-086 raises it to 6200 against 5996 measured lines for outcome-based
  // semantics, request-bound conflict topology, schema-driven uniqueness, and
  // assignment-aware determinism enforcement. Current amendment history and
  // measurements are recorded in ADR-0034. D-122 raises it to 8000 against
  // 7941 measured lines for exact pending-action balance accounting. D-124
  // keeps it at 8000 against 7989 lines after settled-outgoing reconciliation.
  // D-125 raises it to 8100 against 8018 lines for transitive determinism
  // provenance and restriction lifecycle recomputation.
  // The ratchet-down after
  // the corpus generator's first
  // post-prompt-19 simplification pass now has real work to do. Tooling is REPORTED SEPARATELY,
  // never averaged into a platform layer.
  tooling: 8300,
} as const;

type Bucket = keyof typeof CEILINGS | "other";

function bucket(file: string): Bucket {
  const r = relative(REPO_ROOT, file).replace(/\\/g, "/");
  if (r.startsWith("src/app/presentation/")) return "presentation";
  if (r.startsWith("src/contracts/")) return "contracts";
  if (r.startsWith("src/domain/")) return "domain";
  if (r.startsWith("src/infrastructure/")) return "infrastructure";
  if (r.startsWith("scripts/")) return "tooling";
  return "other";
}

/** Build-time tooling files - the tree the platform fences never walked. */
export function toolingFiles(root?: string): string[] {
  return toolingSourceFiles(root);
}

export function measureBudgets(): Record<keyof typeof CEILINGS, number> {
  const totals = { contracts: 0, domain: 0, infrastructure: 0, presentation: 0, tooling: 0 };
  for (const f of [...shippedSourceFiles(), ...toolingFiles()]) {
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
    it("build-time tooling is charged to `tooling`, never to a platform layer (ADR-0034)", () => {
      expect(bucket(`${REPO_ROOT}scripts/corpus/generate.ts`)).toBe("tooling");
      expect(bucket(`${REPO_ROOT}scripts/db-seed.ts`)).toBe("tooling");
      expect(bucket(`${REPO_ROOT}src/contracts/x.ts`)).toBe("contracts");
    });
    it("the tooling bucket measures a NON-EMPTY tree, so moving code to scripts/ cannot hide it", () => {
      expect(toolingFiles().length).toBeGreaterThanOrEqual(10);
      expect(totals.tooling).toBeGreaterThan(0);
      const v = budgetViolations({ ...totals, tooling: 0 });
      expect(v.some((m) => m.startsWith("tooling:") && m.includes("stale"))).toBe(true);
    });
    it("the tooling aggregate discovers every supported executable source extension", () => {
      const dir = mkdtempSync(join(tmpdir(), "verin-tooling-budget-"));
      try {
        const names = [
          "a.ts",
          "b.tsx",
          "c.mts",
          "d.cts",
          "e.js",
          "f.jsx",
          "g.mjs",
          "h.cjs",
        ];
        for (const name of [...names, "ignored.txt"]) {
          writeFileSync(join(dir, name), "// source\n");
        }
        expect(
          toolingFiles(dir)
            .map((file) => relative(dir, file))
            .sort(),
        ).toEqual(names.sort());
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
