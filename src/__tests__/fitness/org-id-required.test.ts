import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { SyntaxKind, type SourceFile } from "ts-morph";
import { realProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";
import { MIGRATION_SQL, MIGRATIONS, type PreflightProbe } from "@infra/store/migrations";
import {
  DECISION_LEDGER_GENERATIONS_SQL,
  DECISION_REPLAY_SOURCE_PROVENANCE_SQL,
} from "@infra/store/decision-ledger-migration";

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
  "evidence_snapshots",
  "decision_input_bundles",
  "decision_input_bundle_evidence",
  "decision_records",
  "decision_replay_source_provenance",
  "decision_ledger",
  "decision_ledger_anchor",
  "decision_state_projection",
  "decision_reservation_index",
  "decision_projection_checkpoint",
];
// Reviewed NON-tenant tables (each with the reason it needs no org_id filter). The
// derivation check below proves DATA_TABLES + NON_TENANT_TABLES = exactly the
// tables in migrations.ts, so a NEW table cannot ship silently unfenced.
const NON_TENANT_TABLES = [
  "orgs", // the tenant table itself — keyed by its own id
  "sessions", // capability-keyed by the unguessable session id; org_id comes FROM the row
  "flow_executions", // capability-keyed by the resume token / engine-held execution id
  "crm_write_cache", // idempotency cache, PK (org_id, idempotency_key) — always key-scoped
  "audit_outbox", // internal delivery queue, keyed by row id claims
  "audit_anchor", // one integrity row per org, keyed by org_id PK upserts
  "schema_migrations", // migration ledger (D-016), global infra table keyed by version - no tenant data
];
/** Tables present in DDL but classified in neither list (must be empty). */
export function unclassifiedTables(ddl: string, dataTables: readonly string[], nonTenant: readonly string[]): string[] {
  const inDdl = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);
  const classified = new Set([...dataTables, ...nonTenant]);
  return inDdl.filter((t) => !classified.has(t));
}

// Reviewed escapes — queries that legitimately cannot carry an org_id filter.
// Each entry is the FULL whitespace-normalized statement and must match the
// normalized SQL exactly: a substring/containment match would silently exempt
// any superset query (e.g. the login query grown an "OR role = $2" arm).
const REVIEWED_ESCAPES: Array<{ sql: string; why: string }> = [
  {
    sql: normalizeSql(DECISION_LEDGER_GENERATIONS_SQL),
    why: "forward-only migration 5 validates and backfills every existing tenant",
  },
  {
    sql: normalizeSql(DECISION_REPLAY_SOURCE_PROVENANCE_SQL),
    why: "forward-only migration 7 backfills and validates every existing tenant",
  },
  {
    sql:
      "SELECT s.id AS session_id, s.org_id, u.role, s.expires_at, s.revoked_at, " +
      "u.id AS user_id, u.email, u.status AS user_status " +
      "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1",
    why: "session resolution: the unguessable session id is the capability; org_id comes FROM this row",
  },
  {
    sql: "SELECT id, org_id, email, display_name, role, status FROM users WHERE email = $1 ORDER BY created_at ASC, id ASC LIMIT 1",
    why: "login by email — org-qualified login is an explicit deferral (Sable F3, FOUNDATION gap list); deterministic ORDER BY so an email collision cannot resolve arbitrarily",
  },
  {
    sql: "SELECT password_hash FROM credentials WHERE user_id = $1",
    why: "credentials has no org_id column; keyed by the user PK resolved during authentication",
  },
  {
    sql: "SELECT * FROM account_opening_applications WHERE esign_token = $1",
    why: "the unguessable e-sign token is the application capability",
  },
];
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

const SQL_ALIAS_STOP_WORDS = new Set([
  "cross",
  "full",
  "for",
  "from",
  "group",
  "having",
  "inner",
  "join",
  "left",
  "limit",
  "on",
  "offset",
  "order",
  "outer",
  "returning",
  "right",
  "set",
  "union",
  "using",
  "where",
]);

