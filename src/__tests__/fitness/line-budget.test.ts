import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Project } from "ts-morph";
import {
  localSpecifierTargets,
  moduleReferences,
  realProject,
  shippedSourceFiles,
  REPO_ROOT,
  type ModuleReference,
} from "./_fence-utils";
import { isAbsolute, join, relative } from "node:path";

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
// ADR-0038 raised domain and infrastructure for identifier provenance. Before
// ADR-0033, domain and infrastructure sat at exactly ZERO headroom, so one added
// line in either failed `pnpm test` on an unrelated ceiling and the only remedy was
// an ADR amendment rather than a code change - which is what compressed doc comments
// across contracts/metric.ts and contracts/provenance.ts and deleted the
// migrations.ts header AGENTS.md still points readers at. A ceiling that cannot
// absorb a correction buys no discipline; it just converts review findings into
// documentation deletions.
//
// MEASURED after D-093, with this file's own algorithm: contracts 4021/4050
// (29), domain 1298/1350 (52), infrastructure 3484/3550 (66). These are
// the real figures, not a stale decision-table row. Any FURTHER increase is still a
// measured ADR amendment, never a code change.
const CEILINGS = {
  contracts: 4050, // ADR-0035, on a re-measured 4,017 baseline
  domain: 1350, // ADR-0038, on a re-measured 1,298 baseline
  infrastructure: 3550, // ADR-0038, on a re-measured 3,484 baseline
  presentation: 6000, // grown only by an ADR bump (ADR-0012)
} as const;

const CONTRACTS_RUNTIME_DATA_ROOT = join(REPO_ROOT, "src/contracts");
const RUNTIME_DATA_ARTIFACT_CEILING = 620;
const RUNTIME_DATA_ARTIFACT_BASELINE = [
  "src/contracts/iana-time-zone-links-2026b.json",
  "src/contracts/iana-time-zones-2026b.json",
] as const;
const RUNTIME_JSON_REFERENCE_KINDS = new Set<ModuleReference["kind"]>([
  "import",
  "export",
  "dynamic-import",
  "require",
  "import-equals",
]);

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

function isWithinContractsRoot(artifact: string): boolean {
  const withinContracts = relative(CONTRACTS_RUNTIME_DATA_ROOT, artifact);
  return (
    withinContracts !== "" &&
    !withinContracts.startsWith("..") &&
    !isAbsolute(withinContracts)
  );
}

/**
 * The contracts registries a reference pulls into the runtime. The specifier is
 * RESOLVED through the same authority the dependency rule uses, never matched as
 * text: a `startsWith(".")` test calls `@contracts/registry.json` external, and a
 * generated registry lands under an alias with its lines charged to nothing.
 */
function runtimeDataArtifactTargets(
  project: Project,
  importer: string,
  reference: Pick<ModuleReference, "kind" | "specifier">,
): string[] {
  if (
    reference.specifier === null ||
    !RUNTIME_JSON_REFERENCE_KINDS.has(reference.kind)
  ) {
    return [];
  }
  return localSpecifierTargets(project, importer, reference.specifier).filter(
    (target) => target.endsWith(".json") && isWithinContractsRoot(target),
  );
}

/** Does any configured alias point DIRECTLY at a `.json` file? */
function mapsAliasOntoJson(project: Project): boolean {
  return Object.values(project.getCompilerOptions().paths ?? {}).some((targets) =>
    targets.some((target) => target.endsWith(".json")),
  );
}

function runtimeDataArtifactPaths(project: Project): string[] {
  // A specifier is spelled literally in its importing file, so a file whose text
  // never says `.json` reaches an artifact only through a mapping that HIDES the
  // extension. tsconfig configures none today, which is what makes skipping those
  // files exact rather than a sampled shortcut - and the moment one is configured
  // the whole tree is scanned instead of trusting the spelling.
  const scanEveryFile = mapsAliasOntoJson(project);
  const paths = new Set<string>();
  for (const sourceFile of project.getSourceFiles()) {
    if (!scanEveryFile && !sourceFile.getFullText().includes(".json")) continue;
    for (const reference of moduleReferences(sourceFile)) {
      for (const artifact of runtimeDataArtifactTargets(
        project,
        sourceFile.getFilePath(),
        reference,
      )) {
        paths.add(artifact);
      }
    }
  }
  return [...paths].sort();
}

