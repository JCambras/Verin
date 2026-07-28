/**
 * Prompt 7 storage foundation. This migration is additive and deliberately
 * separate from the operational audit schema. Immutable source rows are protected
 * against UPDATE, DELETE, and TRUNCATE in Postgres and PGlite. Projections, the
 * reservation index, and anchors are derived integrity state, so they remain
 * replaceable. Every ledger row carries the provenance of the producer that
 * appended it, so no stored fact needs a name match to be classified.
 */
export const DECISION_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS evidence_snapshots (
  org_id text NOT NULL REFERENCES orgs(id),
  id text NOT NULL,
  canonical_json text NOT NULL,
  schema_version text NOT NULL,
  serializer_version text NOT NULL,
  content_hash text NOT NULL,
  snapshot_hash text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS decision_input_bundles (
  org_id text NOT NULL REFERENCES orgs(id),
  id text NOT NULL,
  canonical_json text NOT NULL,
  schema_version text NOT NULL,
  serializer_version text NOT NULL,
  engine_version text NOT NULL,
  primitive_set_version text NOT NULL,
  time_zone_data_version text NOT NULL,
  bundle_hash text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, bundle_hash)
);

CREATE TABLE IF NOT EXISTS decision_input_bundle_evidence (
  org_id text NOT NULL,
  bundle_id text NOT NULL,
  evidence_snapshot_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (org_id, bundle_id, evidence_snapshot_id),
  UNIQUE (org_id, bundle_id, ordinal),
  FOREIGN KEY (org_id, bundle_id)
    REFERENCES decision_input_bundles(org_id, id),
  FOREIGN KEY (org_id, evidence_snapshot_id)
    REFERENCES evidence_snapshots(org_id, id)
);

CREATE TABLE IF NOT EXISTS decision_records (
  org_id text NOT NULL REFERENCES orgs(id),
  id text NOT NULL,
  input_bundle_id text NOT NULL,
  canonical_json text NOT NULL,
  schema_version text NOT NULL,
  serializer_version text NOT NULL,
  decision_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, decision_hash),
  FOREIGN KEY (org_id, input_bundle_id)
    REFERENCES decision_input_bundles(org_id, id)
);

CREATE TABLE IF NOT EXISTS decision_ledger (
  org_id text NOT NULL REFERENCES orgs(id),
  id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  event_type text NOT NULL CHECK (event_type IN (
    'DecisionRecorded', 'EvidenceSnapshotRecorded', 'ApprovalRecorded',
    'ApprovalInvalidated', 'ApprovalStageExpired', 'ApprovalStageEscalated',
    'ReservationCreated', 'ReservationReleased', 'ExecutionStarted',
    'ExecutionSucceeded', 'ExecutionPartiallySucceeded', 'ExecutionFailed',
    'StatusObserved', 'VerificationClosed', 'VerificationStuck',
    'ExceptionDecisionRequested'
  )),
  schema_version text NOT NULL,
  serializer_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  actor_json text NOT NULL,
  correlation_id text NOT NULL,
  causation_id text,
  decision_id text,
  evidence_snapshot_id text,
  triggering_entry_id text,
  payload_json text NOT NULL,
  prev_hash text NOT NULL,
  entry_hash text NOT NULL,
  prov_source text NOT NULL,
  prov_asof timestamptz NOT NULL,
  prov_confidence text NOT NULL,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, sequence),
  FOREIGN KEY (org_id, causation_id) REFERENCES decision_ledger(org_id, id),
  FOREIGN KEY (org_id, decision_id) REFERENCES decision_records(org_id, id),
  FOREIGN KEY (org_id, evidence_snapshot_id)
    REFERENCES evidence_snapshots(org_id, id),
  FOREIGN KEY (org_id, triggering_entry_id)
    REFERENCES decision_ledger(org_id, id)
);
CREATE INDEX IF NOT EXISTS decision_ledger_decision
  ON decision_ledger(org_id, decision_id, sequence);