function normalizeSqlIdentifiers(sql: string): string {
  return sql.replace(/"((?:""|[^"])*)"/g, (_, value: string) =>
    value.replace(/""/g, "\"").toLowerCase());
}

const BOUND_TENANT_VALUE = "(?:\\$\\d+|\\?|:[a-z_][a-z0-9_$]*)";
const TENANT_EQUAL_VALUE =
  `(?:${BOUND_TENANT_VALUE}|'[^']*'|\\d+)`;
const BOUND_TENANT_LIST =
  `\\(\\s*${BOUND_TENANT_VALUE}(?:\\s*,\\s*${BOUND_TENANT_VALUE})*\\s*\\)`;

function tenantTableAliases(sql: string): string[] {
  const normalized = normalizeSqlIdentifiers(sql);
  const references =
    /\b(?:from|join|update|delete\s+from)\s+(?:only\s+)?((?:[a-z_][a-z0-9_$]*\s*\.\s*)?([a-z_][a-z0-9_$]*))(?:\s+(?:as\s+)?([a-z_][a-z0-9_$]*))?/gi;
  const aliases: string[] = [];
  for (const match of normalized.matchAll(references)) {
    const table = match[2]?.toLowerCase();
    if (!table || !DATA_TABLES.includes(table)) continue;
    const candidate = match[3]?.toLowerCase();
    aliases.push(
      candidate && !SQL_ALIAS_STOP_WORDS.has(candidate) ? candidate : table,
    );
  }
  return aliases;
}

function scopedTenantAliases(sql: string, aliases: readonly string[]): Set<string> {
  const governed = new Set(aliases);
  const scoped = new Set<string>();
  const edges = new Map<string, Set<string>>();
  for (const alias of governed) edges.set(alias, new Set());
  for (const match of sql.matchAll(
    /\b([a-z_][a-z0-9_$]*)\s*\.\s*org_id\s*=\s*([a-z_][a-z0-9_$]*)\s*\.\s*org_id\b/gi,
  )) {
    const left = match[1]!.toLowerCase();
    const right = match[2]!.toLowerCase();
    if (governed.has(left) && governed.has(right)) {
      edges.get(left)!.add(right);
      edges.get(right)!.add(left);
    }
  }
  for (const alias of governed) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      new RegExp(
        `\\b${escaped}\\s*\\.\\s*org_id\\s*(?:=\\s*${TENANT_EQUAL_VALUE}|\\bin\\s*${BOUND_TENANT_LIST})`,
        "i",
      ).test(sql) ||
      new RegExp(
        `(?:${BOUND_TENANT_VALUE}|'[^']*')\\s*=\\s*${escaped}\\s*\\.\\s*org_id\\b`,
        "i",
      ).test(sql)
    ) {
      scoped.add(alias);
    }
  }
  if (
    governed.size === 1 &&
    new RegExp(
      `\\b(?:where|on)\\b[\\s\\S]*?\\borg_id\\s*(?:=\\s*${TENANT_EQUAL_VALUE}|\\bin\\s*${BOUND_TENANT_LIST})`,
      "i",
    ).test(sql)
  ) {
    scoped.add(aliases[0]!);
  }
  const pending = [...scoped];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const neighbor of edges.get(current) ?? []) {
      if (scoped.has(neighbor)) continue;
      scoped.add(neighbor);
      pending.push(neighbor);
    }
  }
  return scoped;
}

export function detectMissingOrgId(sql: string): boolean {
  if (!/\b(SELECT|UPDATE|DELETE)\b/i.test(sql)) return false; // INSERTs include org_id as a column, checked structurally elsewhere
  const normalized = normalizeSql(sql);
  if (REVIEWED_ESCAPES.some((e) => normalized === e.sql)) return false;
  const identifierNormalized = normalizeSqlIdentifiers(normalized);
  const aliases = [...new Set(tenantTableAliases(identifierNormalized))];
  if (aliases.length === 0) return false;
  const scoped = scopedTenantAliases(identifierNormalized, aliases);
  return aliases.some((alias) => !scoped.has(alias));
}

