import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, Node, type SourceFile, type Statement } from "ts-morph";
import { relative } from "node:path";
import { walk, REPO_ROOT, inMemoryProject } from "./_fence-utils";

/**
 * AUTH-ENFORCEMENT FENCE (ADR-0008, charter #12). Every exported HTTP handler in
 * every API route AND every exported Server Action ('use server' — file-level OR
 * function-level directive) must resolve the principal server-side
 * (requirePrincipal / requirePrincipalWithRole / resolveSession) — checked PER
 * EXPORTED HANDLER via AST across every export form (function declaration, const
 * arrow, identifier initializer, local and cross-module re-export), so an
 * unauthenticated DELETE added to a file whose POST is authenticated is still
 * caught and a resolver name in a comment cannot satisfy the check. FAIL CLOSED:
 * a handler whose body cannot be analyzed (imported/opaque initializer) still
 * requires a resolver call somewhere in the enclosing (or re-export target)
 * module, and an unresolvable or wildcard re-export is a violation outright.
 * Only the explicit UNAUTHENTICATED allowlist may skip it.
 */
const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SESSION_RESOLVERS = new Set(["requirePrincipal", "requirePrincipalWithRole", "resolveSession"]);

// Deliberately unauthenticated (each documented in the file + threat model):
const UNAUTHENTICATED = new Set([
  "src/app/health/route.ts", // liveness
  "src/app/ready/route.ts", // readiness
  "src/app/api/esign/webhook/route.ts", // HMAC token auth (external provider)
  "src/app/login/actions.ts", // THE login boundary — authenticates credentials, no prior session exists
]);

function callsSessionResolver(node: Node): boolean {
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const expr = call.getExpression();
    const name = expr.getKind() === SyntaxKind.PropertyAccessExpression
      ? expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()
      : expr.getText();
    return SESSION_RESOLVERS.has(name);
  });
}

/** The block-body statements of a function-like node, or null (no analyzable body). */
function bodyStatements(n: Node): Statement[] | null {
  if (!Node.isFunctionDeclaration(n) && !Node.isArrowFunction(n) && !Node.isFunctionExpression(n)) return null;
  const body = n.getBody();
  return body && Node.isBlock(body) ? body.getStatements() : null;
}

// The directive is the first STATEMENT (comments may precede it), so check the
// AST, not the raw text. Shared by the file-level and function-level checks.
function firstIsUseServer(statements: Statement[] | null | undefined): boolean {
  const first = statements?.[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralText() === "use server";
}

/**
 * Follow an initializer through parens/as/satisfies wrappers and LOCAL identifier
 * chains to a function body. Returns null when the body cannot be analyzed
 * (imported identifier, call-expression wrapper, …) — the caller fails closed.
 */
function resolveFunctionNode(sf: SourceFile, node: Node | undefined, seen: Set<string>): Node | null {
  if (!node) return null;
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node)) return node;
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node)) {
    return resolveFunctionNode(sf, node.getExpression(), seen);
  }
  if (Node.isIdentifier(node)) return resolveLocalName(sf, node.getText(), seen);
  return null;
}

function resolveLocalName(sf: SourceFile, name: string, seen: Set<string>): Node | null {
  if (seen.has(name)) return null; // self/cyclic reference — unanalyzable
  seen.add(name);
  const fn = sf.getFunction(name);
  if (fn) return fn;
  const vd = sf.getVariableDeclaration(name);
  return vd ? resolveFunctionNode(sf, vd.getInitializer(), seen) : null; // imported/absent → unanalyzable
}

export function unauthenticatedExports(rel: string, sf: SourceFile): string[] {
  const norm = rel.replace(/\\/g, "/");
  if (UNAUTHENTICATED.has(norm)) return [];
  const isRoute = norm.endsWith("route.ts");
  const isActionFile = firstIsUseServer(sf.getStatements());
  const mustEnforce = (name: string): boolean => (isRoute ? HTTP_VERBS.has(name) : isActionFile);
  const offenders: string[] = [];
  // Fail closed: when the handler body is unanalyzable (body === null), a resolver
  // call somewhere in the scope module is still required — an opaque initializer
  // must not slip the fence entirely.
  const check = (name: string, body: Node | null, scope: Node = sf): void => {
    if (!callsSessionResolver(body ?? scope)) offenders.push(`${norm} :: ${name}`);
  };

  for (const fn of sf.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName() ?? "default";
    if (mustEnforce(name) || firstIsUseServer(bodyStatements(fn))) check(name, fn);
  }

  for (const vs of sf.getVariableStatements()) {
    if (!vs.isExported()) continue;
    for (const decl of vs.getDeclarations()) {
      const name = decl.getName();
      const body = resolveFunctionNode(sf, decl.getInitializer(), new Set([name]));
      const isFnLevelAction = body != null && firstIsUseServer(bodyStatements(body));
      if (mustEnforce(name) || isFnLevelAction) check(name, body);
    }
  }

  for (const ed of sf.getExportDeclarations()) {
    if (ed.isTypeOnly()) continue;
    const named = ed.getNamedExports();
    if (named.length === 0 && ed.hasModuleSpecifier()) {
      // export * (or * as ns) cannot be enumerated — in a route file it could
      // silently expose unauthenticated handlers.
      if (isRoute) offenders.push(`${norm} :: * (wildcard re-export hides handlers)`);
      continue;
    }
    for (const spec of named) {
      if (spec.isTypeOnly()) continue;
      const exportedName = spec.getAliasNode()?.getText() ?? spec.getName();
      if (!mustEnforce(exportedName)) continue;
      const localName = spec.getName();
      if (!ed.hasModuleSpecifier()) {
        check(exportedName, resolveLocalName(sf, localName, new Set()));
        continue;
      }
      const target = ed.getModuleSpecifierSourceFile();
      if (!target) {
        offenders.push(`${norm} :: ${exportedName} (unresolvable re-export)`);
        continue;
      }
      check(exportedName, resolveLocalName(target, localName, new Set()), target);
    }
  }
  return offenders;
}

