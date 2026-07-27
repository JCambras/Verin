import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type Project,
  type Statement,
} from "ts-morph";
import {
  realSemanticProject,
  inMemoryProject,
  REPO_ROOT,
} from "./_fence-utils";
import { GOVERNED_ACTIONS } from "@contracts/authz";
import { ROLES } from "@contracts/roles";

/**
 * GOVERNED-ACTIONS FENCE (v3 §15.3; extends charter #12's route-level RBAC).
 * Three structural guarantees:
 *  1. The registry covers EXACTLY the seven permission points v3 §15.3 names,
 *     as eight actions (policy drafting and approval are distinct) — an action
 *     cannot be dropped (or renamed away) silently.
 *  2. Separation of duties holds in the registry itself: compliance authority
 *     (policy.approve, decision.override) never includes the IT-admin role or
 *     the requesting advisor role (D-036) — a quiet allowlist widening fails
 *     the build, not review.
 *  3. Every SURFACED governed action's route file calls
 *     requireActionGrant(..., "<that action>") — the hook cannot be unwired.
 */
const V3_15_3_ACTIONS = [
  "pii.view", // viewing PII
  "evidence.supply", // supplying evidence
  "policy.draft", // drafting policy
  "policy.approve", // approving policy
  "decision.approve", // approving decisions
  "decision.override", // overriding policy
  "execution.initiate", // initiating execution
  "audit.export", // viewing audit exports
] as const;

const GOVERNED_SINKS = [
  { file: "src/infrastructure/crm/house-crm.ts", name: "listHouseholds", action: "pii.view" },
  { file: "src/infrastructure/wire.ts", name: "startAccountOpening", action: "execution.initiate" },
  { file: "src/infrastructure/audit/audit-store.ts", name: "verifyAndListOrgChain", action: "audit.export" },
] as const;

interface GovernedRouteEntry {
  readonly file: string;
  readonly handler: string;
  readonly action: string;
  readonly sink: string;
  readonly sinkFile?: string;
}

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

function callResolvesTo(
  call: CallExpression,
  file: string,
  name: string,
): boolean {
  const symbol = call.getExpression().getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getName() === name &&
    target.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) === file
    );
}

function governedSinkForCall(
  call: CallExpression,
): (typeof GOVERNED_SINKS)[number] | null {
  return GOVERNED_SINKS.find((sink) =>
    callResolvesTo(call, sink.file, sink.name)
  ) ?? null;
}

export function discoverGovernedRoutes(
  project: Project,
): { entries: GovernedRouteEntry[]; violations: string[] } {
  const entries: GovernedRouteEntry[] = [];
  const violations: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!/^src\/app\/.*\/route\.ts$/.test(file)) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const sink = governedSinkForCall(call);
      if (!sink) continue;
      const handler = call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
      if (!handler?.isExported() || !handler.getName()) {
        violations.push(
          `${file}:${call.getStartLineNumber()}: governed sink '${sink.name}' must be called inside an exported route handler`,
        );
        continue;
      }
      entries.push({
        file,
        handler: handler.getName()!,
        action: sink.action,
        sink: sink.name,
        sinkFile: sink.file,
      });
    }
  }
  return {
    entries: entries.filter((entry, index) =>
      entries.findIndex((candidate) =>
        candidate.file === entry.file &&
        candidate.handler === entry.handler &&
        candidate.sink === entry.sink &&
        candidate.sinkFile === entry.sinkFile
      ) === index
    ),
    violations,
  };
}

function governedTestProject(route: string): Project {
  return inMemoryProject({
    "/src/app/_server/context.ts": `
      export async function requireActionGrant(req: Request, action: string): Promise<any> {
        return { ok: true };
      }
      export function errorResponse(error: unknown): Response {
        return new Response();
      }
    `,
    "/src/app/api/audit/route.ts": `
      import { requireActionGrant, errorResponse } from "@app/_server/context";
      ${route}
    `,
  });
}

function governedDiscoveryProject(route: string): Project {
  return inMemoryProject({
    "/src/app/_server/context.ts": `
      export async function requireActionGrant(req: Request, action: string): Promise<any> {
        return { ok: true };
      }
      export function errorResponse(error: unknown): Response {
        return new Response();
      }
    `,
    "/src/infrastructure/audit/audit-store.ts": `
      export function verifyAndListOrgChain(db: unknown, tenant: unknown): unknown {
        return { db, tenant };
      }
    `,
    "/src/app/api/other/route.ts": route,
  });
}

