-- 007-decision-record (prompt 6, PR-6a): a tenant-scoped, append-only decision record.
-- Exact source bytes and chain envelopes are immutable twice over: verin_app has no mutation
-- privilege and owner-level row or statement mutation is rejected by triggers. The anchor and
-- projection are derived state, updated only by the one governed decisionRecord.append command.
CREATE TABLE decision_continuity_authorization (
  org_id uuid NOT NULL REFERENCES org(id),
  lcm_digest text NOT NULL,
  manifest_bytes bytea NOT NULL,
  signature_bytes bytea NOT NULL,
  authorizing_actor text NOT NULL,
  authorized_at timestamptz NOT NULL,
  producer_kind text NOT NULL,
  producer_id text NOT NULL,
  produced_at timestamptz NOT NULL,
  record_origin text NOT NULL,
  PRIMARY KEY (org_id, lcm_digest)
);
CREATE TABLE decision_record_source (
  org_id uuid NOT NULL REFERENCES org(id),
  source_kind text NOT NULL CHECK (source_kind IN ('request', 'evidence', 'policy', 'engine', 'outcome', 'replay-manifest')),
  identity text NOT NULL,
  bytes bytea NOT NULL CHECK (octet_length(bytes) > 0),
  producer_kind text NOT NULL,
  producer_id text NOT NULL,
  produced_at timestamptz NOT NULL,
  record_origin text NOT NULL,
  PRIMARY KEY (org_id, source_kind, identity)
);
CREATE TABLE decision_ledger (
  org_id uuid NOT NULL REFERENCES org(id),
  seq bigint NOT NULL CHECK (seq >= 0),
  entry_id text NOT NULL,
  decision_id text,
  replay_manifest_id text,
  envelope_bytes bytea NOT NULL CHECK (octet_length(envelope_bytes) > 0),
  prev_hash text NOT NULL,
  entry_hash text NOT NULL,
  recorded_at timestamptz NOT NULL,
  producer_kind text NOT NULL,
  producer_id text NOT NULL,
  produced_at timestamptz NOT NULL,
  record_origin text NOT NULL,
  PRIMARY KEY (org_id, seq),
  UNIQUE (org_id, entry_id),
  UNIQUE (org_id, decision_id),
  CHECK ((seq = 0 AND decision_id IS NULL AND replay_manifest_id IS NULL) OR (seq > 0 AND decision_id IS NOT NULL AND replay_manifest_id IS NOT NULL))
);
CREATE TABLE decision_chain_anchor (
  org_id uuid PRIMARY KEY REFERENCES org(id),
  entry_count bigint NOT NULL CHECK (entry_count >= 0),
  max_seq bigint NOT NULL CHECK (max_seq >= 0),
  head_hash text NOT NULL,
  head_decision_id text,
  updated_at timestamptz NOT NULL
);
CREATE TABLE decision_record_projection (
  org_id uuid NOT NULL REFERENCES org(id),
  decision_id text NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  replay_manifest_id text NOT NULL,
  request_ref text NOT NULL,
  household_slug text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('proceed', 'blocked', 'prohibited')),
  recorded_at timestamptz NOT NULL,
  record_origin text NOT NULL,
  PRIMARY KEY (org_id, decision_id),
  UNIQUE (org_id, seq)
);

ALTER TABLE decision_continuity_authorization ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_record_source ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_ledger ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_chain_anchor ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_record_projection ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_continuity_tenant ON decision_continuity_authorization FOR ALL USING (org_id::text = current_setting('verin.org_id', true)) WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE POLICY decision_source_tenant ON decision_record_source FOR ALL USING (org_id::text = current_setting('verin.org_id', true)) WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE POLICY decision_ledger_tenant ON decision_ledger FOR ALL USING (org_id::text = current_setting('verin.org_id', true)) WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE POLICY decision_anchor_tenant ON decision_chain_anchor FOR ALL USING (org_id::text = current_setting('verin.org_id', true)) WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE POLICY decision_projection_tenant ON decision_record_projection FOR ALL USING (org_id::text = current_setting('verin.org_id', true)) WITH CHECK (org_id::text = current_setting('verin.org_id', true));

CREATE FUNCTION decision_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP; END $$;
CREATE FUNCTION decision_immutable_statement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only: TRUNCATE is forbidden', TG_TABLE_NAME; END $$;
CREATE TRIGGER decision_continuity_immutable BEFORE UPDATE OR DELETE ON decision_continuity_authorization FOR EACH ROW EXECUTE FUNCTION decision_immutable_row();
CREATE TRIGGER decision_continuity_no_truncate BEFORE TRUNCATE ON decision_continuity_authorization FOR EACH STATEMENT EXECUTE FUNCTION decision_immutable_statement();
CREATE TRIGGER decision_source_immutable BEFORE UPDATE OR DELETE ON decision_record_source FOR EACH ROW EXECUTE FUNCTION decision_immutable_row();
CREATE TRIGGER decision_source_no_truncate BEFORE TRUNCATE ON decision_record_source FOR EACH STATEMENT EXECUTE FUNCTION decision_immutable_statement();
CREATE TRIGGER decision_ledger_immutable BEFORE UPDATE OR DELETE ON decision_ledger FOR EACH ROW EXECUTE FUNCTION decision_immutable_row();
CREATE TRIGGER decision_ledger_no_truncate BEFORE TRUNCATE ON decision_ledger FOR EACH STATEMENT EXECUTE FUNCTION decision_immutable_statement();

GRANT SELECT ON decision_continuity_authorization TO verin_app;
GRANT SELECT, INSERT ON decision_record_source, decision_ledger TO verin_app;
GRANT SELECT, INSERT, UPDATE ON decision_chain_anchor, decision_record_projection TO verin_app;