/**
 * Migration preflight probes are BUILT at module load, so they never appear as a
 * source literal this fence could scan, and they read every tenant's rows on purpose
 * — "can this schema change be applied to this store at all" is a question about the
 * store, not about a tenant. The reviewed exemption is therefore narrow and checked,
 * not implicit: a probe must be a single read-only SELECT. The moment one is allowed
 * to write, an unscoped cross-tenant MUTATION would be running outside every rule
 * this fence exists to enforce.
 */
export function nonReadOnlyProbes(probes: readonly PreflightProbe[]): string[] {
  return probes
    .filter((p) => !/^SELECT\b/i.test(normalizeSql(p.sql)) || /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT)\b/i.test(p.sql) || p.sql.replace(/;\s*$/, "").includes(";"))
    .map((p) => `${p.relationship}: preflight probe must be a single read-only SELECT`);
}

/** Every string-ish literal in a file — including SQL assigned to variables. */
export function sqlLiterals(sf: SourceFile): string[] {
  return sqlOccurrences(sf).map((item) => item.sql);
}

function sqlOccurrences(sf: SourceFile): Array<{ sql: string; line: number }> {
  return [
    ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral).map((node) => ({
      sql: node.getLiteralText(),
      line: node.getStartLineNumber(),
    })),
    ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral).map(
      (node) => ({
        sql: node.getLiteralText(),
        line: node.getStartLineNumber(),
      }),
    ),
    ...sf.getDescendantsOfKind(SyntaxKind.TemplateExpression).map((node) => ({
      sql: node.getText(),
      line: node.getStartLineNumber(),
    })),
  ];
}