function authDeclaration(
  statement: Statement,
  action: string,
): { variable: string } | null {
  if (!Node.isVariableStatement(statement)) return null;
  const declarations = statement.getDeclarations();
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  let initializer = declaration.getInitializer();
  if (initializer && Node.isAwaitExpression(initializer)) {
    initializer = initializer.getExpression();
  }
  if (
    !initializer ||
    !Node.isCallExpression(initializer) ||
    !callResolvesTo(
      initializer,
      "src/app/_server/context.ts",
      "requireActionGrant",
    )
  ) {
    return null;
  }
  const args = initializer.getArguments();
  if (
    args[0]?.getText() !== "req" ||
    !Node.isStringLiteral(args[1]) ||
    args[1].getLiteralValue() !== action
  ) {
    return null;
  }
  return { variable: declaration.getName() };
}

function isFailClosedGuard(statement: Statement, variable: string): boolean {
  if (!Node.isIfStatement(statement)) return false;
  const condition = statement.getExpression().getText().replace(/[\s()]/g, "");
  if (condition !== `!${variable}.ok`) return false;
  const thenStatement = statement.getThenStatement();
  const returns = Node.isReturnStatement(thenStatement)
    ? [thenStatement]
    : thenStatement.getDescendantsOfKind(SyntaxKind.ReturnStatement);
  return returns.some((node) => {
    const expression = node.getExpression();
    return Node.isCallExpression(expression) &&
      callResolvesTo(
        expression,
        "src/app/_server/context.ts",
        "errorResponse",
      ) &&
      expression.getArguments()[0]?.getText() === `${variable}.error`;
  });
}

export function detectUnwiredGovernedRoutes(
  project: Project,
  entries: ReadonlyArray<GovernedRouteEntry>,
): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const sf = project.getSourceFiles().find((f) => {
      const rel = relative(REPO_ROOT, f.getFilePath()).replace(/\\/g, "/");
      const normalized = rel.startsWith("..") ? f.getFilePath().replace(/^\//, "") : rel;
      return normalized === entry.file;
    });
    if (!sf) {
      out.push(`${entry.file}: file missing (surfaced action '${entry.action}' has no route)`);
      continue;
    }
    const handler = sf.getFunction(entry.handler);
    if (!handler?.isExported() || !handler.getBody()) {
      out.push(`${entry.file}: exported ${entry.handler} handler missing`);
      continue;
    }
    const body = handler.getBodyOrThrow();
    if (!Node.isBlock(body)) {
      out.push(`${entry.file} :: ${entry.handler}: handler body must be a block`);
      continue;
    }
    const statements = body.getStatements();
    const auth = statements[0] ? authDeclaration(statements[0], entry.action) : null;
    if (!auth) {
      out.push(
        `${entry.file} :: ${entry.handler}: first statement must bind requireActionGrant(req, "${entry.action}")`,
      );
      continue;
    }
    if (!statements[1] || !isFailClosedGuard(statements[1], auth.variable)) {
      out.push(
        `${entry.file} :: ${entry.handler}: authorization result must be fail-closed before route work`,
      );
      continue;
    }
    const authorizedVariables = new Set<string>();
    const referencesAuthorization = (node: Node): boolean => {
      if (node.getText().startsWith(`${auth.variable}.value`)) return true;
      const identifiers = [
        ...(Node.isIdentifier(node) ? [node] : []),
        ...node.getDescendantsOfKind(SyntaxKind.Identifier),
      ];
      if (identifiers.some((identifier) =>
        authorizedVariables.has(identifier.getText())
      )) {
        return true;
      }
      return node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
        .some((access) => access.getText().startsWith(`${auth.variable}.value`));
    };
    for (const statement of statements.slice(2)) {
      if (!Node.isVariableStatement(statement)) continue;
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (initializer && referencesAuthorization(initializer)) {
          authorizedVariables.add(declaration.getName());
        }
      }
    }
    const authorizedSink = statements.slice(2)
      .flatMap((statement) =>
        statement.getDescendantsOfKind(SyntaxKind.CallExpression)
      )
      .some((call) =>
        call.getExpression().getText() === entry.sink &&
        (!entry.sinkFile ||
          callResolvesTo(call, entry.sinkFile, entry.sink)) &&
        call.getArguments().some(referencesAuthorization)
      );
    if (!authorizedSink) {
      out.push(
        `${entry.file} :: ${entry.handler}: authorized value does not reach '${entry.sink}'`,
      );
    }
  }
  return out;
}

