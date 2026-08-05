import { createHash } from "node:crypto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import {
  createMemoryDb,
  isSqlTransaction,
  type SqlDb,
  type SqlTx,
} from "@infra/store/db";
import {
  appendDecisionEvents,
  rebuildDecisionProjections,
  recordDecision,
  type LedgerProducerProvenance,
} from "@infra/ledger/ledger-store";
import {
  verifyAndListDecisionLedger,
  verifyDecisionLedgerIntegrity,
  verifyDecisionLedger,
  listDecisionLedger,
} from "@infra/ledger/ledger-verification";
import { readVerifiedDecisionRegister } from "@infra/ledger/ledger-register";
import { computeChainHash, GENESIS_HASH } from "@infra/audit/hash-chain";
import { auditedWrite } from "@infra/audit/audited-write";
import { systemWriteActor } from "@contracts/principal";
import { registerTestSystemActor } from "@contracts/tenant";
import { decisionLedgerChainPreimage } from "@infra/ledger/ledger-schema-registry";
import { verifyRecordedLedgerProvenance } from "@infra/ledger/ledger-producer-provenance";
import {
  assertLedgerEventPiiBoundary,
  assertReplaySourcePiiBoundary,
  isVersionIdentifier,
  retainedTextReference,
} from "@infra/ledger/ledger-pii";
import { LedgerEntrySchema } from "@contracts/decision-core/ledger";
import {
  promotedDecisionId,
  promotedEvidenceSnapshotId,
  promotedReservationCreationId,
  promotedTriggeringEntryId,
} from "@contracts/decision-core/ledger-references";
import {
  bundleHashPreimage,
  CANONICAL_SERIALIZER_VERSION,
  canonicalJson,
  DECISION_CORE_SCHEMA_VERSION,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
} from "@contracts/decision-core/evidence";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import { DecisionRecordV1_7_0Schema } from "@contracts/decision-core/v1-7/decision";
import { DecisionInputBundleV1_7_0Schema } from "@contracts/decision-core/v1-7/evidence";
import {
  COMPUTED_LEDGER_PROVENANCE_VERSION,
  LEDGER_PROVENANCE_SERIALIZER_VERSION,
  canFeedComplianceDecision,
  computedProvenanceTrace,
  deriveArtifactProvenance,
  parseLedgerProducerProvenance,
  type ComputedLedgerProducerProvenance,
} from "@contracts/provenance";
import {
  bundleHashPreimageV1_7_0,
  canonicalJsonV1_0_0,
  decisionHashPreimageV1_7_0,
  type JsonValue as JsonValueV1_7_0,
} from "@contracts/decision-core/v1-7/serialization";
import {
  LEDGER_LATER,
  LEDGER_ORG,
  LEDGER_OTHER_ORG,
  LEDGER_PROVENANCE,
  LEDGER_TENANT,
  allLedgerEventSamples,
  decisionRecordingInput,
  laterEvidenceRecording,
  retainedDecisionSourceFixtures,
  reusedBundleRecordingInput,
} from "../helpers/ledger-fixtures";

const TS = "2026-07-26T13:30:00.000Z";

function hashPreimage(value: unknown): string {
  const canonical = canonicalJson(value as JsonValue);
  if (!canonical.ok) throw canonical.error;
  return createHash("sha256").update(canonical.value, "utf8").digest("hex");
}

function issuedTraceId(label: string): string {
  return `trace:${createHash("sha256").update(label, "utf8").digest("hex")}`;
}

function computedProvenance(
  input: Awaited<ReturnType<typeof listDecisionLedger>>[number],
  traceId: string,
  asOf = LEDGER_LATER,
): ComputedLedgerProducerProvenance {
  const trace = {
    schemaVersion: COMPUTED_LEDGER_PROVENANCE_VERSION,
    serializerVersion: LEDGER_PROVENANCE_SERIALIZER_VERSION,
    traceRef: { firmId: LEDGER_ORG, id: issuedTraceId(traceId) },
    producer: {
      kind: "algorithm",
      id: "verin.test.decision-score",
      version: "1.0.0",
    },
    inputs: [{
      kind: "ledger-entry",
      entryRef: { firmId: LEDGER_ORG, id: input.id },
      entryHash: input.entryHash,
    }],
    observedAt: asOf,
    confidence: "high",
  } as const;
  return {
    source: "computed",
    asOf,
    confidence: "high",
    derivation: {
      ...trace,
      traceDigest: hashPreimage(trace),
    },
  };
}

function hashPreimageV1_7_0(value: unknown): string {
  const canonical = canonicalJsonV1_0_0(value as JsonValueV1_7_0);
  if (!canonical.ok) throw canonical.error;
  return createHash("sha256").update(canonical.value, "utf8").digest("hex");
}

async function seedOrg(db: SqlDb, id: string): Promise<void> {
  await db.query(
    `INSERT INTO orgs
      (id,name,created_at,prov_source,prov_asof,prov_confidence)
     VALUES ($1,$2,$3,'synthetic-ledger-test',$3,'high')`,
    [id, `Synthetic ${id}`, TS],
  );
}

async function recordFixture(db: SqlDb): Promise<void> {
  const result = await recordDecision(db, LEDGER_TENANT, decisionRecordingInput());
  expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
}

async function appendComputedExpiry(
  db: SqlDb,
  inputRow: Awaited<ReturnType<typeof listDecisionLedger>>[number],
  traceId: string,
): Promise<void> {
  const input = decisionRecordingInput();
  const sample = allLedgerEventSamples().find(
    (event) => event.type === "ApprovalStageExpired",
  )!;
  const event = LedgerEntrySchema.parse({
    ...sample,
    id: `ledger:computed:${issuedTraceId(traceId)}`,
    priorDecisionHash: input.decisionRecord.decisionHash,
  });
  await db.transaction((tx) => appendDecisionEvents(
    tx,
    LEDGER_TENANT,
    [event],
    computedProvenance(inputRow, traceId),
  ));
}

const append = (
  db: SqlDb,
  events: Parameters<typeof appendDecisionEvents>[2],
) => db.transaction((tx) => appendDecisionEvents(tx, LEDGER_TENANT, events, LEDGER_PROVENANCE));