CREATE TABLE IF NOT EXISTS decision_ledger_anchor (
  org_id text PRIMARY KEY REFERENCES orgs(id),
  max_sequence bigint NOT NULL,
  entry_count bigint NOT NULL,
  head_hash text NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_state_projection (
  org_id text NOT NULL REFERENCES orgs(id),
  decision_id text NOT NULL,
  state_json text NOT NULL,
  provenance_json text NOT NULL,
  last_sequence bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, decision_id),
  FOREIGN KEY (org_id, decision_id) REFERENCES decision_records(org_id, id)
);

CREATE TABLE IF NOT EXISTS decision_reservation_index (
  org_id text NOT NULL REFERENCES orgs(id),
  reservation_id text NOT NULL,
  decision_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'released')),
  PRIMARY KEY (org_id, reservation_id),
  FOREIGN KEY (org_id, decision_id) REFERENCES decision_records(org_id, id)
);

CREATE TABLE IF NOT EXISTS decision_projection_checkpoint (
  org_id text PRIMARY KEY REFERENCES orgs(id),
  last_sequence bigint NOT NULL,
  rebuilt_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION decision_source_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'decision ledger source rows are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS evidence_snapshots_no_update ON evidence_snapshots;
CREATE TRIGGER evidence_snapshots_no_update BEFORE UPDATE ON evidence_snapshots
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS evidence_snapshots_no_delete ON evidence_snapshots;
CREATE TRIGGER evidence_snapshots_no_delete BEFORE DELETE ON evidence_snapshots
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS evidence_snapshots_no_truncate ON evidence_snapshots;
CREATE TRIGGER evidence_snapshots_no_truncate BEFORE TRUNCATE ON evidence_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION decision_source_append_only();

DROP TRIGGER IF EXISTS decision_input_bundles_no_update ON decision_input_bundles;
CREATE TRIGGER decision_input_bundles_no_update BEFORE UPDATE ON decision_input_bundles
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_input_bundles_no_delete ON decision_input_bundles;
CREATE TRIGGER decision_input_bundles_no_delete BEFORE DELETE ON decision_input_bundles
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_input_bundles_no_truncate ON decision_input_bundles;
CREATE TRIGGER decision_input_bundles_no_truncate BEFORE TRUNCATE ON decision_input_bundles
  FOR EACH STATEMENT EXECUTE FUNCTION decision_source_append_only();

DROP TRIGGER IF EXISTS decision_input_bundle_evidence_no_update ON decision_input_bundle_evidence;
CREATE TRIGGER decision_input_bundle_evidence_no_update BEFORE UPDATE ON decision_input_bundle_evidence
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_input_bundle_evidence_no_delete ON decision_input_bundle_evidence;
CREATE TRIGGER decision_input_bundle_evidence_no_delete BEFORE DELETE ON decision_input_bundle_evidence
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_input_bundle_evidence_no_truncate ON decision_input_bundle_evidence;
CREATE TRIGGER decision_input_bundle_evidence_no_truncate BEFORE TRUNCATE ON decision_input_bundle_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION decision_source_append_only();

DROP TRIGGER IF EXISTS decision_records_no_update ON decision_records;
CREATE TRIGGER decision_records_no_update BEFORE UPDATE ON decision_records
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_records_no_delete ON decision_records;
CREATE TRIGGER decision_records_no_delete BEFORE DELETE ON decision_records
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_records_no_truncate ON decision_records;
CREATE TRIGGER decision_records_no_truncate BEFORE TRUNCATE ON decision_records
  FOR EACH STATEMENT EXECUTE FUNCTION decision_source_append_only();

DROP TRIGGER IF EXISTS decision_ledger_no_update ON decision_ledger;
CREATE TRIGGER decision_ledger_no_update BEFORE UPDATE ON decision_ledger
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_ledger_no_delete ON decision_ledger;
CREATE TRIGGER decision_ledger_no_delete BEFORE DELETE ON decision_ledger
  FOR EACH ROW EXECUTE FUNCTION decision_source_append_only();
DROP TRIGGER IF EXISTS decision_ledger_no_truncate ON decision_ledger;
CREATE TRIGGER decision_ledger_no_truncate BEFORE TRUNCATE ON decision_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION decision_source_append_only();
`;
