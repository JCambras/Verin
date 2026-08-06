/** Sole synchronous decision-ledger write path. There is no outbox. */
import { createHash } from "node:crypto";
import { isSqlTransaction, type SqlDb, type SqlTx } from "@infra/store/db";
import { GENESIS_HASH, computeChainHash } from "@infra/audit/hash-chain";
import { appError, logLevelFor, normalizeAppError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import { classifyErrorMetadata, log } from "@infra/observability/logger";
import { authorityObservabilityId } from "@domain/observability/safe-values";
import { err, ok, type Result } from "@contracts/result";
import { parseRecordProvenance, type RecordProvenance } from "@contracts/provenance";
import {
  EvidenceSnapshotRefSchema, DecisionInputBundleSchema,
  type EvidenceSnapshotRef, type DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import { DecisionRecordSchema, type DecisionRecord } from "@contracts/decision-core/decision";
import { LedgerEntrySchema, type LedgerEntry } from "@contracts/decision-core/ledger";
import {
  bundleHashPreimage,
  decisionHashPreimage,
} from "@contracts/decision-core/serialization";
import {
  assertLedgerHistoryOrdering,
  assertLedgerSourceBindings,
} from "./ledger-bindings";
import {
  insertDecisionSources,
  insertEvidenceSnapshots,
  preflightEvidenceSnapshots,
} from "./ledger-sources";
import { canonical, canonicalDigest } from "./ledger-canonical";
import { applyProjection } from "./ledger-projection-store";
import { decisionLedgerChainPreimage } from "./ledger-schema-registry";
import { lockDecisionLedgerTenant } from "./ledger-lock";
import { deriveRecordedDecisionProvenance } from "./ledger-source-provenance";
import {
  assertLedgerEventPiiBoundary,
  assertReplaySourcePiiBoundary,
} from "./ledger-pii";

export { rebuildDecisionProjections } from "./ledger-verification";

export interface RecordDecisionInput extends PIIBearing {
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
  const parsed = LedgerEntrySchema.safeParse(input);
  if (!parsed.success) return err(appError("VALIDATION", "ledger event is invalid"));
  try {
    assertLedgerEventPiiBoundary(parsed.data);
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

function reservationCreationId(event: LedgerEntry): string | null {
  return event.type === "ReservationReleased"
    ? event.reservationCreationRef.id
    : null;
}

/**
 * Prohibited retained text and an unsupported source shape are two different repairs,
 * so a precise refusal passes through: reporting a version this build cannot read as
 * PII_VIOLATION points an operator at personal data that is not there.
 */
function replaySourceRefusal(error: unknown): AppError {
  const known = normalizeAppError(error, "trusted-only");
  return known && known.code !== "PII_VIOLATION"
    ? known
    : appError("PII_VIOLATION", "decision replay source contains prohibited PII");
}

/**
 * The real driver error is logged before mapping: this is the sole ledger write
 * chokepoint, so collapsing an outage, a bug, and a genuine constraint violation into
 * one opaque code would leave a failed append undiagnosable.
 */
function storeFailure(tenant: TenantContext, error: unknown): AppError {
  const metadata = classifyErrorMetadata(error);
  const known = metadata.appError;
  log[known ? logLevelFor(known.code) : "error"](
    {
      orgId: authorityObservabilityId("orgId", tenant),
      code: known?.code ?? null,
      reason: metadata.reason,
    },
    "decision ledger append failed",
  );
  if (known) return known;
  return metadata.sqlState?.startsWith("23")
    ? appError("STORE_CONSTRAINT", "decision ledger append violated a store constraint")
    : appError("INTERNAL", "decision ledger append failed");
}

async function appendPrepared(
  tx: SqlTx,
  tenant: TenantContext,
  events: readonly PreparedEvent[],
  provenance: RecordProvenance,
  decisionRecord?: DecisionRecord,
  decisionProvenance?: RecordProvenance,
): Promise<AppendedLedgerEntry[]> {
  assertTenantContext(tenant);
  const orgId = tenant.orgId;
  const head = await tx.query<{ sequence: number | string; entry_hash: string }>(
    "SELECT sequence, entry_hash FROM decision_ledger WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
    [orgId],
  );
  let sequence = head.rows[0] ? Number(head.rows[0].sequence) + 1 : 0;
  let prevHash = head.rows[0]?.entry_hash ?? GENESIS_HASH;
  const appended: AppendedLedgerEntry[] = [];
  for (const prepared of events) {
    const { event, payloadJson, actorJson } = prepared;
    for (const reference of [
      event.causationRef,
      event.type === "ExceptionDecisionRequested"
        ? event.triggeringEntryRef
        : undefined,
    ]) {
      if (!reference) continue;
      const preceding = await tx.query<{ sequence: number | string }>(
        "SELECT sequence FROM decision_ledger WHERE org_id = $1 AND id = $2",
        [orgId, reference.id],
      );
      if (
        !preceding.rows[0] ||
        Number(preceding.rows[0].sequence) >= sequence
      ) {
        throw appError(
          "STORE_CONSTRAINT",
          "ledger causal reference must name a preceding entry",
        );
      }
    }
    await assertLedgerSourceBindings(tx, tenant, event);
    await assertLedgerHistoryOrdering(tx, tenant, event, sequence);
    const projectionProvenance =
      event.type === "DecisionRecorded" && decisionProvenance
        ? decisionProvenance
        : provenance;
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
         decision_id,evidence_snapshot_id,triggering_entry_id,payload_json,
         reservation_creation_id,prev_hash,entry_hash,prov_source,prov_asof,
         prov_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21)`,
      [
        orgId, event.id, sequence, event.type, event.schemaVersion,
        event.serializerVersion, event.occurredAt, event.recordedAt, actorJson,
        event.correlationId, event.causationRef?.id ?? null, decisionId(event),
        evidenceId(event), triggeringEntryId(event), payloadJson,
        reservationCreationId(event), prevHash, entryHash, provenance.source,
        provenance.asOf, provenance.confidence,
      ],
    );
    await applyProjection(
      tx,
      tenant,
      event,
      sequence,
      projectionProvenance,
      event.type === "DecisionRecorded" ? decisionRecord : undefined,
    );
    appended.push({ id: event.id, sequence, entryHash });
    prevHash = entryHash;
    sequence += 1;
  }
  const last = appended.at(-1);
  const recordedAt = events.at(-1)?.event.recordedAt;
  if (!last || !recordedAt) return appended;
  await tx.query(
    `INSERT INTO decision_ledger_anchor
      (org_id,max_sequence,entry_count,head_hash,updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id) DO UPDATE
       SET max_sequence = EXCLUDED.max_sequence,
           entry_count = decision_ledger_anchor.entry_count + EXCLUDED.entry_count,
           head_hash = EXCLUDED.head_hash,
           updated_at = EXCLUDED.updated_at`,
    [orgId, last.sequence, appended.length, last.entryHash, recordedAt],
  );
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
      return err(appError("AUTH_FAILED", "ledger event tenant does not match append authority"));
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
  orgId: string,
): Result<{
  snapshots: EvidenceSnapshotRef[];
  bundle: DecisionInputBundle;
  record: DecisionRecord;
  events: PreparedEvent[];
  provenance: RecordProvenance;
}, AppError> {
  const provenance = parseRecordProvenance(input.provenance);
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
  if (
    bundle.data.firmId !== orgId ||
    record.data.firmId !== orgId ||
    snapshotValues.some((snapshot) => snapshot.firmId !== orgId)
  ) {
    return err(appError("AUTH_FAILED", "decision replay source tenant does not match write authority"));
  }
  try {
    snapshotValues.forEach((snapshot) =>
      assertReplaySourcePiiBoundary("evidence", snapshot));
    assertReplaySourcePiiBoundary("bundle", bundle.data);
    assertReplaySourcePiiBoundary("decision", record.data);
  } catch (error: unknown) {
    return err(replaySourceRefusal(error));
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
  tenant: TenantContext,
  input: RecordDecisionInput,
): Promise<Result<AppendedLedgerEntry[], AppError>> {
  assertTenantContext(tenant);
  const prepared = validateDecisionInput(input, tenant.orgId);
  if (!prepared.ok) return prepared;
  try {
    const appended = await db.transaction(async (tx) => {
      await lockDecisionLedgerTenant(tx, tenant);
      await insertDecisionSources(
        tx,
        tenant,
        prepared.value.snapshots,
        prepared.value.bundle,
        prepared.value.record,
        prepared.value.events.at(-1)!.event.recordedAt,
      );
      const decisionProvenance = await deriveRecordedDecisionProvenance(
        tx,
        tenant,
        prepared.value.bundle,
        prepared.value.record,
        prepared.value.provenance,
      );
      return appendPrepared(
        tx,
        tenant,
        prepared.value.events,
        prepared.value.provenance,
        prepared.value.record,
        decisionProvenance,
      );
    });
    return ok(appended);
  } catch (error) {
    return err(storeFailure(tenant, error));
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
  tenant: TenantContext,
  inputs: readonly LedgerEntry[],
  provenance: RecordProvenance,
  evidenceSnapshots: readonly EvidenceSnapshotRef[] = [],
): Promise<AppendedLedgerEntry[]> {
  assertTenantContext(tenant);
  if (!isSqlTransaction(tx)) {
    throw appError("VALIDATION", "decision events require an active transaction");
  }
  const normalizedProvenance = parseRecordProvenance(provenance);
  if (!normalizedProvenance) {
    throw appError("VALIDATION", "decision ledger provenance is invalid");
  }
  const orgId = tenant.orgId;
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
  try {
    snapshots.forEach((snapshot) =>
      assertReplaySourcePiiBoundary("evidence", snapshot));
  } catch (error: unknown) {
    throw replaySourceRefusal(error);
  }
  if (!evidenceCorresponds(snapshots, prepared.value, orgId)) {
    throw appError("VALIDATION", "decision source rows and recording events do not correspond");
  }
  let savepointOpen = false;
  try {
    await lockDecisionLedgerTenant(tx, tenant);
    await preflightEvidenceSnapshots(tx, tenant, snapshots);
    await tx.exec("SAVEPOINT decision_ledger_append");
    savepointOpen = true;
    await insertEvidenceSnapshots(
      tx,
      tenant,
      snapshots,
      prepared.value.at(-1)!.event.recordedAt,
    );
    const appended = await appendPrepared(
      tx,
      tenant,
      prepared.value,
      normalizedProvenance,
    );
    await tx.exec("RELEASE SAVEPOINT decision_ledger_append");
    return appended;
  } catch (error: unknown) {
    // The substrate is the authority on generation, ordering, and tenant edges, so a
    // refusal can arrive as a driver error - and leaves here typed, like recordDecision's.
    // Classification happens BEFORE savepoint recovery: a connection lost mid-rollback
    // would otherwise replace the typed refusal with raw driver prose.
    const failure = storeFailure(tenant, error);
    if (savepointOpen) {
      await tx.exec("ROLLBACK TO SAVEPOINT decision_ledger_append").catch(() => undefined);
      await tx.exec("RELEASE SAVEPOINT decision_ledger_append").catch(() => undefined);
    }
    throw failure;
  }
}
