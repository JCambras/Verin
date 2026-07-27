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
const SECRET_NAME = "(SECRET|KEY|TOKEN|PASSWORD|COOKIE|CREDENTIAL)"; // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
// Applied to the comment-stripped WHOLE file (\s spans newlines), so wrapping the
// `??`/`||` fallback across lines is not an evasion.
const SECRET_FALLBACK_RE = new RegExp(
  `process\\s*\\.\\s*env\\s*\\.\\s*[A-Z0-9_]*${SECRET_NAME}[A-Z0-9_]*\\s*(\\|\\||\\?\\?)\\s*["'\`]`,
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

export function detectEnvExampleNonPlaceholder(): string[] {
  const p = join(REPO_ROOT, ".env.example");
  if (!existsSync(p)) return ["MISSING .env.example"];
  const out: string[] = [];
  readFileSync(p, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
      const eq = s.indexOf("=");
      if (eq < 0) return;
      const value = s.slice(eq + 1).trim();
      if (!PLACEHOLDER_VALUE.test(value)) out.push(`.env.example:${i + 1} (${s.slice(0, eq)}=${value})`);
    });
  return out;
}

describe("config-hygiene fence (no secret fallback / no live org domain / placeholder .env)", () => {
  const files = committedTextFiles();

  it("enforces: no secret has a hardcoded fallback", () => {
    const o = detectSecretFallback(files);
    expect(o, `secret fallbacks:\n${o.join("\n")}`).toEqual([]);
  });
  it("enforces: no live org domain in committed files", () => {
    const o = detectLiveOrgDomain(files);
    expect(o, `live org domains:\n${o.join("\n")}`).toEqual([]);
  });
  it("enforces: .env.example is placeholder-only", () => {
    const o = detectEnvExampleNonPlaceholder();
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
    it("does not flag a commented-out fallback", () => {
      const text = `// const s = process.env.SESSION_SECRET ?? "dev-secret";`;
      expect(detectSecretFallback([{ rel: "src/infrastructure/config/x.ts", text }]).length).toBe(0);
    });
    it("catches a live Salesforce org domain", () => {
      expect(detectLiveOrgDomain([{ rel: "docs/HANDOFF.md", text: `Login at https://acme-corp.my.salesforce.com` }]).length).toBe(1);
    });
    it("catches a non-placeholder env value shape", () => {
      // simulate the parser directly on a suspicious value
      const suspicious = "sk_live_51H8xQ2eZvKYlo2C"; // gitleaks:allow - deliberately secret-shaped test fixture, not a real key
      expect(PLACEHOLDER_VALUE.test(suspicious)).toBe(false);
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
