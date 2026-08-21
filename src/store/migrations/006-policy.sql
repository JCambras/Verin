-- 006-policy (prompt 4 deliverable 8): the content-addressed firm-policy shelf. policy_document holds
-- exact published bytes keyed by their own SHA-256 (the address IS the digest, so a store is a cache
-- and never the authority); policy_version is the append-only sequence that owns ordering, which
-- content cannot state. In-force is DERIVED from the sequence - there is deliberately no in-force
-- pointer column anywhere. The trigger is the database's own word for rule 2: stored bytes are never
-- edited in place or deleted, even by the table owner. record_origin is named at every insert, never
-- a column default. verin_app holds no UPDATE or DELETE on either table. Forward-only, never edited
-- once shipped; FORCE ROW LEVEL SECURITY keyed on the tenant GUC is the firm-isolation guarantee.
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
ALTER TABLE policy_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_document FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_version FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_document_tenant ON policy_document FOR ALL
  USING (org_id::text = current_setting('verin.org_id', true))
  WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE POLICY policy_version_tenant ON policy_version FOR ALL
  USING (org_id::text = current_setting('verin.org_id', true))
  WITH CHECK (org_id::text = current_setting('verin.org_id', true));
CREATE FUNCTION policy_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'policy_document is immutable: a version''s bytes are never edited in place or deleted; publish a new version';
END $$;
CREATE TRIGGER policy_document_immutable BEFORE UPDATE OR DELETE ON policy_document
  FOR EACH ROW EXECUTE FUNCTION policy_document_immutable();
GRANT SELECT, INSERT ON policy_document, policy_version TO verin_app;
