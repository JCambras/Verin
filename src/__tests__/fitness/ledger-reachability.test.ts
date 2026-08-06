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
 * fence derives reachability TRANSITIVELY from shipped ENTRY POINTS - src/ outside the
 * test tree and outside the ledger directory, plus scripts/ - and requires every
 * unreachable ledger export to be a NAMED deferral that says which prompt lands its
 * caller and which decision records it (D-116 pattern). Both directions:
 *
 *   - a new export no entry point can reach fails until it is wired or named, and
 *   - a named deferral that has since gained a shipped caller fails too, so the list
 *     cannot quietly become a permanent amnesty for dead code.
 *
 * Rooting OUTSIDE the subsystem is what makes that true: every ledger file is itself
 * shipped, so a one-hop rule let an intra-subsystem call - even one made only from
 * another named deferral - stand in for a reachable caller.
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
interface NamedDeferral {
  /** The prompt that lands the first shipped caller. */
  readonly prompt: string;
  /** The DECISIONS.md entry that records the deferral. */
  readonly decision: string;
}
/** Named deferrals: export -> where its first shipped caller is promised. */
const DEFERRED_EXPORTS = new Map<string, NamedDeferral>([
  ["appendDecisionEvents", { prompt: "v3 prompt 8", decision: "D-116" }],
  ["preflightEvidenceSnapshots", { prompt: "v3 prompt 8", decision: "D-118" }],
]);

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
  readonly exported: boolean;
}

function declarationName(node: Node): string | undefined {
  if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node)) {
    return node.getName();
  }
  return Node.isVariableDeclaration(node) ? node.getName() : undefined;
}

function isExportedDeclaration(node: Node): boolean {
  if (Node.isVariableDeclaration(node)) {
    return node.getVariableStatement()?.isExported() ?? false;
  }
  return Node.isExportable(node) ? node.isExported() : false;
}

/**
 * Every top-level declaration in the ledger directory - exported or not, function,
 * class, or `const` (an arrow export is a variable declaration, which a
 * `getFunctions()`-only scan cannot see). The non-exported ones are graph nodes: a
 * private helper carries reachability from a reached export to what it calls.
 */
function ledgerDeclarations(project: Project, dir: string): LedgerExport[] {
  const out: LedgerExport[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!file.startsWith(dir) || !file.endsWith(".ts")) continue;
    const declarations: Node[] = [
      ...sf.getFunctions(),
      ...sf.getClasses(),
      ...sf.getVariableStatements().flatMap((statement) => statement.getDeclarations()),
    ];
    for (const declaration of declarations) {
      const name = declarationName(declaration);
      if (!name) continue;
      out.push({
        name,
        file,
        declaration,
        exported: isExportedDeclaration(declaration),
      });
    }
  }
  return out;
}

export function ledgerExports(project: Project, dir: string): LedgerExport[] {
  return ledgerDeclarations(project, dir).filter((item) => item.exported);
}

function resolvedTargets(node: Node, known: ReadonlySet<Node>): Node[] {
  const symbol = node.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  if (!target) return [];
  return target.getDeclarations().filter((declaration) => known.has(declaration));
}

/**
 * Ledger exports no shipped ENTRY POINT can reach, keyed on resolved declaration.
 * Reachability is transitive and rooted OUTSIDE the subsystem: only a reference from a
 * shipped non-ledger file (a route, a surface, a script) is a root, and a ledger
 * declaration is reached only when a reached declaration's own body references it. A
 * one-hop rule counted an intra-subsystem call as shipping the capability, so a helper
 * whose only caller was itself a named deferral passed unnamed.
 */
