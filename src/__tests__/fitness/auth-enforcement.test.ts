import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, type Node, type SourceFile } from "ts-morph";
import { relative } from "node:path";
import { walk, REPO_ROOT, inMemoryProject } from "./_fence-utils";

/**
 * AUTH-ENFORCEMENT FENCE (ADR-0008, charter #12). Every exported HTTP handler in
 * every API route AND every exported Server Action ('use server' file) must
 * resolve the principal server-side (requirePrincipal / requirePrincipalWithRole /
 * resolveSession) — checked PER EXPORTED HANDLER via AST, so an unauthenticated
 * DELETE added to a file whose POST is authenticated is still caught, and a
 * resolver name in a comment cannot satisfy the check. Only the explicit
 * UNAUTHENTICATED allowlist may skip it.
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

/** Exported (name, body) pairs that must each resolve a session. */
function exportedHandlers(sf: SourceFile, kind: "route" | "action"): Array<{ name: string; node: Node }> {
  const out: Array<{ name: string; node: Node }> = [];
  for (const fn of sf.getFunctions()) {
    if (!fn.isExported()) continue;
    const name = fn.getName() ?? "";
    if (kind === "route" ? HTTP_VERBS.has(name) : true) out.push({ name, node: fn });
  }
  for (const vs of sf.getVariableStatements()) {
    if (!vs.isExported()) continue;
    for (const decl of vs.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const isFn = init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression;
      if (!isFn) continue;
      const name = decl.getName();
      if (kind === "route" ? HTTP_VERBS.has(name) : true) out.push({ name, node: init });
    }
  }
  return out;
}

function isServerActionFile(sf: SourceFile): boolean {
  // The directive is the first STATEMENT (comments may precede it), so check the
  // AST, not the raw text.
  const first = sf.getStatements()[0];
  if (!first || first.getKind() !== SyntaxKind.ExpressionStatement) return false;
  const expr = first.asKindOrThrow(SyntaxKind.ExpressionStatement).getExpression();
  return expr.getKind() === SyntaxKind.StringLiteral && expr.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText() === "use server";
}

export function unauthenticatedExports(rel: string, sf: SourceFile): string[] {
  const norm = rel.replace(/\\/g, "/");
  if (UNAUTHENTICATED.has(norm)) return [];
  const kind = norm.endsWith("route.ts") ? "route" : isServerActionFile(sf) ? "action" : null;
  if (!kind) return [];
  return exportedHandlers(sf, kind)
    .filter(({ node }) => !callsSessionResolver(node))
    .map(({ name }) => `${norm} :: ${name}`);
}

function appProject(): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  // ALL app-layer source, not just route.ts: a Server Action can live in any file
  // carrying the "use server" directive.
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
    it("flags a Server Action ('use server' file) that never resolves a session", () => {
      const project = inMemoryProject({
        "/src/app/evil/actions.ts": `"use server";\nexport async function mutateEverything(formData: FormData){ return { ok: true }; }`,
      });
      expect(unauthenticatedExports("src/app/evil/actions.ts", project.getSourceFiles()[0]!)).toEqual([
        "src/app/evil/actions.ts :: mutateEverything",
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
