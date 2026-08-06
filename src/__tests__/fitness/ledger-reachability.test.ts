import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Node, SyntaxKind, type Project } from "ts-morph";
import {
  REPO_ROOT,
  inMemoryProject,
  normalizedPath,
  realSemanticProject,
} from "./_fence-utils";

/**
 * LEDGER REACHABILITY FENCE (charter #5, "nothing built-but-not-shipped").
 *
 * `knip` cannot see this class: every ledger export has a TEST importing it, so a
 * capability that no surface, route, or script can reach still counts as used. This
 * fence derives reachability from SHIPPED callers only - src/ outside the test tree
 * plus scripts/ - and requires every unreachable ledger export to be a NAMED deferral
 * that says which prompt lands its caller (D-116). Both directions:
 *
 *   - a new export with no shipped caller fails until it is wired or named, and
 *   - a named deferral that has since gained a shipped caller fails too, so the list
 *     cannot quietly become a permanent amnesty for dead code.
 *
 * Re-exports and imports are not callers: a module that merely forwards a symbol has
 * not made it reachable.
 */
const LEDGER_DIR = "src/infrastructure/ledger/";
/**
 * Test-only injection seams, which are fenced to have NO shipped caller BY DESIGN.
 * `ledger-pii-vocabulary` is what proves that, so this fence must not demand one.
 */
const TEST_INJECTION_SEAMS = new Set([
  "registerTestLedgerIdentifier",
  "registerTestLedgerIdentifierPrefix",
]);
/** Named deferrals: export -> the prompt that lands its first shipped caller. */
const DEFERRED_EXPORTS = new Map<string, string>([
  ["appendDecisionEvents", "v3 prompt 8"],
]);
const DEFERRAL_DECISION = "D-116";

function isShipped(file: string): boolean {
  return (
    (file.startsWith("src/") && !file.startsWith("src/__tests__/")) ||
    file.startsWith("scripts/")
  );
}

export interface LedgerExport {
  readonly name: string;
  readonly file: string;
  readonly declaration: Node;
}

export function ledgerExports(project: Project, dir: string): LedgerExport[] {
  const out: LedgerExport[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!file.startsWith(dir) || !file.endsWith(".ts")) continue;
    for (const declaration of sf.getFunctions()) {
      const name = declaration.getName();
      if (!name || !declaration.isExported()) continue;
      out.push({ name, file, declaration });
    }
  }
  return out;
}

function referencesDeclaration(node: Node, declaration: Node): boolean {
  const symbol = node.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return Boolean(target?.getDeclarations().includes(declaration));
}

/** Ledger exports with no shipped call site, keyed on resolved declaration. */
export function unreachableLedgerExports(
  project: Project,
  dir: string,
  shipped: (path: string) => boolean = isShipped,
): string[] {
  const exports = ledgerExports(project, dir);
  const reached = new Set<Node>();
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!shipped(file)) continue;
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (
        identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) ||
        identifier.getFirstAncestorByKind(SyntaxKind.ExportDeclaration)
      ) continue;
      for (const item of exports) {
        if (
          item.file !== file &&
          !reached.has(item.declaration) &&
          referencesDeclaration(identifier, item.declaration)
        ) {
          reached.add(item.declaration);
        }
      }
    }
  }
  return exports
    .filter((item) => !reached.has(item.declaration))
    .map((item) => item.name)
    .sort();
}

function fixture(files: Record<string, string>): Project {
  return inMemoryProject(files);
}

const FIXTURE_DIR = "src/infrastructure/ledger/";

describe("ledger reachability fence (charter #5)", () => {
  const project = realSemanticProject();
  const exports = ledgerExports(project, LEDGER_DIR);
  const unreachable = unreachableLedgerExports(project, LEDGER_DIR);

  it("enforces: the scan sees the real ledger surface (charter #4 non-vacuity)", () => {
    expect(
      exports.length,
      "no ledger exports found - the scan went stale",
    ).toBeGreaterThanOrEqual(30);
    const names = new Set(exports.map(({ name }) => name));
    for (const wired of ["recordDecision", "readVerifiedDecisionRegister"]) {
      expect(names.has(wired)).toBe(true);
      expect(
        unreachable,
        `${wired} has a shipped caller - the reachability scan resolves nothing`,
      ).not.toContain(wired);
    }
  });

  it("enforces: every unreachable ledger export is a NAMED deferral or a fenced seam", () => {
    expect(
      unreachable.filter((name) => !TEST_INJECTION_SEAMS.has(name)).sort(),
    ).toEqual([...DEFERRED_EXPORTS.keys()].sort());
  });

  it("enforces: a named deferral that gained a shipped caller must be retired", () => {
    const stale = [...DEFERRED_EXPORTS.keys()].filter((name) =>
      !unreachable.includes(name)
    );
    expect(stale).toEqual([]);
  });

  it("enforces: each deferral names its prompt in DECISIONS.md", () => {
    const decisions = readFileSync(join(REPO_ROOT, "DECISIONS.md"), "utf8");
    const start = decisions.indexOf(`### ${DEFERRAL_DECISION} `);
    const section = start < 0 ? "" : decisions.slice(start);
    expect(section.length, `${DEFERRAL_DECISION} is not recorded`).toBeGreaterThan(0);
    for (const [name, prompt] of DEFERRED_EXPORTS) {
      expect(section).toContain(name);
      expect(section).toContain(prompt);
    }
  });
});

describe("detects (companion — charter #4)", () => {
  const LEDGER = {
    [`/${FIXTURE_DIR}ledger-store.ts`]: `
      export function recordDecision(): number { return 1; }
      export function appendDecisionEvents(): number { return 2; }
    `,
  };

  it("flags a ledger export with no shipped caller", () => {
    const project = fixture({
      ...LEDGER,
      "/src/app/api/route.ts": `
        import { recordDecision } from "@infra/ledger/ledger-store";
        export const value = recordDecision();
      `,
    });
    expect(unreachableLedgerExports(project, FIXTURE_DIR)).toEqual([
      "appendDecisionEvents",
    ]);
  });

  it("does not count a bare re-export as a caller", () => {
    const project = fixture({
      ...LEDGER,
      "/src/app/api/route.ts": `
        export { appendDecisionEvents } from "@infra/ledger/ledger-store";
        import { recordDecision } from "@infra/ledger/ledger-store";
        export const value = recordDecision();
      `,
    });
    expect(unreachableLedgerExports(project, FIXTURE_DIR)).toEqual([
      "appendDecisionEvents",
    ]);
  });

  it("does not count a TEST caller as shipping the capability", () => {
    const project = fixture({
      ...LEDGER,
      "/src/__tests__/integration/ledger.test.ts": `
        import { recordDecision, appendDecisionEvents } from "@infra/ledger/ledger-store";
        export const value = recordDecision() + appendDecisionEvents();
      `,
    });
    expect(unreachableLedgerExports(project, FIXTURE_DIR)).toEqual([
      "appendDecisionEvents",
      "recordDecision",
    ]);
  });

  it("counts an ALIASED shipped call (keyed on declaration, not text)", () => {
    const project = fixture({
      ...LEDGER,
      "/src/app/api/route.ts": `
        import { recordDecision as record, appendDecisionEvents as append } from "@infra/ledger/ledger-store";
        export const value = record() + append();
      `,
    });
    expect(unreachableLedgerExports(project, FIXTURE_DIR)).toEqual([]);
  });
});
