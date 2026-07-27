/**
 * Shared fence utilities. Fences prefer AST (ts-morph) and file-content scanning
 * over naive regex, and resolve relative + dynamic imports — the seams both prior
 * builds leaked through (retro-r7 don't-again #23, #35). Every fence that uses
 * these also ships a co-located "detects" companion that feeds a synthetic
 * violation and asserts it is caught (charter #4: detection is not verification).
 */
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SRC_ROOT = join(REPO_ROOT, "src");
const IN_MEMORY_SRC_ROOT = resolve("/src");

export type Layer = "contracts" | "domain" | "infrastructure" | "app";
const RANK: Record<Layer, number> = { contracts: 0, domain: 1, infrastructure: 2, app: 3 };
const ALIAS_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["@contracts", "contracts"],
  ["@domain", "domain"],
  ["@infra", "infrastructure"],
  ["@app", "app"],
  ["@", ""],
];

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

function layerWithinSourceRoot(absPath: string, sourceRoot: string): Layer | null {
  const pathFromRoot = relative(sourceRoot, resolve(absPath));
  if (
    pathFromRoot.length === 0 ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    return null;
  }
  const seg = pathFromRoot.split(/[/\\]/)[0];
  if (seg === "contracts" || seg === "domain" || seg === "infrastructure" || seg === "app") return seg;
  return null;
}

function sourceRootOf(absPath: string): string | null {
  if (layerWithinSourceRoot(absPath, SRC_ROOT) !== null) return SRC_ROOT;
  if (layerWithinSourceRoot(absPath, IN_MEMORY_SRC_ROOT) !== null) return IN_MEMORY_SRC_ROOT;
  return null;
}

/** Which layer does a path under the real or in-memory src/ root belong to? */
export function layerOfPath(absPath: string): Layer | null {
  return layerWithinSourceRoot(absPath, SRC_ROOT) ?? layerWithinSourceRoot(absPath, IN_MEMORY_SRC_ROOT);
}

/**
 * Resolve a module specifier (as written in `fromFile`) to a layer, or null if
 * it is an external/node module. Handles alias (@contracts, @/infrastructure, …),
 * bare "@/<layer>/…", and relative (./ ../) paths.
 */
export function specifierToLayer(fromFile: string, spec: string): Layer | null {
  const sourceRoot = sourceRootOf(fromFile);
  if (sourceRoot === null) return null;
  for (const [alias, pathFromSourceRoot] of ALIAS_PATHS) {
    const root = resolve(sourceRoot, pathFromSourceRoot);
    if (spec === alias) return layerWithinSourceRoot(root, sourceRoot);
    const prefix = `${alias}/`;
    if (spec.startsWith(prefix)) {
      return layerWithinSourceRoot(resolve(root, ...spec.slice(prefix.length).split("/")), sourceRoot);
    }
  }
  if (spec.startsWith(".")) {
    const resolved = resolve(dirname(fromFile), spec);
    return layerWithinSourceRoot(resolved, sourceRoot);
  }
  return null; // bare/external
}

export interface ModuleReference {
  specifier: string | null;
  line: number;
  kind:
    | "import"
    | "export"
    | "dynamic-import"
    | "require"
    | "import-type"
    | "import-equals"
    | "reference-types"
    | "reference-path"
    | "implicit-jsx-runtime";
}

