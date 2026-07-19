/**
 * House-CRM store schema (ADR-0004/0007). Portable PostgreSQL DDL — runs on PGlite
 * (dev/CI) and managed Postgres (prod) unchanged. The audit_log is append-only
 * (BEFORE UPDATE/DELETE triggers RAISE EXCEPTION) and hash-chained per org; the
 * outbox delivers audit entries at-least-once; crm_write_cache gives idempotency.
 */
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at text NOT NULL,
  prov_source text NOT NULL,
  prov_asof text NOT NULL,
  prov_confidence text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  created_at text NOT NULL,
  prov_source text NOT NULL,
  prov_asof text NOT NULL,
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
  org_id text NOT NULL,
  role text NOT NULL,
  created_at text NOT NULL,
  expires_at text NOT NULL,
  revoked_at text
);

CREATE TABLE IF NOT EXISTS households (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  name text NOT NULL,
  primary_contact_id text,
  advisor_user_id text,
  status text NOT NULL,
  created_at text NOT NULL,
  prov_source text NOT NULL,
  prov_asof text NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS households_org ON households(org_id);

CREATE TABLE IF NOT EXISTS contacts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  created_at text NOT NULL,
  prov_source text NOT NULL,
  prov_asof text NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS contacts_org ON contacts(org_id);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text NOT NULL,
  account_type text NOT NULL,
  custodian text,
  balance_minor_units bigint,
  currency text NOT NULL,
  status text NOT NULL,
  open_date text,
  created_at text NOT NULL,
  prov_source text NOT NULL,
  prov_asof text NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS financial_accounts_org ON financial_accounts(org_id);

CREATE TABLE IF NOT EXISTS account_opening_applications (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text NOT NULL,
  contact_id text NOT NULL,
  account_type text NOT NULL,
  status text NOT NULL,
  esign_token text,
  idempotency_key text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  prov_source text NOT NULL,
  prov_asof text NOT NULL,
  prov_confidence text NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_org ON account_opening_applications(org_id);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs(id),
  household_id text,
  subject text NOT NULL,
  status text NOT NULL,
  due_date text,
  assignee_user_id text,
  created_at text NOT NULL,
  prov_source text NOT NULL,
  prov_asof text NOT NULL,
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
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS flow_exec_token ON flow_executions(resume_token);

-- Idempotency for external/CRM writes (ADR-0009).
CREATE TABLE IF NOT EXISTS crm_write_cache (
  org_id text NOT NULL,
  idempotency_key text NOT NULL,
  result_json text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (org_id, idempotency_key)
);

-- Transactional outbox for audit entries (ADR-0007/0016).
CREATE TABLE IF NOT EXISTS audit_outbox (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  claimed_at text
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
  created_at text NOT NULL,
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
  updated_at text NOT NULL
);
`;
