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
// 1581/1650 (69), infrastructure 7780/7840 (60), presentation 2064/6000 (re-measured in the
// D-198 review round, which gives the tier ONE stated ordering in its own `table-order.ts` -
// banded, blanks-last, raw scalars rather than the formatted string a collator misreads - and
// reconciles the virtual window with the element the print pass scrolled; 1970 at D-197,
// 1915 at D-196, 1884 at D-195, 1840 at D-194, 1664 at D-192, 1645
// as the primitives landed). D-193
// recorded
// 1782 for a tree that measured 1804 - the figure was taken before that round finished
// landing, which is the exact staleness the paragraph below names, so D-194 re-took it
// with this file's own algorithm rather than inheriting it, and D-195 re-takes it again
// for the one-action recorded-order restore and the boundary reset key. A figure recorded
// here is a MEASUREMENT, so
// re-measure it in the commit that changes a layer - ADR-0049's import hoist left this
// line reading a stale figure while the layer had moved, and the whole ratchet chain rests
// on the recorded figure being the measured one. Any FURTHER increase remains a measured
// ADR amendment rather than a silent fence edit, and no correction is ever paid for by
// deleting documentation - nor, per ADR-0050, by folding readable code onto fewer lines.
// ADR-0054 raised contracts and domain for the prompt-9 policy AST and
// interpreter (the grammar module policy.ts plus the schema-introspection
// helpers in primitives/values.ts; the nine-file policy module: loader, checks,
// conflict prover, facts plane, four-phase evaluator, temporal math, trace).
// Its first figures were taken before the tree it describes had finished
// landing and went stale by 20/13 lines - the exact condition the paragraph
// above calls "a ceiling with a number nobody re-took". ADR-0054 is amended
// with figures RE-MEASURED on the tree as it lands after the prompt-9 review
// round (atomic Phase-0 unwind, brand-tight temporal bytes, constant-scoped
// temporal widening, single-walk key reads): contracts 6,555 against an
// unchanged 6,600 ceiling, and domain 4,063 - which passed the 4,050 ceiling,
// so the ceiling moved to 4,150. The SECOND review round (cascaded unwind of
// every primitive a rejected rule configured, per-parameter rejection
// attribution, one shared context-key precedence, the fail-closed
// future-observation freshness read, the constant-binding assembly guard)
// added 101 domain lines and passed 4,150 in turn: ADR-0054 is amended again to
// 4,250 against a re-measured 4,164, contracts unmoved at 6,555. The THIRD
// review round (discriminated predicate union, load-time structural nesting
// bound, fail-closed rejection implication, total evidence-requirement
// comparator, structural context-key-collision refusal) landed domain at 4,248
// - INSIDE 4,250 by two lines, which is the ADR-0033 failure mode this header
// exists to prevent, not a pass to bank. ADR-0054 is amended a third time to
// 6,650/4,350 against re-measured 6,567/4,248. Those figures then went stale in
// the very next commit: the FOURTH review round (load-time reservation of the
// synthesized blocker-code namespaces, the fail-closed non-scalar guard on the
// evidence and instruction fact arms, the per-version grammar-schema
// memoization, the integer-depth nesting walk) added 80 domain and 17 contracts
// lines without re-taking either number. ADR-0054 is amended a fourth time with
// figures RE-MEASURED on the tree as that correction lands: contracts 6,584 and
// domain 4,328 against UNCHANGED 6,650/4,350 ceilings - 66 and 22 lines of real
// headroom, named rather than banked, so the next change to `src/domain/**`
// reads as the measured ADR-0054 amendment it now is rather than as a code
// change. The SIXTH review round is that change: making key-shaping parameters
// non-writable added the catalog declaration in contracts and, in domain, the
// load check plus `load-effects.ts` - the module the 500-line PER-FILE ceiling
// forced, since `load-checks.ts` sat at 495 with all of `checkEffects` in it.
// That is one module header and one import block bought to keep the check where
// it belongs instead of folding code to fit (ADR-0050), and it is why the
// domain ceiling moves. ADR-0054 is amended a fifth time to domain 4,500 against
// a re-measured 4,400 (100 lines of correction room), contracts unmoved at 6,650
// against 6,602. The SEVENTH review round spends part of that room - resolving a
// context key by its DECLARED ORIGIN, so an intent entry can never stand in for a
// fact an unevaluable primitive did not publish - and re-takes both figures
// rather than inheriting them: domain 4,444 and contracts 6,602, against
// UNCHANGED 4,500/6,650 ceilings, 56 and 48 lines of headroom NAMED rather than
// banked. The post-merge temporal-canonicality guard (D-186, firm ruling
// p9-temporal-fact-bytes: declared registry types plumbed into resolveValue so
// non-canonical temporal bytes land the reading rule unevaluable) added 70
// domain lines and passed 4,514 - ADR-0054 is amended a sixth time to domain
// 4,550 (36 lines of headroom), contracts unmoved at 6,650 against an
// unchanged 6,602. Re-measure in any commit that
// changes a layer; a raise is always a measured ADR amendment.
const CEILINGS = {
  contracts: 6650, // ADR-0054, on the prompt-9 policy grammar (6,602 measured)
  domain: 4550, // ADR-0054, on the temporal-canonicality guard (D-186; 4,514 measured)
  infrastructure: 7840, // ADR-0051, on the scoped rebuild preview and counted provenance
  presentation: 6000, // grown only by an ADR bump (ADR-0012)
  // BUILD-TIME TOOLING under scripts/** (ADR-0052 amendment to ADR-0018). Until
  // v3 prompt 11 this tree was invisible to BOTH budget fences, so moving the
  // corpus generator out of src/ would have been evasion rather than
  // discipline. Measured 3636 at introduction; 3818 after the PR-11a review
  // round (D-078/D-080 split observation from business instants and replaced
  // substring resolution with structured parses), then 4254 after D-081 closed
  // the graph, intake, signoff, and measurement review findings. ADR-0052 raises
  // the ceiling from 4000 to 4300 with 46 lines of explicit headroom. D-082
  // raises it to 4900; D-084 records 4900 measured lines after the final
  // replay-intake review. D-085 raises it to 5900 against 5747 measured lines.
  // D-086 raises it to 6200 against 5996 measured lines for outcome-based
  // semantics, request-bound conflict topology, schema-driven uniqueness, and
  // assignment-aware determinism enforcement. D-152 raises it to 8000 against
  // 7941 measured lines for exact pending-action balance accounting. D-154
  // keeps it at 8000 against 7989 lines after settled-outgoing reconciliation.
  // D-155 raises it to 8100 against 8018 lines for transitive determinism
  // provenance and restriction lifecycle recomputation. D-158 (ADR-0052) raises
  // it to 8300 for the conflict-safe corpus substrate. The recorded figure then
  // went a round stale (8276 against an actual 8292), leaving EIGHT lines of
  // real headroom - the exact condition the header above argues against, where
  // the next one-line correction fails `pnpm test` on an unrelated ceiling and
  // the only remedy is an ADR amendment. D-167 (ADR-0052) re-measures 8446
  // lines AFTER the fail-closed evidence vocabulary, the spec-coverage check,
  // the narrowed executable-authority binding, and the parameterized signoff
  // root, and raises the ceiling to 8700 so a review round has room to correct
  // itself. That figure then went stale the same way, by 141 lines the two
  // review commits after it added, so D-172 KEEPS the ceiling at 8700 and
  // records the re-measured 8587 - 113 lines of real headroom. D-173 keeps it
  // at 8700 again and re-measures 8607 after the single-sourced real-derived
  // intake filename rule - 93 lines of real headroom. D-175 keeps it at 8700
  // once more and re-measures 8657 after the intake naming authority moved into
  // its own module, which the per-file ceiling forced and which costs one
  // module header - 43 lines of real headroom. D-176 keeps it at 8700 and
  // re-measures 8681 after the intake anchoring rule became a STRUCTURAL read
  // of the pattern rather than a first-and-last-character test - 19 lines of
  // real headroom, the narrowest this ceiling has run, named here so the next
  // change reads it as the ADR amendment it now is. D-177 raises it to 9300
  // against 9053 measured lines: the envelope arrives on the decision-ledger
  // trunk, whose OWN build-time tooling (`seed-decision-ledger.ts`,
  // `ledger-rebuild{,-args}.ts`, `decision-ledger-vacuity.ts`, plus the
  // chain-verify, restore-drill and seed edits) this bucket now measures for the
  // first time - 366 lines this branch did not write and cannot shrink. A
  // ceiling is measured on the tree AS IT LANDS, so it is re-taken here rather
  // than inherited. ADR-0055's consolidated wrap-up amendment (2026-08-10)
  // raises it to 12400 against 12,139 re-measured lines: the shared gate
  // constitution decomposed into `scripts/v3-gates/` modules under the 500-line
  // per-file ceiling (the ADR-0055 rule set, its ratchets, and the CI-workflow
  // authority the fences and the blocking runner both import), plus the
  // registry-validation consolidation - 261 lines of named correction headroom.
  // Every raise above is a
  // MEASURED ADR amendment recorded in ADR-0052 or ADR-0055, never a code
  // change - a ceiling raised without a measurement beside it is a ceiling
  // nobody is holding, and a measurement left stale is the same ceiling with a
  // number nobody re-took. Tooling is REPORTED SEPARATELY, never averaged into
  // a platform layer.
  //
  // `src/__tests__/**` is NOT in any bucket: 49,365 lines that no ceiling
  // holds (49,014 before the key-shaping load tests, property family G, and the
  // catalog-declaration fence check; 45,362 before the prompt-9 policy suites, property families, and
  // policy-ast fence landed beneath it; 37,529 before D-173 split the two oversized corpus fence files into
  // per-topic modules, which costs one import header per file; 38,125 before
  // the non-determinism scanner was decomposed into per-concern modules under
  // the same ceiling; 38,469 before D-175 made the shared corpus world rebuild
  // itself on a watch rerun and refuse an unpinned clock; 38,641 before D-176
  // proved the sharing seam against a counted double instead of two more real
  // validations; 38,728 before the decision-ledger suites and fences landed
  // beneath it). Every figure here is re-measured with this file's own
  // algorithm on the tree AS IT LANDS - the D-175 figure went a review round
  // stale by 80 lines, which is what the paragraph above says a number nobody
  // re-took is worth. That gap is recorded
  // honestly in D-172 under follow-up key `fu-corpus-test-tree-budget`, not left
  // implicit here.
  tooling: 12400,
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
    it("build-time tooling is charged to `tooling`, never to a platform layer (ADR-0052)", () => {
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