/** Every module reference, including non-literal dynamic import/require calls. */
export function moduleReferences(sf: SourceFile): ModuleReference[] {
  const refs: ModuleReference[] = [];
  for (const imp of sf.getImportDeclarations()) {
    refs.push({ specifier: imp.getModuleSpecifierValue(), line: imp.getStartLineNumber(), kind: "import" });
  }
  for (const exp of sf.getExportDeclarations()) {
    const v = exp.getModuleSpecifierValue();
    if (v) refs.push({ specifier: v, line: exp.getStartLineNumber(), kind: "export" });
  }
  for (const ref of sf.getTypeReferenceDirectives()) {
    refs.push({
      specifier: ref.getFileName(),
      line: sf.getLineAndColumnAtPos(ref.getPos()).line,
      kind: "reference-types",
    });
  }
  for (const ref of sf.getPathReferenceDirectives()) {
    refs.push({
      specifier: ref.getFileName(),
      line: sf.getLineAndColumnAtPos(ref.getPos()).line,
      kind: "reference-path",
    });
  }
  const jsx = sf.getDescendants().find((node) =>
    node.isKind(SyntaxKind.JsxElement) ||
    node.isKind(SyntaxKind.JsxSelfClosingElement) ||
    node.isKind(SyntaxKind.JsxFragment),
  );
  if (jsx) {
    refs.push({
      specifier: "react/jsx-runtime",
      line: jsx.getStartLineNumber(),
      kind: "implicit-jsx-runtime",
    });
  }
  for (const imp of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    const moduleRef = imp.getModuleReference();
    if (!Node.isExternalModuleReference(moduleRef)) continue;
    const expression = moduleRef.getExpression();
    refs.push({
      specifier:
        Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)
          ? expression.getLiteralText()
          : null,
      line: imp.getStartLineNumber(),
      kind: "import-equals",
    });
  }
  for (const imp of sf.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const argument = imp.getArgument();
    const literal = Node.isLiteralTypeNode(argument) ? argument.getLiteral() : undefined;
    refs.push({
      specifier:
        literal && (Node.isStringLiteral(literal) || Node.isNoSubstitutionTemplateLiteral(literal))
          ? literal.getLiteralText()
          : null,
      line: imp.getStartLineNumber(),
      kind: "import-type",
    });
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.ImportKeyword) {
      const arg = call.getArguments()[0];
      refs.push({
        specifier: arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) ? arg.getLiteralText() : null,
        line: call.getStartLineNumber(),
        kind: "dynamic-import",
      });
    }
    if (expr.getText() === "require") {
      const arg = call.getArguments()[0];
      refs.push({
        specifier: arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) ? arg.getLiteralText() : null,
        line: call.getStartLineNumber(),
        kind: "require",
      });
    }
  }
  return refs;
}

export interface LayerViolation {
  file: string;
  line: number;
  specifier: string;
  fromLayer: Layer;
  toLayer: Layer | "unresolved";
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
    const fromLayer = layerOfPath(filePath);
    if (!fromLayer) continue;
    for (const ref of moduleReferences(sf)) {
      if (ref.specifier === null) {
        if (fromLayer !== "app") {
          violations.push({
            file: relative(REPO_ROOT, filePath),
            line: ref.line,
            specifier: `<non-literal ${ref.kind}>`,
            fromLayer,
            toLayer: "unresolved",
          });
        }
        continue;
      }
      const toLayer = specifierToLayer(filePath, ref.specifier);
      if (!toLayer) continue;
      if (RANK[toLayer] > RANK[fromLayer]) {
        violations.push({
          file: relative(REPO_ROOT, filePath),
          line: ref.line,
          specifier: ref.specifier,
          fromLayer,
          toLayer,
        });
      }
    }
  }
  return violations;
}

export interface ContractsExternalImportViolation {
  file: string;
  line: number;
  specifier: string;
}

/** ADR-0029 allows contracts to import only Zod among external packages. */
export function detectContractsExternalImportViolations(project: Project): ContractsExternalImportViolation[] {
  const violations: ContractsExternalImportViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    if (layerOfPath(filePath) !== "contracts") continue;
    for (const ref of moduleReferences(sf)) {
      const specifier = ref.specifier;
      if (specifier !== null && specifierToLayer(filePath, specifier) !== null) continue;
      if (specifier === "zod" || specifier?.startsWith("zod/")) continue;
      violations.push({
        file: relative(REPO_ROOT, filePath),
        line: ref.line,
        specifier: specifier ?? `<non-literal ${ref.kind}>`,
      });
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
