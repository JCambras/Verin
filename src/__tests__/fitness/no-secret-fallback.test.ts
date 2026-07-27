import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  Node,
  SyntaxKind,
  ts,
  type CallExpression,
  type Project,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  REPO_ROOT,
  inMemoryProject,
  realSemanticProject,
  walk,
  stripComments,
} from "./_fence-utils";

/**
 * CONFIG-HYGIENE FENCE (ADR-0003/0017, charter #7). Fails the build on:
 *  (1) a secret with a hardcoded fallback (`process.env.X_SECRET || "…"`) —
 *      Meridian's `SF_COOKIE_SECRET || "…change-in-prod!!"` class;
 *  (2) a live org domain / instance in any committed file (retro: HANDOFF.md
 *      shipped a real Salesforce org domain);
 *  (3) a non-placeholder value in .env.example.
 */

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|ya?ml|toml|css|env\.example)$/;
const SKIP_DIRS = ["node_modules", ".next", ".git", "coverage", "playwright-report", "test-results"];

function committedTextFiles(): Array<{ rel: string; text: string }> {
  return walk(REPO_ROOT, (f) => TEXT_EXT.test(f) || f.endsWith(".env.example"))
    .filter((f) => !SKIP_DIRS.some((d) => f.includes(`/${d}/`)) && !f.includes("/.verin-data"))
    .map((f) => ({ rel: relative(REPO_ROOT, f), text: readFileSync(f, "utf8") }));
}

// Alternation fragment of this fence's own detection regex, not a credential
// (njsscan's node_secret heuristic flags any *SECRET* variable holding a string).
// DSN/URL/CONNECTION are in the set because the codebase itself classifies
// DATABASE_URL as a secret: config/index.ts seals it in a SecretValue and
// contracts/pii.ts lists `database.?url` / `connection.?string` as PII, so a
// hardcoded `postgres://user:pw@host/db` fallback is the same defect class.
const SECRET_NAME = "(SECRET|KEY|TOKEN|PASSWORD|COOKIE|CREDENTIAL|DSN|DATABASE_URL|CONNECTION_STRING)"; // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
const SECRET_NAME_RE = new RegExp(`[A-Z0-9_]*${SECRET_NAME}[A-Z0-9_]*`, "i");
// Applied to the comment-stripped WHOLE file (\s spans newlines), so wrapping the
// `??`/`||` fallback across lines is not an evasion.
// `??=` / `||=` are the same defect spelled as a compound assignment, and the
// old `\s*` after the operator could not cross the `=`.
const SECRET_FALLBACK_RE = new RegExp(
  `process\\s*\\.\\s*env\\s*\\.\\s*[A-Z0-9_]*${SECRET_NAME}[A-Z0-9_]*\\s*(\\|\\|=?|\\?\\?=?)\\s*["'\`]`,
  "i",
);
// Destructuring default: `const { X_SECRET = "…" } = process.env`.
const SECRET_DESTRUCTURE_RE = new RegExp(
  `\\{[^{}]*[A-Z0-9_]*${SECRET_NAME}[A-Z0-9_]*\\s*=\\s*["'\`][^{}]*\\}\\s*=\\s*process\\s*\\.\\s*env`,
  "i",
);
const LIVE_ORG_RE = /[a-z0-9][a-z0-9-]*\.(my\.salesforce\.com|lightning\.force\.com|my\.site\.com)/i;

export function detectSecretFallback(files: Array<{ rel: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    // The fence's own companion fixtures contain the pattern as a literal.
    if (rel.endsWith("no-secret-fallback.test.ts")) continue;
    const stripped = text.split("\n").map(stripComments).join("\n");
    if (SECRET_FALLBACK_RE.test(stripped) || SECRET_DESTRUCTURE_RE.test(stripped)) out.push(rel);
  }
  return out;
}

/**
 * The SAME invariant, resolved through the AST (charter: AST over regex). The
 * text regexes above scan every committed file type; this covers the two TS
 * forms they structurally cannot see — element access
 * (`process.env["SESSION_SECRET"] ?? "…"`) and destructure-then-default
 * (`const { SESSION_SECRET } = process.env; SESSION_SECRET ?? "…"`) — inside
 * src/ and scripts/, where a process.env read can actually occur.
 */
