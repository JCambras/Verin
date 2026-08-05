import { appError } from "@contracts/errors";
import type { SqlQueryable } from "@infra/store/db";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import {
  parseRecordedLedgerEvent,
} from "./ledger-schema-registry";
import { parseRecordedReplaySource } from "./ledger-source-registry";
import type {
  LedgerStructureLookup,
  StructuralLedgerEntry,
} from "./ledger-structural-validator";
import { executionHandleOwnerEntries } from "./ledger-structural-history";

interface StoredEntryRow {
  readonly sequence: number | string;
  readonly event_type: string;
  readonly schema_version: string;
  readonly serializer_version: string;
  readonly payload_json: string;
}

function parseEntry(row: StoredEntryRow): StructuralLedgerEntry {
  let value: unknown;
  try {
    value = JSON.parse(row.payload_json);
  } catch {
    throw appError("STORE_CONSTRAINT", "ledger structural payload is not JSON");
  }
  const parsed = parseRecordedLedgerEvent(
    row.event_type,
    row.schema_version,
    row.serializer_version,
    value,
  );
  if (!parsed.ok) throw appError("STORE_CONSTRAINT", parsed.reason);
  return { sequence: Number(row.sequence), event: parsed.event };
}

export function storedLedgerStructureLookup(
  tx: SqlQueryable,
  tenant: TenantContext,
): LedgerStructureLookup {
  assertTenantContext(tenant);
  const orgId = tenant.orgId;
  return {
    async decision(id) {
      const result = await tx.query<{
        canonical_json: string;
        schema_version: string;
        serializer_version: string;
        decision_hash: string;
        bundle_hash: string;
      }>(
        `SELECT decision.canonical_json, decision.schema_version,
                decision.serializer_version, decision.decision_hash,
                bundle.bundle_hash
           FROM decision_records decision
           JOIN decision_input_bundles bundle
             ON bundle.org_id = decision.org_id
            AND bundle.id = decision.input_bundle_id
          WHERE decision.org_id = $1
            AND bundle.org_id = $1
            AND decision.id = $2`,
        [orgId, id],
      );
      const row = result.rows[0];
      if (!row) return null;
      let value: unknown;
      try {
        value = JSON.parse(row.canonical_json);
      } catch {
        throw appError(
          "STORE_CONSTRAINT",
          "decision structural source is not JSON",
        );
      }
      const parsed = parseRecordedReplaySource(
        "decision",
        row.schema_version,
        row.serializer_version,
        value,
      );
      if (
        !parsed.ok ||
        parsed.canonicalBytes !== row.canonical_json ||
        parsed.recordedHash !== row.decision_hash ||
        parsed.value.id !== id ||
        parsed.value.firmId !== orgId
      ) {
        throw appError(
          "STORE_CONSTRAINT",
          "decision structural source does not verify",
        );
      }
      return {
        record: parsed.value,
        bundleHash: row.bundle_hash,
      };
    },
    async entry(id) {
      const result = await tx.query<StoredEntryRow>(
        `SELECT sequence, event_type, schema_version, serializer_version,
                payload_json
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1 AND ledger.id = $2`,
        [orgId, id],
      );
      return result.rows[0] ? parseEntry(result.rows[0]) : null;
    },
    async decisionRecording(decisionId, beforeSequence) {
      const result = await tx.query<StoredEntryRow>(
        `SELECT sequence, event_type, schema_version, serializer_version,
                payload_json
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1
            AND ledger.decision_id = $2
            AND ledger.event_type = 'DecisionRecorded'
            AND ledger.sequence < $3
          ORDER BY ledger.sequence DESC
          LIMIT 1`,
        [orgId, decisionId, beforeSequence],
      );
      return result.rows[0] ? parseEntry(result.rows[0]) : null;
    },
    async evidenceRecording(evidenceId, beforeSequence) {
      const result = await tx.query<StoredEntryRow>(
        `SELECT sequence, event_type, schema_version, serializer_version,
                payload_json
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1
            AND ledger.evidence_snapshot_id = $2
            AND ledger.event_type = 'EvidenceSnapshotRecorded'
            AND ledger.sequence < $3
          ORDER BY ledger.sequence DESC
          LIMIT 1`,
        [orgId, evidenceId, beforeSequence],
      );
      return result.rows[0] ? parseEntry(result.rows[0]) : null;
    },
    async activeReservation(reservationId, beforeSequence) {
      const result = await tx.query<StoredEntryRow>(
        `SELECT created.sequence, created.event_type, created.schema_version,
                created.serializer_version, created.payload_json
           FROM decision_ledger created
          WHERE created.org_id = $1
            AND created.event_type = 'ReservationCreated'
            AND created.payload_json::jsonb #>> '{reservationRef,id}' = $2
            AND created.sequence < $3
            AND NOT EXISTS (
                  SELECT 1
                    FROM decision_ledger released
                   WHERE released.org_id = created.org_id
                     AND released.event_type = 'ReservationReleased'
                     AND released.reservation_creation_id = created.id
                     AND released.sequence < $3
                )
          ORDER BY created.sequence DESC
          LIMIT 1`,
        [orgId, reservationId, beforeSequence],
      );
      return result.rows[0] ? parseEntry(result.rows[0]) : null;
    },
    async approvalEscalations(decisionId, stageId, beforeSequence, limit) {
      const result = await tx.query<StoredEntryRow>(
        `SELECT sequence, event_type, schema_version, serializer_version,
                payload_json
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1
            AND ledger.decision_id = $2
            AND ledger.event_type = 'ApprovalStageEscalated'
            AND ledger.payload_json::jsonb #>> '{stageId}' = $3
            AND ledger.sequence < $4
          ORDER BY ledger.sequence ASC
          LIMIT $5`,
        [orgId, decisionId, stageId, beforeSequence, limit],
      );
      return result.rows.map(parseEntry);
    },
    async executionHandleEvents(handleId, beforeSequence) {
      const first = await tx.query<StoredEntryRow>(
        `SELECT sequence, event_type, schema_version, serializer_version,
                payload_json
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1
            AND ledger.event_type IN (
              'ExecutionSucceeded', 'ExecutionPartiallySucceeded',
              'StatusObserved', 'VerificationStuck'
            )
            AND ledger.payload_json::jsonb #>> '{executionHandleRef,id}' = $2
            AND ledger.sequence < $3
          ORDER BY ledger.sequence ASC
          LIMIT 1`,
        [orgId, handleId, beforeSequence],
      );
      const step = await tx.query<StoredEntryRow>(
        `SELECT sequence, event_type, schema_version, serializer_version,
                payload_json
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1
            AND ledger.event_type IN (
              'ExecutionSucceeded', 'ExecutionPartiallySucceeded'
            )
            AND ledger.payload_json::jsonb #>> '{executionHandleRef,id}' = $2
            AND ledger.sequence < $3
          ORDER BY ledger.sequence ASC
          LIMIT 1`,
        [orgId, handleId, beforeSequence],
      );
      return executionHandleOwnerEntries(
        [...first.rows, ...step.rows].map(parseEntry),
      );
    },
  };
}