export function unreachableLedgerExports(
  project: Project,
  dir: string,
  shipped: (path: string) => boolean = isShipped,
): string[] {
  const declarations = ledgerDeclarations(project, dir);
  const known = new Set(declarations.map((item) => item.declaration));
  const edges = new Map<Node, Set<Node>>();
  const roots = new Set<Node>();
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    const inside = file.startsWith(dir) && file.endsWith(".ts");
    if (!inside && !shipped(file)) continue;
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (
        identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) ||
        identifier.getFirstAncestorByKind(SyntaxKind.ExportDeclaration)
      ) continue;
      const targets = resolvedTargets(identifier, known);
      if (targets.length === 0) continue;
      const owner = inside
        ? identifier.getAncestors().find((ancestor) => known.has(ancestor))
        : undefined;
      for (const target of targets) {
        if (!inside) {
          roots.add(target);
          continue;
        }
        if (!owner || owner === target) continue;
        const out = edges.get(owner) ?? new Set<Node>();
        out.add(target);
        edges.set(owner, out);
      }
    }
  }
  const reached = new Set<Node>(roots);
  const pending = [...roots];
  while (pending.length > 0) {
    for (const next of edges.get(pending.pop()!) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      pending.push(next);
    }
  }
  return declarations
    .filter((item) => item.exported && !reached.has(item.declaration))
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

  it("enforces: each deferral names its prompt in its own DECISIONS.md entry", () => {
    const decisions = readFileSync(join(REPO_ROOT, "DECISIONS.md"), "utf8");
    for (const [name, { prompt, decision }] of DEFERRED_EXPORTS) {
      const start = decisions.indexOf(`### ${decision} `);
      const end = decisions.indexOf("\n### ", start + 1);
      const section = start < 0
        ? ""
        : decisions.slice(start, end < 0 ? undefined : end);
      expect(section.length, `${decision} is not recorded`).toBeGreaterThan(0);
      expect(section, `${decision} does not name ${name}`).toContain(name);
      expect(section, `${decision} does not name ${prompt}`).toContain(prompt);
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

  it("does not let an unreachable ledger export vouch for what it calls", () => {
    const project = fixture({
      [`/${FIXTURE_DIR}ledger-sources.ts`]: `
        export function preflightEvidenceSnapshots(): number { return 3; }
      `,
      [`/${FIXTURE_DIR}ledger-store.ts`]: `
        import { preflightEvidenceSnapshots } from "@infra/ledger/ledger-sources";
        export function recordDecision(): number { return 1; }
        export function appendDecisionEvents(): number { return preflightEvidenceSnapshots(); }
      `,
      "/src/app/api/route.ts": `
        import { recordDecision } from "@infra/ledger/ledger-store";
        export const value = recordDecision();
      `,
    });
    expect(unreachableLedgerExports(project, FIXTURE_DIR)).toEqual([
      "appendDecisionEvents",
      "preflightEvidenceSnapshots",
    ]);
  });

  it("carries reachability through a reached export and its private helper", () => {
    const project = fixture({
      [`/${FIXTURE_DIR}ledger-sources.ts`]: `
        export function preflightEvidenceSnapshots(): number { return 3; }
      `,
      [`/${FIXTURE_DIR}ledger-store.ts`]: `
        import { preflightEvidenceSnapshots } from "@infra/ledger/ledger-sources";
        function preflight(): number { return preflightEvidenceSnapshots(); }
        export function recordDecision(): number { return preflight(); }
      `,
      "/src/app/api/route.ts": `
        import { recordDecision } from "@infra/ledger/ledger-store";
        export const value = recordDecision();
      `,
    });
    expect(unreachableLedgerExports(project, FIXTURE_DIR)).toEqual([]);
  });

  it("sees an exported arrow const a getFunctions()-only scan misses", () => {
    const project = fixture({
      [`/${FIXTURE_DIR}ledger-canonical.ts`]: `
        export const canonicalize = (value: string): string => value;
        export function canonicalDigest(value: string): string { return value; }
      `,
      "/src/app/api/route.ts": `
        import { canonicalDigest } from "@infra/ledger/ledger-canonical";
        export const value = canonicalDigest("x");
      `,
    });
    expect(unreachableLedgerExports(project, FIXTURE_DIR)).toEqual(["canonicalize"]);
  });
});