const DEFAULTING_OPERATORS = new Set([
  SyntaxKind.QuestionQuestionToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.BarBarEqualsToken,
]);

/** Strip the wrappers a value passes through unchanged. */
function unwrapValue(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/** The outermost expression this node's value flows out through unchanged. */
function valuePosition(node: Node): Node {
  let current = node;
  for (;;) {
    const parent = current.getParent();
    if (
      !parent ||
      !(Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) ||
        Node.isSatisfiesExpression(parent) || Node.isTypeAssertion(parent) ||
        Node.isNonNullExpression(parent))
    ) {
      return current;
    }
    current = parent;
  }
}

/**
 * A statically-known string on the fallback side. Node-kind alone is not enough:
 * `const DEV = "dev-secret"; process.env.SESSION_SECRET ?? DEV` hardcodes exactly
 * the same credential through one extra binding, and its TYPE says so.
 */
function isStringishLiteral(node: Node | undefined): boolean {
  if (!node) return false;
  const inner = unwrapValue(node);
  return Node.isStringLiteral(inner) ||
    Node.isNoSubstitutionTemplateLiteral(inner) ||
    Node.isTemplateExpression(inner) ||
    inner.getType().isStringLiteral();
}

/** Is this read defaulted to a string literal — by `??`/`||`, `??=`/`||=`, or a ternary? */
function defaultedToLiteral(node: Node): boolean {
  const positioned = valuePosition(node);
  const parent = positioned.getParent();
  if (!parent) return false;
  if (Node.isBinaryExpression(parent)) {
    return DEFAULTING_OPERATORS.has(parent.getOperatorToken().getKind()) &&
      parent.getLeft() === positioned &&
      isStringishLiteral(parent.getRight());
  }
  // `process.env.X ? process.env.X : "…"` — the same default, spelled long-hand.
  return Node.isConditionalExpression(parent) &&
    parent.getCondition() === positioned &&
    isStringishLiteral(parent.getWhenFalse());
}

function readsProcessEnv(node: Node): boolean {
  return Node.isPropertyAccessExpression(node) &&
    node.getName() === "env" &&
    node.getExpression().getText() === "process";
}

export function detectSecretFallbackInCode(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (
      (!file.startsWith("src/") && !file.startsWith("scripts/")) ||
      file.includes("/__tests__/")
    ) continue;
    const report = (node: Node): void => {
      out.push(`${file}:${node.getStartLineNumber()}`);
    };
    // process.env.X ?? "…"
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (!readsProcessEnv(access.getExpression())) continue;
      if (SECRET_NAME_RE.test(access.getName()) && defaultedToLiteral(access)) {
        report(access);
      }
    }
    // process.env["X"] ?? "…"
    for (const access of sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      if (!readsProcessEnv(access.getExpression())) continue;
      const argument = access.getArgumentExpression();
      if (
        argument &&
        Node.isStringLiteral(argument) &&
        SECRET_NAME_RE.test(argument.getLiteralValue()) &&
        defaultedToLiteral(access)
      ) {
        report(access);
      }
    }
    // const { X = "…" } = process.env   /   const { X } = process.env; X ?? "…"
    for (const declaration of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (
        !Node.isObjectBindingPattern(name) ||
        !initializer ||
        !readsProcessEnv(initializer)
      ) continue;
      for (const element of name.getElements()) {
        const envName = element.getPropertyNameNode()?.getText() ?? element.getName();
        if (!SECRET_NAME_RE.test(envName)) continue;
        if (isStringishLiteral(element.getInitializer())) {
          report(element);
          continue;
        }
        const bound = element.getNameNode();
        if (!Node.isIdentifier(bound)) continue;
        for (const reference of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
          if (reference === bound || reference.getText() !== bound.getText()) continue;
          if (defaultedToLiteral(reference)) report(reference);
        }
      }
    }
  }
  return [...new Set(out)];
}

