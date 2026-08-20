-- 002-household: the tenant table the household register reads (prompt 2 5B.2, PR-2a' of the split).
-- FORCE ROW LEVEL SECURITY with the policy keyed on the tenant GUC that withTenant sets; the
-- database, not the application predicate, is the isolation guarantee (section 6 M-A).
CREATE TABLE household (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES org(id),
  name text NOT NULL,
  record_origin text NOT NULL
);
CREATE INDEX household_org_idx ON household (org_id);
ALTER TABLE household ENABLE ROW LEVEL SECURITY;
ALTER TABLE household FORCE ROW LEVEL SECURITY;
CREATE POLICY household_tenant ON household FOR ALL
  USING (org_id::text = current_setting('verin.org_id', true))
  WITH CHECK (org_id::text = current_setting('verin.org_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON household TO verin_app;
