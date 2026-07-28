/** Sole synchronous decision-ledger write path. There is no outbox. */
import { createHash } from "node:crypto";
import type { SqlDb, SqlQueryable } from "@infra/store/db";
import { GENESIS_HASH, computeChainHash } from "@infra/audit/hash-chain";
import { scrub } from "@infra/pii/scrub";
import { assertNoPIIValues } from "@contracts/pii";
import { appError, isAppError, logLevelFor, type AppError } from "@contracts/errors";
import { log } from "@infra/observability/logger";
import { isDriverConstraintError, logSafeReason } from "@infra/store/driver-errors";
import { err, ok, type Result } from "@contracts/result";
import { SOURCE_SYSTEMS, type RecordProvenance } from "@contracts/provenance";
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
  bundleHashPreimage,
  decisionHashPreimage,
} from "@contracts/decision-core/serialization";
import { listDecisionLedger } from "./ledger-verification";
import { assertLedgerSourceBindings } from "./ledger-bindings";
import {
  canonical,
  insertDecisionSources,
  insertEvidenceSnapshots,
} from "./ledger-sources";
import {
  applyProjection,
  clearDerivedState,
  listDecisionProjections,
  type ProjectedDecision,
} from "./ledger-projection-store";

export interface RecordDecisionInput {
  readonly evidenceSnapshots: readonly EvidenceSnapshotRef[];
  readonly inputBundle: DecisionInputBundle;
  readonly decisionRecord: DecisionRecord;
  readonly events: readonly LedgerEntry[];
  /** Provenance of the producer appending these facts (charter #4). */
  readonly provenance: RecordProvenance;
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

function triggeringEntryId(event: LedgerEntry): string | null {
  return event.type === "ExceptionDecisionRequested"
    ? event.triggeringEntryRef.id
    : null;
}

function validProvenance(provenance: RecordProvenance): boolean {
  return SOURCE_SYSTEMS.includes(provenance.source) &&
    !Number.isNaN(Date.parse(provenance.asOf));
}

/**
 * The real driver error is logged before mapping: this is the sole ledger write
 * chokepoint, so collapsing an outage, a bug, and a genuine constraint violation into
 * one opaque code would leave a failed append undiagnosable.
 */
function storeFailure(orgId: string, error: unknown): AppError {
  const known = isAppError(error) ? error : null;
  log[known ? logLevelFor(known.code) : "error"](
    { orgId, code: known?.code ?? null, reason: logSafeReason(error) },
    "decision ledger append failed",
  );
  if (known) return known;
  return isDriverConstraintError(error)
    ? appError("STORE_CONSTRAINT", "decision ledger append violated a store constraint")
    : appError("INTERNAL", "decision ledger append failed");
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

async function appendPrepared(
  tx: SqlQueryable,
  orgId: string,
  events: readonly PreparedEvent[],
  provenance: RecordProvenance,
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
         decision_id,evidence_snapshot_id,triggering_entry_id,payload_json,
         prev_hash,entry_hash,prov_source,prov_asof,prov_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20)`,
      [
        orgId, event.id, sequence, event.type, event.schemaVersion,
        event.serializerVersion, event.occurredAt, event.recordedAt, actorJson,
        event.correlationId, event.causationRef?.id ?? null, decisionId(event),
        evidenceId(event), triggeringEntryId(event), payloadJson, prevHash,
        entryHash, provenance.source, provenance.asOf, provenance.confidence,
      ],
    );
    await applyProjection(
      tx,
      event,
      sequence,
      event.type === "DecisionRecorded" ? decisionRecord : undefined,
    );
    // Per entry, never once per batch: if a later event of this batch throws and a
    // future producer swallows it inside its own transaction, the rows that DID
    // commit still have an anchor that matches them, so L4 stays repairable.
    await tx.query(
      `INSERT INTO decision_ledger_anchor
        (org_id,max_sequence,entry_count,head_hash,updated_at)
       VALUES ($1,$2,1,$3,$4)
       ON CONFLICT (org_id) DO UPDATE
         SET max_sequence = EXCLUDED.max_sequence,
             entry_count = decision_ledger_anchor.entry_count + 1,
             head_hash = EXCLUDED.head_hash,
             updated_at = EXCLUDED.updated_at`,
      [orgId, sequence, entryHash, event.recordedAt],
    );
    await tx.query(
      `INSERT INTO decision_projection_checkpoint (org_id,last_sequence,rebuilt_at)
       VALUES ($1,$2,$3)
       ON CONFLICT (org_id) DO UPDATE
         SET last_sequence = EXCLUDED.last_sequence, rebuilt_at = EXCLUDED.rebuilt_at`,
      [orgId, sequence, event.recordedAt],
    );
    appended.push({ id: event.id, sequence, entryHash });
    prevHash = entryHash;
    sequence += 1;
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

/**
 * Immutable evidence and the events that record it are appended together: every
 * supplied snapshot belongs to the appending tenant and is named by exactly one
 * `EvidenceSnapshotRecorded` of the same batch, and no such event names bytes the batch
 * does not carry. Both write paths hold to this, so evidence never lands unrecorded.
 */
function evidenceCorresponds(
  snapshots: readonly EvidenceSnapshotRef[],
  events: readonly PreparedEvent[],
  orgId: string,
): boolean {
  const named = events.flatMap(({ event }) =>
    event.type === "EvidenceSnapshotRecorded" ? [event.evidenceSnapshotRef.id] : []);
  const unique = new Set(named);
  return named.length === snapshots.length &&
    unique.size === named.length &&
    snapshots.every((snapshot) =>
      snapshot.firmId === orgId && unique.has(snapshot.id));
}

function validateDecisionInput(
  input: RecordDecisionInput,
): Result<{
  snapshots: EvidenceSnapshotRef[];
  bundle: DecisionInputBundle;
  record: DecisionRecord;
  events: PreparedEvent[];
}, AppError> {
  if (!validProvenance(input.provenance)) {
    return err(appError("VALIDATION", "decision ledger provenance is invalid"));
  }
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
  const snapshotValues = snapshots.flatMap((parsed) =>
    parsed.success ? [parsed.data] : []);
  const event = decisionEvents[0]?.event;
  if (
    decisionEvents.length !== 1 ||
    !evidenceCorresponds(snapshotValues, events.value, record.data.firmId) ||
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
        input.provenance,
        prepared.value.record,
      );
    });
    return ok(appended);
  } catch (error) {
    return err(storeFailure(prepared.value.record.firmId, error));
  }
}

/**
 * Append later facts inside the caller's transaction. This function never starts
 * a transaction, so a future audited CRM write can commit its outbox intent and
 * decision event atomically. Adapter-boundary errors throw typed AppError values
 * to force the caller's transaction to abort.
 *
 * `evidenceSnapshots` carries evidence gathered AFTER the decision - what a
 * verification-time `StatusObserved` cites - so its promoted, foreign-keyed id is never
 * a dead reference. Recording a decision still requires `recordDecision` (the bundle).
 */
export async function appendDecisionEvents(
  tx: SqlQueryable,
  orgId: string,
  inputs: readonly LedgerEntry[],
  provenance: RecordProvenance,
  evidenceSnapshots: readonly EvidenceSnapshotRef[] = [],
): Promise<AppendedLedgerEntry[]> {
  if (!validProvenance(provenance)) {
    throw appError("VALIDATION", "decision ledger provenance is invalid");
  }
  const prepared = prepareEvents(inputs, orgId);
  if (!prepared.ok) throw prepared.error;
  if (
    prepared.value.length === 0 ||
    prepared.value.some(({ event }) => event.type === "DecisionRecorded")
  ) {
    throw appError("VALIDATION", "recording a decision requires recordDecision");
  }
  const parsed = evidenceSnapshots.map((value) => EvidenceSnapshotRefSchema.safeParse(value));
  if (parsed.some((snapshot) => !snapshot.success)) {
    throw appError("VALIDATION", "evidence snapshot is invalid");
  }
  const snapshots = parsed.flatMap((snapshot) => snapshot.success ? [snapshot.data] : []);
  if (!evidenceCorresponds(snapshots, prepared.value, orgId)) {
    throw appError("VALIDATION", "decision source rows and recording events do not correspond");
  }
  await lockTenant(tx, orgId);
  await insertEvidenceSnapshots(tx, snapshots, prepared.value.at(-1)!.event.recordedAt);
  return appendPrepared(tx, orgId, prepared.value, provenance);
}

/** Delete only derived state, then replay immutable rows in sequence order. */
export async function rebuildDecisionProjections(
  db: SqlDb,
  orgId: string,
): Promise<ProjectedDecision[]> {
  await db.transaction(async (tx) => {
    await lockTenant(tx, orgId);
    await clearDerivedState(tx, orgId);
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