function physicalLineCount(text: string): number {
  if (text.length === 0) return 0;
  const newlineCount = text.split("\n").length - 1;
  return newlineCount + (text.endsWith("\n") ? 0 : 1);
}

function measureRuntimeDataArtifacts(paths: readonly string[]): number {
  return paths.reduce(
    (total, path) =>
      total + physicalLineCount(readFileSync(path, "utf8")),
    0,
  );
}

function runtimeDataArtifactBudgetViolations(total: number): string[] {
  if (total === 0) {
    return [
      "runtime-data-artifacts: 0 lines measured - import discovery went stale",
    ];
  }
  return total > RUNTIME_DATA_ARTIFACT_CEILING
    ? [
        `runtime-data-artifacts: ${total} lines exceed ceiling ${RUNTIME_DATA_ARTIFACT_CEILING} - review generated registry growth and amend its separate budget`,
      ]
    : [];
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

describe("runtime JSON data-artifact budget", () => {
  const project = realProject();
  const paths = runtimeDataArtifactPaths(project);
  const total = measureRuntimeDataArtifacts(paths);

  it(`enforces: imported contracts registries are explicit and within ${RUNTIME_DATA_ARTIFACT_CEILING} lines [now ${total}]`, () => {
    expect(
      paths.map((path) => relative(REPO_ROOT, path)),
    ).toEqual(RUNTIME_DATA_ARTIFACT_BASELINE);
    expect(
      runtimeDataArtifactBudgetViolations(total),
    ).toEqual([]);
  });

  describe("detects (companion): the data budget cannot pass incompletely", () => {
    it("fails a planted artifact total above the separate ceiling", () => {
      expect(runtimeDataArtifactBudgetViolations(
        RUNTIME_DATA_ARTIFACT_CEILING + 1,
      )).toEqual([
        expect.stringContaining("exceed ceiling"),
      ]);
    });

    it("fails an empty discovery result instead of passing vacuously", () => {
      expect(runtimeDataArtifactBudgetViolations(0)).toEqual([
        expect.stringContaining("discovery went stale"),
      ]);
    });

    it("discovers a runtime JSON import through EVERY spelling that reaches contracts", () => {
      const importer = join(CONTRACTS_RUNTIME_DATA_ROOT, "probe.ts");
      const artifact = join(CONTRACTS_RUNTIME_DATA_ROOT, "probe.json");
      for (const specifier of [
        "./probe.json",
        // An ALIASED registry is the same artifact under another name: resolved,
        // never text-matched, or its lines are charged to nothing.
        "@contracts/probe.json",
        "@/contracts/probe.json",
      ]) {
        expect(
          runtimeDataArtifactTargets(project, importer, { kind: "import", specifier }),
          specifier,
        ).toEqual([artifact]);
      }
      for (const reference of [
        { kind: "import-type", specifier: "./probe.json" },
        { kind: "import", specifier: "package/probe.json" },
        { kind: "import", specifier: "./probe.ts" },
        { kind: "import", specifier: "../probe.json" },
        { kind: "import", specifier: "@app/probe.json" },
      ] as const) {
        expect(
          runtimeDataArtifactTargets(project, importer, reference),
          reference.specifier,
        ).toEqual([]);
      }
    });

    it("scans every file when an alias maps directly onto a .json target", () => {
      expect(mapsAliasOntoJson(project)).toBe(false);
      expect(
        mapsAliasOntoJson({
          getCompilerOptions: () => ({ paths: { "@registry": ["./src/contracts/big.json"] } }),
        } as unknown as Project),
      ).toBe(true);
    });

    it("counts a trailing newline as termination, not an empty line", () => {
      expect(physicalLineCount("one\ntwo\n")).toBe(2);
      expect(physicalLineCount("one\ntwo")).toBe(2);
      expect(physicalLineCount("")).toBe(0);
    });
  });
});
