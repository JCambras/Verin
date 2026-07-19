import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { SyntaxKind, type SourceFile } from "ts-morph";
import { realProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";

/**
 * ORG-ID-REQUIRED FENCE (ADR-0004, charter #7). Every SELECT/UPDATE/DELETE on a
 * tenant DATA table must filter by org_id — no cross-tenant reads (STRIDE T-I2).
 * (Capability-keyed tables — sessions by id, flow_executions by resume token,
 * crm_write_cache/audit_outbox — are scoped by an unguessable key, not org_id.)
 * Scans EVERY string/template literal in EVERY shipped src file (app layer
 * included), so SQL built in a variable or issued from a route handler cannot
 * escape the scan the way a `.query("…")`-only regex allowed.
 */
const DATA_TABLES = [
  "households",
  "contacts",
  "financial_accounts",
  "tasks",
  "account_opening_applications",
  "users",
  "credentials",
  "audit_log",
];
// Columns that are themselves an unguessable capability (scope the row without org_id).
const CAPABILITY_KEYS = ["esign_token", "resume_token", "idempotency_key"];

// Reviewed escapes — queries that legitimately cannot carry an org_id filter.
// Matched against whitespace-normalized SQL; each carries its justification.
const REVIEWED_ESCAPES: Array<{ sql: string; why: string }> = [
  {
    sql: "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
    why: "session resolution: the unguessable session id is the capability; org_id comes FROM this row",
  },
  {
    sql: "FROM users WHERE email = $1",
    why: "login by email — org-qualified login is an explicit deferral (Sable F3, FOUNDATION gap list)",
  },
  {
    sql: "FROM credentials WHERE user_id = $1",
    why: "credentials has no org_id column; keyed by the user PK resolved during authentication",
  },
];

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

export function detectMissingOrgId(sql: string): boolean {
  if (!/\b(SELECT|UPDATE|DELETE)\b/i.test(sql)) return false; // INSERTs include org_id as a column, checked structurally elsewhere
  // Statement-shaped table references only (FROM/JOIN/UPDATE <table>), so trigger
  // DDL like "BEFORE UPDATE ON audit_log" does not false-positive.
  const touchesData = DATA_TABLES.some((t) => new RegExp(`\\b(FROM|JOIN|UPDATE)\\s+${t}\\b`, "i").test(sql));
  if (!touchesData) return false;
  if (CAPABILITY_KEYS.some((k) => new RegExp(`\\b${k}\\b`).test(sql))) return false; // capability-keyed access
  const normalized = normalizeSql(sql);
  if (REVIEWED_ESCAPES.some((e) => normalized.includes(e.sql))) return false;
  // Vale V4: org_id must appear as a FILTER predicate (org_id = / org_id IN),
  // not merely anywhere in the string (e.g. in the SELECT projection).
  return !/\borg_id\s*(=|\bin\b)/i.test(sql);
}

/** Every string-ish literal in a file — including SQL assigned to variables. */
export function sqlLiterals(sf: SourceFile): string[] {
  const out: string[] = [];
  for (const node of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) out.push(node.getLiteralText());
  for (const node of sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) out.push(node.getLiteralText());
  for (const node of sf.getDescendantsOfKind(SyntaxKind.TemplateExpression)) out.push(node.getText());
  return out;
}

describe("org-id-required fence", () => {
  it("enforces: every read/write on a tenant data table filters by org_id (all layers, all literals)", () => {
    const offenders: string[] = [];
    for (const sf of realProject().getSourceFiles()) {
      const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
      for (const sql of sqlLiterals(sf)) {
        if (detectMissingOrgId(sql)) offenders.push(`${rel}: ${normalizeSql(sql).slice(0, 70)}`);
      }
    }
    expect(offenders, `queries missing org_id:\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a query without org_id is caught", () => {
    it("flags a SELECT on households without org_id", () => {
      expect(detectMissingOrgId("SELECT * FROM households WHERE id = $1")).toBe(true);
    });
    it("flags an UPDATE on tasks without org_id", () => {
      expect(detectMissingOrgId("UPDATE tasks SET status = 'done' WHERE id = $1")).toBe(true);
    });
    it("flags an unscoped read of the org-scoped audit_log (cross-tenant read)", () => {
      expect(detectMissingOrgId("SELECT * FROM audit_log ORDER BY sequence")).toBe(true);
    });
    it("flags an unscoped SELECT on users", () => {
      expect(detectMissingOrgId("SELECT * FROM users WHERE role = 'admin'")).toBe(true);
    });
    it("allows a query that filters by org_id", () => {
      expect(detectMissingOrgId("SELECT * FROM households WHERE org_id = $1 AND id = $2")).toBe(false);
    });
    it("flags org_id in the projection but NOT the filter (Vale V4 evasion)", () => {
      expect(detectMissingOrgId("SELECT id, org_id FROM households WHERE id = $1")).toBe(true);
    });
    it("ignores non-data tables (capability-keyed)", () => {
      expect(detectMissingOrgId("SELECT * FROM sessions WHERE id = $1")).toBe(false);
    });
    it("ignores trigger DDL mentioning a data table (BEFORE UPDATE ON audit_log)", () => {
      expect(detectMissingOrgId("CREATE TRIGGER t BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION f()")).toBe(false);
    });
    it("catches SQL assigned to a variable before .query() (literal sweep, not call-site only)", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts": `const q = "SELECT * FROM households WHERE id = $1";\nexport async function evil(db: { query(s: string): Promise<unknown> }) { return db.query(q); }`,
      });
      const flagged = project.getSourceFiles().flatMap((sf) => sqlLiterals(sf)).filter(detectMissingOrgId);
      expect(flagged.length).toBe(1);
    });
  });
});