function appProject(): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  // ALL app-layer source, not just route.ts: a Server Action can live in any file
  // carrying the "use server" directive (file-level or per-function).
  const files = walk(`${REPO_ROOT}src/app`, (f) => /\.(ts|tsx)$/.test(f));
  for (const f of files) project.addSourceFileAtPath(f);
  return project;
}

describe("auth-enforcement fence", () => {
  it("enforces: every exported HTTP handler and Server Action resolves a session (per handler, AST)", () => {
    const offenders: string[] = [];
    for (const sf of appProject().getSourceFiles()) {
      const rel = relative(REPO_ROOT, sf.getFilePath());
      offenders.push(...unauthenticatedExports(rel, sf));
    }
    expect(offenders, `exported handlers/actions not enforcing auth:\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): per-handler and server-action evasions are caught", () => {
    it("flags a POST route with no session resolution", () => {
      const project = inMemoryProject({
        "/src/app/api/evil/route.ts": `export async function POST(req: Request){ return Response.json({ok:true}); }`,
      });
      expect(unauthenticatedExports("src/app/api/evil/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/evil/route.ts :: POST",
      ]);
    });
    it("flags an unauthenticated DELETE added to a file whose POST IS authenticated (per-handler, not per-file)", () => {
      const project = inMemoryProject({
        "/src/app/api/mixed/route.ts": [
          `declare function requirePrincipalWithRole(req: unknown, roles: string[]): Promise<unknown>;`,
          `export async function POST(req: Request){ const p = await requirePrincipalWithRole(req, ["ops"]); return Response.json({}); }`,
          `export async function DELETE(req: Request){ return Response.json({gone:true}); }`,
        ].join("\n"),
      });
      expect(unauthenticatedExports("src/app/api/mixed/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/mixed/route.ts :: DELETE",
      ]);
    });
    it("a resolver name in a COMMENT does not satisfy the check", () => {
      const project = inMemoryProject({
        "/src/app/api/commented/route.ts": `// requirePrincipal(req) is called elsewhere\nexport async function POST(req: Request){ return Response.json({}); }`,
      });
      expect(unauthenticatedExports("src/app/api/commented/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/commented/route.ts :: POST",
      ]);
    });
    it("flags an exported const-arrow handler (export const POST = …)", () => {
      const project = inMemoryProject({
        "/src/app/api/arrow/route.ts": `export const POST = async (req: Request) => Response.json({});`,
      });
      expect(unauthenticatedExports("src/app/api/arrow/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/arrow/route.ts :: POST",
      ]);
    });
    it("flags export const POST = localIdentifier whose resolved body lacks a resolver (identifier initializer)", () => {
      const project = inMemoryProject({
        "/src/app/api/alias/route.ts": `async function impl(req: Request){ return Response.json({}); }\nexport const POST = impl;`,
      });
      expect(unauthenticatedExports("src/app/api/alias/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/alias/route.ts :: POST",
      ]);
    });
    it("passes export const POST = localIdentifier when the resolved body requires a principal", () => {
      const project = inMemoryProject({
        "/src/app/api/alias-ok/route.ts": [
          `declare function requirePrincipal(req: unknown): Promise<unknown>;`,
          `async function impl(req: Request){ const p = await requirePrincipal(req); return Response.json({}); }`,
          `export const POST = impl;`,
        ].join("\n"),
      });
      expect(unauthenticatedExports("src/app/api/alias-ok/route.ts", project.getSourceFiles()[0]!)).toEqual([]);
    });
    it("fails closed on an IMPORTED identifier initializer when the file never resolves a session", () => {
      const project = inMemoryProject({
        "/src/app/api/imported/route.ts": `import { impl } from "./impl";\nexport const POST = impl;`,
      });
      expect(unauthenticatedExports("src/app/api/imported/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/imported/route.ts :: POST",
      ]);
    });
    it("flags a re-export (export { POST } from './impl') whose target module lacks a resolver", () => {
      const project = inMemoryProject({
        "/src/app/api/re/impl.ts": `export async function POST(req: Request){ return Response.json({}); }`,
        "/src/app/api/re/route.ts": `export { POST } from "./impl";`,
      });
      expect(unauthenticatedExports("src/app/api/re/route.ts", project.getSourceFileOrThrow("/src/app/api/re/route.ts"))).toEqual([
        "src/app/api/re/route.ts :: POST",
      ]);
    });
    it("passes a re-export whose target module resolves a session", () => {
      const project = inMemoryProject({
        "/src/app/api/re-ok/impl.ts": [
          `declare function requirePrincipal(req: unknown): Promise<unknown>;`,
          `export async function POST(req: Request){ const p = await requirePrincipal(req); return Response.json({}); }`,
        ].join("\n"),
        "/src/app/api/re-ok/route.ts": `export { POST } from "./impl";`,
      });
      expect(unauthenticatedExports("src/app/api/re-ok/route.ts", project.getSourceFileOrThrow("/src/app/api/re-ok/route.ts"))).toEqual([]);
    });
    it("flags an aliased LOCAL re-export (export { impl as GET })", () => {
      const project = inMemoryProject({
        "/src/app/api/local-alias/route.ts": `async function impl(req: Request){ return Response.json({}); }\nexport { impl as GET };`,
      });
      expect(unauthenticatedExports("src/app/api/local-alias/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/local-alias/route.ts :: GET",
      ]);
    });
    it("fails closed on an UNRESOLVABLE re-export target", () => {
      const project = inMemoryProject({
        "/src/app/api/ghost/route.ts": `export { POST } from "./missing";`,
      });
      expect(unauthenticatedExports("src/app/api/ghost/route.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/api/ghost/route.ts :: POST (unresolvable re-export)",
      ]);
    });
    it("fails closed on a wildcard re-export from a route file (cannot enumerate handlers)", () => {
      const project = inMemoryProject({
        "/src/app/api/star/impl.ts": `export async function POST(req: Request){ return Response.json({}); }`,
        "/src/app/api/star/route.ts": `export * from "./impl";`,
      });
      expect(unauthenticatedExports("src/app/api/star/route.ts", project.getSourceFileOrThrow("/src/app/api/star/route.ts"))).toEqual([
        "src/app/api/star/route.ts :: * (wildcard re-export hides handlers)",
      ]);
    });
    it("flags a Server Action ('use server' file) that never resolves a session", () => {
      const project = inMemoryProject({
        "/src/app/evil/actions.ts": `"use server";\nexport async function mutateEverything(formData: FormData){ return { ok: true }; }`,
      });
      expect(unauthenticatedExports("src/app/evil/actions.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/evil/actions.ts :: mutateEverything",
      ]);
    });
    it("flags a FUNCTION-LEVEL 'use server' action in a file with NO file-level directive (helpers untouched)", () => {
      const project = inMemoryProject({
        "/src/app/tools/report-actions.ts": [
          `export async function runAdminReport(){ "use server"; return { ok: true }; }`,
          `export function formatTitle(){ return "t"; }`,
        ].join("\n"),
      });
      expect(unauthenticatedExports("src/app/tools/report-actions.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/tools/report-actions.ts :: runAdminReport",
      ]);
    });
    it("flags a function-level 'use server' const-arrow action outside route/action files", () => {
      const project = inMemoryProject({
        "/src/app/tools/inline-action.ts": `export const wipeData = async () => { "use server"; return { ok: true }; };`,
      });
      expect(unauthenticatedExports("src/app/tools/inline-action.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/tools/inline-action.ts :: wipeData",
      ]);
    });
    it("passes a route whose every handler requires a principal", () => {
      const project = inMemoryProject({
        "/src/app/api/ok/route.ts": `declare function requirePrincipal(req: unknown): Promise<unknown>;\nexport async function POST(req: Request){ const p = await requirePrincipal(req); return Response.json({}); }`,
      });
      expect(unauthenticatedExports("src/app/api/ok/route.ts", project.getSourceFiles()[0]!)).toEqual([]);
    });
    it("allows an allowlisted unauthenticated route", () => {
      const project = inMemoryProject({
        "/src/app/health/route.ts": `export function GET(){ return Response.json({}); }`,
      });
      expect(unauthenticatedExports("src/app/health/route.ts", project.getSourceFiles()[0]!)).toEqual([]);
    });
  });
});
