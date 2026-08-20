-- 001-access-base: the tenant, identity and session tables slice 2 reads (prompt 2 5B.2/5B.3).
-- Forward-only; applied by src/tools/cli.ts under verin_migrator, which owns every table; FORCE ROW
-- LEVEL SECURITY puts even the owner under policy. GUCs: verin.org_id (the tenant GUC, set by
-- withTenant from PR-2a' on); verin.session_token_hash and verin.login_email, set only by their
-- admitted transaction classes - the session table is scoped to the exact token hash the transaction
-- proves it holds, and the identity policy's second arm serves the pre-tenant credential exchange.
CREATE TABLE org (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  record_origin text NOT NULL
);
CREATE TABLE identity (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES org(id),
  login_email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL,
  credential_hash text NOT NULL,
  credential_salt text NOT NULL,
  record_origin text NOT NULL
);
CREATE TABLE session (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  identity_id uuid NOT NULL REFERENCES identity(id),
  org_id uuid NOT NULL REFERENCES org(id),
  display_name text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX identity_org_idx ON identity (org_id);
ALTER TABLE org ENABLE ROW LEVEL SECURITY;
ALTER TABLE org FORCE ROW LEVEL SECURITY;
ALTER TABLE identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity FORCE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE session FORCE ROW LEVEL SECURITY;
CREATE POLICY org_tenant ON org FOR ALL
  USING (id::text = current_setting('verin.org_id', true))
  WITH CHECK (id::text = current_setting('verin.org_id', true));
CREATE POLICY identity_tenant_or_login ON identity FOR ALL
  USING (org_id::text = current_setting('verin.org_id', true) OR login_email = current_setting('verin.login_email', true))
  WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE POLICY session_token_scoped ON session FOR ALL
  USING (token_hash = current_setting('verin.session_token_hash', true))
  WITH CHECK (token_hash = current_setting('verin.session_token_hash', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON org, identity, session TO verin_app;
