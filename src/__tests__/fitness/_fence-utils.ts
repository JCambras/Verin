/**
 * Shared fence utilities. Fences prefer AST (ts-morph) and file-content scanning
 * over naive regex, and resolve relative + dynamic imports — the seams both prior
 * builds leaked through (retro-r7 don't-again #23, #35). Every fence that uses
 * these also ships a co-located "detects" companion that feeds a synthetic
 * violation and asserts it is caught (charter #4: detection is not verification).
 */
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, dirname } from "node:path";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SRC_ROOT = join(REPO_ROOT, "src");

export type Layer = "contracts" | "domain" | "infrastructure" | "app";
const RANK: Record<Layer, number> = { contracts: 0, domain: 1, infrastructure: 2, app: 3 };

/** Recursively list files under `dir` whose name matches `filter`. */
export function walk(dir: string, filter: (f: string) => boolean): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      out.push(...walk(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Source files that ship (excludes tests, the setup file, and type decls). */
export function shippedSourceFiles(): string[] {
  return walk(SRC_ROOT, (f) => /\.(ts|tsx)$/.test(f)).filter(
    (f) => !f.includes(`${join(SRC_ROOT, "__tests__")}`) && !f.endsWith(".d.ts"),
  );
}

/**
 * Which layer does a path under src/ belong to? Classifies by the segment after
 * the LAST "src" segment, so it works for both real absolute paths
 * (/…/verin/src/domain/x.ts) and in-memory companion paths (/src/domain/evil.ts).
 */
export function layerOfPath(absPath: string): Layer | null {
  const parts = absPath.split(/[/\\]/);
  const srcIdx = parts.lastIndexOf("src");
  if (srcIdx < 0 || srcIdx + 1 >= parts.length) return null;
  const seg = parts[srcIdx + 1];
  if (seg === "contracts" || seg === "domain" || seg === "infrastructure" || seg === "app") return seg;
  return null;
}

/**
 * Resolve a module specifier (as written in `fromFile`) to a layer, or null if
 * it is an external/node module. Handles alias (@contracts, @/infrastructure, …),
 * bare "@/<layer>/…", and relative (./ ../) paths.
 */
export function specifierToLayer(fromFile: string, spec: string): Layer | null {
  const aliasMap: Array<[RegExp, Layer]> = [
    [/^@contracts(\/|$)/, "contracts"],
    [/^@domain(\/|$)/, "domain"],
    [/^@infra(\/|$)/, "infrastructure"],
    [/^@app(\/|$)/, "app"],
    [/^@\/contracts(\/|$)/, "contracts"],
    [/^@\/domain(\/|$)/, "domain"],
    [/^@\/infrastructure(\/|$)/, "infrastructure"],
    [/^@\/app(\/|$)/, "app"],
  ];
  for (const [re, layer] of aliasMap) if (re.test(spec)) return layer;
  if (spec.startsWith("@/")) {
    const seg = spec.slice(2).split("/")[0];
    if (seg === "contracts" || seg === "domain" || seg === "infrastructure" || seg === "app") return seg;
    return null;
  }
  if (spec.startsWith(".")) {
    const resolved = resolve(dirname(fromFile), spec);
    return layerOfPath(resolved);
  }
  return null; // bare/external
}

/** Every import specifier in a source file: static imports, dynamic import(), and require(). */
export function importSpecifiers(sf: SourceFile): string[] {
  const specs: string[] = [];
  for (const imp of sf.getImportDeclarations()) specs.push(imp.getModuleSpecifierValue());
  for (const exp of sf.getExportDeclarations()) {
    const v = exp.getModuleSpecifierValue();
    if (v) specs.push(v);
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    // dynamic import("…")
    if (expr.getKind() === SyntaxKind.ImportKeyword) {
      const arg = call.getArguments()[0];
      if (arg && arg.getKind() === SyntaxKind.StringLiteral) specs.push(arg.getText().slice(1, -1));
    }
    // require("…")
    if (expr.getText() === "require") {
      const arg = call.getArguments()[0];
      if (arg && arg.getKind() === SyntaxKind.StringLiteral) specs.push(arg.getText().slice(1, -1));
    }
  }
  return specs;
}

export interface LayerViolation {
  file: string;
  specifier: string;
  fromLayer: Layer;
  toLayer: Layer;
}

/**
 * Core dependency-rule detector. Runs over any ts-morph Project so the companion
 * can feed it a synthetic violating project. Rule: an importer at layer L may
 * only import layers with rank <= rank(L) (dependencies point inward).
 */
export function detectLayerViolations(project: Project): LayerViolation[] {
  const violations: LayerViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    if (filePath.includes("/__tests__/")) continue;
    const fromLayer = layerOfPath(filePath);
    if (!fromLayer) continue;
    for (const spec of importSpecifiers(sf)) {
      const toLayer = specifierToLayer(filePath, spec);
      if (!toLayer) continue;
      if (RANK[toLayer] > RANK[fromLayer]) {
        violations.push({ file: relative(REPO_ROOT, filePath), specifier: spec, fromLayer, toLayer });
      }
    }
  }
  return violations;
}

/** A ts-morph Project loaded from the real src/ tree (no type-checking, fast). */
export function realProject(): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  for (const f of shippedSourceFiles()) project.addSourceFileAtPath(f);
  return project;
}

/** An in-memory Project for companion tests. */
export function inMemoryProject(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, content] of Object.entries(files)) project.createSourceFile(path, content);
  return project;
}


/** Read a shipped source file's contents (for content-scan fences). */
export function readShipped(): Array<{ path: string; rel: string; text: string }> {
  return shippedSourceFiles().map((path) => ({
    path,
    rel: relative(REPO_ROOT, path),
    text: readFileSync(path, "utf8"),
  }));
}

/**
 * Strip line comments and block-comment lines so prose does not trip content
 * scans. String-aware: a `//` INSIDE a string literal (e.g. "http://x") is code,
 * not a comment — truncating there would let everything after it evade the fence.
 */
export function stripComments(line: string): string {
  if (/^\s*\*/.test(line) || /^\s*\/\*/.test(line)) return "";
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += line[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") break;
    out += ch;
  }
  return out;
}

