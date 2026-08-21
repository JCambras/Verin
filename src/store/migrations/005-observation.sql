-- 005-observation (prompt 3 deliverable 8): the observation table the EvidenceBundle assembly reads.
-- observed_at is the instant the fact holds; retrieved_at is when Verin fetched it; record_origin is
-- named at every insert, never a column default. Forward-only, never edited once shipped; FORCE ROW
-- LEVEL SECURITY keyed on the tenant GUC, so the database is the isolation guarantee.
CREATE TABLE observation (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES org(id),
  household_id uuid NOT NULL REFERENCES household(id),
  kind text NOT NULL,
  subject text NOT NULL,
  body_json jsonb NOT NULL,
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  record_origin text NOT NULL
);
CREATE INDEX observation_household_idx ON observation (org_id, household_id);
ALTER TABLE observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation FORCE ROW LEVEL SECURITY;
CREATE POLICY observation_tenant ON observation FOR ALL
  USING (org_id::text = current_setting('verin.org_id', true))
  WITH CHECK (org_id::text = current_setting('verin.org_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON observation TO verin_app;