export function detectLiveOrgDomain(files: Array<{ rel: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    // The fence's own regex source + companion fixtures are not live domains.
    if (rel.endsWith("no-secret-fallback.test.ts")) continue;
    text.split("\n").forEach((line, i) => {
      if (LIVE_ORG_RE.test(line)) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

// A .env.example value is a placeholder if it is empty, an enum/driver/tz/localhost
// value, or an explicit CHANGEME_/e2e-only placeholder. Anything else is suspect.
const PLACEHOLDER_VALUE =
  /^(|CHANGEME[_A-Za-z0-9]*|development|production|test|info|error|debug|warn|verin|pglite|postgres|America\/New_York|America\/[A-Za-z_]+|http:\/\/localhost(:\d+)?|\.verin-data[\w-]*|\d+|postgres:\/\/USER:CHANGEME_PASSWORD@HOST:5432\/verin)$/;

// --- SecretValue containment (v3 §15.4, prompt 6) ---------------------------
const REVEAL_ALLOWLIST: Array<{ file: string; functionName: string; why: string }> = [
  { file: "src/infrastructure/identity/session.ts", functionName: "sign", why: "HMAC-signs the session cookie" },
  { file: "src/infrastructure/esign/esign.ts", functionName: "signCallback", why: "HMAC-signs/verifies the e-sign webhook callback" },
];
const SECRET_MODULE_EXPORTS = new Set(["SecretValue", "revealSecret"]);

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

function declaredAsSecretValue(type: Type): boolean {
  return [type.getAliasSymbol(), type.getSymbol()].some((symbol) =>
    symbol?.getName() === "SecretValue" &&
    symbol.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) ===
      "src/contracts/secret.ts"
    )
  );
}

function revealSecretCall(call: CallExpression): boolean {
  const symbol = call.getExpression().getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getName() === "revealSecret" &&
    target.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) ===
      "src/contracts/secret.ts"
    );
}

function revealSecretReference(node: Node): boolean {
  const symbol = node.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getName() === "revealSecret" &&
    target.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) ===
      "src/contracts/secret.ts"
    );
}

interface SecretAccess {
  readonly file: string;
  readonly line: number;
  readonly call: CallExpression | null;
}

function resolvedModulePath(
  project: Project,
  sourceFile: SourceFile,
  specifier: string,
): string | null {
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile.getFilePath(),
    project.getCompilerOptions(),
    project.getModuleResolutionHost(),
  ).resolvedModule?.resolvedFileName;
  return resolved ? normalizedPath(resolved) : null;
}

function secretAccesses(project: Project): SecretAccess[] {
  const out: SecretAccess[] = [];
  const seen = new Set<string>();
  const add = (
    file: string,
    line: number,
    call: CallExpression | null,
  ): void => {
    const ref = `${file}:${line}:${call?.getStart() ?? "reference"}`;
    if (!seen.has(ref)) {
      seen.add(ref);
      out.push({ file, line, call });
    }
  };
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (
      (!file.startsWith("src/") && !file.startsWith("scripts/")) ||
      file.includes("/__tests__/")
    ) continue;
    for (const declaration of sf.getImportDeclarations()) {
      const target = declaration.getModuleSpecifierSourceFile();
      const targetPath = target ? normalizedPath(target.getFilePath()) : null;
      if (
        targetPath === "src/contracts/secret.ts" &&
        (declaration.getNamespaceImport() || declaration.getDefaultImport())
      ) {
        add(file, declaration.getStartLineNumber(), null);
      }
    }
    for (const declaration of sf.getExportDeclarations()) {
      const target = declaration.getModuleSpecifierSourceFile();
      const targetPath = target ? normalizedPath(target.getFilePath()) : null;
      if (targetPath !== "src/contracts/secret.ts") continue;
      const exportedNames = declaration.getNamedExports().map((item) =>
        item.getNameNode().getText()
      );
      if (
        declaration.isNamespaceExport() ||
        exportedNames.length === 0 ||
        exportedNames.includes("revealSecret")
      ) {
        add(file, declaration.getStartLineNumber(), null);
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (revealSecretCall(call)) {
        add(file, call.getStartLineNumber(), call);
      }
      const expression = call.getExpression();
      const isModuleLoad = expression.getKind() === SyntaxKind.ImportKeyword ||
        expression.getText() === "require";
      if (!isModuleLoad) continue;
      const argument = call.getArguments()[0];
      if (
        !argument ||
        !Node.isStringLiteral(argument) ||
        resolvedModulePath(project, sf, argument.getLiteralValue()) ===
          "src/contracts/secret.ts"
      ) {
        add(file, call.getStartLineNumber(), null);
      }
    }
    for (const reference of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const parent = reference.getParent();
      if (
        reference.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) ||
        (Node.isFunctionDeclaration(parent) &&
          parent.getNameNode() === reference) ||
        !revealSecretReference(reference)
      ) {
        continue;
      }
      if (
        Node.isCallExpression(parent) &&
        parent.getExpression() === reference &&
        revealSecretCall(parent)
      ) {
        continue;
      }
      add(file, reference.getStartLineNumber(), null);
    }
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (
        access.getName() === "reveal" &&
        declaredAsSecretValue(access.getExpression().getType())
      ) {
        add(file, access.getStartLineNumber(), null);
      }
    }
    for (const access of sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      const argument = access.getArgumentExpression();
      if (
        Node.isStringLiteral(argument) &&
        argument.getLiteralValue() === "reveal" &&
        declaredAsSecretValue(access.getExpression().getType())
      ) {
        add(file, access.getStartLineNumber(), null);
      }
    }
    for (const declaration of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (
        Node.isObjectBindingPattern(name) &&
        initializer &&
        declaredAsSecretValue(initializer.getType()) &&
        name.getElements().some((element) =>
          (element.getPropertyNameNode()?.getText() ?? element.getName()) === "reveal"
        )
      ) {
        add(file, declaration.getStartLineNumber(), null);
      }
    }
  }
  return out;
}

