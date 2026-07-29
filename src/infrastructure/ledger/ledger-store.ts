/** Sole synchronous decision-ledger write path. There is no outbox. */
import {
  isSqlTransaction,
  type SqlDb,
  type SqlTx,
} from "@infra/store/db";
import { GENESIS_HASH, computeChainHash } from "@infra/audit/hash-chain";
import { assertNoPIIValues } from "@contracts/pii";
import { appError, isAppError, logLevelFor, type AppError } from "@contracts/errors";
import { log } from "@infra/observability/logger";
import { isDriverConstraintError, logSafeReason } from "@infra/store/driver-errors";
import { err, ok, type Result } from "@contracts/result";
import {
  parseRecordProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
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
  promotedDecisionId,
  promotedEvidenceSnapshotId,
  promotedReservationCreationId,
  promotedTriggeringEntryId,
} from "@contracts/decision-core/ledger-references";
import {
  bundleHashPreimage,
  decisionHashPreimage,
} from "@contracts/decision-core/serialization";
import {
  assertLedgerSourceBindings,
  decisionReplayPinsMatchBundle,
} from "./ledger-bindings";
import {
  bindReplaySourceProvenance,
  insertDecisionSources,
  insertEvidenceSnapshots,
  preflightEvidenceSnapshots,
  replaySourcesContainPII,
} from "./ledger-sources";
import { issueValidatedLedgerSourceWrite } from "./ledger-source-capability";
import { deriveLedgerEventProvenance } from "./ledger-source-provenance";
import { assertStatusEvidenceOrder } from "./ledger-event-order";
import { canonical, canonicalDigest } from "./ledger-canonical";
import {
  persistProjection,
  prepareProjection,
} from "./ledger-projection-store";
import { decisionLedgerChainPreimage } from "./ledger-schema-registry";
import { lockDecisionLedgerTenant } from "./ledger-lock";
import {
  assertLedgerEventPiiBoundary,
  assertReplaySourcePiiBoundary,
} from "./ledger-pii";
import { storedLedgerStructureLookup } from "./ledger-structural-store";
import { assertRecordedLedgerStructure } from "./ledger-structural-validator";

export { rebuildDecisionProjections } from "./ledger-rebuild";

