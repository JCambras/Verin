export const DECISION_LEDGER_COMPUTED_PROVENANCE_SQL = `
CREATE TABLE IF NOT EXISTS decision_provenance_traces (
  org_id text NOT NULL REFERENCES orgs(id),
  id text NOT NULL,
  schema_version text NOT NULL,
  serializer_version text NOT NULL,
  canonical_json text NOT NULL,
  trace_digest text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, id)
);

DROP TRIGGER IF EXISTS decision_provenance_traces_no_update
  ON decision_provenance_traces;
CREATE TRIGGER decision_provenance_traces_no_update
  BEFORE UPDATE ON decision_provenance_traces
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_provenance_traces_no_delete
  ON decision_provenance_traces;
CREATE TRIGGER decision_provenance_traces_no_delete
  BEFORE DELETE ON decision_provenance_traces
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_provenance_traces_no_truncate
  ON decision_provenance_traces;
CREATE TRIGGER decision_provenance_traces_no_truncate
  BEFORE TRUNCATE ON decision_provenance_traces
  FOR EACH STATEMENT EXECUTE FUNCTION decision_source_append_only();

ALTER TABLE decision_ledger
  ADD COLUMN prov_schema_version text DEFAULT 'record-v1.0.0';
ALTER TABLE decision_ledger
  ADD COLUMN prov_serializer_version text DEFAULT '1.0.0';
ALTER TABLE decision_ledger
  ADD COLUMN prov_json text;
ALTER TABLE decision_ledger
  ADD COLUMN prov_trace_id text;
ALTER TABLE decision_ledger
  DISABLE TRIGGER decision_ledger_no_update;
UPDATE decision_ledger ledger
   SET prov_schema_version = CASE
         WHEN ledger.prov_source = 'computed'
           THEN 'computed-legacy-v0.0.0'
         ELSE 'record-v1.0.0'
       END,
       prov_serializer_version = '1.0.0'
 WHERE ledger.org_id IN (SELECT id FROM orgs);
ALTER TABLE decision_ledger
  ENABLE TRIGGER decision_ledger_no_update;
ALTER TABLE decision_ledger
  ALTER COLUMN prov_schema_version SET NOT NULL;
ALTER TABLE decision_ledger
  ALTER COLUMN prov_serializer_version SET NOT NULL;
ALTER TABLE decision_ledger
  ADD CONSTRAINT decision_ledger_provenance_shape
  CHECK (
    prov_serializer_version = '1.0.0'
    AND (
      (
        prov_schema_version = 'record-v1.0.0'
        AND prov_source <> 'computed'
        AND prov_json IS NULL
        AND prov_trace_id IS NULL
      )
      OR (
        prov_schema_version = 'computed-legacy-v0.0.0'
        AND prov_source = 'computed'
        AND prov_json IS NULL
        AND prov_trace_id IS NULL
      )
      OR (
        prov_schema_version = 'computed-v1.0.0'
        AND prov_source = 'computed'
        AND prov_json IS NOT NULL
        AND prov_trace_id IS NOT NULL
      )
    )
  );
ALTER TABLE decision_ledger
  ADD CONSTRAINT decision_ledger_provenance_trace_fkey
  FOREIGN KEY (org_id, prov_trace_id)
  REFERENCES decision_provenance_traces(org_id, id);
CREATE INDEX decision_ledger_provenance_trace
  ON decision_ledger(org_id, prov_trace_id, sequence)
  WHERE prov_trace_id IS NOT NULL;
`;
