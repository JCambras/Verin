/**
 * House-CRM store schema (ADR-0004/0007). Portable PostgreSQL DDL — runs on PGlite
 * (dev/CI) and managed Postgres (prod) unchanged. The audit_log is append-only
 * (BEFORE UPDATE/DELETE triggers RAISE EXCEPTION) and hash-chained per org; the
 * outbox delivers audit entries at-least-once; crm_write_cache gives idempotency.
 *
 * VERSIONED MIGRATIONS (D-016 executed by deep-review r6 finding #6). The schema is
 * an ORDERED list of migrations, each recorded in `schema_migrations` once applied,
 * so a schema change is an APPENDED migration rather than an in-place DDL edit that
 * silently no-ops on an already-initialized dataDir. `runMigrations` applies every
 * not-yet-recorded version in order, each in its own transaction (DDL is
 * transactional in Postgres), recording the version in the SAME transaction - a
 * crash mid-migration leaves neither a half-applied schema nor a
 * recorded-but-unapplied version. There is no production store yet (dev/CI stores
 * are ephemeral / reseedable), so version 1 is a hardened baseline rather than a
 * text→timestamptz data conversion; the mechanism is what future prod changes ride.
 *
 * Every temporal column is `timestamptz` (not `text`): the app boundary keeps ISO
 * strings on BOTH sides (writers emit `toISOString()`; the driver serializes the
 * string and the `timestamptz` read-parser in `db.ts` normalizes back to a canonical
 * UTC ISO-8601 string), so ordering and `<`/`>` comparisons are instant-correct
 * instead of lexicographic on whatever offset a writer happened to emit - closing the
 * `claimed_at < $2` foot-gun in `audit-store.ts`.
 */
import { appError } from "@contracts/errors";
import type { SqlDb } from "./db";

export interface Migration {
  /** Monotonic, gap-free version. Recorded in `schema_migrations` once applied. */
  readonly version: number;
  /** Stable slug (kebab-case) - documents intent in `schema_migrations` and logs. */
  readonly name: string;
  /** Idempotent-where-possible DDL for this version. Runs as one transaction. */
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
// index keeps that sweep from degrading to a full scan as the sessions table
// grows. Additive, idempotent (IF NOT EXISTS) - the versioned-migration
// mechanism applies it once and records version 2 in `schema_migrations`.
const SESSIONS_EXPIRES_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
`;

/** The ordered migration list. Append a new `{ version, name, sql }` for each schema change; never edit a shipped entry. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", sql: BASELINE_SQL },
  { version: 2, name: "sessions-expires-index", sql: SESSIONS_EXPIRES_INDEX_SQL },
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

/**
 * Apply every not-yet-recorded migration version in order. Idempotent: an already
 * up-to-date store runs no DDL. Each version's DDL and its `schema_migrations` record
 * commit in ONE transaction, so the applied set and the actual schema never diverge.
 */
export async function runMigrations(db: SqlDb): Promise<void> {
  // Bootstrap the ledger so a virgin store can be queried for its applied versions.
  await db.exec(SCHEMA_MIGRATIONS_DDL);
  const recorded = await db.query<{ version: number }>("SELECT version FROM schema_migrations");
  const applied = new Set(recorded.rows.map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    // The migration's DDL and its ledger record commit as ONE transaction: a crash
    // mid-migration leaves neither a half-applied schema nor a recorded-but-unapplied
    // version, so re-running always resumes cleanly (safe even for a future
    // non-idempotent ALTER). The version record is a PARAMETERIZED write - no SQL is
    // built by interpolation.
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now())", [m.version, m.name]);
    });
  }
}