async function insertRawEvidenceSnapshot(
  db: SqlDb,
  snapshot: ReturnType<typeof laterEvidenceRecording>["snapshot"],
): Promise<void> {
  const bytes = canonicalJson(snapshot as unknown as JsonValue);
  expect(bytes.ok).toBe(true);
  if (!bytes.ok) return;
  await db.query(
    `INSERT INTO evidence_snapshots
      (org_id,id,canonical_json,schema_version,contract_schema_version,
       serializer_version,content_hash,snapshot_hash,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      snapshot.firmId,
      snapshot.id,
      bytes.value,
      snapshot.schemaVersion,
      DECISION_CORE_SCHEMA_VERSION,
      CANONICAL_SERIALIZER_VERSION,
      snapshot.contentHash,
      createHash("sha256").update(bytes.value, "utf8").digest("hex"),
      LEDGER_LATER,
    ],
  );
}

async function insertRawDecisionEvent(
  db: SqlDb,
  event: ReturnType<typeof LedgerEntrySchema.parse>,
): Promise<void> {
  const head = await db.query<{
    sequence: number | string;
    entry_hash: string;
  }>(
    "SELECT sequence, entry_hash FROM decision_ledger WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
    [LEDGER_ORG],
  );
  const payload = canonicalJson(event as unknown as JsonValue);
  const actor = canonicalJson(event.actor as unknown as JsonValue);
  expect(payload.ok && actor.ok).toBe(true);
  if (!payload.ok || !actor.ok) return;
  const sequence = Number(head.rows[0]!.sequence) + 1;
  const previousHash = head.rows[0]!.entry_hash;
  const preimage = decisionLedgerChainPreimage(
    event.schemaVersion,
    event.serializerVersion,
    payload.value,
    LEDGER_PROVENANCE,
  );
  expect(preimage).not.toBeNull();
  if (!preimage) return;
  const entryHash = computeChainHash(preimage, previousHash);
  const inputBundle = event.type === "DecisionRecorded"
    ? await db.query<{ input_bundle_id: string }>(
        `SELECT input_bundle_id FROM decision_records
          WHERE org_id = $1 AND id = $2`,
        [LEDGER_ORG, event.decisionRef.id],
      )
    : null;
  await db.query(
    `INSERT INTO decision_ledger
      (org_id,id,sequence,event_type,schema_version,serializer_version,
       occurred_at,recorded_at,actor_json,correlation_id,causation_id,
       decision_id,evidence_snapshot_id,input_bundle_id,triggering_entry_id,
       payload_json,reservation_creation_id,prev_hash,entry_hash,prov_source,
       prov_asof,prov_confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20,$21,$22)`,
    [
      LEDGER_ORG,
      event.id,
      sequence,
      event.type,
      event.schemaVersion,
      event.serializerVersion,
      event.occurredAt,
      event.recordedAt,
      actor.value,
      event.correlationId,
      event.causationRef?.id ?? null,
      promotedDecisionId(event),
      promotedEvidenceSnapshotId(event),
      inputBundle?.rows[0]?.input_bundle_id ?? null,
      promotedTriggeringEntryId(event),
      payload.value,
      promotedReservationCreationId(event),
      previousHash,
      entryHash,
      LEDGER_PROVENANCE.source,
      LEDGER_PROVENANCE.asOf,
      LEDGER_PROVENANCE.confidence,
    ],
  );
  await db.query(
    `UPDATE decision_ledger_anchor
        SET max_sequence = $2, entry_count = entry_count + 1,
            head_hash = $3, updated_at = $4
      WHERE org_id = $1`,
    [LEDGER_ORG, sequence, entryHash, event.recordedAt],
  );
}

async function moveLastEntryBeforeDecisionRecording(db: SqlDb): Promise<void> {
  const rows = await db.query<{
    id: string;
    sequence: number | string;
    event_type: string;
    schema_version: string;
    serializer_version: string;
    payload_json: string;
  }>(
    `SELECT id, sequence, event_type, schema_version, serializer_version,
            payload_json
       FROM decision_ledger
      WHERE org_id = $1
      ORDER BY sequence DESC
      LIMIT 2`,
    [LEDGER_ORG],
  );
  const later = rows.rows[0]!;
  const recording = rows.rows[1]!;
  const laterSequence = Number(later.sequence);
  const recordingSequence = Number(recording.sequence);
  expect(later.event_type).toBe("ApprovalRecorded");
  expect(recording.event_type).toBe("DecisionRecorded");
  const predecessor = await db.query<{ entry_hash: string }>(
    "SELECT entry_hash FROM decision_ledger WHERE org_id = $1 AND sequence = $2",
    [LEDGER_ORG, recordingSequence - 1],
  );
  const laterPreimage = decisionLedgerChainPreimage(
    later.schema_version,
    later.serializer_version,
    later.payload_json,
    LEDGER_PROVENANCE,
  );
  const recordingPreimage = decisionLedgerChainPreimage(
    recording.schema_version,
    recording.serializer_version,
    recording.payload_json,
    LEDGER_PROVENANCE,
  );
  expect(laterPreimage).not.toBeNull();
  expect(recordingPreimage).not.toBeNull();
  if (!laterPreimage || !recordingPreimage) return;
  const previousHash = predecessor.rows[0]!.entry_hash;
  const laterHash = computeChainHash(laterPreimage, previousHash);
  const recordingHash = computeChainHash(recordingPreimage, laterHash);
  await db.exec(
    "ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update",
  );
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE decision_ledger SET sequence = $3 WHERE org_id = $1 AND id = $2",
        [LEDGER_ORG, recording.id, laterSequence + 1],
      );
      await tx.query(
        `UPDATE decision_ledger
            SET sequence = $3, prev_hash = $4, entry_hash = $5
          WHERE org_id = $1 AND id = $2`,
        [
          LEDGER_ORG,
          later.id,
          recordingSequence,
          previousHash,
          laterHash,
        ],
      );
      await tx.query(
        `UPDATE decision_ledger
            SET sequence = $3, prev_hash = $4, entry_hash = $5
          WHERE org_id = $1 AND id = $2`,
        [
          LEDGER_ORG,
          recording.id,
          laterSequence,
          laterHash,
          recordingHash,
        ],
      );
      await tx.query(
        `UPDATE decision_ledger_anchor
            SET max_sequence = $2, head_hash = $3
          WHERE org_id = $1`,
        [LEDGER_ORG, laterSequence, recordingHash],
      );
      await tx.query(
        "UPDATE decision_ledger_total_witness SET compromised = false WHERE org_id = $1",
        [LEDGER_ORG],
      );
    });
  } finally {
    await db.exec(
      "ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update",
    );
  }
}

/** Every statement a path issues, in order, so lock mode is observed not assumed. */
async function measureStatements(
  db: SqlDb,
  run: (measured: SqlDb) => Promise<void>,
): Promise<string[]> {
  const statements: string[] = [];
  const measured: SqlDb = {
    ...db,
    async query<U>(sql: string, params?: unknown[]) {
      statements.push(sql);
      return db.query<U>(sql, params);
    },
    transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      return db.transaction((tx) => fn({
        ...tx,
        async query<U>(sql: string, params?: unknown[]) {
          statements.push(sql);
          return tx.query<U>(sql, params);
        },
      }));
    },
  };
  await run(measured);
  return statements;
}

async function sourceCounts(db: SqlDb): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of [
    "evidence_snapshots",
    "decision_input_bundles",
    "decision_input_bundle_evidence",
    "decision_records",
    "decision_ledger",
  ]) {
    const count = await db.query<{ n: number | string }>(
      `SELECT count(*) AS n FROM ${table} WHERE org_id = $1`,
      [LEDGER_ORG],
    );
    result[table] = Number(count.rows[0]!.n);
  }
  return result;
}

describe("decision ledger storage and L1-L4 verification", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await seedOrg(db, LEDGER_ORG);
  });
  afterEach(async () => {
    await db.close();
  });

  it("commits replay inputs, decision record, typed events, chain, and projection atomically", async () => {
    await recordFixture(db);
    expect(await sourceCounts(db)).toEqual({
      evidence_snapshots: 4,
      decision_input_bundles: 1,
      decision_input_bundle_evidence: 4,
      decision_records: 1,
      decision_ledger: 5,
    });
    const sourceProvenance = await db.query<{
      source_kind: string;
      source_id: string;
      recording_entry_id: string;
    }>(
      `SELECT source_kind, source_id, recording_entry_id
         FROM decision_replay_source_provenance
        WHERE org_id = $1
        ORDER BY source_kind ASC, source_id ASC`,
      [LEDGER_ORG],
    );
    expect(sourceProvenance.rows).toHaveLength(6);
    expect(sourceProvenance.rows.every((row) =>
      row.recording_entry_id.startsWith("ledger:") ||
      /^[a-f0-9]{64}$/.test(row.recording_entry_id))).toBe(true);
    const replayMetadata = await db.query<{
      schema_version: string;
      serializer_version: string;
      engine_version: string;
      primitive_set_version: string;
      time_zone_data_version: string;
    }>(
      `SELECT schema_version, serializer_version, engine_version,
              primitive_set_version, time_zone_data_version
         FROM decision_input_bundles
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, "bundle:GC-01:0001"],
    );
    expect(replayMetadata.rows[0]).toEqual({
      schema_version: DECISION_CORE_SCHEMA_VERSION,
      serializer_version: CANONICAL_SERIALIZER_VERSION,
      engine_version: "0.0.0",
      primitive_set_version: "0",
      time_zone_data_version: "iana-tzdb/2026b",
    });
    const verification = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(verification.ok).toBe(true);
    expect(verification.entriesChecked).toBe(5);
    expect(verification.levels.map((level) => level.level)).toEqual([
      "L1", "L2", "L3", "L4",
    ]);
    const projection = await db.query<{ state_json: string }>(
      "SELECT state_json FROM decision_state_projection WHERE org_id = $1 AND decision_id = $2",
      [LEDGER_ORG, "dec:GC-01:0001"],
    );
    expect(JSON.parse(projection.rows[0]!.state_json)).toMatchObject({
      disposition: "proceed",
      approvalMode: "approval",
      lastEventType: "DecisionRecorded",
      lastSequence: 4,
    });
  });

  it("rolls back every source row when the decision event cannot append", async () => {
    const input = decisionRecordingInput();
    const last = input.events.at(-1)!;
    const invalid = LedgerEntrySchema.parse({
      ...last,
      causationRef: { firmId: LEDGER_ORG, id: "missing-cause" },
    });
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...input,
      events: [...input.events.slice(0, -1), invalid],
    });
    expect(result.ok).toBe(false);
    expect(await sourceCounts(db)).toEqual({
      evidence_snapshots: 0,
      decision_input_bundles: 0,
      decision_input_bundle_evidence: 0,
      decision_records: 0,
      decision_ledger: 0,
    });
  });

  it("database triggers reject UPDATE, DELETE, and TRUNCATE on every immutable source table", async () => {
    await recordFixture(db);
    for (const table of [
      "evidence_snapshots",
      "decision_input_bundles",
      "decision_input_bundle_evidence",
      "decision_records",
      "decision_replay_source_provenance",
      "decision_ledger",
    ]) {
      await expect(
        db.query(`UPDATE ${table} SET org_id = org_id WHERE org_id = $1`, [LEDGER_ORG]),
      ).rejects.toThrow(/append-only/);
      await expect(
        db.query(`DELETE FROM ${table} WHERE org_id = $1`, [LEDGER_ORG]),
      ).rejects.toThrow(/append-only/);
      await expect(db.exec(`TRUNCATE ${table}`)).rejects.toThrow(
        /append-only|foreign key constraint/,
      );
    }
  });

  it("L1 detects changed stored payload bytes", async () => {
    await recordFixture(db);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET payload_json = payload_json || ' ' WHERE org_id = $1 AND sequence = 4",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L1");
  });

  it("L2 detects noncanonical payload even when a privileged writer recomputes the chain", async () => {
    await recordFixture(db);
    const row = await db.query<{
      payload_json: string;
      prev_hash: string;
      schema_version: string;
      serializer_version: string;
      prov_source: string;
      prov_asof: string;
      prov_confidence: string;
    }>(
      `SELECT payload_json, prev_hash, schema_version, serializer_version,
              prov_source, prov_asof, prov_confidence
         FROM decision_ledger
        WHERE org_id = $1 AND sequence = 4`,
      [LEDGER_ORG],
    );
    const payload = `${row.rows[0]!.payload_json} `;
    const preimage = decisionLedgerChainPreimage(
      row.rows[0]!.schema_version,
      row.rows[0]!.serializer_version,
      payload,
      {
        source: row.rows[0]!.prov_source as "fixture",
        asOf: row.rows[0]!.prov_asof,
        confidence: row.rows[0]!.prov_confidence as "high",
      },
    );
    expect(preimage).not.toBeNull();
    if (!preimage) return;
    const hash = computeChainHash(preimage, row.rows[0]!.prev_hash);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET payload_json = $2, entry_hash = $3 WHERE org_id = $1 AND sequence = 4",
      [LEDGER_ORG, payload, hash],
    );
    await db.query(
      "UPDATE decision_ledger_anchor SET head_hash = $2 WHERE org_id = $1",
      [LEDGER_ORG, hash],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L2");
  });

  it("refuses an unregistered recorded schema or serializer version", async () => {
    await recordFixture(db);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET serializer_version = '9.0.0' WHERE org_id = $1 AND sequence = 4",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)).toMatchObject({
      level: "L1",
      reason: "ledger chain preimage or provenance is unsupported",
    });
  });

  it("L3 detects promoted-column drift without relying on the hash", async () => {
    await recordFixture(db);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET correlation_id = 'drifted' WHERE org_id = $1 AND sequence = 4",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L3");
  });

  it("L3 binds promoted bundle identity to the immutable decision record", async () => {
    await recordFixture(db);
    await db.query(
      `INSERT INTO decision_input_bundles
        (org_id,id,canonical_json,schema_version,serializer_version,
         engine_version,primitive_set_version,time_zone_data_version,
         bundle_hash,recorded_at)
       SELECT org_id,'bundle:l3-alternate',canonical_json,schema_version,
              serializer_version,engine_version,primitive_set_version,
              time_zone_data_version,$2,recorded_at
         FROM decision_input_bundles
        WHERE org_id = $1 AND id = 'bundle:GC-01:0001'`,
      [LEDGER_ORG, "f".repeat(64)],
    );
    await db.exec(
      "ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update",
    );
    await db.query(
      `UPDATE decision_ledger
          SET input_bundle_id = 'bundle:l3-alternate'
        WHERE org_id = $1 AND event_type = 'DecisionRecorded'`,
      [LEDGER_ORG],
    );
    await db.exec(
      "ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update",
    );
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L3");
  });

  it("binds stored provenance into ledger integrity verification", async () => {
    await recordFixture(db);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET prov_source = 'verin-crm' WHERE org_id = $1 AND sequence = 4",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L1");
  });

  it("locks one tenant owner: compatible to verify, exclusive to append", async () => {
    const appendStatements = await measureStatements(db, recordFixture);
    expect(appendStatements[0]).toBe(
      "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
    );

    const verifyStatements = await measureStatements(db, async (target) => {
      expect((await verifyDecisionLedger(target, LEDGER_TENANT)).ok).toBe(true);
    });
    expect(verifyStatements[0]).toBe(
      "SELECT id FROM orgs WHERE id = $1 FOR SHARE",
    );
    // A compatible read still excludes appends, so the exclusive mode is the ONLY
    // one that can compute a next sequence: no verify path may take it back.
    expect(
      verifyStatements.filter((sql) => sql.includes("FOR UPDATE")),
    ).toEqual([]);
    expect(
      verifyStatements.some((sql) =>
        /count\(\*\).*max\(sequence\).*decision_ledger/is.test(sql)),
    ).toBe(true);

    const rebuildStatements = await measureStatements(db, async (target) => {
      await rebuildDecisionProjections(target, LEDGER_TENANT);
    });
    expect(rebuildStatements[0]).toBe(
      "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
    );
  });

  it("L4 detects tail deletion and anchor drift", async () => {
    await recordFixture(db);
    await db.query(
      "UPDATE decision_ledger_anchor SET entry_count = entry_count + 1 WHERE org_id = $1",
      [LEDGER_ORG],
    );
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L4");
  });

  it("L4 window verification detects deletion before its predecessor", async () => {
    await recordFixture(db);
    const expired = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageExpired",
    )!;
    const decisionHash = decisionRecordingInput().decisionRecord.decisionHash;
    await append(db, Array.from({ length: 4 }, (_, index) =>
      LedgerEntrySchema.parse({
        ...expired,
        id: `ledger:expired:${index}`,
        priorDecisionHash: decisionHash,
      })));
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_delete");
    await db.query(
      "DELETE FROM decision_ledger WHERE org_id = $1 AND sequence = 5",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_delete");

    const result = await verifyAndListDecisionLedger(db, LEDGER_TENANT, 2);
    expect(result.verification.ok).toBe(false);
    expect(result.verification.levels.at(-1)).toMatchObject({ level: "L4" });
  });

  it("marks both tenant witnesses compromised when a row changes owner", async () => {
    await seedOrg(db, LEDGER_OTHER_ORG);
    await db.query(
      `INSERT INTO decision_ledger_total_witness
        (org_id, entry_count, compromised, updated_at)
       VALUES ($1, 0, false, $3), ($2, 0, false, $3)`,
      [LEDGER_ORG, LEDGER_OTHER_ORG, TS],
    );
    await db.exec(
      `CREATE TABLE ledger_mutation_probe (org_id text NOT NULL);
       CREATE TRIGGER ledger_mutation_probe_trigger
       AFTER UPDATE OR DELETE ON ledger_mutation_probe
       FOR EACH ROW EXECUTE FUNCTION decision_ledger_total_on_mutation();`,
    );
    await db.query(
      "INSERT INTO ledger_mutation_probe (org_id) VALUES ($1)",
      [LEDGER_ORG],
    );
    await db.query(
      "UPDATE ledger_mutation_probe SET org_id = $2 WHERE org_id = $1",
      [LEDGER_ORG, LEDGER_OTHER_ORG],
    );

    const witnesses = await db.query<{
      org_id: string;
      compromised: boolean;
    }>(
      `SELECT org_id, compromised
         FROM decision_ledger_total_witness
        WHERE org_id IN ($1, $2)
        ORDER BY org_id`,
      [LEDGER_ORG, LEDGER_OTHER_ORG],
    );
    expect(witnesses.rows).toEqual([
      { org_id: LEDGER_ORG, compromised: true },
      { org_id: LEDGER_OTHER_ORG, compromised: true },
    ]);
  });

  it("recognizes transaction authority across separately evaluated bundles", () => {
    const transaction = {
      [Symbol.for("verin.sql-transaction")]: true,
      async query() { return { rows: [] }; },
      async exec() {},
    };
    expect(isSqlTransaction(transaction)).toBe(true);
  });

  it("L3 detects a promoted exception-trigger link that drifts from the payload", async () => {
    await recordFixture(db);
    const samples = allLedgerEventSamples();
    const stuck = samples.find((event) => event.type === "VerificationStuck")!;
    const exception = samples.find(
      (event) => event.type === "ExceptionDecisionRequested",
    )!;
    await expect(append(db, [stuck, exception])).resolves.toHaveLength(2);
    const promoted = await db.query<{ triggering_entry_id: string | null }>(
      "SELECT triggering_entry_id FROM decision_ledger WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, exception.id],
    );
    expect(promoted.rows[0]?.triggering_entry_id).toBe(stuck.id);

    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET triggering_entry_id = NULL WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, exception.id],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L3");
  });

  it("a windowed verification checks its own entries and their link to the stored predecessor", async () => {
    await recordFixture(db);
    const windowed = await verifyAndListDecisionLedger(db, LEDGER_TENANT, 2);
    expect(windowed.verification.ok).toBe(true);
    expect(windowed.verification.entriesChecked).toBe(2);
    expect(windowed.verification.entriesStored).toBe(5);
    expect(windowed.rows.map((row) => row.sequence)).toEqual([3, 4]);

    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET entry_hash = $2 WHERE org_id = $1 AND sequence = 2",
      [LEDGER_ORG, "f".repeat(64)],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const broken = await verifyAndListDecisionLedger(db, LEDGER_TENANT, 2);
    expect(broken.verification.ok).toBe(false);
    expect(broken.verification.levels.at(-1)).toMatchObject({
      level: "L1",
      reason: "prev_hash does not match preceding entry_hash",
    });
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(false);
  });

  it("structural foreign keys reject cross-tenant causation", async () => {
    await recordFixture(db);
    await seedOrg(db, LEDGER_OTHER_ORG);
    const raw = allLedgerEventSamples().find(
      (event) => event.type === "ReservationCreated",
    )!;
    const event = LedgerEntrySchema.parse({
      ...raw,
      firmId: LEDGER_OTHER_ORG,
      id: "firm-b:event",
      actor: { firmId: LEDGER_OTHER_ORG, systemId: "ledger-test" },
      reservationRef: { firmId: LEDGER_OTHER_ORG, id: "reservation:b" },
      decisionRef: { firmId: LEDGER_OTHER_ORG, id: "decision:b" },
      causationRef: { firmId: LEDGER_OTHER_ORG, id: "ledger:decision:0" },
    });
    const payload = canonicalJson(event as unknown as JsonValue);
    const actor = canonicalJson(event.actor as unknown as JsonValue);
    expect(payload.ok && actor.ok).toBe(true);
    if (!payload.ok || !actor.ok) return;
    const provenance = {
      source: "fixture",
      asOf: event.occurredAt,
      confidence: "high",
    } as const;
    const preimage = decisionLedgerChainPreimage(
      event.schemaVersion,
      event.serializerVersion,
      payload.value,
      provenance,
    );
    expect(preimage).not.toBeNull();
    if (!preimage) return;
    await expect(db.query(
      `INSERT INTO decision_ledger
        (org_id,id,sequence,event_type,schema_version,serializer_version,
         occurred_at,recorded_at,actor_json,correlation_id,causation_id,
         decision_id,evidence_snapshot_id,triggering_entry_id,payload_json,
         prev_hash,entry_hash,prov_source,prov_asof,prov_confidence)
       VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,NULL,NULL,NULL,$11,$12,$13,
               'fixture',$6,'high')`,
      [
        LEDGER_OTHER_ORG, event.id, event.type, event.schemaVersion,
        event.serializerVersion, event.occurredAt, event.recordedAt, actor.value,
        event.correlationId, event.causationRef?.id, payload.value, GENESIS_HASH,
        computeChainHash(preimage, GENESIS_HASH),
      ],
    )).rejects.toThrow(/foreign key/i);
    await expect(db.query(
      `INSERT INTO decision_input_bundle_evidence
        (org_id,bundle_id,evidence_snapshot_id,ordinal)
       VALUES ($1,$2,$3,0)`,
      [
        LEDGER_OTHER_ORG,
        "bundle:GC-01:0001",
        "evs:GC-01:balance",
      ],
    )).rejects.toThrow(/foreign key|constraint/i);
  });

  it("orders appended events by input sequence, independent of recorded timestamps", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const laterFirst = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "ordered:first",
      recordedAt: LEDGER_LATER,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const earlierSecond = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "ordered:second",
      recordedAt: TS,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const result = await append(db, [laterFirst, earlierSecond]);
    expect(result.map((entry) => [entry.id, entry.sequence])).toEqual([
      ["ordered:first", 5],
      ["ordered:second", 6],
    ]);
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
  });

  it("requires causation and exception triggers to precede the citing event", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const later = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "causal:later",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const forwardCause = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "causal:forward",
      priorDecisionHash: input.decisionRecord.decisionHash,
      causationRef: { firmId: LEDGER_ORG, id: later.id },
    });
    await expect(append(db, [forwardCause, later])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });

    const exception = LedgerEntrySchema.parse({
      ...samples.find(
        (event) => event.type === "ExceptionDecisionRequested",
      )!,
      id: "trigger:forward",
      triggeringEntryRef: { firmId: LEDGER_ORG, id: later.id },
    });
    await expect(append(db, [exception, later])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(5);
  });

  it("rejects event references that the immutable decision does not authorize", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalRecorded",
    )!;
    const invalid = LedgerEntrySchema.parse({
      ...sample,
      id: "ledger:approval:missing-stage",
      stageId: "stage:1",
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
    });
    await expect(append(db, [invalid])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("requires an eligible approver role while preserving additional role attribution", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalRecorded",
    )!;
    if (sample.type !== "ApprovalRecorded") {
      throw new Error("expected approval fixture");
    }
    const base = {
      ...sample,
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
    };
    const roleless = LedgerEntrySchema.parse({
      ...base,
      id: "ledger:approval:roleless",
      approver: { ...sample.approver, roleIds: [] },
    });
    await expect(append(db, [roleless])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });

    const attributed = LedgerEntrySchema.parse({
      ...base,
      id: "ledger:approval:additional-role",
      approver: {
        ...sample.approver,
        roleIds: [
          ...sample.approver.roleIds,
          { firmId: LEDGER_ORG, id: "client-service" },
        ],
      },
    });
    await expect(append(db, [attributed])).resolves.toHaveLength(1);
  });

  it("rejects unauthorized execution, verification, reservation, and trigger references", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const invalidEvents = [
      LedgerEntrySchema.parse({
        ...samples.find((event) => event.type === "ExecutionStarted")!,
        id: "ledger:execution:missing-step",
        stepId: "step:missing",
      }),
      LedgerEntrySchema.parse({
        ...samples.find((event) => event.type === "VerificationClosed")!,
        id: "ledger:verification:missing-rule",
        verificationRuleRef: {
          firmId: LEDGER_ORG,
          id: "verification:missing",
        },
      }),
      LedgerEntrySchema.parse({
        ...samples.find((event) => event.type === "ReservationCreated")!,
        id: "ledger:reservation:missing-plan",
        reservationRef: {
          firmId: LEDGER_ORG,
          id: "reservation:missing",
        },
      }),
    ];
    for (const event of invalidEvents) {
      await expect(append(db, [event])).rejects.toMatchObject({
        code: "STORE_CONSTRAINT",
      });
    }
    const ineligible = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "ledger:trigger:ineligible",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(append(db, [ineligible])).resolves.toHaveLength(1);
    const exception = LedgerEntrySchema.parse({
      ...samples.find(
        (event) => event.type === "ExceptionDecisionRequested",
      )!,
      id: "ledger:exception:ineligible-trigger",
      triggeringEntryRef: {
        firmId: LEDGER_ORG,
        id: ineligible.id,
      },
    });
    await expect(append(db, [exception])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    expect((await recordDecision(db, LEDGER_TENANT, second)).ok).toBe(true);
    const crossDecision = LedgerEntrySchema.parse({
      ...ineligible,
      id: "ledger:causal:cross-decision",
      decisionRef: {
        firmId: LEDGER_ORG,
        id: second.decisionRecord.id,
      },
      priorDecisionHash: second.decisionRecord.decisionHash,
      causationRef: {
        firmId: LEDGER_ORG,
        id: ineligible.id,
      },
    });
    await expect(append(db, [crossDecision])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("whole-ledger verification and rebuild reject a valid chain with invalid decision subreferences", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalRecorded",
    )!;
    const invalid = LedgerEntrySchema.parse({
      ...sample,
      id: "ledger:approval:forged-stage",
      stageId: "forged-stage",
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
    });
    await insertRawDecisionEvent(db, invalid);
    const register = await readVerifiedDecisionRegister(
      db,
      LEDGER_TENANT,
      200,
      50,
    );
    expect(register.verification.ok).toBe(false);
    expect(register.decisions).toEqual([]);
    expect(register.replaySourceReason).toBe(
      "ledger event references an unauthorized approval stage",
    );
    const verified = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(verified.ok).toBe(false);
    expect(verified.replaySourceReason).toBe(
      "ledger event references an unauthorized approval stage",
    );
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT))
      .rejects.toMatchObject({ code: "STORE_CONSTRAINT" });
  });

  it("rejects decision events recorded before their decision initialization", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalRecorded",
    )!;
    const approval = LedgerEntrySchema.parse({
      ...sample,
      id: "ledger:approval:before-decision",
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
    });
    await insertRawDecisionEvent(db, approval);
    await moveLastEntryBeforeDecisionRecording(db);

    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
    const register = await readVerifiedDecisionRegister(
      db,
      LEDGER_TENANT,
      200,
      50,
    );
    expect(register.verification.ok).toBe(false);
    expect(register.decisions).toEqual([]);
    expect(register.replaySourceReason).toBe(
      "decision-scoped ledger event must follow DecisionRecorded",
    );
    const integrity = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(integrity.ok).toBe(false);
    expect(integrity.replaySourceReason).toBe(
      "decision-scoped ledger event must follow DecisionRecorded",
    );
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT))
      .rejects.toMatchObject({ code: "STORE_CONSTRAINT" });
  });

  it("whole-ledger verification rejects competing active reservation generations", async () => {
    const first = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, first)).ok).toBe(true);
    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    expect((await recordDecision(db, LEDGER_TENANT, second)).ok).toBe(true);
    const created = allLedgerEventSamples().find(
      (event) => event.type === "ReservationCreated",
    )!;
    await expect(append(db, [created])).resolves.toHaveLength(1);
    const competing = LedgerEntrySchema.parse({
      ...created,
      id: "ledger:reservation:forged-conflict",
      decisionRef: { firmId: LEDGER_ORG, id: second.decisionRecord.id },
    });
    await insertRawDecisionEvent(db, competing);

    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
    const integrity = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(integrity.ok).toBe(false);
    expect(integrity.replaySourceReason).toMatch(
      /reservation already has an active generation/,
    );
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT))
      .rejects.toMatchObject({ code: "STORE_CONSTRAINT" });
  });

  it.each([
    [
      "mismatched approval hash",
      (input: ReturnType<typeof decisionRecordingInput>) =>
        LedgerEntrySchema.parse({
          ...allLedgerEventSamples().find(
            (event) => event.type === "ApprovalRecorded",
          )!,
          id: "ledger:forged:approval-hash",
          decisionHash: "f".repeat(64),
          inputBundleHash: input.inputBundle.bundleHash,
        }),
      "ledger event decision hash does not match immutable record",
    ],
    [
      "status evidence cited before recording",
      () => LedgerEntrySchema.parse({
        ...allLedgerEventSamples().find(
          (event) => event.type === "StatusObserved",
        )!,
        id: "ledger:forged:status-order",
      }),
      "status evidence must be recorded before it is cited",
    ],
    [
      "duplicate decision recording",
      (input: ReturnType<typeof decisionRecordingInput>) =>
        LedgerEntrySchema.parse({
          ...input.events.at(-1)!,
          id: "ledger:forged:duplicate-decision",
        }),
      "decision may be recorded only once",
    ],
  ])("whole-ledger verification rejects a valid chain with %s", async (
    _case,
    buildEvent,
    reason,
  ) => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const event = buildEvent(input);
    if (event.type === "StatusObserved" && event.evidenceSnapshotRef) {
      await insertRawEvidenceSnapshot(
        db,
        laterEvidenceRecording(event.evidenceSnapshotRef.id).snapshot,
      );
    }
    await insertRawDecisionEvent(db, event);
    const verified = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(verified.ok).toBe(false);
    expect(verified.replaySourceReason).toBe(reason);
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT))
      .rejects.toMatchObject({ code: "STORE_CONSTRAINT" });
  });

  it("rejects PII in ledger text without rewriting the submitted bytes", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const approval = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalRecorded")!,
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
      structuredReason: "Reviewed by analyst@firm.test.",
    });
    await expect(append(db, [approval])).rejects.toMatchObject({
      code: "PII_VIOLATION",
    });

    const unsafeStatus = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ExecutionFailed")!,
      sourceStatus: "forwarded by analyst@firm.test",
    });
    await expect(append(db, [unsafeStatus])).rejects.toMatchObject({
      code: "PII_VIOLATION",
    });
    const unformattedAccount = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ExecutionFailed")!,
      sourceStatus: "123456789012",
    });
    await expect(append(db, [unformattedAccount])).rejects.toMatchObject({
      code: "PII_VIOLATION",
    });
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(5);
  });

  it("requires every ledger reason and failure code to be registered or opaque", async () => {
    const coded = allLedgerEventSamples().filter(
      (event) => "reasonCode" in event || "failureCode" in event,
    );
    expect(coded.length).toBeGreaterThan(0);
    for (const event of coded) {
      const key = "reasonCode" in event ? "reasonCode" : "failureCode";
      const unsafe = LedgerEntrySchema.parse({
        ...event,
        [key]: "unregistered-ledger-code",
      });
      await expect(append(db, [unsafe])).rejects.toMatchObject({
        code: "PII_VIOLATION",
      });
    }
    expect(await listDecisionLedger(db, LEDGER_TENANT)).toHaveLength(0);

    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const expired = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageExpired",
    )!;
    const opaque = LedgerEntrySchema.parse({
      ...expired,
      priorDecisionHash: input.decisionRecord.decisionHash,
      reasonCode: retainedTextReference("2".repeat(64)),
    });
    await expect(append(db, [opaque])).resolves.toHaveLength(1);
  });

  it("classifies every immutable string path and rejects unclassified growth", () => {
    const input = decisionRecordingInput();
    input.evidenceSnapshots.forEach((snapshot) =>
      assertReplaySourcePiiBoundary("evidence", snapshot));
    assertReplaySourcePiiBoundary("bundle", input.inputBundle);
    assertReplaySourcePiiBoundary("decision", input.decisionRecord);
    retainedDecisionSourceFixtures().forEach((record) =>
      assertReplaySourcePiiBoundary("decision", record));
    allLedgerEventSamples().forEach(assertLedgerEventPiiBoundary);
    expect(input.decisionRecord.result.kind).toBe("proceed");
    if (input.decisionRecord.result.kind !== "proceed") return;
    const authority = input.decisionRecord.result.authority;
    if (authority.mode === "automatic") throw new Error("expected staged authority");
    const optionalPaths = DecisionRecordSchema.parse({
      ...input.decisionRecord,
      createdBy: {
        firmId: LEDGER_ORG,
        actorId: "actor:2",
        roleIds: authority.stages[0]!.requirements[0]!.eligibleRoleIds,
      },
      derivedFromDecisionRef: {
        firmId: LEDGER_ORG,
        id: "dec:prior:optional-paths",
      },
      reevaluateWhen: [{
        kind: "deadline_reached",
        deadline: LEDGER_LATER,
      }],
      result: {
        ...input.decisionRecord.result,
        authority: {
          mode: "specialist_review",
          specialistRoleIds:
            authority.stages[0]!.requirements[0]!.eligibleRoleIds,
          stages: authority.stages,
        },
        executionPlan: {
          ...input.decisionRecord.result.executionPlan,
          steps: input.decisionRecord.result.executionPlan.steps.map(
            (step, index) => index === 0
              ? {
                  ...step,
                  compensatingAction: {
                    targetRef: step.targetRef,
                    command: step.command,
                    idempotencyKey: `${step.idempotencyKey}:compensate`,
                    conflictKeys: step.conflictKeys,
                    reservationRefs: step.reservationRefs,
                    preconditions: step.preconditions,
                    verificationRuleRef: step.verificationRuleRef,
                    reasonCode: "decision-closed",
                  },
                }
              : step,
          ),
        },
      },
    });
    assertReplaySourcePiiBoundary("decision", optionalPaths);
    assertLedgerEventPiiBoundary(LedgerEntrySchema.parse({
      ...allLedgerEventSamples()[0]!,
      id: "event:optional-paths",
      actor: {
        firmId: LEDGER_ORG,
        actorId: "actor:2",
        roleIds: authority.stages[0]!.requirements[0]!.eligibleRoleIds,
      },
      causationRef: { firmId: LEDGER_ORG, id: "event:prior" },
    }));
    expect(() => assertLedgerEventPiiBoundary({
      ...allLedgerEventSamples()[0]!,
      futureContainer: { id: "future-id" },
    } as never)).toThrowError(/unclassified retained text/);
  });

  it.each([
    ["system actor", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      actor: { firmId: LEDGER_ORG, systemId: "Robert Smith" },
    })],
    ["correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "Robert Smith",
    })],
    ["email correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "victim@example.com",
    })],
    ["hyphenated-name correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "Alice-Smith",
    })],
    ["lowercase actor", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      actor: {
        firmId: LEDGER_ORG,
        actorId: "robert-smith",
        roleIds: [],
      },
    })],
    ["namespaced lowercase actor", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      actor: {
        firmId: LEDGER_ORG,
        actorId: "actor:robert-smith",
        roleIds: [],
      },
    })],
    ["suffixed lowercase actor", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      actor: {
        firmId: LEDGER_ORG,
        actorId: "actor:robert-smith:1",
        roleIds: [],
      },
    })],
    ["lowercase correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "john",
    })],
    ["namespaced lowercase correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "corr:john",
    })],
    ["account correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "123456789012",
    })],
    ["namespaced numeric correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "corr:123456789012",
    })],
    ["namespaced numeric actor", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      actor: {
        firmId: LEDGER_ORG,
        actorId: "actor:123456789012",
        roleIds: [],
      },
    })],
    ["prefixed account correlation", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      correlationId: "account:123456789012",
    })],
    ["email actor", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      actor: { firmId: LEDGER_ORG, systemId: "victim@example.com" },
    })],
    ["hyphenated-name reference", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      decisionRef: { firmId: LEDGER_ORG, id: "Alice-Smith" },
    })],
    ["lowercase reference", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      decisionRef: { firmId: LEDGER_ORG, id: "robert-smith" },
    })],
    ["namespaced lowercase reference", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      decisionRef: { firmId: LEDGER_ORG, id: "subject:robert-smith" },
    })],
    ["namespaced numeric reference", "DecisionRecorded", (event: Record<string, unknown>) => ({
      ...event,
      decisionRef: { firmId: LEDGER_ORG, id: "decision:123456789012" },
    })],
    ["approval stage", "ApprovalRecorded", (event: Record<string, unknown>) => ({
      ...event,
      stageId: "Robert Smith",
    })],
    ["idempotency key", "ExecutionStarted", (event: Record<string, unknown>) => ({
      ...event,
      idempotencyKey: "Robert Smith",
    })],
    [
      "execution part",
      "ExecutionPartiallySucceeded",
      (event: Record<string, unknown>) => ({
        ...event,
        completedParts: ["Robert Smith"],
      }),
    ],
  ] as const)(
    "rejects a plain name retained as %s",
    (_name, type, mutate) => {
      const sample = allLedgerEventSamples().find(
        (event) => event.type === type,
      )!;
      const event = LedgerEntrySchema.parse(
        mutate(sample as unknown as Record<string, unknown>),
      );
      expect(() => assertLedgerEventPiiBoundary(event)).toThrowError(
        /unclassified retained text/,
      );
    },
  );

  it("rejects plain names in replay schema, command, and precondition fields", () => {
    const input = decisionRecordingInput();
    const snapshot = EvidenceSnapshotRefSchema.parse({
      ...input.evidenceSnapshots[0]!,
      schemaVersion: "Robert Smith",
    });
    expect(() =>
      assertReplaySourcePiiBoundary("evidence", snapshot)
    ).toThrowError(/unclassified retained text/);
    expect(input.decisionRecord.result.kind).toBe("proceed");
    if (input.decisionRecord.result.kind !== "proceed") return;
    const step = input.decisionRecord.result.executionPlan.steps[0]!;
    for (const changedStep of [
      {
        ...step,
        command: { ...step.command, commandType: "Robert Smith" },
      },
      {
        ...step,
        command: { ...step.command, commandType: "robert-smith" },
      },
      {
        ...step,
        preconditions: step.preconditions.map((precondition, index) => ({
          ...precondition,
          code: index === 0 ? "Robert Smith" : precondition.code,
        })),
      },
    ]) {
      const record = DecisionRecordSchema.parse({
        ...input.decisionRecord,
        result: {
          ...input.decisionRecord.result,
          executionPlan: {
            ...input.decisionRecord.result.executionPlan,
            steps: [changedStep],
          },
        },
      });
      expect(() =>
        assertReplaySourcePiiBoundary("decision", record)
      ).toThrowError(/unclassified retained text/);
    }
  });

  it("accepts schema-valid time zones and fractional durations at the PII boundary", () => {
    const input = decisionRecordingInput();
    const bundle = DecisionInputBundleSchema.parse({
      ...input.inputBundle,
      timeZone: "Etc/GMT+5",
    });
    expect(() => assertReplaySourcePiiBoundary("bundle", bundle)).not.toThrow();
    expect(input.decisionRecord.result.kind).toBe("proceed");
    if (input.decisionRecord.result.kind !== "proceed") return;
    const authority = input.decisionRecord.result.authority;
    if (authority.mode === "automatic") throw new Error("expected staged authority");
    const decision = DecisionRecordSchema.parse({
      ...input.decisionRecord,
      result: {
        ...input.decisionRecord.result,
        authority: {
          ...authority,
          stages: authority.stages.map((stage, stageIndex) => ({
            ...stage,
            escalationPath: stage.escalationPath.map((step, stepIndex) => ({
              ...step,
              after: stageIndex === 0 && stepIndex === 0
                ? "PT0.5S"
                : step.after,
            })),
          })),
        },
      },
    });
    expect(() => assertReplaySourcePiiBoundary("decision", decision)).not.toThrow();
  });

  it.each([
    {
      name: "authority escalation",
      mutate(record: ReturnType<typeof decisionRecordingInput>["decisionRecord"]) {
        if (record.result.kind !== "proceed") throw new Error("expected proceed decision");
        const authority = record.result.authority;
        if (authority.mode === "automatic") throw new Error("expected staged authority");
        return {
          ...record,
          result: {
            ...record.result,
            authority: {
              ...authority,
              stages: authority.stages.map((stage, stageIndex) => ({
                ...stage,
                escalationPath: stage.escalationPath.map((step, stepIndex) => ({
                  ...step,
                  reasonCode:
                    stageIndex === 0 && stepIndex === 0
                      ? "analyst-at-firm.test"
                      : step.reasonCode,
                })),
              })),
            },
          },
        };
      },
    },
    {
      name: "compensating action",
      mutate(record: ReturnType<typeof decisionRecordingInput>["decisionRecord"]) {
        if (record.result.kind !== "proceed") throw new Error("expected proceed decision");
        return {
          ...record,
          result: {
            ...record.result,
            executionPlan: {
              ...record.result.executionPlan,
              steps: record.result.executionPlan.steps.map((step, index) => ({
                ...step,
                ...(index === 0
                  ? {
                      compensatingAction: {
                        targetRef: step.targetRef,
                        command: step.command,
                        idempotencyKey: `${step.idempotencyKey}:compensate`,
                        conflictKeys: step.conflictKeys,
                        reservationRefs: step.reservationRefs,
                        preconditions: step.preconditions,
                        verificationRuleRef: step.verificationRuleRef,
                        reasonCode: "analyst-at-firm.test",
                      },
                    }
                  : {}),
              })),
            },
          },
        };
      },
    },
  ])("rejects unclassified reason codes in $name records", async ({ mutate }) => {
    const input = decisionRecordingInput();
    const candidate = DecisionRecordSchema.parse({
      ...mutate(input.decisionRecord),
      decisionHash: "0".repeat(64),
    });
    const decisionRecord = DecisionRecordSchema.parse({
      ...candidate,
      decisionHash: hashPreimage(decisionHashPreimage(candidate)),
    });
    const decisionEvent = LedgerEntrySchema.parse({
      ...input.events.at(-1)!,
      decisionHash: decisionRecord.decisionHash,
    });
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...input,
      decisionRecord,
      events: [...input.events.slice(0, -1), decisionEvent],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("PII_VIOLATION");
    expect(result.ok ? "" : result.error.message).not.toContain(
      "analyst-at-firm.test",
    );
    expect(result.ok ? "" : result.error.message).toBe(
      "decision replay source contains prohibited PII",
    );
    expect(await listDecisionLedger(db, LEDGER_TENANT)).toHaveLength(0);
  });

  it("returns an empty append before consulting or mutating a transaction", async () => {
    let consulted = false;
    const inaccessible = new Proxy({} as SqlTx, {
      get() {
        consulted = true;
        throw new Error("empty append consulted its transaction");
      },
      has() {
        consulted = true;
        throw new Error("empty append inspected its transaction");
      },
    });
    await expect(appendDecisionEvents(
      inaccessible,
      LEDGER_TENANT,
      [],
      LEDGER_PROVENANCE,
    )).resolves.toEqual([]);
    expect(consulted).toBe(false);
    expect(await listDecisionLedger(db, LEDGER_TENANT)).toHaveLength(0);
  });

  it("classifies bundle versions by lexical form, so a real release still records", async () => {
    const rebuild = async (engineVersion: string, primitiveSetVersion: string) => {
      const input = decisionRecordingInput();
      const candidate = DecisionInputBundleSchema.parse({
        ...input.inputBundle,
        engineVersion,
        primitiveSetVersion,
        bundleHash: "0".repeat(64),
      });
      const inputBundle = DecisionInputBundleSchema.parse({
        ...candidate,
        bundleHash: hashPreimage(bundleHashPreimage(candidate)),
      });
      return recordDecision(db, LEDGER_TENANT, {
        ...input,
        inputBundle,
        events: [
          ...input.events.slice(0, -1),
          LedgerEntrySchema.parse({
            ...input.events.at(-1)!,
            bundleHash: inputBundle.bundleHash,
          }),
        ],
      });
    };
    // The engine will be versioned past its fixture value; an allowlist of today's
    // values would turn the first real release into a PII_VIOLATION on every append.
    for (const accepted of ["0", "0.0.0", "1.2.3", "2.0.0-rc.1", "10.4.0.1"]) {
      expect(isVersionIdentifier(accepted), accepted).toBe(true);
    }
    for (const rejected of [
      "Zephyrine Okonkwo-Blackwood",
      "engine built by analyst@firm.test",
      "212-555-0142",
      "v1.2.3",
      "1.2.3 (nightly)",
      `1.${"0".repeat(64)}`,
    ]) {
      expect(isVersionIdentifier(rejected), rejected).toBe(false);
    }

    const released = await rebuild("1.2.3", "4");
    expect(released.ok, released.ok ? "" : released.error.message).toBe(true);
    const stored = await db.query<{ engine_version: string }>(
      "SELECT engine_version FROM decision_input_bundles WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(stored.rows[0]?.engine_version).toBe("1.2.3");

    const refused = await rebuild("engine built by analyst@firm.test", "0");
    expect(refused.ok ? null : refused.error.code).toBe("PII_VIOLATION");
  });

  it("refuses PII in every immutable replay source", async () => {
    const snapshotInput = decisionRecordingInput();
    const snapshotResult = await recordDecision(db, LEDGER_TENANT, {
      ...snapshotInput,
      evidenceSnapshots: snapshotInput.evidenceSnapshots.map((snapshot, index) =>
        index === 0
          ? { ...snapshot, attribution: "captured by analyst@firm.test" }
          : snapshot),
    });
    expect(snapshotResult.ok).toBe(false);
    expect(snapshotResult.ok ? null : snapshotResult.error.code).toBe("PII_VIOLATION");

    const bundleInput = decisionRecordingInput();
    const bundleCandidate = DecisionInputBundleSchema.parse({
      ...bundleInput.inputBundle,
      engineVersion: "analyst@firm.test",
      bundleHash: "0".repeat(64),
    });
    const bundle = DecisionInputBundleSchema.parse({
      ...bundleCandidate,
      bundleHash: hashPreimage(bundleHashPreimage(bundleCandidate)),
    });
    const bundleResult = await recordDecision(db, LEDGER_TENANT, {
      ...bundleInput,
      inputBundle: bundle,
    });
    expect(bundleResult.ok).toBe(false);
    expect(bundleResult.ok ? null : bundleResult.error.code).toBe("PII_VIOLATION");

    const recordInput = decisionRecordingInput();
    if (recordInput.decisionRecord.result.kind !== "proceed") {
      throw new Error("expected proceed decision fixture");
    }
    const recordCandidate = DecisionRecordSchema.parse({
      ...recordInput.decisionRecord,
      result: {
        ...recordInput.decisionRecord.result,
        recommendation: {
          ...recordInput.decisionRecord.result.recommendation,
          summary: "reviewed by analyst@firm.test",
        },
      },
      decisionHash: "0".repeat(64),
    });
    const decisionRecord = DecisionRecordSchema.parse({
      ...recordCandidate,
      decisionHash: hashPreimage(decisionHashPreimage(recordCandidate)),
    });
    const decisionEvent = LedgerEntrySchema.parse({
      ...recordInput.events.at(-1)!,
      decisionHash: decisionRecord.decisionHash,
    });
    const recordResult = await recordDecision(db, LEDGER_TENANT, {
      ...recordInput,
      decisionRecord,
      events: [...recordInput.events.slice(0, -1), decisionEvent],
    });
    expect(recordResult.ok).toBe(false);
    expect(recordResult.ok ? null : recordResult.error.code).toBe("PII_VIOLATION");
    expect(await sourceCounts(db)).toEqual({
      evidence_snapshots: 0,
      decision_input_bundles: 0,
      decision_input_bundle_evidence: 0,
      decision_records: 0,
      decision_ledger: 0,
    });
  });

  it.each([
    ["PII-bearing parameter keys", { "victim@example.com": true }],
    ["unregistered numeric parameters", { accountNumber: 123456789012 }],
    ["account-shaped registered amounts", { amountUsd: 123456789012 }],
  ])("refuses %s before immutable insertion", async (_case, parameters) => {
    const input = decisionRecordingInput();
    if (input.decisionRecord.result.kind !== "proceed") {
      throw new Error("expected proceed decision fixture");
    }
    const candidate = DecisionRecordSchema.parse({
      ...input.decisionRecord,
      result: {
        ...input.decisionRecord.result,
        recommendation: {
          ...input.decisionRecord.result.recommendation,
          parameters,
        },
      },
      decisionHash: "0".repeat(64),
    });
    const decisionRecord = DecisionRecordSchema.parse({
      ...candidate,
      decisionHash: hashPreimage(decisionHashPreimage(candidate)),
    });
    const decisionEvent = LedgerEntrySchema.parse({
      ...input.events.at(-1)!,
      decisionHash: decisionRecord.decisionHash,
    });
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...input,
      decisionRecord,
      events: [...input.events.slice(0, -1), decisionEvent],
    });
    expect(result.ok ? null : result.error.code).toBe("PII_VIOLATION");
    expect(await sourceCounts(db)).toEqual({
      evidence_snapshots: 0,
      decision_input_bundles: 0,
      decision_input_bundle_evidence: 0,
      decision_records: 0,
      decision_ledger: 0,
    });
  });

  it("rejects decision citations that are not pinned by the exact input bundle", async () => {
    const cases = [
      (record: ReturnType<typeof decisionRecordingInput>["decisionRecord"]) => {
        if (record.result.kind !== "proceed") throw new Error("expected proceed");
        return {
          ...record,
          result: {
            ...record.result,
            executionPlan: {
              ...record.result.executionPlan,
              steps: record.result.executionPlan.steps.map((step, index) => ({
                ...step,
                preconditions: step.preconditions.map((precondition) => ({
                  ...precondition,
                  requiredEvidenceSnapshotRefs: index === 0
                    ? [{
                        firmId: LEDGER_ORG,
                        id: "evidence:not-in-bundle",
                      }]
                    : precondition.requiredEvidenceSnapshotRefs,
                })),
              })),
            },
          },
        };
      },
      (record: ReturnType<typeof decisionRecordingInput>["decisionRecord"]) => ({
        ...record,
        precedenceTrace: record.precedenceTrace.map((step, index) => index === 0
          ? {
              ...step,
              left: {
                ...step.left,
                versionRef: {
                  firmId: LEDGER_ORG,
                  id: "policy:not-in-bundle",
                },
              },
            }
          : step),
      }),
      (record: ReturnType<typeof decisionRecordingInput>["decisionRecord"]) => ({
        ...record,
        precedenceTrace: record.precedenceTrace.map((step, index) => index === 0
          ? {
              ...step,
              right: {
                ...step.right,
                versionRef: {
                  firmId: LEDGER_ORG,
                  id: "instruction:not-in-bundle",
                },
              },
            }
          : step),
      }),
    ];

    for (const mutate of cases) {
      const input = decisionRecordingInput();
      const candidate = DecisionRecordSchema.parse({
        ...mutate(input.decisionRecord),
        decisionHash: "0".repeat(64),
      });
      const decisionRecord = DecisionRecordSchema.parse({
        ...candidate,
        decisionHash: hashPreimage(decisionHashPreimage(candidate)),
      });
      const decisionEvent = LedgerEntrySchema.parse({
        ...input.events.at(-1)!,
        decisionHash: decisionRecord.decisionHash,
      });
      const result = await recordDecision(db, LEDGER_TENANT, {
        ...input,
        decisionRecord,
        events: [...input.events.slice(0, -1), decisionEvent],
      });
      expect(result.ok).toBe(false);
      expect(result.ok ? null : result.error.code).toBe("VALIDATION");
    }
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toEqual([]);
  });

  it("binds every regulatory citation to the exact immutable bundle", async () => {
    const regulatory = {
      sourceType: "regulatory" as const,
      sourceRef: {
        firmId: LEDGER_ORG,
        id: "reg-distribution-holds",
      },
      versionRef: {
        firmId: LEDGER_ORG,
        id: "reg-distribution-holds@2026.02",
      },
    };
    const build = (
      input: ReturnType<typeof decisionRecordingInput>,
      pinnedVersion: string | null,
      placements: readonly (
        "result" | "precedence" | "explanation-root" | "explanation-child"
      )[] = [
        "result",
        "precedence",
        "explanation-root",
        "explanation-child",
      ],
    ) => {
      const candidate = DecisionRecordSchema.parse({
        ...input.decisionRecord,
        result: placements.includes("result")
          ? {
              kind: "prohibited",
              prohibition: {
                source: regulatory,
                scopeRef: {
                  firmId: LEDGER_ORG,
                  id: "scope:demo:1",
                },
                reasonCode: "active-legal-hold",
                explanation: "active-legal-hold",
              },
            }
          : input.decisionRecord.result,
        precedenceTrace: input.decisionRecord.precedenceTrace.map(
          (step, index) =>
            placements.includes("precedence") && index === 0
              ? { ...step, left: regulatory }
              : step,
        ),
        explanationTrace: input.decisionRecord.explanationTrace.map(
          (node, index) =>
            index === 0
              ? {
                  ...node,
                  sourceRefs: placements.includes("explanation-root")
                    ? [...node.sourceRefs, regulatory]
                    : node.sourceRefs,
                  childNodes: node.childNodes.map((child, childIndex) =>
                    placements.includes("explanation-child") &&
                      childIndex === 0
                      ? {
                          ...child,
                          sourceRefs: [...child.sourceRefs, regulatory],
                        }
                      : child),
                }
              : node,
        ),
        reevaluateWhen: placements.includes("result")
          ? []
          : input.decisionRecord.reevaluateWhen,
        decisionHash: "0".repeat(64),
      });
      const decisionRecord = DecisionRecordSchema.parse({
        ...candidate,
        decisionHash: hashPreimage(decisionHashPreimage(candidate)),
      });
      const bundleCandidate = DecisionInputBundleSchema.parse({
        ...input.inputBundle,
        regulatoryVersionRefs: pinnedVersion === null
          ? []
          : [{
              firmId: LEDGER_ORG,
              id: pinnedVersion,
            }],
        bundleHash: "0".repeat(64),
      });
      const inputBundle = DecisionInputBundleSchema.parse({
        ...bundleCandidate,
        bundleHash: hashPreimage(bundleHashPreimage(bundleCandidate)),
      });
      return {
        ...input,
        inputBundle,
        decisionRecord,
        events: [
          ...input.events.slice(0, -1),
          LedgerEntrySchema.parse({
            ...input.events.at(-1)!,
            decisionHash: decisionRecord.decisionHash,
            bundleHash: inputBundle.bundleHash,
          }),
        ],
      };
    };

    const input = decisionRecordingInput();
    const { regulatoryVersionRefs: _removed, ...withoutRegulatoryPins } =
      input.inputBundle;
    expect(_removed).toEqual([]);
    expect(
      DecisionInputBundleSchema.safeParse(withoutRegulatoryPins).success,
    ).toBe(false);
    expect(DecisionInputBundleSchema.safeParse({
      ...input.inputBundle,
      regulatoryVersionRefs: [
        regulatory.versionRef,
        regulatory.versionRef,
      ],
    }).success).toBe(false);
    expect(DecisionInputBundleSchema.safeParse({
      ...input.inputBundle,
      regulatoryVersionRefs: [{
        ...regulatory.versionRef,
        firmId: LEDGER_OTHER_ORG,
      }],
    }).success).toBe(false);

    for (const placement of [
      "result",
      "precedence",
      "explanation-root",
      "explanation-child",
    ] as const) {
      const absent = await recordDecision(
        db,
        LEDGER_TENANT,
        build(input, null, [placement]),
      );
      expect(absent.ok, placement).toBe(false);
      expect(absent.ok ? null : absent.error.code).toBe("VALIDATION");
    }
    const mismatched = await recordDecision(
      db,
      LEDGER_TENANT,
      build(input, "reg-distribution-holds@2026.03"),
    );
    expect(mismatched.ok).toBe(false);
    expect(mismatched.ok ? null : mismatched.error.code).toBe("VALIDATION");
    const accepted = await recordDecision(
      db,
      LEDGER_TENANT,
      build(input, regulatory.versionRef.id),
    );
    expect(accepted.ok, accepted.ok ? "" : accepted.error.message).toBe(true);
  });

  it("rejects retained replay citations that its upcast bundle does not pin", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const regulatory = {
      sourceType: "regulatory" as const,
      sourceRef: {
        firmId: LEDGER_ORG,
        id: "reg-distribution-holds",
      },
      versionRef: {
        firmId: LEDGER_ORG,
        id: "reg-distribution-holds@2026.02",
      },
    };
    const recordCandidate = DecisionRecordV1_7_0Schema.parse({
      ...input.decisionRecord,
      explanationTrace: input.decisionRecord.explanationTrace.map(
        (node, index) => index === 0
          ? { ...node, sourceRefs: [...node.sourceRefs, regulatory] }
          : node,
      ),
      decisionHash: "0".repeat(64),
    });
    const decisionRecord = DecisionRecordV1_7_0Schema.parse({
      ...recordCandidate,
      decisionHash: hashPreimageV1_7_0(
        decisionHashPreimageV1_7_0(recordCandidate),
      ),
    });
    const {
      regulatoryVersionRefs: _regulatoryVersionRefs,
      ...bundleWithoutRegulatoryPins
    } = input.inputBundle;
    expect(_regulatoryVersionRefs).toEqual([]);
    const bundleCandidate = DecisionInputBundleV1_7_0Schema.parse({
      ...bundleWithoutRegulatoryPins,
      schemaVersion: "1.7.0",
      bundleHash: "0".repeat(64),
    });
    const inputBundle = DecisionInputBundleV1_7_0Schema.parse({
      ...bundleCandidate,
      bundleHash: hashPreimageV1_7_0(
        bundleHashPreimageV1_7_0(bundleCandidate),
      ),
    });
    const decisionEvent = LedgerEntrySchema.parse({
      ...input.events.at(-1)!,
      decisionHash: decisionRecord.decisionHash,
      bundleHash: inputBundle.bundleHash,
    });
    const recordBytes = canonicalJsonV1_0_0(
      decisionRecord as unknown as JsonValueV1_7_0,
    );
    const bundleBytes = canonicalJsonV1_0_0(
      inputBundle as unknown as JsonValueV1_7_0,
    );
    const eventBytes = canonicalJson(
      decisionEvent as unknown as JsonValue,
    );
    expect(recordBytes.ok && bundleBytes.ok && eventBytes.ok).toBe(true);
    if (!recordBytes.ok || !bundleBytes.ok || !eventBytes.ok) return;
    const row = await db.query<{
      prev_hash: string;
      schema_version: string;
      serializer_version: string;
      prov_source: string;
      prov_asof: string;
      prov_confidence: string;
    }>(
      `SELECT prev_hash, schema_version, serializer_version,
              prov_source, prov_asof, prov_confidence
         FROM decision_ledger
        WHERE org_id = $1 AND decision_id = $2`,
      [LEDGER_ORG, input.decisionRecord.id],
    );
    const preimage = decisionLedgerChainPreimage(
      row.rows[0]!.schema_version,
      row.rows[0]!.serializer_version,
      eventBytes.value,
      {
        source: row.rows[0]!.prov_source as "fixture",
        asOf: row.rows[0]!.prov_asof,
        confidence: row.rows[0]!.prov_confidence as "high",
      },
    );
    expect(preimage).not.toBeNull();
    if (!preimage) return;
    const entryHash = computeChainHash(preimage, row.rows[0]!.prev_hash);
    await db.exec(
      "ALTER TABLE decision_input_bundles DISABLE TRIGGER decision_input_bundles_no_update",
    );
    await db.exec(
      "ALTER TABLE decision_records DISABLE TRIGGER decision_records_no_update",
    );
    await db.exec(
      "ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update",
    );
    await db.query(
      `UPDATE decision_input_bundles
          SET canonical_json = $3, schema_version = '1.7.0', bundle_hash = $4
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, inputBundle.id, bundleBytes.value, inputBundle.bundleHash],
    );
    await db.query(
      `UPDATE decision_records
          SET canonical_json = $3, schema_version = '1.7.0', decision_hash = $4
        WHERE org_id = $1 AND id = $2`,
      [
        LEDGER_ORG,
        decisionRecord.id,
        recordBytes.value,
        decisionRecord.decisionHash,
      ],
    );
    await db.query(
      `UPDATE decision_ledger
          SET payload_json = $3, entry_hash = $4
        WHERE org_id = $1 AND decision_id = $2`,
      [LEDGER_ORG, decisionRecord.id, eventBytes.value, entryHash],
    );
    await db.query(
      "UPDATE decision_ledger_anchor SET head_hash = $2 WHERE org_id = $1",
      [LEDGER_ORG, entryHash],
    );
    await db.query(
      "UPDATE decision_ledger_total_witness SET compromised = false WHERE org_id = $1",
      [LEDGER_ORG],
    );
    await db.exec(
      "ALTER TABLE decision_input_bundles ENABLE TRIGGER decision_input_bundles_no_update",
    );
    await db.exec(
      "ALTER TABLE decision_records ENABLE TRIGGER decision_records_no_update",
    );
    await db.exec(
      "ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update",
    );

    const verified = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(verified.ok).toBe(false);
    expect(verified.replaySourceReason).toBe(
      "decision replay source binding differs during replay",
    );
  });

  it("refuses retained names and unformatted account numbers without rewriting bytes", async () => {
    const input = decisionRecordingInput();
    const snapshot = {
      ...input.evidenceSnapshots[0]!,
      attribution: "Robert Smith account 123456789012",
    };
    const evidenceEvent = LedgerEntrySchema.parse({
      ...input.events[0]!,
      snapshotHash: hashPreimage(snapshot),
    });
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...input,
      evidenceSnapshots: [snapshot, ...input.evidenceSnapshots.slice(1)],
      events: [evidenceEvent, ...input.events.slice(1)],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("PII_VIOLATION");
    expect(await sourceCounts(db)).toEqual({
      evidence_snapshots: 0,
      decision_input_bundles: 0,
      decision_input_bundle_evidence: 0,
      decision_records: 0,
      decision_ledger: 0,
    });
  });

  it("refuses duplicated names disguised as source and decision codes", async () => {
    const evidenceInput = decisionRecordingInput();
    const snapshot = {
      ...evidenceInput.evidenceSnapshots[0]!,
      sourceRef: {
        ...evidenceInput.evidenceSnapshots[0]!.sourceRef,
        id: "robert-smith",
      },
      attribution: "robert-smith",
    };
    const evidenceEvent = LedgerEntrySchema.parse({
      ...evidenceInput.events[0]!,
      snapshotHash: hashPreimage(snapshot),
    });
    const evidenceResult = await recordDecision(db, LEDGER_TENANT, {
      ...evidenceInput,
      evidenceSnapshots: [
        snapshot,
        ...evidenceInput.evidenceSnapshots.slice(1),
      ],
      events: [evidenceEvent, ...evidenceInput.events.slice(1)],
    });
    expect(evidenceResult.ok).toBe(false);
    expect(evidenceResult.ok ? null : evidenceResult.error.code).toBe(
      "PII_VIOLATION",
    );

    const decisionInput = decisionRecordingInput();
    if (decisionInput.decisionRecord.result.kind !== "proceed") {
      throw new Error("expected proceed decision fixture");
    }
    const candidate = DecisionRecordSchema.parse({
      ...decisionInput.decisionRecord,
      result: {
        ...decisionInput.decisionRecord.result,
        recommendation: {
          ...decisionInput.decisionRecord.result.recommendation,
          code: "robert-smith",
          summary: "robert-smith",
        },
      },
      decisionHash: "0".repeat(64),
    });
    const decisionRecord = DecisionRecordSchema.parse({
      ...candidate,
      decisionHash: hashPreimage(decisionHashPreimage(candidate)),
    });
    const decisionEvent = LedgerEntrySchema.parse({
      ...decisionInput.events.at(-1)!,
      decisionHash: decisionRecord.decisionHash,
    });
    const decisionResult = await recordDecision(db, LEDGER_TENANT, {
      ...decisionInput,
      decisionRecord,
      events: [
        ...decisionInput.events.slice(0, -1),
        decisionEvent,
      ],
    });
    expect(decisionResult.ok).toBe(false);
    expect(decisionResult.ok ? null : decisionResult.error.code).toBe(
      "PII_VIOLATION",
    );
  });

  it("refuses a replay bundle whose recomputed hash is not bound by its decision event", async () => {
    await recordFixture(db);
    const stored = await db.query<{ canonical_json: string }>(
      `SELECT canonical_json
         FROM decision_input_bundles
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, "bundle:GC-01:0001"],
    );
    const original = DecisionInputBundleSchema.parse(
      JSON.parse(stored.rows[0]!.canonical_json),
    );
    const candidate = DecisionInputBundleSchema.parse({
      ...original,
      asOf: LEDGER_LATER,
      bundleHash: "0".repeat(64),
    });
    const changed = DecisionInputBundleSchema.parse({
      ...candidate,
      bundleHash: hashPreimage(bundleHashPreimage(candidate)),
    });
    const bytes = canonicalJson(changed as unknown as JsonValue);
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;
    await db.exec(
      "ALTER TABLE decision_input_bundles DISABLE TRIGGER decision_input_bundles_no_update",
    );
    await db.query(
      `UPDATE decision_input_bundles
          SET canonical_json = $3,
              bundle_hash = $4
        WHERE org_id = $1 AND id = $2`,
      [
        LEDGER_ORG,
        original.id,
        bytes.value,
        changed.bundleHash,
      ],
    );
    await db.exec(
      "ALTER TABLE decision_input_bundles ENABLE TRIGGER decision_input_bundles_no_update",
    );
    expect((await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT)).ok).toBe(
      false,
    );
  });

  it("refuses replay after immutable decision bytes are changed", async () => {
    await recordFixture(db);
    const stored = await db.query<{ canonical_json: string }>(
      "SELECT canonical_json FROM decision_records WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "dec:GC-01:0001"],
    );
    const record = JSON.parse(stored.rows[0]!.canonical_json) as Record<string, unknown>;
    record.result = {
      kind: "prohibited",
      prohibition: {
        source: {
          sourceType: "firm_policy",
          sourceRef: { firmId: LEDGER_ORG, id: "policy:tampered" },
          versionRef: { firmId: LEDGER_ORG, id: "policy:tampered@1" },
        },
        scopeRef: { firmId: LEDGER_ORG, id: "scope:tampered" },
        reasonCode: "tampered-disposition",
        explanation: "A trigger-bypassing edit changed the stored disposition.",
      },
    };
    record.reevaluateWhen = [];
    const canonical = canonicalJson(record as JsonValue);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    await db.exec("ALTER TABLE decision_records DISABLE TRIGGER decision_records_no_update");
    await db.query(
      "UPDATE decision_records SET canonical_json = $3 WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "dec:GC-01:0001", canonical.value],
    );
    await db.exec("ALTER TABLE decision_records ENABLE TRIGGER decision_records_no_update");
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT)).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("refuses replay after immutable bundle bytes are changed", async () => {
    await recordFixture(db);
    const stored = await db.query<{ canonical_json: string }>(
      "SELECT canonical_json FROM decision_input_bundles WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "bundle:GC-01:0001"],
    );
    const bundle = JSON.parse(stored.rows[0]!.canonical_json) as Record<string, unknown>;
    bundle.engineVersion = "tampered-engine";
    const canonical = canonicalJson(bundle as JsonValue);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    await db.exec("ALTER TABLE decision_input_bundles DISABLE TRIGGER decision_input_bundles_no_update");
    await db.query(
      "UPDATE decision_input_bundles SET canonical_json = $3 WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "bundle:GC-01:0001", canonical.value],
    );
    await db.exec("ALTER TABLE decision_input_bundles ENABLE TRIGGER decision_input_bundles_no_update");
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT)).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("refuses replay after immutable evidence bytes are changed", async () => {
    await recordFixture(db);
    const stored = await db.query<{ canonical_json: string }>(
      "SELECT canonical_json FROM evidence_snapshots WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "evs:GC-01:balance"],
    );
    const snapshot = JSON.parse(stored.rows[0]!.canonical_json) as Record<string, unknown>;
    snapshot.attribution = "tampered attribution";
    const canonical = canonicalJson(snapshot as JsonValue);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    await db.exec("ALTER TABLE evidence_snapshots DISABLE TRIGGER evidence_snapshots_no_update");
    await db.query(
      "UPDATE evidence_snapshots SET canonical_json = $3 WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "evs:GC-01:balance", canonical.value],
    );
    await db.exec("ALTER TABLE evidence_snapshots ENABLE TRIGGER evidence_snapshots_no_update");
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT)).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("integrity verification dispatches immutable sources by recorded version", async () => {
    await recordFixture(db);
    const intact = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(intact.ok).toBe(true);
    expect(intact.replaySourcesChecked).toBe(10);

    await db.exec(
      "ALTER TABLE evidence_snapshots DISABLE TRIGGER evidence_snapshots_no_update",
    );
    await db.query(
      `UPDATE evidence_snapshots
          SET contract_schema_version = '9.0.0'
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, "evs:GC-01:balance"],
    );
    await db.exec(
      "ALTER TABLE evidence_snapshots ENABLE TRIGGER evidence_snapshots_no_update",
    );
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
    const broken = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(broken.ok).toBe(false);
    // The specific, PII-safe reason survives into the unbounded integrity result: a gate
    // that reports only BROKEN leaves an unverifiable ledger undiagnosable.
    expect(broken.replaySourceReason).toBe(
      "unsupported evidence encoding 9.0.0/1.0.0 during replay",
    );
  });

  it("refuses a replay source provenance binding moved to a later recording", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const snapshot = input.evidenceSnapshots[0]!;
    const rerecorded = LedgerEntrySchema.parse({
      ...input.events[0]!,
      id: "ledger:evidence:rerecorded",
      occurredAt: LEDGER_LATER,
      recordedAt: LEDGER_LATER,
    });
    await db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [rerecorded],
      { source: "verin-crm", asOf: LEDGER_LATER, confidence: "high" },
      [snapshot],
    ));
    await db.exec(
      `ALTER TABLE decision_replay_source_provenance
       DISABLE TRIGGER decision_replay_source_provenance_no_update`,
    );
    await db.query(
      `UPDATE decision_replay_source_provenance
          SET recording_entry_id = $3
        WHERE org_id = $1 AND source_kind = 'evidence' AND source_id = $2`,
      [LEDGER_ORG, snapshot.id, rerecorded.id],
    );
    await db.exec(
      `ALTER TABLE decision_replay_source_provenance
       ENABLE TRIGGER decision_replay_source_provenance_no_update`,
    );
    const broken = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(broken.ok).toBe(false);
    expect(broken.replaySourceReason).toBe(
      "immutable replay source provenance binding is invalid",
    );
  });

  it("rejects a preclaimed replay-source provenance binding during append", async () => {
    await recordFixture(db);
    const later = laterEvidenceRecording("evidence:preclaimed");
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM decision_ledger
        WHERE org_id = $1 ORDER BY sequence ASC LIMIT 1`,
      [LEDGER_ORG],
    );
    await db.query(
      `INSERT INTO decision_replay_source_provenance
        (org_id, source_kind, source_id, recording_entry_id)
       VALUES ($1, 'evidence', $2, $3)`,
      [LEDGER_ORG, later.snapshot.id, existing.rows[0]!.id],
    );

    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [later.event],
      LEDGER_PROVENANCE,
      [later.snapshot],
    ))).rejects.toMatchObject({ code: "STORE_CONSTRAINT" });
    const persisted = await db.query<{ n: number | string }>(
      `SELECT
         (SELECT count(*) FROM evidence_snapshots
           WHERE org_id = $1 AND id = $2) +
         (SELECT count(*) FROM decision_ledger
           WHERE org_id = $1 AND id = $3) AS n`,
      [LEDGER_ORG, later.snapshot.id, later.event.id],
    );
    expect(Number(persisted.rows[0]?.n)).toBe(0);
  });

  it("rejects an orphan replay-source provenance binding during verification", async () => {
    await recordFixture(db);
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM decision_ledger
        WHERE org_id = $1 ORDER BY sequence ASC LIMIT 1`,
      [LEDGER_ORG],
    );
    await db.query(
      `INSERT INTO decision_replay_source_provenance
        (org_id, source_kind, source_id, recording_entry_id)
       VALUES ($1, 'evidence', 'evidence:orphan-binding', $2)`,
      [LEDGER_ORG, existing.rows[0]!.id],
    );

    const broken = await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT);
    expect(broken.ok).toBe(false);
    expect(broken.replaySourceReason).toBe(
      "immutable replay-source provenance binding has no source",
    );
  });

  it("refuses replay after immutable bundle membership is changed", async () => {
    await recordFixture(db);
    await db.exec(
      "ALTER TABLE decision_input_bundle_evidence DISABLE TRIGGER decision_input_bundle_evidence_no_delete",
    );
    await db.query(
      `DELETE FROM decision_input_bundle_evidence
        WHERE org_id = $1 AND bundle_id = $2 AND ordinal = 0`,
      [LEDGER_ORG, "bundle:GC-01:0001"],
    );
    await db.exec(
      "ALTER TABLE decision_input_bundle_evidence ENABLE TRIGGER decision_input_bundle_evidence_no_delete",
    );
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT)).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("routes replay through the recorded ledger version registry", async () => {
    await recordFixture(db);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET schema_version = '9.0.0' WHERE org_id = $1 AND sequence = 4",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT)).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("produces identical sequence and hash streams from identical recorded inputs", async () => {
    await recordFixture(db);
    const other = await createMemoryDb();
    try {
      await seedOrg(other, LEDGER_ORG);
      await recordFixture(other);
      const project = (rows: Awaited<ReturnType<typeof listDecisionLedger>>) =>
        rows.map((row) => ({
          sequence: row.sequence,
          payload: row.payloadJson,
          prevHash: row.prevHash,
          entryHash: row.entryHash,
        }));
      expect(project(await listDecisionLedger(other, LEDGER_TENANT))).toEqual(
        project(await listDecisionLedger(db, LEDGER_TENANT)),
      );
    } finally {
      await other.close();
    }
  });

  it("distinguishes a store constraint from a failure that is not one", async () => {
    await recordFixture(db);
    const duplicate = await recordDecision(db, LEDGER_TENANT, decisionRecordingInput());
    expect(duplicate.ok).toBe(false);
    expect(duplicate.ok ? null : duplicate.error.code).toBe("STORE_CONSTRAINT");

    const unavailable: SqlDb = {
      ...db,
      transaction: () => Promise.reject(new TypeError("driver is gone")),
    };
    const failed = await recordDecision(unavailable, LEDGER_TENANT, decisionRecordingInput());
    expect(failed.ok).toBe(false);
    // A bug or an outage must never be reported as a client-resolvable conflict.
    expect(failed.ok ? null : failed.error.code).toBe("INTERNAL");
  });

  it("rejects derived provenance when recording a decision", async () => {
    const provenance = deriveArtifactProvenance([LEDGER_PROVENANCE], TS);
    expect(provenance.demonstration).toBe(true);
    expectTypeOf(provenance).not.toMatchTypeOf<LedgerProducerProvenance>();
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...decisionRecordingInput(),
      provenance: provenance as unknown as LedgerProducerProvenance,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("VALIDATION");
    expect(await listDecisionLedger(db, LEDGER_TENANT)).toEqual([]);
  });

  it("rejects trace-stripped computed provenance when recording a decision", async () => {
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...decisionRecordingInput(),
      provenance: {
        source: "computed",
        asOf: TS,
        confidence: "high",
      } as unknown as LedgerProducerProvenance,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("VALIDATION");
    expect(await listDecisionLedger(db, LEDGER_TENANT)).toEqual([]);
  });

  it("rejects human identifiers in every computed provenance identity path", async () => {
    expect((await recordDecision(
      db,
      LEDGER_TENANT,
      decisionRecordingInput(),
    )).ok).toBe(true);
    const inputRow = (await listDecisionLedger(db, LEDGER_TENANT))[0]!;
    const valid = computedProvenance(inputRow, "trace:real-input");
    expect(parseLedgerProducerProvenance(valid)).not.toBeNull();
    const attempts = [
      {
        ...valid,
        derivation: {
          ...valid.derivation,
          producer: { ...valid.derivation.producer, id: "robert-smith" },
        },
      },
      {
        ...valid,
        derivation: {
          ...valid.derivation,
          producer: {
            ...valid.derivation.producer,
            id: "verin.robert.smith",
          },
        },
      },
      {
        ...valid,
        derivation: {
          ...valid.derivation,
          traceRef: { firmId: LEDGER_ORG, id: "trace:robert-smith" },
        },
      },
      {
        ...valid,
        derivation: {
          ...valid.derivation,
          inputs: [{
            ...valid.derivation.inputs[0]!,
            entryRef: { firmId: LEDGER_ORG, id: "ledger:robert-smith" },
          }],
        },
      },
    ];
    for (const attempt of attempts) {
      expect(parseLedgerProducerProvenance(attempt)).toBeNull();
    }
  });

  it("retains and verifies canonical computed provenance from real ledger inputs", async () => {
    const input = decisionRecordingInput();
    const recorded = await recordDecision(db, LEDGER_TENANT, {
      ...input,
      provenance: {
        source: "verin-crm",
        asOf: TS,
        confidence: "high",
      },
    });
    expect(recorded.ok).toBe(true);
    const inputRow = (await listDecisionLedger(db, LEDGER_TENANT))[0]!;
    await appendComputedExpiry(db, inputRow, "trace:real-input");
    const traceId = issuedTraceId("trace:real-input");

    const rows = await listDecisionLedger(db, LEDGER_TENANT);
    const computed = rows.at(-1)!;
    expect(computed.provenanceSchemaVersion).toBe(
      COMPUTED_LEDGER_PROVENANCE_VERSION,
    );
    expect(computed.provenanceTraceId).toBe(traceId);
    expect(JSON.parse(computed.provenanceJson!)).toMatchObject({
      source: "computed",
      derivation: {
        producer: {
          kind: "algorithm",
          id: "verin.test.decision-score",
          version: "1.0.0",
        },
        inputs: [{
          entryRef: { firmId: LEDGER_ORG, id: inputRow.id },
          entryHash: inputRow.entryHash,
        }],
      },
    });
    const trace = await db.query<{
      canonical_json: string;
      trace_digest: string;
    }>(
      `SELECT canonical_json, trace_digest
         FROM decision_provenance_traces
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, traceId],
    );
    expect(hashPreimage(JSON.parse(trace.rows[0]!.canonical_json))).toBe(
      trace.rows[0]!.trace_digest,
    );
    expect((await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT)).ok).toBe(true);
    expect(await rebuildDecisionProjections(db, LEDGER_TENANT)).toHaveLength(1);
    const bounded = await readVerifiedDecisionRegister(
      db,
      LEDGER_TENANT,
      1,
      20,
    );
    expect(bounded.verification.ok).toBe(true);
    expect(bounded.rowProvenance.has(computed.id)).toBe(false);
    expect(bounded.decisions).toEqual([]);
    const register = await readVerifiedDecisionRegister(
      db,
      LEDGER_TENANT,
      20,
      20,
    );
    expect(register.verification.ok).toBe(true);
    expect(register.decisions).toHaveLength(1);
    expect(canFeedComplianceDecision(
      register.rowProvenance.get(computed.id)!,
    )).toBe(true);
    expect(canFeedComplianceDecision(
      register.decisions[0]!.provenance,
    )).toBe(true);

    await expect(db.query(
      `UPDATE decision_provenance_traces
          SET trace_digest = $3
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, traceId, "0".repeat(64)],
    )).rejects.toThrow(/append-only/i);
    await expect(db.query(
      `DELETE FROM decision_provenance_traces
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, traceId],
    )).rejects.toThrow(/append-only/i);
    await expect(db.exec(
      "TRUNCATE decision_provenance_traces CASCADE",
    )).rejects.toThrow(/append-only/i);
  });

  it("rejects computed confidence above its verified input ancestry", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, {
      ...input,
      provenance: { source: "verin-crm", asOf: TS, confidence: "medium" },
    })).ok).toBe(true);
    const inputRow = (await listDecisionLedger(db, LEDGER_TENANT))[0]!;
    const event = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (sample) => sample.type === "ApprovalStageExpired",
      )!,
      id: "ledger:computed:confidence-write",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [event],
      computedProvenance(inputRow, "trace:confidence-write"),
    ))).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
      message: "computed provenance confidence does not match verified ancestry",
    });
    const traces = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM decision_provenance_traces WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(Number(traces.rows[0]?.n ?? 0)).toBe(0);
  });

  it("rejects retained computed confidence above verified ancestry on replay", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, {
      ...input,
      provenance: { source: "verin-crm", asOf: TS, confidence: "medium" },
    })).ok).toBe(true);
    const inputRow = (await listDecisionLedger(db, LEDGER_TENANT))[0]!;
    const provenance = computedProvenance(inputRow, "trace:confidence-replay");
    const trace = computedProvenanceTrace(provenance);
    const traceJson = canonicalJson(trace as unknown as JsonValue);
    const provenanceJson = canonicalJson(provenance as unknown as JsonValue);
    expect(traceJson.ok).toBe(true);
    expect(provenanceJson.ok).toBe(true);
    if (!traceJson.ok || !provenanceJson.ok) return;
    await db.query(
      `INSERT INTO decision_provenance_traces
        (org_id,id,schema_version,serializer_version,canonical_json,
         trace_digest,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        LEDGER_ORG,
        trace.traceRef.id,
        trace.schemaVersion,
        trace.serializerVersion,
        traceJson.value,
        provenance.derivation.traceDigest,
        trace.observedAt,
      ],
    );
    await expect(verifyRecordedLedgerProvenance(db, LEDGER_TENANT, {
      ...inputRow,
      id: "ledger:computed:confidence-replay",
      sequence: inputRow.sequence + 1,
      provSource: "computed",
      provAsOf: provenance.asOf,
      provConfidence: provenance.confidence,
      provenanceSchemaVersion: COMPUTED_LEDGER_PROVENANCE_VERSION,
      provenanceSerializerVersion: LEDGER_PROVENANCE_SERIALIZER_VERSION,
      provenanceJson: provenanceJson.value,
      provenanceTraceId: provenance.derivation.traceRef.id,
    })).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
      message: "computed provenance confidence does not match verified ancestry",
    });
  });

  it("rejects missing, extra, mismatched, and synthetic computed traces", async () => {
    await recordFixture(db);
    const inputRow = (await listDecisionLedger(db, LEDGER_TENANT))[0]!;
    const valid = computedProvenance(inputRow, "trace:invalid");
    const event = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (sample) => sample.type === "ApprovalStageExpired",
      )!,
      id: "ledger:computed:invalid",
      priorDecisionHash: decisionRecordingInput().decisionRecord.decisionHash,
    });
    const trace = computedProvenanceTrace(valid);
    const wrongInput = {
      ...trace,
      inputs: [{
        ...trace.inputs[0]!,
        entryHash: "0".repeat(64),
      }],
    };
    const wrongTenant = {
      ...trace,
      traceRef: {
        firmId: LEDGER_OTHER_ORG,
        id: trace.traceRef.id,
      },
      inputs: trace.inputs.map((item) => ({
        ...item,
        entryRef: {
          firmId: LEDGER_OTHER_ORG,
          id: item.entryRef.id,
        },
      })),
    };
    const attempts: unknown[] = [
      {
        ...valid,
        derivation: {
          ...valid.derivation,
          traceDigest: "0".repeat(64),
        },
      },
      {
        ...valid,
        derivation: {
          ...valid.derivation,
          unexpected: true,
        },
      },
      {
        ...valid,
        derivation: {
          ...wrongInput,
          traceDigest: hashPreimage(wrongInput),
        },
      },
      {
        ...valid,
        derivation: {
          ...wrongTenant,
          traceDigest: hashPreimage(wrongTenant),
        },
      },
    ];
    for (const provenance of attempts) {
      await expect(db.transaction((tx) => appendDecisionEvents(
        tx,
        LEDGER_TENANT,
        [event],
        provenance as LedgerProducerProvenance,
      ))).rejects.toMatchObject({
        code: expect.stringMatching(/VALIDATION|STORE_CONSTRAINT/),
      });
    }
    const crossTenant = {
      ...valid,
      derivation: {
        ...wrongTenant,
        traceDigest: hashPreimage(wrongTenant),
      },
    };
    const encoded = canonicalJson(crossTenant as unknown as JsonValue);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    await expect(verifyRecordedLedgerProvenance(db, LEDGER_TENANT, {
      ...inputRow,
      id: "ledger:computed:cross-tenant-replay",
      sequence: inputRow.sequence + 1,
      provSource: "computed",
      provAsOf: crossTenant.asOf,
      provConfidence: crossTenant.confidence,
      provenanceSchemaVersion: COMPUTED_LEDGER_PROVENANCE_VERSION,
      provenanceJson: encoded.value,
      provenanceTraceId: crossTenant.derivation.traceRef.id,
    })).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
      message: "computed provenance references another tenant",
    });
    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [event],
      valid,
    ))).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
      message: "computed provenance input is not compliance-eligible",
    });
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(5);
    expect(Number((await db.query<{ n: number | string }>(
      `SELECT count(*) AS n
         FROM decision_provenance_traces
        WHERE org_id = $1`,
      [LEDGER_ORG],
    )).rows[0]!.n)).toBe(0);
  });

  it("fails replay when retained computed trace bytes no longer match", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, {
      ...input,
      provenance: {
        source: "verin-crm",
        asOf: TS,
        confidence: "high",
      },
    })).ok).toBe(true);
    const inputRow = (await listDecisionLedger(db, LEDGER_TENANT))[0]!;
    await appendComputedExpiry(db, inputRow, "trace:tampered");
    await db.exec(
      "ALTER TABLE decision_provenance_traces DISABLE TRIGGER decision_provenance_traces_no_update",
    );
    await db.query(
      `UPDATE decision_provenance_traces
          SET canonical_json = $3
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, issuedTraceId("trace:tampered"), "{}"],
    );
    await db.exec(
      "ALTER TABLE decision_provenance_traces ENABLE TRIGGER decision_provenance_traces_no_update",
    );
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
    expect((await verifyDecisionLedgerIntegrity(db, LEDGER_TENANT)).ok).toBe(false);
    await expect(
      rebuildDecisionProjections(db, LEDGER_TENANT),
    ).rejects.toMatchObject({ code: "STORE_CONSTRAINT" });
  });

  it("recomputes computed trace digests during replay", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, {
      ...input,
      provenance: {
        source: "verin-crm",
        asOf: TS,
        confidence: "high",
      },
    })).ok).toBe(true);
    const inputRow = (await listDecisionLedger(db, LEDGER_TENANT))[0]!;
    await appendComputedExpiry(db, inputRow, "trace:bad-replay-digest");
    const computed = (await listDecisionLedger(db, LEDGER_TENANT)).at(-1)!;
    const provenance = JSON.parse(computed.provenanceJson!) as {
      derivation: { traceDigest: string };
    };
    provenance.derivation.traceDigest = "0".repeat(64);
    const encoded = canonicalJson(provenance as unknown as JsonValue);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    await db.exec(
      "ALTER TABLE decision_provenance_traces DISABLE TRIGGER decision_provenance_traces_no_update",
    );
    await db.query(
      `UPDATE decision_provenance_traces
          SET trace_digest = $3
        WHERE org_id = $1 AND id = $2`,
      [
        LEDGER_ORG,
        issuedTraceId("trace:bad-replay-digest"),
        "0".repeat(64),
      ],
    );
    await db.exec(
      "ALTER TABLE decision_provenance_traces ENABLE TRIGGER decision_provenance_traces_no_update",
    );
    await expect(verifyRecordedLedgerProvenance(
      db,
      LEDGER_TENANT,
      { ...computed, provenanceJson: encoded.value },
    )).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
      message: "computed provenance trace is invalid",
    });
  });

  it("rejects derived provenance when appending later events", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageExpired",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      id: "ledger:append:derived-provenance",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const provenance = deriveArtifactProvenance([LEDGER_PROVENANCE], TS);
    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [event],
      provenance as unknown as LedgerProducerProvenance,
    ))).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(5);
  });

  it("maps later-append driver failures after rolling back the savepoint", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageExpired",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      id: "ledger:append:driver-failure",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(db.transaction(async (tx) => {
      const failingTx: SqlTx = {
        ...tx,
        async query<T>(sql: string, params?: unknown[]) {
          if (sql.includes("INSERT INTO decision_ledger")) {
            throw new TypeError("driver is gone");
          }
          return tx.query<T>(sql, params);
        },
      };
      return appendDecisionEvents(
        failingTx,
        LEDGER_TENANT,
        [event],
        LEDGER_PROVENANCE,
      );
    })).rejects.toMatchObject({ code: "INTERNAL" });
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(5);
  });

  it.each([
    ["tenant lock", "query", "SELECT id FROM orgs"],
    ["savepoint creation", "exec", "SAVEPOINT decision_ledger_append"],
  ] as const)("maps a driver failure during %s", async (
    _phase,
    method,
    statement,
  ) => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageExpired",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      id: `ledger:append:${method === "query" ? "1" : "2"}`,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(db.transaction((tx) => {
      const failingTx: SqlTx = {
        ...tx,
        async query<T>(sql: string, params?: unknown[]) {
          if (method === "query" && sql.includes(statement)) {
            throw new TypeError("driver is gone");
          }
          return tx.query<T>(sql, params);
        },
        async exec(sql: string) {
          if (method === "exec" && sql === statement) {
            throw new TypeError("driver is gone");
          }
          return tx.exec(sql);
        },
      };
      return appendDecisionEvents(
        failingTx,
        LEDGER_TENANT,
        [event],
        LEDGER_PROVENANCE,
      );
    })).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("maps evidence-preflight driver failures before the savepoint", async () => {
    await recordFixture(db);
    const later = laterEvidenceRecording("evidence:preflight-driver-failure");
    await expect(db.transaction((tx) => {
      const failingTx: SqlTx = {
        ...tx,
        async query<T>(sql: string, params?: unknown[]) {
          if (sql.includes("SELECT canonical_json FROM evidence_snapshots")) {
            throw new TypeError("driver is gone");
          }
          return tx.query<T>(sql, params);
        },
      };
      return appendDecisionEvents(
        failingTx,
        LEDGER_TENANT,
        [later.event],
        LEDGER_PROVENANCE,
        [later.snapshot],
      );
    })).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("preserves the original release error after best-effort cleanup", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageExpired",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      id: "ledger:append:release-failure",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    let rollbackAttempts = 0;
    let releaseAttempts = 0;
    await expect(db.transaction((tx) => {
      const failingTx: SqlTx = {
        ...tx,
        async exec(sql: string) {
          if (sql === "ROLLBACK TO SAVEPOINT decision_ledger_append") {
            rollbackAttempts += 1;
            throw new TypeError("rollback cleanup failed");
          }
          if (sql === "RELEASE SAVEPOINT decision_ledger_append") {
            releaseAttempts += 1;
            if (releaseAttempts === 1) {
              throw { code: "23505", message: "release failed" };
            }
            throw new TypeError("release cleanup failed");
          }
          return tx.exec(sql);
        },
      };
      return appendDecisionEvents(
        failingTx,
        LEDGER_TENANT,
        [event],
        LEDGER_PROVENANCE,
      );
    })).rejects.toMatchObject({ code: "STORE_CONSTRAINT" });
    expect(rollbackAttempts).toBe(1);
    expect(releaseAttempts).toBe(2);
  });

  it("persists evidence gathered after the decision and refuses an uncited snapshot", async () => {
    await recordFixture(db);
    const observed = allLedgerEventSamples().find(
      (event) => event.type === "StatusObserved",
    )!;
    await expect(append(db, [observed])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });

    const later = laterEvidenceRecording("evidence:status:1");
    const cited = LedgerEntrySchema.parse({
      ...observed,
      evidenceSnapshotRef: { firmId: LEDGER_ORG, id: later.snapshot.id },
    });
    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [later.event, cited],
      LEDGER_PROVENANCE,
      [later.snapshot],
    ))).resolves.toHaveLength(2);
    const promoted = await db.query<{ evidence_snapshot_id: string | null }>(
      "SELECT evidence_snapshot_id FROM decision_ledger WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, cited.id],
    );
    expect(promoted.rows[0]?.evidence_snapshot_id).toBe(later.snapshot.id);
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);

    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [laterEvidenceRecording("evidence:status:2").event],
      LEDGER_PROVENANCE,
    ))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("preflights every later evidence source before inserting any of them", async () => {
    await recordFixture(db);
    const later = laterEvidenceRecording("evidence:atomic-refusal");
    const input = decisionRecordingInput();
    const collision = {
      ...input.evidenceSnapshots[0]!,
      freshness: "stale" as const,
    };
    const collisionEvent = LedgerEntrySchema.parse({
      ...input.events[0]!,
      id: "ledger:evidence:collision",
      snapshotHash: hashPreimage(collision),
    });
    await db.transaction(async (tx) => {
      try {
        await appendDecisionEvents(
          tx,
          LEDGER_TENANT,
          [later.event, collisionEvent],
          LEDGER_PROVENANCE,
          [later.snapshot, collision],
        );
      } catch {
        return;
      }
    });
    const snapshot = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM evidence_snapshots WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, later.snapshot.id],
    );
    expect(Number(snapshot.rows[0]!.n)).toBe(0);
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(5);
  });

  it("rolls back every event when a producer catches a mid-batch refusal", async () => {
    await recordFixture(db);
    const samples = allLedgerEventSamples();
    const accepted = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      priorDecisionHash: (await db.query<{ decision_hash: string }>(
        "SELECT decision_hash FROM decision_records WHERE org_id = $1 AND id = $2",
        [LEDGER_ORG, "dec:GC-01:0001"],
      )).rows[0]!.decision_hash,
    });
    const refused = samples.find((event) => event.type === "ApprovalRecorded")!;
    await db.transaction(async (tx) => {
      try {
        await appendDecisionEvents(
          tx,
          LEDGER_TENANT,
          [accepted, refused],
          LEDGER_PROVENANCE,
        );
      } catch {
        // A future producer that swallows the abort must not be able to commit
        // ledger rows the anchor does not cover: L4 would break with no repair.
      }
    });
    const verdict = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(verdict.ok, verdict.levels.at(-1)?.reason ?? "").toBe(true);
    expect(verdict.entriesChecked).toBe(5);
  });

  it("rejects a direct database handle where a transaction capability is required", async () => {
    expectTypeOf<SqlDb>().not.toMatchTypeOf<
      Parameters<typeof appendDecisionEvents>[0]
    >();
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (sample) => sample.type === "ApprovalStageExpired",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(appendDecisionEvents(
      db as unknown as Parameters<typeof appendDecisionEvents>[0],
      LEDGER_TENANT,
      [event],
      LEDGER_PROVENANCE,
    )).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(5);
  });

  it("composes CRM mutation, operational audit intent, and ledger append in one transaction", async () => {
    await recordFixture(db);
    const actor = systemWriteActor(
      registerTestSystemActor("test.execution"),
      LEDGER_ORG,
    );
    const samples = allLedgerEventSamples();
    const started = samples.find((event) => event.type === "ExecutionStarted")!;
    const write = await auditedWrite({
      db,
      actor,
      action: "task.create",
      entityType: "Task",
      entityId: "task-ledger-ok",
      detail: "Synthetic atomic ledger composition test",
      perform: async (tx) => {
        await tx.query(
          `INSERT INTO tasks
            (id,org_id,household_id,subject,status,due_date,assignee_user_id,
             created_at,prov_source,prov_asof,prov_confidence)
           VALUES ($1,$2,NULL,'Synthetic ledger task','not-started',NULL,NULL,
                   $3,'synthetic-ledger-test',$3,'high')`,
          ["task-ledger-ok", LEDGER_ORG, TS],
        );
        await appendDecisionEvents(tx, LEDGER_TENANT, [started], LEDGER_PROVENANCE);
        return { id: "task-ledger-ok" };
      },
    });
    expect(write.ok).toBe(true);
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(6);
    const audit = await db.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
      [LEDGER_ORG],
    );
    expect(audit.rows[0]?.action).toBe("task.create");

    const unsafe = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ExecutionFailed")!,
      sourceStatus: "reported by unsafe@firm.test",
    });
    const refused = await auditedWrite({
      db,
      actor,
      action: "task.create",
      entityType: "Task",
      entityId: "task-ledger-refused",
      detail: "Synthetic atomic ledger refusal test",
      perform: async (tx) => {
        await tx.query(
          `INSERT INTO tasks
            (id,org_id,household_id,subject,status,due_date,assignee_user_id,
             created_at,prov_source,prov_asof,prov_confidence)
           VALUES ($1,$2,NULL,'Synthetic refused task','not-started',NULL,NULL,
                   $3,'synthetic-ledger-test',$3,'high')`,
          ["task-ledger-refused", LEDGER_ORG, TS],
        );
        await appendDecisionEvents(tx, LEDGER_TENANT, [unsafe], LEDGER_PROVENANCE);
        return { id: "task-ledger-refused" };
      },
    });
    expect(refused.ok).toBe(false);
    const tasks = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM tasks WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "task-ledger-refused"],
    );
    expect(Number(tasks.rows[0]!.n)).toBe(0);
    expect((await listDecisionLedger(db, LEDGER_TENANT))).toHaveLength(6);
    const failedAudit = await db.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
      [LEDGER_ORG],
    );
    expect(failedAudit.rows[0]?.action).toBe("task.create.failed");
  });
});