export type LedgerProducerProvenance = RecordProvenance & {
  readonly demonstration?: never;
  readonly derivedFrom?: never;
};
export interface RecordDecisionInput {
  readonly evidenceSnapshots: readonly EvidenceSnapshotRef[];
  readonly inputBundle: DecisionInputBundle;
  readonly decisionRecord: DecisionRecord;
  readonly events: readonly LedgerEntry[];
  /** Provenance of the producer appending these facts (charter #4). */
  readonly provenance: LedgerProducerProvenance;
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

function parseLedgerProducerProvenance(
  value: unknown,
): LedgerProducerProvenance | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Reflect.ownKeys(value).some((key) =>
      key !== "source" && key !== "asOf" && key !== "confidence")
  ) return null;
  return parseRecordProvenance(value);
}
function prepareEvent(input: LedgerEntry): Result<PreparedEvent, AppError> {
  const parsed = LedgerEntrySchema.safeParse(input);
  if (!parsed.success) return err(appError("VALIDATION", "ledger event is invalid"));
  try {
    assertLedgerEventPiiBoundary(parsed.data);
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

async function cleanUpAppendSavepoint(
  tx: SqlTx,
  orgId: string,
): Promise<void> {
  try {
    await tx.exec("ROLLBACK TO SAVEPOINT decision_ledger_append");
  } catch (error) {
    log.warn(
      { orgId, reason: logSafeReason(error) },
      "decision ledger savepoint rollback failed",
    );
  }
  try {
    await tx.exec("RELEASE SAVEPOINT decision_ledger_append");
  } catch (error) {
    log.warn(
      { orgId, reason: logSafeReason(error) },
      "decision ledger savepoint release failed",
    );
  }
}

async function appendPrepared(
  tx: SqlTx,
  orgId: string,
  events: readonly PreparedEvent[],
  provenance: RecordProvenance,
  sourceWrite: ReturnType<typeof issueValidatedLedgerSourceWrite>,
  decisionRecord?: DecisionRecord,
): Promise<AppendedLedgerEntry[]> {
  const head = await tx.query<{ sequence: number | string; entry_hash: string }>(
    "SELECT sequence, entry_hash FROM decision_ledger WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
    [orgId],
  );
  let sequence = head.rows[0] ? Number(head.rows[0].sequence) + 1 : 0;
  let prevHash = head.rows[0]?.entry_hash ?? GENESIS_HASH;
  const appended: AppendedLedgerEntry[] = [];
  const structure = storedLedgerStructureLookup(tx, orgId);
  for (const prepared of events) {
    const { event, payloadJson, actorJson } = prepared;
    const inputBundleId = await assertLedgerSourceBindings(tx, event);
    await assertRecordedLedgerStructure(
      [{ sequence, event }],
      structure,
    );
    const projectionProvenance = await deriveLedgerEventProvenance(
      tx,
      event,
      provenance,
      event.type === "DecisionRecorded",
    );
    const projection = await prepareProjection(
      tx,
      event,
      sequence,
      projectionProvenance,
      event.type === "DecisionRecorded" ? decisionRecord : undefined,
    );
    const chainPreimage = decisionLedgerChainPreimage(
      event.schemaVersion,
      event.serializerVersion,
      payloadJson,
      provenance,
    );
    if (!chainPreimage) {
      throw appError("VALIDATION", "ledger chain preimage version is unsupported");
    }
    const entryHash = computeChainHash(chainPreimage, prevHash);
    await tx.query(
      `INSERT INTO decision_ledger
        (org_id,id,sequence,event_type,schema_version,serializer_version,
         occurred_at,recorded_at,actor_json,correlation_id,causation_id,
         decision_id,evidence_snapshot_id,input_bundle_id,triggering_entry_id,
         payload_json,reservation_creation_id,prev_hash,entry_hash,prov_source,prov_asof,prov_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22)`,
      [
        orgId, event.id, sequence, event.type, event.schemaVersion,
        event.serializerVersion, event.occurredAt, event.recordedAt, actorJson,
        event.correlationId, event.causationRef?.id ?? null,
        promotedDecisionId(event), promotedEvidenceSnapshotId(event),
        event.type === "DecisionRecorded" ? inputBundleId : null,
        promotedTriggeringEntryId(event), payloadJson,
        promotedReservationCreationId(event), prevHash, entryHash,
        provenance.source, provenance.asOf, provenance.confidence,
      ],
    );
    if (
      event.type === "EvidenceSnapshotRecorded" ||
      event.type === "DecisionRecorded"
    ) {
      await bindReplaySourceProvenance(sourceWrite, tx, event);
    }
    await persistProjection(tx, projection, sequence);
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
  const recorded = events.flatMap(({ event }) =>
    event.type === "EvidenceSnapshotRecorded" ? [event] : []);
  const byId = new Map(recorded.map((event) => [
    event.evidenceSnapshotRef.id,
    event,
  ]));
  return recorded.length === snapshots.length &&
    byId.size === recorded.length &&
    snapshots.every((snapshot) => {
      const digest = canonicalDigest(snapshot, "evidence snapshot");
      const event = byId.get(snapshot.id);
      return snapshot.firmId === orgId &&
        digest.ok &&
        event?.contentHash === snapshot.contentHash &&
        event.snapshotHash === digest.value;
    });
}

function validateDecisionInput(
  input: RecordDecisionInput,
): Result<{
  snapshots: EvidenceSnapshotRef[];
  bundle: DecisionInputBundle;
  record: DecisionRecord;
  events: PreparedEvent[];
  provenance: RecordProvenance;
}, AppError> {
  const provenance = parseLedgerProducerProvenance(input.provenance);
  if (!provenance) {
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
  const snapshotValues = snapshots.flatMap((parsed) =>
    parsed.success ? [parsed.data] : []);
  try {
    snapshotValues.forEach((snapshot) =>
      assertReplaySourcePiiBoundary("evidence", snapshot));
    assertReplaySourcePiiBoundary("bundle", bundle.data);
    assertReplaySourcePiiBoundary("decision", record.data);
  } catch {
    return err(appError("PII_VIOLATION", "decision replay source contains prohibited PII"));
  }
  if (replaySourcesContainPII([...snapshotValues, bundle.data, record.data])) {
    return err(appError("PII_VIOLATION", "decision replay source contains prohibited PII"));
  }
  if (
    bundle.data.firmId !== record.data.firmId ||
    record.data.inputBundleRef.id !== bundle.data.id ||
    !decisionReplayPinsMatchBundle(record.data, bundle.data)
  ) {
    return err(appError("VALIDATION", "decision record and input bundle do not match"));
  }
  const bundleHash = canonicalDigest(bundleHashPreimage(bundle.data), "bundle hash preimage");
  const recordHash = canonicalDigest(decisionHashPreimage(record.data), "decision hash preimage");
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
  const event = decisionEvents[0]?.event;
  if (
    decisionEvents.length !== 1 ||
    event !== events.value.at(-1)?.event ||
    !evidenceCorresponds(snapshotValues, events.value, record.data.firmId) ||
    event?.type !== "DecisionRecorded" ||
    event.decisionRef.id !== record.data.id ||
    event.decisionHash !== record.data.decisionHash ||
    event.bundleHash !== bundle.data.bundleHash ||
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
    provenance,
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
    const sourceWrite = issueValidatedLedgerSourceWrite();
    const appended = await db.transaction(async (tx) => {
      await lockDecisionLedgerTenant(tx, prepared.value.record.firmId, "append");
      await insertDecisionSources(
        sourceWrite,
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
        prepared.value.provenance,
        sourceWrite,
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
  tx: SqlTx,
  orgId: string,
  inputs: readonly LedgerEntry[],
  provenance: LedgerProducerProvenance,
  evidenceSnapshots: readonly EvidenceSnapshotRef[] = [],
): Promise<AppendedLedgerEntry[]> {
  if (inputs.length === 0 && evidenceSnapshots.length === 0) return [];
  if (!isSqlTransaction(tx)) {
    throw appError("VALIDATION", "decision events require an active transaction");
  }
  const normalizedProvenance = parseLedgerProducerProvenance(provenance);
  if (!normalizedProvenance) {
    throw appError("VALIDATION", "decision ledger provenance is invalid");
  }
  const prepared = prepareEvents(inputs, orgId);
  if (!prepared.ok) throw prepared.error;
  if (prepared.value.some(({ event }) => event.type === "DecisionRecorded")) {
    throw appError("VALIDATION", "recording a decision requires recordDecision");
  }
  const parsed = evidenceSnapshots.map((value) => EvidenceSnapshotRefSchema.safeParse(value));
  if (parsed.some((snapshot) => !snapshot.success)) {
    throw appError("VALIDATION", "evidence snapshot is invalid");
  }
  const snapshots = parsed.flatMap((snapshot) => snapshot.success ? [snapshot.data] : []);
  try {
    snapshots.forEach((snapshot) =>
      assertReplaySourcePiiBoundary("evidence", snapshot));
  } catch {
    throw appError("PII_VIOLATION", "decision replay source contains prohibited PII");
  }
  if (replaySourcesContainPII(snapshots)) {
    throw appError("PII_VIOLATION", "decision replay source contains prohibited PII");
  }
  if (!evidenceCorresponds(snapshots, prepared.value, orgId)) {
    throw appError("VALIDATION", "decision source rows and recording events do not correspond");
  }
  let savepointCreated = false;
  try {
    await lockDecisionLedgerTenant(tx, orgId, "append");
    await assertStatusEvidenceOrder(tx, orgId, prepared.value);
    await preflightEvidenceSnapshots(tx, snapshots);
    const sourceWrite = issueValidatedLedgerSourceWrite();
    await tx.exec("SAVEPOINT decision_ledger_append");
    savepointCreated = true;
    await insertEvidenceSnapshots(
      sourceWrite,
      tx,
      snapshots,
      prepared.value.at(-1)!.event.recordedAt,
    );
    const appended = await appendPrepared(
      tx,
      orgId,
      prepared.value,
      normalizedProvenance,
      sourceWrite,
    );
    await tx.exec("RELEASE SAVEPOINT decision_ledger_append");
    savepointCreated = false;
    return appended;
  } catch (error) {
    if (savepointCreated) {
      await cleanUpAppendSavepoint(tx, orgId);
    }
    throw storeFailure(orgId, error);
  }
}
