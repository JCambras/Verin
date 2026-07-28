/** Sole synchronous decision-ledger write path. There is no outbox. */
import { createHash } from "node:crypto";
import type { SqlDb, SqlQueryable } from "@infra/store/db";
import { GENESIS_HASH, computeChainHash } from "@infra/audit/hash-chain";
import { scrub } from "@infra/pii/scrub";
import { assertNoPIIValues } from "@contracts/pii";
import { appError, isAppError, type AppError } from "@contracts/errors";
import { err, ok, type Result } from "@contracts/result";
import {
  EvidenceSnapshotRefSchema,
  DecisionInputBundleSchema,
  type EvidenceSnapshotRef,
  type DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import {
  DecisionRecordSchema,
  type DecisionRecord,
} from "@contracts/decision-core/decision";
import {
  LedgerEntrySchema,
  type LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import {
  foldDecisionProjection,
  type DecisionProjection,
} from "@domain/ledger/projections";
import { listDecisionLedger } from "./ledger-verification";
import { assertLedgerSourceBindings } from "./ledger-bindings";

export interface RecordDecisionInput {
  readonly evidenceSnapshots: readonly EvidenceSnapshotRef[];
  readonly inputBundle: DecisionInputBundle;
  readonly decisionRecord: DecisionRecord;
  readonly events: readonly LedgerEntry[];
}
export interface AppendedLedgerEntry {
  readonly id: string;
  readonly sequence: number;
  readonly entryHash: string;
}
interface PreparedEvent {
  readonly event: LedgerEntry;
  readonly payloadJson: string;
  readonly actorJson: string;
}

function canonical(value: unknown, label: string): Result<string, AppError> {
  const serialized = canonicalJson(value as JsonValue);
  return serialized.ok
    ? serialized
    : err(appError("VALIDATION", `${label} is not canonically serializable`));
}

function hashCanonical(value: unknown, label: string): Result<string, AppError> {
  const bytes = canonical(value, label);
  return bytes.ok
    ? ok(createHash("sha256").update(bytes.value, "utf8").digest("hex"))
    : bytes;
}

function prepareEvent(input: LedgerEntry): Result<PreparedEvent, AppError> {
  const candidate = input.type === "ApprovalRecorded" && input.structuredReason
    ? { ...input, structuredReason: String(scrub(input.structuredReason)) }
    : input;
  const parsed = LedgerEntrySchema.safeParse(candidate);
  if (!parsed.success) return err(appError("VALIDATION", "ledger event is invalid"));
  try {
    assertNoPIIValues(parsed.data, "decision ledger");
  } catch {
    return err(appError("PII_VIOLATION", "decision ledger payload contains prohibited PII"));
  }
  const payloadJson = canonical(parsed.data, "ledger event");
  if (!payloadJson.ok) return payloadJson;
  const actorJson = canonical(parsed.data.actor, "ledger actor");
  return actorJson.ok
    ? ok({ event: parsed.data, payloadJson: payloadJson.value, actorJson: actorJson.value })
    : actorJson;
}

function decisionId(event: LedgerEntry): string | null {
  if ("decisionRef" in event) return event.decisionRef.id;
  if ("priorDecisionRef" in event) return event.priorDecisionRef.id;
  return null;
}

function evidenceId(event: LedgerEntry): string | null {
  if (event.type === "EvidenceSnapshotRecorded") {
    return event.evidenceSnapshotRef.id;
  }
  if (event.type === "StatusObserved") {
    return event.evidenceSnapshotRef?.id ?? null;
  }
  return null;
}

function storeFailure(error: unknown): AppError {
  return isAppError(error)
    ? error
    : appError("STORE_CONSTRAINT", "decision ledger append was rejected");
}

async function lockTenant(tx: SqlQueryable, orgId: string): Promise<void> {
  const tenant = await tx.query<{ id: string }>(
    "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
    [orgId],
  );
  if (tenant.rows.length !== 1) {
    throw appError("NOT_FOUND", "decision ledger tenant does not exist");
  }
}

async function loadProjection(
  tx: SqlQueryable,
  orgId: string,
  event: LedgerEntry,
): Promise<DecisionProjection | undefined> {
  const id = decisionId(event);
  if (id) {
    const row = await tx.query<{ state_json: string }>(
      "SELECT state_json FROM decision_state_projection WHERE org_id = $1 AND decision_id = $2",
      [orgId, id],
    );
    return row.rows[0]
      ? JSON.parse(row.rows[0].state_json) as DecisionProjection
      : undefined;
  }
  if (event.type !== "ReservationReleased") return undefined;
  const rows = await tx.query<{ state_json: string }>(
    "SELECT state_json FROM decision_state_projection WHERE org_id = $1",
    [orgId],
  );
  return rows.rows
    .map((row) => JSON.parse(row.state_json) as DecisionProjection)
    .find((state) =>
      state.reservations.some(
        (reservation) => reservation.reservationId === event.reservationRef.id,
      ));
}

async function applyProjection(
  tx: SqlQueryable,
  event: LedgerEntry,
  sequence: number,
  record?: DecisionRecord,
): Promise<void> {
  const current = await loadProjection(tx, event.firmId, event);
  const next = foldDecisionProjection({
    ...(current ? { current } : {}),
    event,
    sequence,
    ...(record ? { decisionRecord: record } : {}),
  });
  if (!next) return;
  const stateJson = canonical(next, "decision projection");
  if (!stateJson.ok) throw stateJson.error;
  await tx.query(
    `INSERT INTO decision_state_projection
      (org_id, decision_id, state_json, last_sequence, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id, decision_id) DO UPDATE
       SET state_json = EXCLUDED.state_json,
           last_sequence = EXCLUDED.last_sequence,
           updated_at = EXCLUDED.updated_at`,
    [event.firmId, next.decisionId, stateJson.value, sequence, event.recordedAt],
  );
}

async function appendPrepared(
  tx: SqlQueryable,
  orgId: string,
  events: readonly PreparedEvent[],
  decisionRecord?: DecisionRecord,
): Promise<AppendedLedgerEntry[]> {
  const head = await tx.query<{ sequence: number | string; entry_hash: string }>(
    "SELECT sequence, entry_hash FROM decision_ledger WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
    [orgId],
  );
  let sequence = head.rows[0] ? Number(head.rows[0].sequence) + 1 : 0;
  let prevHash = head.rows[0]?.entry_hash ?? GENESIS_HASH;
  const appended: AppendedLedgerEntry[] = [];
  for (const prepared of events) {
    const { event, payloadJson, actorJson } = prepared;
    await assertLedgerSourceBindings(tx, event);
    const entryHash = computeChainHash(payloadJson, prevHash);
    await tx.query(
      `INSERT INTO decision_ledger
        (org_id,id,sequence,event_type,schema_version,serializer_version,
         occurred_at,recorded_at,actor_json,correlation_id,causation_id,
         decision_id,evidence_snapshot_id,payload_json,prev_hash,entry_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        orgId, event.id, sequence, event.type, event.schemaVersion,
        event.serializerVersion, event.occurredAt, event.recordedAt, actorJson,
        event.correlationId, event.causationRef?.id ?? null, decisionId(event),
        evidenceId(event), payloadJson, prevHash, entryHash,
      ],
    );
    await applyProjection(
      tx,
      event,
      sequence,
      event.type === "DecisionRecorded" ? decisionRecord : undefined,
    );
    appended.push({ id: event.id, sequence, entryHash });
    prevHash = entryHash;
    sequence += 1;
  }
  const last = appended.at(-1);
  if (last) {
    await tx.query(
      `INSERT INTO decision_ledger_anchor
        (org_id,max_sequence,entry_count,head_hash,updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id) DO UPDATE
         SET max_sequence = EXCLUDED.max_sequence,
             entry_count = decision_ledger_anchor.entry_count + EXCLUDED.entry_count,
             head_hash = EXCLUDED.head_hash,
             updated_at = EXCLUDED.updated_at`,
      [orgId, last.sequence, appended.length, last.entryHash, events.at(-1)!.event.recordedAt],
    );
    await tx.query(
      `INSERT INTO decision_projection_checkpoint (org_id,last_sequence,rebuilt_at)
       VALUES ($1,$2,$3)
       ON CONFLICT (org_id) DO UPDATE
         SET last_sequence = EXCLUDED.last_sequence, rebuilt_at = EXCLUDED.rebuilt_at`,
      [orgId, last.sequence, events.at(-1)!.event.recordedAt],
    );
  }
  return appended;
}

function prepareEvents(
  events: readonly LedgerEntry[],
  orgId: string,
): Result<PreparedEvent[], AppError> {
  const prepared: PreparedEvent[] = [];
  for (const raw of events) {
    const item = prepareEvent(raw);
    if (!item.ok) return item;
    if (item.value.event.firmId !== orgId) {
      return err(appError("VALIDATION", "ledger event tenant does not match append tenant"));
    }
    prepared.push(item.value);
  }
  return ok(prepared);
}

async function insertDecisionSources(
  tx: SqlQueryable,
  snapshots: readonly EvidenceSnapshotRef[],
  bundle: DecisionInputBundle,
  record: DecisionRecord,
  recordedAt: string,
): Promise<void> {
  for (const snapshot of snapshots) {
    const bytes = canonical(snapshot, "evidence snapshot");
    if (!bytes.ok) throw bytes.error;
    await tx.query(
      `INSERT INTO evidence_snapshots
        (org_id,id,canonical_json,schema_version,serializer_version,
         content_hash,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        snapshot.firmId, snapshot.id, bytes.value, snapshot.schemaVersion,
        CANONICAL_SERIALIZER_VERSION, snapshot.contentHash, recordedAt,
      ],
    );
  }
  const bundleBytes = canonical(bundle, "decision input bundle");
  if (!bundleBytes.ok) throw bundleBytes.error;
  await tx.query(
    `INSERT INTO decision_input_bundles
      (org_id,id,canonical_json,schema_version,serializer_version,engine_version,
       primitive_set_version,time_zone_data_version,bundle_hash,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      bundle.firmId, bundle.id, bundleBytes.value, bundle.schemaVersion,
      bundle.canonicalSerializerVersion, bundle.engineVersion,
      bundle.primitiveSetVersion, bundle.timeZoneDataVersion, bundle.bundleHash,
      recordedAt,
    ],
  );
  for (const [ordinal, ref] of bundle.evidenceSnapshotRefs.entries()) {
    await tx.query(
      `INSERT INTO decision_input_bundle_evidence
        (org_id,bundle_id,evidence_snapshot_id,ordinal) VALUES ($1,$2,$3,$4)`,
      [bundle.firmId, bundle.id, ref.id, ordinal],
    );
  }
  const recordBytes = canonical(record, "decision record");
  if (!recordBytes.ok) throw recordBytes.error;
  await tx.query(
    `INSERT INTO decision_records
      (org_id,id,input_bundle_id,canonical_json,schema_version,
       serializer_version,decision_hash,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      record.firmId, record.id, record.inputBundleRef.id, recordBytes.value,
      bundle.schemaVersion, bundle.canonicalSerializerVersion,
      record.decisionHash, record.createdAt,
    ],
  );
}

function validateDecisionInput(
  input: RecordDecisionInput,
): Result<{
  snapshots: EvidenceSnapshotRef[];
  bundle: DecisionInputBundle;
  record: DecisionRecord;
  events: PreparedEvent[];
}, AppError> {
  const snapshots = input.evidenceSnapshots.map((value) =>
    EvidenceSnapshotRefSchema.safeParse(value));
  if (snapshots.some((parsed) => !parsed.success)) {
    return err(appError("VALIDATION", "evidence snapshot is invalid"));
  }
  const bundle = DecisionInputBundleSchema.safeParse(input.inputBundle);
  const record = DecisionRecordSchema.safeParse(input.decisionRecord);
  if (!bundle.success || !record.success) {
    return err(appError("VALIDATION", "decision replay input is invalid"));
  }
  if (
    bundle.data.firmId !== record.data.firmId ||
    record.data.inputBundleRef.id !== bundle.data.id
  ) {
    return err(appError("VALIDATION", "decision record and input bundle do not match"));
  }
  const bundleHash = hashCanonical(bundleHashPreimage(bundle.data), "bundle hash preimage");
  const recordHash = hashCanonical(decisionHashPreimage(record.data), "decision hash preimage");
  if (
    !bundleHash.ok ||
    !recordHash.ok ||
    bundleHash.value !== bundle.data.bundleHash ||
    recordHash.value !== record.data.decisionHash
  ) {
    return err(appError("VALIDATION", "decision replay hash does not match canonical inputs"));
  }
  const events = prepareEvents(input.events, record.data.firmId);
  if (!events.ok) return events;
  const decisionEvents = events.value.filter(
    ({ event }) => event.type === "DecisionRecorded",
  );
  const evidenceEvents = events.value.filter(
    ({ event }) => event.type === "EvidenceSnapshotRecorded",
  );
  const snapshotValues = snapshots.map((parsed) => parsed.success ? parsed.data : never());
  const eventEvidenceIds = new Set(evidenceEvents.map(
    ({ event }) => event.type === "EvidenceSnapshotRecorded"
      ? event.evidenceSnapshotRef.id
      : "",
  ));
  const event = decisionEvents[0]?.event;
  if (
    decisionEvents.length !== 1 ||
    evidenceEvents.length !== snapshotValues.length ||
    snapshotValues.some((snapshot) =>
      snapshot.firmId !== record.data.firmId ||
      !eventEvidenceIds.has(snapshot.id)) ||
    event?.type !== "DecisionRecorded" ||
    event.decisionRef.id !== record.data.id ||
    event.decisionHash !== record.data.decisionHash ||
    events.value.some(({ event: item }) =>
      item.type !== "DecisionRecorded" &&
      item.type !== "EvidenceSnapshotRecorded")
  ) {
    return err(appError("VALIDATION", "decision source rows and recording events do not correspond"));
  }
  return ok({
    snapshots: snapshotValues,
    bundle: bundle.data,
    record: record.data,
    events: events.value,
  });
}

function never(): never {
  throw appError("INTERNAL", "unreachable invalid snapshot");
}

/** Atomically persist evidence, bundle, immutable decision, events, and projections. */
export async function recordDecision(
  db: SqlDb,
  input: RecordDecisionInput,
): Promise<Result<AppendedLedgerEntry[], AppError>> {
  const prepared = validateDecisionInput(input);
  if (!prepared.ok) return prepared;
  try {
    const appended = await db.transaction(async (tx) => {
      await lockTenant(tx, prepared.value.record.firmId);
      await insertDecisionSources(
        tx,
        prepared.value.snapshots,
        prepared.value.bundle,
        prepared.value.record,
        prepared.value.events.at(-1)!.event.recordedAt,
      );
      return appendPrepared(
        tx,
        prepared.value.record.firmId,
        prepared.value.events,
        prepared.value.record,
      );
    });
    return ok(appended);
  } catch (error) {
    return err(storeFailure(error));
  }
}

/**
 * Append later facts inside the caller's transaction. This function never starts
 * a transaction, so a future audited CRM write can commit its outbox intent and
 * decision event atomically. Adapter-boundary errors throw typed AppError values
 * to force the caller's transaction to abort.
 */
export async function appendDecisionEvents(
  tx: SqlQueryable,
  orgId: string,
  inputs: readonly LedgerEntry[],
): Promise<AppendedLedgerEntry[]> {
  const prepared = prepareEvents(inputs, orgId);
  if (!prepared.ok) throw prepared.error;
  if (
    prepared.value.length === 0 ||
    prepared.value.some(({ event }) =>
      event.type === "DecisionRecorded" ||
      event.type === "EvidenceSnapshotRecorded")
  ) {
    throw appError("VALIDATION", "source-recording events require recordDecision");
  }
  await lockTenant(tx, orgId);
  return appendPrepared(tx, orgId, prepared.value);
}

export async function listDecisionProjections(
  db: SqlDb,
  orgId: string,
): Promise<DecisionProjection[]> {
  const rows = await db.query<{ state_json: string }>(
    "SELECT state_json FROM decision_state_projection WHERE org_id = $1 ORDER BY decision_id ASC",
    [orgId],
  );
  return rows.rows.map((row) => JSON.parse(row.state_json) as DecisionProjection);
}

/** Delete only derived state, then replay immutable rows in sequence order. */
export async function rebuildDecisionProjections(
  db: SqlDb,
  orgId: string,
): Promise<DecisionProjection[]> {
  await db.transaction(async (tx) => {
    await lockTenant(tx, orgId);
    await tx.query(
      "DELETE FROM decision_state_projection WHERE org_id = $1",
      [orgId],
    );
    await tx.query(
      "DELETE FROM decision_projection_checkpoint WHERE org_id = $1",
      [orgId],
    );
    const rows = await listDecisionLedger(tx, orgId);
    for (const row of rows) {
      const parsed = LedgerEntrySchema.safeParse(JSON.parse(row.payloadJson));
      if (!parsed.success) throw appError("STORE_CONSTRAINT", "ledger replay payload is invalid");
      let record: DecisionRecord | undefined;
      if (parsed.data.type === "DecisionRecorded") {
        const stored = await tx.query<{ canonical_json: string }>(
          "SELECT canonical_json FROM decision_records WHERE org_id = $1 AND id = $2",
          [orgId, parsed.data.decisionRef.id],
        );
        const validated = DecisionRecordSchema.safeParse(
          stored.rows[0] ? JSON.parse(stored.rows[0].canonical_json) : undefined,
        );
        if (!validated.success) throw appError("STORE_CONSTRAINT", "decision record is missing during replay");
        record = validated.data;
      }
      await applyProjection(tx, parsed.data, row.sequence, record);
    }
    const head = rows.at(-1);
    if (head) {
      await tx.query(
        `INSERT INTO decision_projection_checkpoint (org_id,last_sequence,rebuilt_at)
         VALUES ($1,$2,$3)`,
        [orgId, head.sequence, new Date().toISOString()],
      );
    }
  });
  return listDecisionProjections(db, orgId);
}
