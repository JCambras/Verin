/**
 * Portable PostgreSQL schema and ordered VERSIONED migrations (ADR-0004/0007,
 * D-016/D-029). `MIGRATIONS` is an ordered list applied by `runMigrations`, which
 * records each version in `schema_migrations`; the complete pending plan commits in
 * one transaction, with each preflight immediately before its DDL. A schema change
 * APPENDS a `{version, name, sql}` entry. Never edit a shipped entry's DDL: stores
 * that already recorded that version will never re-run it, so the edit reaches new
 * stores only and the two silently diverge.
 *
 * TEMPORAL COLUMNS ARE `timestamptz`, BUT THE APPLICATION BOUNDARY STAYS ISO STRINGS
 * IN BOTH DIRECTIONS. Writers emit `toISOString()`; a read parser in `db.ts`
 * (OID 1184, `new Date(v).toISOString()`) normalizes every read back to canonical UTC
 * ISO. So callers never receive `Date` objects, and - the reason this matters beyond
 * ergonomics - the round-trip is BYTE-EXACT. The audit hash chain hashes `created_at`
 * as text, so a write-read cycle that changed the rendering by even one character
 * (a space instead of `T`, a `+00` instead of `Z`, microseconds instead of millis)
 * would break `verifyChain` on rows nobody touched. Adding a temporal column means
 * adding it as `timestamptz` and leaving the boundary alone.
 *
 * Adding a table also means classifying it in the `org-id-required` fence, which
 * DERIVES its table list from this DDL: an unclassified table fails the build rather
 * than defaulting to unscoped.
 */
import { appError } from "@contracts/errors";
import type { SqlDb } from "./db";
import { runMigrationPlan } from "./migration-runner";
import {
  DECISION_LEDGER_BUNDLE_IDENTITY_SQL,
  DECISION_LEDGER_COMPUTED_PROVENANCE_SQL,
  DECISION_LEDGER_GENERATIONS_SQL,
  DECISION_LEDGER_REPLAY_COVERAGE_INDEX_SQL,
  DECISION_LEDGER_RESERVATION_LOOKUP_INDEXES_SQL,
  DECISION_LEDGER_SQL,
  DECISION_LEDGER_TOTAL_WITNESS_SQL,
  DECISION_REPLAY_SOURCE_PROVENANCE_SQL,
} from "./decision-ledger-migration";

export interface Migration {
  /** Monotonic, gap-free version. Recorded in `schema_migrations` once applied. */
  readonly version: number;
  /** Stable slug (kebab-case) - documents intent in `schema_migrations` and logs. */
  readonly name: string;
  /** Idempotent-where-possible DDL for this version. Runs as one transaction. */
  readonly sql: string;
  /** READ-ONLY probes run before this version's DDL; a non-zero count refuses the upgrade. */
  readonly preflight?: readonly PreflightProbe[];
}

/**
 * A pre-migration data check. `sql` MUST be read-only and return one `orphans` count:
 * an unsatisfiable constraint is REPORTED, never repaired - no shipped migration
 * deletes, rewrites, or re-points a row a human put there.
 */
export interface PreflightProbe {
  /** The constraint this probe stands in for - the diagnostic names it. */
  readonly relationship: string;
  /** Child -> parent columns, so the diagnostic is actionable without the source. */
  readonly subject: string;
  readonly sql: string;
}

// Bookkeeping table: which migration versions this store has applied. Bootstrapped
// (CREATE IF NOT EXISTS) before any version runs, so `runMigrations` can read it on a
// virgin store. Global infra table - no tenant data, keyed by version (classified
// NON_TENANT in the org-id-required fence).
export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
`;

// Version 1 - hardened baseline (deep-review r6 finding #6): timestamptz for every
// temporal column, the household_id / org_id foreign keys, and the lookup indexes the
// household detail view + load gate need. On a virgin store this simply builds the
// hardened schema; there is no prior text-column data to convert (D-016 designated
// this the first real schema change).
const BASELINE_SQL = `
CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL,
  UNIQUE (org_id, email)
);

