import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { Node, SyntaxKind, type Project, type Statement } from "ts-morph";
import { realProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";
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

/** The governed actions that have a live HTTP surface today (Wave A). */
const SURFACED: Array<{ file: string; handler: string; action: string; sink: string }> = [
  { file: "src/app/api/crm/households/route.ts", handler: "GET", action: "pii.view", sink: "listHouseholds" },
  { file: "src/app/api/flows/account-opening/route.ts", handler: "POST", action: "execution.initiate", sink: "startAccountOpening" },
  { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "verifyAndListOrgChain" },
];

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
  if (!initializer || !Node.isCallExpression(initializer)) return null;
  if (initializer.getExpression().getText() !== "requireActionGrant") return null;
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
      expression.getExpression().getText() === "errorResponse" &&
      expression.getArguments()[0]?.getText() === `${variable}.error`;
  });
}

export function detectUnwiredGovernedRoutes(
  project: Project,
  entries: ReadonlyArray<{ file: string; handler: string; action: string; sink: string }>,
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
    const unwired = detectUnwiredGovernedRoutes(realProject(), SURFACED);
    expect(unwired, `unwired governed routes:\n${unwired.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): an unwired or miswired route is caught", () => {
    it("flags a route that never calls requireActionGrant", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) { return listEverything(); }`,
      });
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v.length).toBe(1);
    });
    it("flags a route wired to the WRONG action literal", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) { const a = await requireActionGrant(req, "pii.view"); }`,
      });
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v.length).toBe(1);
    });
    it("flags a DELETED route file for a surfaced action", () => {
      const project = inMemoryProject({});
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v[0]).toContain("file missing");
    });
    it("flags authorization placed after data access", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) {
          const db = await getDb();
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return list(db, auth.value.grant.tenant);
        }`,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "list" },
      ])).toHaveLength(1);
    });
    it("flags a call in another HTTP verb", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `
          export async function POST(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return use(auth.value);
          }
          export async function GET(req: Request) { return listEverything(); }
        `,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("flags an ignored authorization result", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return listEverything();
        }`,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("flags a superficial authorization reference that does not reach the governed sink", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          void auth.value;
          return listEverything();
        }`,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("passes a correctly wired route", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return list(auth.value.grant.tenant);
        }`,
      });
      expect(detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "list" }])).toEqual([]);
    });
  });
});
