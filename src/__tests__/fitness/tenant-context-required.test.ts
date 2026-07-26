import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { Node, type Project } from "ts-morph";
import { realProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";

/**
 * TENANT-CONTEXT-REQUIRED FENCE (v3 §15.2, invariant 2; extends the org-id
 * fence, never displaces it). Every EXPORTED function in a repository module
 * that takes the SQL layer (SqlDb/SqlQueryable/SqlTx) must also take the sealed
 * TenantContext — directly, or inside a WriteActor — so a repository call
 * without tenant scope does not COMPILE. The org-id fence proves the SQL
 * filters; this fence proves the SIGNATURES demand the sealed context (and the
 * runtime asserts inside the factories/adapters make an impostor fail to
 * PARSE). Escapes are exact-match `file :: function` entries, each with the
 * reason it legitimately sits below or beside the tenant seam.
 */
const REPO_MODULE_DIRS = [
  "src/infrastructure/crm/",
  "src/infrastructure/store/",
  "src/infrastructure/audit/",
  "src/infrastructure/identity/",
];

const SQL_PARAM_RE = /\bSql(Db|Queryable|Tx)\b/;
const TENANT_PARAM_RE = /\b(TenantContext|WriteActor)\b/;

// Reviewed escapes — functions that legitimately cannot carry a TenantContext.
// Exact-match on `file :: name`, so a renamed or added sibling is NOT exempt.
const REVIEWED_ESCAPES: Array<{ ref: string; why: string }> = [
  // --- the tenant-MINTING boundary (simplified Phase 1 identity provider, ADR-0008) ---
  { ref: "src/infrastructure/identity/identity-store.ts :: findUserByEmail", why: "login by email: the org comes FROM the resolved row (org-qualified login is the recorded Sable F3 deferral)" },
  { ref: "src/infrastructure/identity/identity-store.ts :: getPasswordHash", why: "keyed by the user PK resolved during authentication, before any tenant exists" },
  { ref: "src/infrastructure/identity/identity-store.ts :: authenticate", why: "the login boundary itself — it PRODUCES the identity a tenant is minted from" },
  { ref: "src/infrastructure/identity/identity-store.ts :: createSession", why: "post-authentication session mint; the session row is what future TenantContexts derive from" },
  { ref: "src/infrastructure/identity/identity-store.ts :: revokeSession", why: "capability-keyed by the unguessable session id (org-id fence NON_TENANT class)" },
  { ref: "src/infrastructure/identity/identity-store.ts :: renewSession", why: "capability-keyed rotation of the unguessable session id" },
  { ref: "src/infrastructure/identity/identity-store.ts :: deleteDeadSessions", why: "time-scoped maintenance sweep over the capability-keyed sessions table" },
  { ref: "src/infrastructure/identity/session.ts :: resolveSession", why: "maps a signed cookie to a Principal — the read side of the minting boundary" },
  { ref: "src/infrastructure/identity/session.ts :: resolveAndRenewSession", why: "same minting boundary, sliding-renewal path (ADR-0008/D-030)" },
  // --- capability-keyed loads (the unguessable token scopes the row; tenant comes FROM it) ---
  { ref: "src/infrastructure/crm/application-store.ts :: getApplicationByToken", why: "e-sign webhook entry: the token is the capability; the caller re-checks org agreement (resumeFlow)" },
  // --- below or beside the tenant seam ---
  { ref: "src/infrastructure/store/migrations.ts :: runMigrations", why: "schema management runs at boot, before any tenant exists (D-016 versioned migrations)" },
  { ref: "src/infrastructure/store/execution-store.ts :: makeExecutionStore", why: "adapter FACTORY — the returned port methods carry TenantContext (checked by the port-shape test below)" },
  { ref: "src/infrastructure/audit/audit-store.ts :: enqueueAudit", why: "tx-scoped internal called ONLY by auditedWrite, which asserts the sealed tenant first (anti-fork invariant)" },
  { ref: "src/infrastructure/audit/audit-store.ts :: discardedAuditEventWork", why: "constant-work login mirror (Vale V6): persists NOTHING; mints its reserved-org context internally" },
];

export interface TenantFenceViolation {
  ref: string;
  detail: string;
}

/** Exported SQL-taking repository functions missing a TenantContext/WriteActor param. */
export function detectMissingTenantParams(project: Project, escapes: ReadonlySet<string>): TenantFenceViolation[] {
  const out: TenantFenceViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
    // In-memory companion paths have no REPO_ROOT prefix; normalize both shapes.
    const normalized = rel.startsWith("..") ? sf.getFilePath().replace(/^\//, "") : rel;
    if (!REPO_MODULE_DIRS.some((d) => normalized.startsWith(d))) continue;

    const exported: Array<{ name: string; paramTexts: string[] }> = [];
    for (const fn of sf.getFunctions()) {
      if (!fn.isExported()) continue;
      exported.push({ name: fn.getName() ?? "<anonymous>", paramTexts: fn.getParameters().map((p) => p.getTypeNode()?.getText() ?? "") });
    }
    // Exported const arrows/function expressions — fail-closed against that evasion.
    for (const vs of sf.getVariableStatements()) {
      if (!vs.isExported()) continue;
      for (const decl of vs.getDeclarations()) {
        const init = decl.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
          exported.push({ name: decl.getName(), paramTexts: init.getParameters().map((p) => p.getTypeNode()?.getText() ?? "") });
        }
      }
    }

    for (const fn of exported) {
      if (!fn.paramTexts.some((t) => SQL_PARAM_RE.test(t))) continue; // not a repository entry point
      const ref = `${normalized} :: ${fn.name}`;
      if (escapes.has(ref)) continue;
      if (!fn.paramTexts.some((t) => TENANT_PARAM_RE.test(t))) {
        out.push({ ref, detail: `takes (${fn.paramTexts.join(", ")}) with no TenantContext/WriteActor` });
      }
    }
  }
  return out;
}

