import { describe, it, expect } from "vitest";
import { readShipped } from "./_fence-utils";

/**
 * ORG-ID-REQUIRED FENCE (ADR-0004, charter #7). Every SELECT/UPDATE/DELETE on a
 * tenant DATA table must filter by org_id — no cross-tenant reads (STRIDE T-I2).
 * (Capability-keyed tables — sessions by id, flow_executions by resume token,
 * crm_write_cache/audit_outbox — are scoped by an unguessable key, not org_id.)
 */
const DATA_TABLES = ["households", "contacts", "financial_accounts", "tasks", "account_opening_applications"];
// Columns that are themselves an unguessable capability (scope the row without org_id).
const CAPABILITY_KEYS = ["esign_token", "resume_token", "idempotency_key"];

/**
 * Extract the SQL string passed to .query(...) calls only (not prose/comments) —
 * avoids false positives from apostrophes in comments.
 */
function queryStrings(text: string): string[] {
  const out: string[] = [];
  const re = /\.query\s*(?:<[^>]*>)?\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!.slice(1, -1));
  return out;
}

export function detectMissingOrgId(sql: string): boolean {
  const isReadOrWrite = /\b(SELECT|UPDATE|DELETE)\b/i.test(sql);
  if (!isReadOrWrite) return false; // INSERTs include org_id as a column, checked structurally elsewhere
  const touchesData = DATA_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(sql));
  if (!touchesData) return false;
  if (CAPABILITY_KEYS.some((k) => new RegExp(`\\b${k}\\b`).test(sql))) return false; // capability-keyed access
  return !/\borg_id\b/.test(sql);
}

describe("org-id-required fence", () => {
  it("enforces: every read/write on a tenant data table filters by org_id", () => {
    const offenders: string[] = [];
    for (const { rel, text } of readShipped()) {
      if (!rel.replace(/\\/g, "/").startsWith("src/infrastructure/")) continue;
      for (const sql of queryStrings(text)) {
        if (detectMissingOrgId(sql)) offenders.push(`${rel}: ${sql.slice(0, 70).replace(/\s+/g, " ")}`);
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
    it("allows a query that filters by org_id", () => {
      expect(detectMissingOrgId("SELECT * FROM households WHERE org_id = $1 AND id = $2")).toBe(false);
    });
    it("ignores non-data tables (capability-keyed)", () => {
      expect(detectMissingOrgId("SELECT * FROM sessions WHERE id = $1")).toBe(false);
    });
  });
});