describe("governed-actions fence (v3 §15.3)", () => {
  it("enforces: the registry covers exactly the eight actions of the seven v3 §15.3 permission points", () => {
    expect(Object.keys(GOVERNED_ACTIONS).sort()).toEqual([...V3_15_3_ACTIONS].sort());
  });

  it("enforces: every allowlist is non-empty and made of real roles", () => {
    for (const [action, allowed] of Object.entries(GOVERNED_ACTIONS)) {
      expect(allowed.length, `${action} has an empty allowlist`).toBeGreaterThan(0);
      for (const role of allowed) expect(ROLES, `${action} names unknown role '${role}'`).toContain(role);
    }
  });

  it("enforces: separation of duties — compliance authority excludes admin and advisor (D-036)", () => {
    for (const action of ["policy.approve", "decision.override"] as const) {
      expect(GOVERNED_ACTIONS[action], `${action} must not include the IT-admin role`).not.toContain("admin");
      expect(GOVERNED_ACTIONS[action], `${action} must not include the requesting advisor role`).not.toContain("advisor");
    }
    expect(GOVERNED_ACTIONS["decision.approve"], "decision.approve must not include the requesting advisor role").not.toContain("advisor");
  });

  it("enforces: every surfaced governed action is wired through requireActionGrant in its route", () => {
    const project = realSemanticProject();
    const discovered = discoverGovernedRoutes(project);
    expect(
      discovered.violations,
      `invalid governed sink call sites:\n${discovered.violations.join("\n")}`,
    ).toEqual([]);
    expect(
      [...new Set(discovered.entries.map((entry) => entry.sink))].sort(),
    ).toEqual(GOVERNED_SINKS.map((sink) => sink.name).sort());
    const unwired = detectUnwiredGovernedRoutes(project, discovered.entries);
    expect(unwired, `unwired governed routes:\n${unwired.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): an unwired or miswired route is caught", () => {
    it("flags a route that never calls requireActionGrant", () => {
      const project = governedTestProject(
        `export async function GET(req: Request) { return listEverything(); }`,
      );
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v.length).toBe(1);
    });
    it("flags a route wired to the WRONG action literal", () => {
      const project = governedTestProject(
        `export async function GET(req: Request) { const a = await requireActionGrant(req, "pii.view"); }`,
      );
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v.length).toBe(1);
    });
    it("flags a DELETED route file for a surfaced action", () => {
      const project = inMemoryProject({});
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v[0]).toContain("file missing");
    });
    it("flags authorization placed after data access", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const db = await getDb();
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return list(db, auth.value.grant.tenant);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "list" },
      ])).toHaveLength(1);
    });
    it("flags a call in another HTTP verb", () => {
      const project = governedTestProject(`
          export async function POST(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return use(auth.value);
          }
          export async function GET(req: Request) { return listEverything(); }
        `);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("flags an ignored authorization result", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return listEverything();
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("flags a superficial authorization reference that does not reach the governed sink", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          void auth.value;
          return listEverything();
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("discovers a new route calling a governed sink without a manual surface entry", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          return verifyAndListOrgChain({}, {});
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries).toEqual([
        {
          file: "src/app/api/other/route.ts",
          handler: "GET",
          action: "audit.export",
          sink: "verifyAndListOrgChain",
          sinkFile: "src/infrastructure/audit/audit-store.ts",
        },
      ]);
      expect(
        detectUnwiredGovernedRoutes(project, discovered.entries),
      ).toHaveLength(1);
    });
    it("rejects a route-local helper shadowing requireActionGrant", () => {
      const project = inMemoryProject({
        "/src/app/_server/context.ts": `
          export function errorResponse(error: unknown): Response {
            return new Response();
          }
        `,
        "/src/app/api/audit/route.ts": `
          import { errorResponse } from "@app/_server/context";
          function requireActionGrant() {
            return { ok: true, value: { grant: { tenant: {} } } };
          }
          export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return listEverything(auth.value.grant.tenant);
          }
        `,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("rejects a route-local helper shadowing errorResponse", () => {
      const project = inMemoryProject({
        "/src/app/_server/context.ts": `
          export async function requireActionGrant(req: Request, action: string): Promise<any> {
            return { ok: true };
          }
        `,
        "/src/app/api/audit/route.ts": `
          import { requireActionGrant } from "@app/_server/context";
          function errorResponse(): Response {
            return new Response();
          }
          export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return listEverything(auth.value.grant.tenant);
          }
        `,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("passes a correctly wired route", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return list(auth.value.grant.tenant);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "list" }])).toEqual([]);
    });
  });
});
