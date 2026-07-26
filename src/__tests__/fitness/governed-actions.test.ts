import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { SyntaxKind, type Project } from "ts-morph";
import { realProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";
import { GOVERNED_ACTIONS } from "@contracts/authz";
import { ROLES } from "@contracts/roles";

/**
 * GOVERNED-ACTIONS FENCE (v3 §15.3; extends charter #12's route-level RBAC).
 * Three structural guarantees:
 *  1. The registry covers EXACTLY the seven governed actions v3 §15.3 names —
 *     an action cannot be dropped (or renamed away) silently.
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
const SURFACED: Array<{ file: string; action: string }> = [
  { file: "src/app/api/crm/households/route.ts", action: "pii.view" },
  { file: "src/app/api/flows/account-opening/route.ts", action: "execution.initiate" },
  { file: "src/app/api/audit/route.ts", action: "audit.export" },
];

/** Route files among `entries` that do NOT call requireActionGrant with the mapped action literal. */
export function detectUnwiredGovernedRoutes(project: Project, entries: ReadonlyArray<{ file: string; action: string }>): string[] {
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
    const wired = sf.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
      if (call.getExpression().getText() !== "requireActionGrant") return false;
      const arg = call.getArguments()[1];
      return arg?.getKind() === SyntaxKind.StringLiteral && arg.getText() === `"${entry.action}"`;
    });
    if (!wired) out.push(`${entry.file}: no requireActionGrant(req, "${entry.action}") call`);
  }
  return out;
}

describe("governed-actions fence (v3 §15.3)", () => {
  it("enforces: the registry covers exactly the seven v3 §15.3 actions", () => {
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
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", action: "audit.export" }]);
      expect(v.length).toBe(1);
    });
    it("flags a route wired to the WRONG action literal", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) { const a = await requireActionGrant(req, "pii.view"); }`,
      });
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", action: "audit.export" }]);
      expect(v.length).toBe(1);
    });
    it("flags a DELETED route file for a surfaced action", () => {
      const project = inMemoryProject({});
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", action: "audit.export" }]);
      expect(v[0]).toContain("file missing");
    });
    it("passes a correctly wired route", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `export async function GET(req: Request) { const a = await requireActionGrant(req, "audit.export"); }`,
      });
      expect(detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", action: "audit.export" }])).toEqual([]);
    });
  });
});