describe("org-id-required fence", () => {
  it("enforces: the table classification is DERIVED-complete against migrations.ts (a new table cannot ship unfenced)", () => {
    const unclassified = unclassifiedTables(MIGRATION_SQL, DATA_TABLES, NON_TENANT_TABLES);
    expect(unclassified, `tables in migrations.ts with no org-scoping classification (add to DATA_TABLES or review into NON_TENANT_TABLES):\n${unclassified.join("\n")}`).toEqual([]);
    // No stale entries either: a renamed/dropped table must leave the lists.
    const inDdl = new Set([...MIGRATION_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!));
    const stale = [...DATA_TABLES, ...NON_TENANT_TABLES].filter((t) => !inDdl.has(t));
    expect(stale, `classified tables no longer in migrations.ts:\n${stale.join("\n")}`).toEqual([]);
  });

  it("enforces: every read/write on a tenant data table filters by org_id (all layers, all literals)", () => {
    const offenders: string[] = [];
    for (const sf of realProject().getSourceFiles()) {
      const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
      for (const item of sqlOccurrences(sf)) {
        if (detectMissingOrgId(item.sql)) {
          offenders.push(
            `${rel}:${item.line}: ${normalizeSql(item.sql).slice(0, 70)}`,
          );
        }
      }
    }
    expect(offenders, `queries missing org_id:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("enforces: every migration preflight probe is a single read-only SELECT (the one sanctioned cross-tenant read)", () => {
    const probes = MIGRATIONS.flatMap((m) => m.preflight ?? []);
    // Non-vacuity floor: the exemption is only sound while there ARE probes to check.
    expect(probes.length).toBeGreaterThan(0);
    expect(nonReadOnlyProbes(probes), nonReadOnlyProbes(probes).join("\n")).toEqual([]);
  });

  describe("detects (companion): a query without org_id is caught", () => {
    it("a preflight probe that mutates is caught (the exemption does not cover writes)", () => {
      expect(nonReadOnlyProbes([{ relationship: "r", subject: "s", sql: "UPDATE households SET advisor_user_id = NULL" }])).toHaveLength(1);
      expect(nonReadOnlyProbes([{ relationship: "r", subject: "s", sql: "SELECT count(*) AS orphans FROM households; DELETE FROM households" }])).toHaveLength(1);
      expect(nonReadOnlyProbes([{ relationship: "r", subject: "s", sql: "SELECT count(*)::int AS orphans FROM tasks c WHERE c.org_id IS NOT NULL;" }])).toEqual([]);
    });
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
    it("flags unscoped reads of tenant-owned ledger anchors and checkpoints", () => {
      expect(detectMissingOrgId("SELECT * FROM decision_ledger_anchor")).toBe(true);
      expect(
        detectMissingOrgId("SELECT * FROM decision_projection_checkpoint"),
      ).toBe(true);
    });
    it("flags quoted and schema-qualified tenant tables", () => {
      expect(
        detectMissingOrgId("SELECT * FROM public.decision_ledger"),
      ).toBe(true);
      expect(
        detectMissingOrgId('SELECT * FROM "decision_ledger"'),
      ).toBe(true);
    });
    it("requires an organization predicate for every tenant-table alias", () => {
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger dl JOIN households h ON h.id = dl.decision_id WHERE h.org_id = $1",
        ),
      ).toBe(true);
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger dl JOIN households h ON h.id = dl.decision_id WHERE dl.org_id = $1 AND h.org_id = $1",
        ),
      ).toBe(false);
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger dl JOIN households h ON h.org_id = dl.org_id",
        ),
      ).toBe(true);
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger dl JOIN households h ON h.org_id = dl.org_id WHERE h.org_id = $1",
        ),
      ).toBe(false);
    });
    it("allows a query that filters by org_id", () => {
      expect(detectMissingOrgId("SELECT * FROM households WHERE org_id = $1 AND id = $2")).toBe(false);
    });
    it("requires org_id IN values to be bound", () => {
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger dl WHERE dl.org_id IN (SELECT id FROM orgs)",
        ),
      ).toBe(true);
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger dl WHERE dl.org_id IN ($1, $2)",
        ),
      ).toBe(false);
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger dl WHERE dl.org_id IN ('firm-a')",
        ),
      ).toBe(true);
    });
    it("limits migration-wide org_id escapes to the exact reviewed SQL", () => {
      expect(detectMissingOrgId(DECISION_LEDGER_GENERATIONS_SQL)).toBe(false);
      expect(
        detectMissingOrgId(DECISION_REPLAY_SOURCE_PROVENANCE_SQL),
      ).toBe(false);
      expect(
        detectMissingOrgId(
          `${DECISION_LEDGER_GENERATIONS_SQL}
SELECT * FROM decision_ledger`,
        ),
      ).toBe(true);
    });
    it("flags org_id in the projection but NOT the filter (Vale V4 evasion)", () => {
      expect(detectMissingOrgId("SELECT id, org_id FROM households WHERE id = $1")).toBe(true);
    });
    it("does not broadly exempt a tenant query that mentions a capability column", () => {
      expect(
        detectMissingOrgId(
          "SELECT * FROM decision_ledger_anchor JOIN account_opening_applications ON true WHERE esign_token = $1",
        ),
      ).toBe(true);
    });
    it("ignores non-data tables (capability-keyed)", () => {
      expect(detectMissingOrgId("SELECT * FROM sessions WHERE id = $1")).toBe(false);
    });
    it("ignores trigger DDL mentioning a data table (BEFORE UPDATE ON audit_log)", () => {
      expect(detectMissingOrgId("CREATE TRIGGER t BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION f()")).toBe(false);
    });
    it("allows the exact reviewed login escape but flags a superset of it (escapes are exact-match)", () => {
      const escaped = "SELECT id, org_id, email, display_name, role, status FROM users WHERE email = $1 ORDER BY created_at ASC, id ASC LIMIT 1";
      expect(detectMissingOrgId(escaped)).toBe(false);
      expect(detectMissingOrgId(escaped.replace("WHERE email = $1", "WHERE email = $1 OR role = $2"))).toBe(true);
    });
    it("a NEW table added to migrations.ts without a classification is caught", () => {
      const ddl = `${MIGRATION_SQL}\nCREATE TABLE IF NOT EXISTS client_notes (id text PRIMARY KEY, body text);`;
      expect(unclassifiedTables(ddl, DATA_TABLES, NON_TENANT_TABLES)).toEqual(["client_notes"]);
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