const ESCAPE_SET = new Set(REVIEWED_ESCAPES.map((e) => e.ref));

describe("tenant-context-required fence", () => {
  it("enforces: every exported repository function taking SqlDb also takes the sealed TenantContext (or is a reviewed escape)", () => {
    const violations = detectMissingTenantParams(realProject(), ESCAPE_SET);
    expect(violations, violations.map((v) => `${v.ref} — ${v.detail}`).join("\n")).toEqual([]);
  });

  it("enforces: no stale escapes (every escape still names a real exported function)", () => {
    // An escape pointing at nothing is drift: the function was renamed/removed and
    // its replacement may be silently unfenced.
    const project = realProject();
    const live = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
      for (const fn of sf.getFunctions()) if (fn.isExported() && fn.getName()) live.add(`${rel} :: ${fn.getName()}`);
    }
    const stale = REVIEWED_ESCAPES.filter((e) => !live.has(e.ref)).map((e) => e.ref);
    expect(stale, `stale escapes:\n${stale.join("\n")}`).toEqual([]);
  });

  it("enforces: the ExecutionStore PORT itself requires TenantContext on create/save/loadById (loadByToken is THE reviewed capability escape)", () => {
    const project = realProject();
    const engine = project.getSourceFiles().find((sf) => sf.getFilePath().endsWith("src/domain/workflow/engine.ts"));
    expect(engine, "src/domain/workflow/engine.ts not found").toBeTruthy();
    const port = engine!.getInterface("ExecutionStore");
    expect(port, "ExecutionStore port not found").toBeTruthy();
    for (const method of ["create", "save", "loadById"]) {
      const m = port!.getMethod(method);
      const hasTenant = m?.getParameters().some((p) => /\bTenantContext\b/.test(p.getTypeNode()?.getText() ?? ""));
      expect(hasTenant, `ExecutionStore.${method} must take TenantContext`).toBe(true);
    }
    const loadByToken = port!.getMethod("loadByToken");
    const tokenHasTenant = loadByToken?.getParameters().some((p) => /\bTenantContext\b/.test(p.getTypeNode()?.getText() ?? ""));
    expect(tokenHasTenant, "loadByToken is capability-keyed BY DESIGN — if it grew a tenant param, update the escape docs").toBe(false);
  });

  describe("detects (companion): planted violations are caught", () => {
    it("flags an exported repository function with SqlDb but no tenant", () => {
      const project = inMemoryProject({
        "/src/infrastructure/crm/evil.ts": `import type { SqlDb } from "../store/db";\nexport async function listAll(db: SqlDb): Promise<unknown[]> { return db.query("SELECT 1"); }`,
      });
      const v = detectMissingTenantParams(project, ESCAPE_SET);
      expect(v.length).toBe(1);
      expect(v[0]!.ref).toContain("listAll");
    });
    it("flags an exported const ARROW with SqlDb but no tenant (declaration-form evasion)", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/evil.ts": `import type { SqlDb } from "./db";\nexport const readAll = async (db: SqlDb) => db.query("SELECT 1");`,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET).length).toBe(1);
    });
    it("passes a function that takes TenantContext, and one that takes a WriteActor", () => {
      const project = inMemoryProject({
        "/src/infrastructure/crm/good.ts": [
          `import type { SqlDb } from "../store/db";`,
          `import type { TenantContext } from "@contracts/tenant";`,
          `import type { WriteActor } from "@contracts/principal";`,
          `export async function listGood(db: SqlDb, tenant: TenantContext): Promise<void> {}`,
          `export async function writeGood(db: SqlDb, a: WriteActor): Promise<void> {}`,
        ].join("\n"),
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([]);
    });
    it("an escape is EXACT-match: a renamed sibling of an escaped function is still flagged", () => {
      const project = inMemoryProject({
        "/src/infrastructure/identity/identity-store.ts": `import type { SqlDb } from "../store/db";\nexport async function findUserByEmailOrRole(db: SqlDb, email: string): Promise<unknown> { return db.query("SELECT 1"); }`,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET).length).toBe(1);
    });
    it("ignores non-repository modules (a helper without SqlDb is not a repository entry point)", () => {
      const project = inMemoryProject({
        "/src/infrastructure/crm/helper.ts": `export function shape(x: string): string { return x; }`,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([]);
    });
  });
});