CREATE TABLE IF NOT EXISTS credentials (
  user_id text PRIMARY KEY REFERENCES users(id),
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  org_id text NOT NULL REFERENCES orgs(id),
  role text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS households (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  name text NOT NULL,
  primary_contact_id text,
  advisor_user_id text,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS households_org ON households(org_id);

CREATE TABLE IF NOT EXISTS contacts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text NOT NULL REFERENCES households(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  created_at timestamptz NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS contacts_org ON contacts(org_id);
CREATE INDEX IF NOT EXISTS contacts_household ON contacts(household_id);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text NOT NULL REFERENCES households(id),
  account_type text NOT NULL,
  custodian text,
  balance_minor_units bigint,
  currency text NOT NULL,
  status text NOT NULL,
  open_date timestamptz,
  created_at timestamptz NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS financial_accounts_org ON financial_accounts(org_id);
CREATE INDEX IF NOT EXISTS financial_accounts_household ON financial_accounts(household_id);

CREATE TABLE IF NOT EXISTS account_opening_applications (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text NOT NULL,
  contact_id text NOT NULL,
  account_type text NOT NULL,
  status text NOT NULL,
  esign_token text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_org ON account_opening_applications(org_id);
-- The e-sign token is the webhook's capability: UNIQUE makes the exactly-once
-- token resolution structural (rows[0] can never be an ambiguous match) and kills
-- the per-webhook full scan. Multiple NULLs are fine (draft applications).
CREATE UNIQUE INDEX IF NOT EXISTS applications_esign_token_unique ON account_opening_applications(esign_token);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text,
  subject text NOT NULL,
  status text NOT NULL,
  due_date timestamptz,
  assignee_user_id text,
  created_at timestamptz NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_org ON tasks(org_id);

-- Suspend/resume continuation persistence (ADR-0011).
CREATE TABLE IF NOT EXISTS flow_executions (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  flow_id text NOT NULL,
  status text NOT NULL,
  resume_token text,
  context_json text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- UNIQUE: the resume token is the webhook's capability — token-based resume must
-- never resolve an ambiguous match. Multiple NULLs (pre-suspend executions) are fine.
CREATE UNIQUE INDEX IF NOT EXISTS flow_exec_token_unique ON flow_executions(resume_token);

-- Idempotency for external/CRM writes (ADR-0009).
CREATE TABLE IF NOT EXISTS crm_write_cache (
  org_id text NOT NULL,
  idempotency_key text NOT NULL,
  result_json text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, idempotency_key)
);

-- Transactional outbox for audit entries (ADR-0007/0016).
CREATE TABLE IF NOT EXISTS audit_outbox (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  claimed_at timestamptz
);

-- Append-only, hash-chained audit log (ADR-0007). One chain per org, ordered by sequence.
CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  sequence bigint NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_json text,
  after_json text,
  detail text NOT NULL,
  created_at timestamptz NOT NULL,
  prev_hash text NOT NULL,
  entry_hash text NOT NULL,
  UNIQUE (org_id, sequence)
);

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (SEC 17a-4 / SOC2 CC7.4)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Truncation would wipe a chain WITHOUT leaving a gap (Vale V1 / Sable F4).
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Out-of-band anchor: the expected count + max sequence per org, so ACCIDENTAL
-- tail-truncation, a bad restore, or a naive edit that removes rows is DETECTED by
-- verifyChain. NOT proof against an adversary with DB write access: this table
-- lives in the same database and the chain hash is unkeyed, so such an adversary
-- could rewrite entries, recompute hashes, and update this row. Externalizing the
-- anchor (or HMAC-signing the chain) is an explicit ADR-0007 deferred-hardening item.
CREATE TABLE IF NOT EXISTS audit_anchor (
  org_id text PRIMARY KEY,
  max_sequence bigint NOT NULL,
  entry_count bigint NOT NULL,
  updated_at timestamptz NOT NULL
);
`;

// Version 2 - sessions(expires_at) index (deep-review r6 finding #8). The
// opportunistic session cleanup (`deleteDeadSessions`) sweeps rows by
// `expires_at < cutoff`, and sliding-renewal resolution reads by expiry; this
// index supports that expiry-scan arm - the dominant cleanup driver - so it
// stays an index scan as the sessions table grows. The cleanup DELETE's other
// arm (`revoked_at < cutoff`) is intentionally unindexed: the sweep keeps the
// table pruned, so scanning the few recently-revoked rows is cheap. Additive,
// idempotent (IF NOT EXISTS) - the versioned-migration mechanism applies it
// once and records version 2 in `schema_migrations`.
const SESSIONS_EXPIRES_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
`;

/**
 * Version 3's tenant-qualified parent edges, as DATA: each entry generates BOTH the
 * composite foreign key and the read-only orphan PREFLIGHT below, so a relationship
 * can never ship a constraint the migration cannot first check for. Every edge names
 * a column shipped code actually populates - an FK on an always-NULL column is
 * skipped by MATCH SIMPLE forever, so no companion could trip it (charter #4).
 */
interface TenantEdge {
  readonly constraint: string;
  readonly child: string;
  readonly childColumns: readonly string[];
  readonly parent: string;
  readonly parentColumns: readonly string[];
}

const TENANT_EDGES: readonly TenantEdge[] = [
  { constraint: "sessions_user_org_fk", child: "sessions", childColumns: ["user_id", "org_id"], parent: "users", parentColumns: ["id", "org_id"] },
  { constraint: "households_advisor_org_fk", child: "households", childColumns: ["advisor_user_id", "org_id"], parent: "users", parentColumns: ["id", "org_id"] },
  { constraint: "contacts_household_org_fk", child: "contacts", childColumns: ["household_id", "org_id"], parent: "households", parentColumns: ["id", "org_id"] },
  { constraint: "financial_accounts_household_org_fk", child: "financial_accounts", childColumns: ["household_id", "org_id"], parent: "households", parentColumns: ["id", "org_id"] },
  { constraint: "applications_household_org_fk", child: "account_opening_applications", childColumns: ["household_id", "org_id"], parent: "households", parentColumns: ["id", "org_id"] },
  { constraint: "applications_contact_household_org_fk", child: "account_opening_applications", childColumns: ["contact_id", "household_id", "org_id"], parent: "contacts", parentColumns: ["id", "household_id", "org_id"] },
  { constraint: "tasks_household_org_fk", child: "tasks", childColumns: ["household_id", "org_id"], parent: "households", parentColumns: ["id", "org_id"] },
];

/**
 * The orphan probe for one edge, mirroring MATCH SIMPLE exactly: a row with ANY
 * NULL key column is skipped by the constraint, so it is skipped here too - the
 * preflight must not refuse an upgrade the constraint would have accepted.
 */
const orphanProbeSql = (e: TenantEdge) =>
  `SELECT count(*)::int AS orphans FROM ${e.child} c WHERE ${e.childColumns.map((col) => `c.${col} IS NOT NULL`).join(" AND ")} AND NOT EXISTS (SELECT 1 FROM ${e.parent} p WHERE ${e.childColumns.map((col, i) => `p.${e.parentColumns[i]} = c.${col}`).join(" AND ")});`;

const TENANT_QUALIFIED_RELATIONSHIPS_SQL = `
CREATE UNIQUE INDEX users_id_org_unique ON users(id, org_id);
CREATE UNIQUE INDEX households_id_org_unique ON households(id, org_id);
CREATE UNIQUE INDEX contacts_id_household_org_unique ON contacts(id, household_id, org_id);

${TENANT_EDGES.map((e) => `ALTER TABLE ${e.child}
  ADD CONSTRAINT ${e.constraint}
  FOREIGN KEY (${e.childColumns.join(", ")}) REFERENCES ${e.parent}(${e.parentColumns.join(", ")});`).join("\n")}
`;

/** The ordered migration list. Append a new `{ version, name, sql }` for each schema change; never edit a shipped entry. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", sql: BASELINE_SQL },
  { version: 2, name: "sessions-expires-index", sql: SESSIONS_EXPIRES_INDEX_SQL },
  {
    version: 3,
    name: "tenant-qualified-relationships",
    sql: TENANT_QUALIFIED_RELATIONSHIPS_SQL,
    preflight: TENANT_EDGES.map((e) => ({
      relationship: e.constraint,
      subject: `${e.child}(${e.childColumns.join(", ")}) -> ${e.parent}(${e.parentColumns.join(", ")})`,
      sql: orphanProbeSql(e),
    })),
  },
  { version: 4, name: "decision-ledger-foundation", sql: DECISION_LEDGER_SQL },
  {
    version: 5,
    name: "decision-ledger-reservation-generations",
    sql: DECISION_LEDGER_GENERATIONS_SQL,
  },
  {
    version: 6,
    name: "decision-ledger-replay-coverage-index",
    sql: DECISION_LEDGER_REPLAY_COVERAGE_INDEX_SQL,
  },
  {
    version: 7,
    name: "decision-replay-source-provenance",
    sql: DECISION_REPLAY_SOURCE_PROVENANCE_SQL,
  },
  {
    version: 8,
    name: "decision-ledger-reservation-lookup-indexes",
    sql: DECISION_LEDGER_RESERVATION_LOOKUP_INDEXES_SQL,
  },
  {
    version: 9,
    name: "decision-ledger-bundle-identity",
    sql: DECISION_LEDGER_BUNDLE_IDENTITY_SQL,
  },
  {
    version: 10,
    name: "decision-ledger-computed-provenance",
    sql: DECISION_LEDGER_COMPUTED_PROVENANCE_SQL,
  },
  {
    version: 11,
    name: "decision-ledger-total-witness",
    sql: DECISION_LEDGER_TOTAL_WITNESS_SQL,
  },
];

// Fail loud at module load if a migration is malformed: versions must be a gap-free
// 1..N run of integers (so applying them in array order is applying them in version
// order) and names must be clean kebab-case slugs (a readable ledger). A defensive
// invariant on the in-repo constant list, caught at boot, not at first migration.
for (const [i, m] of MIGRATIONS.entries()) {
  if (!Number.isInteger(m.version) || m.version !== i + 1) {
    throw appError("INTERNAL", `migrations must be a gap-free 1..N sequence; got version ${m.version} at index ${i}`);
  }
  if (!/^[a-z0-9-]+$/.test(m.name)) {
    throw appError("INTERNAL", `migration name must be a kebab-case slug; got ${JSON.stringify(m.name)}`);
  }
}

/**
 * The complete shipped schema as one DDL string - every table this store contains,
 * across the bookkeeping table and all migration versions. Consumed by the
 * org-id-required fence's DERIVED-complete table classification (a new table cannot
 * ship without an org-scoping classification), NOT by the runtime (the runtime runs
 * `runMigrations`). Kept as a single string so the fence sees the whole surface.
 */
export const MIGRATION_SQL = [SCHEMA_MIGRATIONS_DDL, ...MIGRATIONS.map((m) => m.sql)].join("\n");

export async function runMigrations(db: SqlDb): Promise<void> {
  return runMigrationPlan(db);
}