function secretModuleExportViolations(project: Project): string[] {
  const sf = project.getSourceFiles().find((sourceFile) =>
    normalizedPath(sourceFile.getFilePath()) === "src/contracts/secret.ts"
  );
  if (!sf) return ["src/contracts/secret.ts:1"];
  return [...sf.getExportedDeclarations()]
    .filter(([name]) => !SECRET_MODULE_EXPORTS.has(name))
    .flatMap(([name, declarations]) =>
      declarations.map((declaration) =>
        `src/contracts/secret.ts:${declaration.getStartLineNumber()} (${name})`
      )
    );
}

function importedNodeCreateHmac(call: CallExpression): boolean {
  const symbol = call.getExpression().getSymbol();
  return Boolean(symbol?.getDeclarations().some((declaration) =>
    Node.isImportSpecifier(declaration) &&
    declaration.getName() === "createHmac" &&
    declaration.getImportDeclaration().getModuleSpecifierValue() === "node:crypto"
  ));
}

function sanctionedHmacReveal(access: SecretAccess): boolean {
  if (!access.call) return false;
  const fn = access.call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
  const allowed = REVEAL_ALLOWLIST.some((entry) =>
    entry.file === access.file &&
    entry.functionName === fn?.getName()
  );
  if (!allowed) return false;
  const parent = access.call.getParent();
  return Node.isCallExpression(parent) &&
    parent.getArguments()[1] === access.call &&
    importedNodeCreateHmac(parent);
}

export function detectUnsanctionedReveal(project: Project): string[] {
  const out: string[] = [];
  for (const access of secretAccesses(project)) {
    if (!sanctionedHmacReveal(access)) {
      out.push(`${access.file}:${access.line}`);
    }
  }
  out.push(...secretModuleExportViolations(project));
  return [...new Set(out)];
}

/** The committed template's lines, or null when the file is missing entirely. */
export function readEnvExampleLines(): string[] | null {
  const p = join(REPO_ROOT, ".env.example");
  return existsSync(p) ? readFileSync(p, "utf8").split("\n") : null;
}

interface EnvAssignment {
  readonly line: number;
  readonly key: string;
  readonly value: string;
}

/**
 * Exported so the companion can prove the PARSER works, not just the regex
 * constant: a detector gutted to `return []` must fail a real synthetic
 * violation, and an assignment count floor catches a parser that stops seeing
 * anything at all (charter #4).
 */
export function envExampleAssignments(lines: readonly string[]): EnvAssignment[] {
  const out: EnvAssignment[] = [];
  lines.forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith("#")) return;
    const eq = s.indexOf("=");
    if (eq < 0) return;
    out.push({ line: i + 1, key: s.slice(0, eq), value: s.slice(eq + 1).trim() });
  });
  return out;
}

