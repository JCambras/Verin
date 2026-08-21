-- 006-policy (prompt 4 deliverable 8): the content-addressed firm-policy shelf. policy_document holds
-- exact published bytes keyed by their own SHA-256; policy_version is the append-only sequence that
-- owns ordering, and in-force is DERIVED from it - there is deliberately no in-force pointer column.
-- The trigger is the database's own word for rule 2, record_origin is named at every insert (never a
-- default), verin_app holds no UPDATE or DELETE, and FORCE RLS on the tenant GUC is the isolation
-- guarantee. Forward-only, never edited once shipped.
CREATE TABLE policy_document (
  org_id uuid NOT NULL REFERENCES org(id),
  digest text NOT NULL,
  bytes bytea NOT NULL,
  record_origin text NOT NULL,
  PRIMARY KEY (org_id, digest)
);
CREATE TABLE policy_version (
  org_id uuid NOT NULL REFERENCES org(id),
  seq int NOT NULL,
  digest text NOT NULL,
  published_at timestamptz NOT NULL,
  record_origin text NOT NULL,
  PRIMARY KEY (org_id, seq),
  UNIQUE (org_id, digest),
  FOREIGN KEY (org_id, digest) REFERENCES policy_document (org_id, digest)
);
ALTER TABLE policy_document ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_version ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_document_tenant ON policy_document FOR ALL USING (org_id::text = current_setting('verin.org_id', true)) WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE POLICY policy_version_tenant ON policy_version FOR ALL USING (org_id::text = current_setting('verin.org_id', true)) WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE FUNCTION policy_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'policy_document is immutable: a version''s bytes are never edited in place or deleted; publish a new version'; END $$;
CREATE TRIGGER policy_document_immutable BEFORE UPDATE OR DELETE ON policy_document FOR EACH ROW EXECUTE FUNCTION policy_document_immutable();
GRANT SELECT, INSERT ON policy_document, policy_version TO verin_app;
