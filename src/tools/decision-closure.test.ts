// DecisionPureClosure (prompt 5 structural rule 2): the runtime closure of evaluate is ASSERTED,
// not promised. The exact exported `evaluate` at its canonical path is resolved through the
// TypeScript compiler; the reachable runtime graph must be non-empty, contain that root, and equal
// the closed allowlist both ways; dynamic import, require, unresolved specifiers and unclassified
// externals fail closed; clocks, randomness, network, environment and every src/tools module are
// excluded - so the answer-key reader PR-5a-iii lands can never join, by construction. A second,
// capability-denied execution (decision-determinism.ts) runs the committed sample cases
// byte-identically under two process time zones - M-F, and the capture-off half of M-I.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";

const ROOT_MODULE = "src/decision/outcome.ts";
const ROOT_SYMBOL = "evaluate";
const ALLOWLIST = ["src/decision/outcome.ts"];
const ALLOWED_EXTERNALS: ReadonlyMap<string, readonly string[]> = new Map([["node:crypto", ["createHash"]]]); // the digest primitive, and nothing else
// prettier-ignore
const FORBIDDEN_GLOBALS = "process globalThis fetch require eval Function Intl setTimeout setInterval setImmediate queueMicrotask performance navigator window document XMLHttpRequest WebSocket".split(" ");
const FORBIDDEN_MEMBERS = ["Math.random", "Date.now", "crypto.getRandomValues", "crypto.randomUUID"];

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const rel = (sf: SourceFile) => relative(process.cwd(), sf.getFilePath());

type Graph = { modules: string[]; violations: string[]; externals: Map<string, string[]> };
function collectClosure(rootPath: string): Graph {
  const violations: string[] = [];
  const externals = new Map<string, string[]>();
  const root = project.getSourceFile((f) => rel(f) === rootPath);
  if (!root) return { modules: [], violations: [`${rootPath} does not exist; the closure root is gone`], externals };
  const seen = new Set<string>();
  const queue: SourceFile[] = [root];
  while (queue.length) {
    const sf = queue.pop()!;
    if (seen.has(rel(sf))) continue;
    seen.add(rel(sf));
    for (const d of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
      const spec = d.getModuleSpecifierValue();
      if (spec === undefined) continue;
      const asImport = d.getKind() === SyntaxKind.ImportDeclaration ? d.asKindOrThrow(SyntaxKind.ImportDeclaration) : null;
      const typeOnly =
        d.isTypeOnly() ||
        (asImport !== null && asImport.getNamedImports().length > 0 && asImport.getNamedImports().every((n) => n.isTypeOnly()) && !asImport.getDefaultImport() && !asImport.getNamespaceImport());
      if (typeOnly) continue; // erased at runtime; carries no capability
      const target = d.getModuleSpecifierSourceFile();
      if (target && rel(target).startsWith("src/")) queue.push(target);
      else if (ALLOWED_EXTERNALS.has(spec)) {
        const names = asImport ? asImport.getNamedImports().map((n) => n.getName()) : [];
        externals.set(spec, [...(externals.get(spec) ?? []), ...names]);
        for (const n of names) if (!ALLOWED_EXTERNALS.get(spec)!.includes(n)) violations.push(`${rel(sf)}: imports '${n}' from ${spec}, outside the allowed names`);
      } else violations.push(`${rel(sf)}:${d.getStartLineNumber()} imports '${spec}', which is ${target ? "outside src/" : "unresolved"} and not an allowed external; failing closed`);
    }
    sf.forEachDescendant((n) => {
      const at = () => `${rel(sf)}:${n.getStartLineNumber()}`;
      if (n.getKind() === SyntaxKind.CallExpression && n.getChildAtIndex(0).getKind() === SyntaxKind.ImportKeyword)
        violations.push(`${at()} uses dynamic import; the closure fails closed on edges it cannot follow`);
      if (n.getKind() === SyntaxKind.PropertyAccessExpression && FORBIDDEN_MEMBERS.includes(n.getText())) violations.push(`${at()} reaches ${n.getText()}, a randomness or clock capability`);
      if (n.getKind() === SyntaxKind.Identifier && FORBIDDEN_GLOBALS.includes(n.getText())) {
        const parent = n.getParent();
        const isMemberName = parent?.getKind() === SyntaxKind.PropertyAccessExpression && parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getNameNode() === n;
        if (!isMemberName) violations.push(`${at()} names the ambient capability '${n.getText()}'`); // process.env is caught on its expression side; foo.process is not
      }
      if (n.getKind() === SyntaxKind.NewExpression && n.getChildAtIndex(1)?.getText() === "Date" && n.asKindOrThrow(SyntaxKind.NewExpression).getArguments().length === 0)
        violations.push(`${at()} constructs new Date() with no arguments - a clock read`);
    });
  }
  return { modules: [...seen].sort(), violations, externals };
}

describe("DecisionPureClosure: the exact-root, closed-allowlist construction proof", () => {
  const graph = collectClosure(ROOT_MODULE);
  it("resolves the exact exported symbol 'evaluate' at its canonical module path, exactly once", () => {
    const root = project.getSourceFile((f) => rel(f) === ROOT_MODULE)!;
    const exported = root.getExportedDeclarations().get(ROOT_SYMBOL) ?? [];
    expect(exported.length, `expected exactly one exported '${ROOT_SYMBOL}' in ${ROOT_MODULE}, found ${exported.length}`).toBe(1);
    expect(exported[0].getKind()).toBe(SyntaxKind.FunctionDeclaration);
  });
  it("collects a non-empty reachable graph that contains the root and equals the allowlist in both directions", () => {
    expect(graph.modules.length).toBeGreaterThan(0); // an empty or truncated graph can never pass
    expect(graph.modules).toContain(ROOT_MODULE);
    expect(graph.modules).toEqual([...ALLOWLIST].sort());
  });
  it("follows every runtime edge and refuses forbidden imports, dynamic edges, clocks, randomness and ambient capabilities with file:line - and admits exactly the digest primitive", () => {
    expect(graph.violations).toEqual([]);
    expect([...graph.externals.keys()]).toEqual(["node:crypto"]);
  });
  it("excludes every tooling module from the closure, and the decision path reads no answer-key field", () => {
    expect(ALLOWLIST.every((m) => m.startsWith("src/decision/"))).toBe(true); // the answer-key reader lives under src/tools and can never join
    expect(graph.modules.filter((m) => !m.startsWith("src/decision/"))).toEqual([]);
    for (const path of ALLOWLIST) {
      const hits = [...readFileSync(path, "utf8").matchAll(/\bexpected[A-Z]\w*/g)].map((m) => m[0]);
      expect(hits, `${path} reads answer-key fields: ${hits.join(", ")}`).toEqual([]);
    }
  });
  it("runs the committed sample cases byte-identically in a capability-denied realm under two process time zones (M-F; the capture-off half of M-I)", () => {
    const run = (tz: string) => execFileSync("corepack", ["pnpm", "exec", "tsx", "src/tools/decision-determinism.ts"], { encoding: "utf8", env: { ...process.env, TZ: tz } });
    const newYork = run("America/New_York");
    expect(newYork).toBe(run("Asia/Tokyo"));
    expect(newYork).toMatch(/outcome=dov\.v1:[0-9a-f]{64}/);
  }, 120_000);
});