/** Takes its input, so the companion can feed it a synthetic violation. */
export function detectEnvExampleNonPlaceholder(lines: readonly string[]): string[] {
  return envExampleAssignments(lines)
    .filter((assignment) => !PLACEHOLDER_VALUE.test(assignment.value))
    .map((assignment) => `.env.example:${assignment.line} (${assignment.key}=${assignment.value})`);
}

describe("config-hygiene fence (no secret fallback / no live org domain / placeholder .env)", () => {
  const files = committedTextFiles();
  const envLines = readEnvExampleLines();

  it("enforces: the scanned corpus is real (a collapsed corpus would pass vacuously — charter #4)", () => {
    expect(files.length, "committedTextFiles() found nothing to scan").toBeGreaterThanOrEqual(50);
    for (const required of ["package.json", "src/infrastructure/config/index.ts", "docs/fences/proof-log.md"]) {
      expect(files.some((f) => f.rel === required), `corpus is missing ${required}`).toBe(true);
    }
    expect(envLines, "MISSING .env.example").not.toBeNull();
    expect(
      envExampleAssignments(envLines ?? []).length,
      ".env.example parsed to zero assignments",
    ).toBeGreaterThanOrEqual(5);
  });
  it("enforces: no secret has a hardcoded fallback", () => {
    const o = detectSecretFallback(files);
    expect(o, `secret fallbacks:\n${o.join("\n")}`).toEqual([]);
    const ast = detectSecretFallbackInCode(realSemanticProject());
    expect(ast, `secret fallbacks (AST):\n${ast.join("\n")}`).toEqual([]);
  });

  it("enforces: SecretValue exposes no raw accessor — revealSecret is the whole API", () => {
    // The documented containment ("reveal only in the allowlisted HMAC
    // consumers") is only true while the class has no `reveal` member; the
    // detector's member/computed/destructured branches are the regression
    // backstop for the day someone re-adds one (proven by their companion).
    const secret = realSemanticProject().getSourceFiles().find((sf) =>
      normalizedPath(sf.getFilePath()) === "src/contracts/secret.ts"
    );
    expect(secret, "src/contracts/secret.ts missing").toBeTruthy();
    const members = secret!.getClassOrThrow("SecretValue").getMembers()
      .flatMap((member) =>
        Node.isMethodDeclaration(member) || Node.isPropertyDeclaration(member)
          ? [member.getName()]
          : []
      );
    expect(members).not.toContain("reveal");
  });
  it("enforces: no live org domain in committed files", () => {
    const o = detectLiveOrgDomain(files);
    expect(o, `live org domains:\n${o.join("\n")}`).toEqual([]);
  });
  it("enforces: .env.example is placeholder-only", () => {
    const o = detectEnvExampleNonPlaceholder(envLines ?? []);
    expect(o, `non-placeholder .env.example values:\n${o.join("\n")}`).toEqual([]);
  });
  it("enforces: raw secret access appears only in reviewed secret-consumer modules (v3 §15.4)", () => {
    const o = detectUnsanctionedReveal(realSemanticProject());
    expect(o, `unsanctioned secret reveals:\n${o.join("\n")}`).toEqual([]);
  });
  it("enforces: every reveal-allowlisted module still reveals (no stale allowlist, charter #4)", () => {
    const calls = secretAccesses(realSemanticProject());
    for (const entry of REVEAL_ALLOWLIST) {
      expect(
        calls.some((call) =>
          call.file === entry.file &&
          call.call?.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
            ?.getName() === entry.functionName
        ),
        `${entry.file} :: ${entry.functionName} no longer reveals a secret - prune the allowlist entry`,
      ).toBe(true);
    }
  });

  describe("detects (companion): planted violations are caught", () => {
    it("catches a secret fallback", () => {
      expect(detectSecretFallback([{ rel: "src/infrastructure/config/x.ts", text: `const s = process.env.SF_COOKIE_SECRET || "change-in-prod!!";` }]).length).toBe(1);
    });
    it("catches a fallback WRAPPED across lines (?? on the next line)", () => {
      const text = `const s =\n  process.env.SESSION_SECRET\n  ?? "dev-secret";`;
      expect(detectSecretFallback([{ rel: "src/infrastructure/config/x.ts", text }]).length).toBe(1);
    });
    it("catches a destructuring default (const { X_SECRET = \"…\" } = process.env)", () => {
      const text = `const { SESSION_SECRET = "dev-secret" } = process.env;`;
      expect(detectSecretFallback([{ rel: "src/infrastructure/config/x.ts", text }]).length).toBe(1);
    });
    it("catches a hardcoded DATABASE_URL fallback (a DSN is a credential)", () => {
      const text = `const url = process.env.DATABASE_URL ?? "postgres://verin:pw@db.internal:5432/verin";`;
      expect(detectSecretFallback([{ rel: "src/infrastructure/config/x.ts", text }]).length).toBe(1);
    });
    it("catches ELEMENT-ACCESS and destructure-then-default forms through the AST", () => {
      const project = inMemoryProject({
        "/src/infrastructure/config/element.ts": `
          const a = process.env["SESSION_SECRET"] ?? "dev-secret-not-for-prod";
          export const first = a;
        `,
        "/src/infrastructure/config/destructured.ts": `
          const { SESSION_SECRET } = process.env;
          export const second = SESSION_SECRET ?? "dev-secret-not-for-prod";
        `,
        "/src/infrastructure/config/inline.ts": `
          const { ESIGN_WEBHOOK_SECRET = "dev-secret-not-for-prod" } = process.env;
          export const third = ESIGN_WEBHOOK_SECRET;
        `,
        "/src/infrastructure/config/dsn.ts": `
          export const fourth = process.env.DATABASE_URL ?? "postgres://verin:pw@db.internal:5432/verin";
        `,
      });
      const hits = detectSecretFallbackInCode(project);
      for (const file of ["element", "destructured", "inline", "dsn"]) {
        expect(
          hits.some((hit) => hit.startsWith(`src/infrastructure/config/${file}.ts`)),
          file,
        ).toBe(true);
      }
    });
    it("catches COMPOUND, PARENTHESIZED, indirect-literal, and ternary fallbacks", () => {
      const project = inMemoryProject({
        "/src/infrastructure/config/compound.ts": `
          export function boot(): void {
            process.env.SESSION_SECRET ??= "dev-secret-not-for-prod";
            process.env.ESIGN_WEBHOOK_SECRET ||= "dev-secret-not-for-prod";
          }
        `,
        "/src/infrastructure/config/wrapped.ts": `
          export const first = (process.env.SESSION_SECRET) ?? "dev-secret-not-for-prod";
        `,
        "/src/infrastructure/config/indirect.ts": `
          const DEV = "dev-secret-not-for-prod";
          export const second = process.env.SESSION_SECRET ?? DEV;
        `,
        "/src/infrastructure/config/ternary.ts": `
          export const third = process.env.SESSION_SECRET ? process.env.SESSION_SECRET : "dev-secret-not-for-prod";
        `,
      });
      const hits = detectSecretFallbackInCode(project);
      for (const file of ["compound", "wrapped", "indirect", "ternary"]) {
        expect(hits.some((hit) => hit.startsWith(`src/infrastructure/config/${file}.ts`)), file).toBe(true);
      }
      // The compound form is a text miss too, until the regex learns `??=`/`||=`.
      expect(detectSecretFallback([{
        rel: "src/infrastructure/config/compound.ts",
        text: `process.env.SESSION_SECRET ??= "dev-secret-not-for-prod";`,
      }])).toHaveLength(1);
    });

    it("does not flag a non-secret env default or an undefaulted secret read", () => {
      const project = inMemoryProject({
        "/src/infrastructure/config/fine.ts": `
          export const level = process.env.LOG_LEVEL ?? "info";
          export const secret = process.env.SESSION_SECRET;
        `,
      });
      expect(detectSecretFallbackInCode(project)).toEqual([]);
    });
    it("does not flag a commented-out fallback", () => {
      const text = `// const s = process.env.SESSION_SECRET ?? "dev-secret";`;
      expect(detectSecretFallback([{ rel: "src/infrastructure/config/x.ts", text }]).length).toBe(0);
    });
    it("catches a live Salesforce org domain", () => {
      expect(detectLiveOrgDomain([{ rel: "docs/HANDOFF.md", text: `Login at https://acme-corp.my.salesforce.com` }]).length).toBe(1);
    });
    it("catches a non-placeholder env value through the REAL detector", () => {
      const suspicious = "sk_live_51H8xQ2eZvKYlo2C"; // gitleaks:allow - deliberately secret-shaped test fixture, not a real key
      expect(detectEnvExampleNonPlaceholder([
        "# a comment with an = sign",
        "",
        "APP_ENV=development",
        `STRIPE_KEY=${suspicious}`,
      ])).toEqual([`.env.example:4 (STRIPE_KEY=${suspicious})`]);
    });
    it("skips comments, blanks, and non-assignments instead of mis-parsing them", () => {
      expect(envExampleAssignments([
        "# APP_ENV=leaked",
        "   ",
        "not-an-assignment",
        "  LOG_LEVEL=info  ",
      ])).toEqual([{ line: 4, key: "LOG_LEVEL", value: "info" }]);
      expect(detectEnvExampleNonPlaceholder(["# APP_ENV=leaked", "LOG_LEVEL=info"])).toEqual([]);
    });
    it("catches an aliased revealSecret call outside the allowlist", () => {
      const project = inMemoryProject({
        "/src/contracts/secret.ts": `export class SecretValue {}; export function revealSecret(value: SecretValue): string { return ""; }`,
        "/src/infrastructure/crm/evil.ts": `import { revealSecret as unwrap, SecretValue } from "../../contracts/secret"; declare const secret: SecretValue; unwrap(secret);`,
      });
      const o = detectUnsanctionedReveal(project);
      expect(o).toEqual(["src/infrastructure/crm/evil.ts:1"]);
    });
    it("catches revealSecret references used through call or bind", () => {
      const project = inMemoryProject({
        "/src/contracts/secret.ts": `export class SecretValue {}; export function revealSecret(value: SecretValue): string { return ""; }`,
        "/src/infrastructure/crm/evil.ts": `
          import { revealSecret, SecretValue } from "../../contracts/secret";
          declare const secret: SecretValue;
          revealSecret.call(undefined, secret);
          const bound = revealSecret.bind(undefined);
          bound(secret);
        `,
      });
      expect(detectUnsanctionedReveal(project).length).toBeGreaterThan(0);
    });
    it("catches revealSecret reached through a reflected module namespace", () => {
      const project = inMemoryProject({
        "/src/contracts/secret.ts": `export class SecretValue {}; export function revealSecret(value: SecretValue): string { return ""; }`,
        "/src/infrastructure/crm/evil.ts": `
          import * as secretModule from "../../contracts/secret";
          declare const secret: secretModule.SecretValue;
          Reflect.get(secretModule, "revealSecret")(secret);
        `,
      });
      expect(detectUnsanctionedReveal(project)).toEqual([
        "src/infrastructure/crm/evil.ts:2",
      ]);
    });
    it("catches computed and destructured access if a raw accessor is reintroduced", () => {
      const project = inMemoryProject({
        "/src/contracts/secret.ts": `export class SecretValue { reveal(): string { return ""; } }`,
        "/src/infrastructure/crm/evil.ts": `
          import { SecretValue } from "../../contracts/secret";
          declare const secret: SecretValue;
          secret["reveal"]();
          const { reveal } = secret;
          reveal();
        `,
      });
      expect(detectUnsanctionedReveal(project)).toHaveLength(2);
    });
    it("rejects a reveal wrapper inside an allowlisted HMAC module", () => {
      const project = inMemoryProject({
        "/src/contracts/secret.ts": `export class SecretValue {}; export function revealSecret(value: SecretValue): string { return ""; }`,
        "/src/infrastructure/identity/session.ts": `
          import { revealSecret, SecretValue } from "../../contracts/secret";
          declare const secret: SecretValue;
          function sign(): string {
            return revealSecret(secret);
          }
        `,
      });
      expect(detectUnsanctionedReveal(project)).toEqual([
        "src/infrastructure/identity/session.ts:5",
      ]);
    });
    it("rejects a reveal wrapper exported by the secret declaration module", () => {
      const project = inMemoryProject({
        "/src/contracts/secret.ts": `
          export class SecretValue {}
          export function revealSecret(value: SecretValue): string { return ""; }
          export function leak(value: SecretValue): string {
            return revealSecret(value);
          }
        `,
      });
      expect(detectUnsanctionedReveal(project).length).toBeGreaterThan(0);
    });
  });
});
