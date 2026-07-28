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
  type SqlDb,
  type SqlTx,
} from "@infra/store/db";
import {
  appendDecisionEvents,
  rebuildDecisionProjections,
  recordDecision,
} from "@infra/ledger/ledger-store";
import {
  verifyAndListDecisionLedger,
  verifyDecisionLedgerIntegrity,
  verifyDecisionLedger,
  listDecisionLedger,
} from "@infra/ledger/ledger-verification";
import { computeChainHash, GENESIS_HASH } from "@infra/audit/hash-chain";
import { auditedWrite } from "@infra/audit/audited-write";
import { listOrgChain } from "@infra/audit/audit-store";
import { decisionLedgerChainPreimage } from "@infra/ledger/ledger-schema-registry";
import {
  isVersionIdentifier,
  retainedTextReference,
} from "@infra/ledger/ledger-pii";
import { LedgerEntrySchema } from "@contracts/decision-core/ledger";
import {
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { DecisionInputBundleSchema } from "@contracts/decision-core/evidence";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import {
  LEDGER_LATER,
  LEDGER_ORG,
  LEDGER_OTHER_ORG,
  LEDGER_PROVENANCE,
  allLedgerEventSamples,
  decisionRecordingInput,
  laterEvidenceRecording,
} from "../helpers/ledger-fixtures";

const TS = "2026-07-26T13:30:00.000Z";

function hashPreimage(value: unknown): string {
  const canonical = canonicalJson(value as JsonValue);
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
  const result = await recordDecision(db, decisionRecordingInput());
  expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
}

const append = (
  db: SqlDb,
  events: Parameters<typeof appendDecisionEvents>[2],
) => db.transaction((tx) => appendDecisionEvents(tx, LEDGER_ORG, events, LEDGER_PROVENANCE));

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
      schema_version: "1.7.0",
      serializer_version: "1.0.0",
      engine_version: "0.0.0",
      primitive_set_version: "0",
      time_zone_data_version: "iana-tzdb/2026b",
    });
    const verification = await verifyDecisionLedger(db, LEDGER_ORG);
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
    const result = await recordDecision(db, {
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
    const result = await verifyDecisionLedger(db, LEDGER_ORG);
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
    const result = await verifyDecisionLedger(db, LEDGER_ORG);
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
    const result = await verifyDecisionLedger(db, LEDGER_ORG);
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
    const result = await verifyDecisionLedger(db, LEDGER_ORG);
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
    const result = await verifyDecisionLedger(db, LEDGER_ORG);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L1");
  });

  it("locks one tenant owner: compatible to verify, exclusive to append", async () => {
    const appendStatements = await measureStatements(db, recordFixture);
    expect(appendStatements[0]).toBe(
      "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
    );

    const verifyStatements = await measureStatements(db, async (target) => {
      expect((await verifyDecisionLedger(target, LEDGER_ORG)).ok).toBe(true);
    });
    expect(verifyStatements[0]).toBe(
      "SELECT id FROM orgs WHERE id = $1 FOR SHARE",
    );
    // A compatible read still excludes appends, so the exclusive mode is the ONLY
    // one that can compute a next sequence: no verify path may take it back.
    expect(
      verifyStatements.filter((sql) => sql.includes("FOR UPDATE")),
    ).toEqual([]);

    const rebuildStatements = await measureStatements(db, async (target) => {
      await rebuildDecisionProjections(target, LEDGER_ORG);
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
    const result = await verifyDecisionLedger(db, LEDGER_ORG);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L4");
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
    const result = await verifyDecisionLedger(db, LEDGER_ORG);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L3");
  });

  it("a windowed verification checks its own entries and their link to the stored predecessor", async () => {
    await recordFixture(db);
    const windowed = await verifyAndListDecisionLedger(db, LEDGER_ORG, 2);
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
    const broken = await verifyAndListDecisionLedger(db, LEDGER_ORG, 2);
    expect(broken.verification.ok).toBe(false);
    expect(broken.verification.levels.at(-1)).toMatchObject({
      level: "L1",
      reason: "prev_hash does not match preceding entry_hash",
    });
    expect((await verifyDecisionLedger(db, LEDGER_ORG)).ok).toBe(false);
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
    expect((await recordDecision(db, input)).ok).toBe(true);
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
    expect((await verifyDecisionLedger(db, LEDGER_ORG)).ok).toBe(true);
  });

  it("requires causation and exception triggers to precede the citing event", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
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
    expect((await listDecisionLedger(db, LEDGER_ORG))).toHaveLength(5);
  });

  it("rejects PII in ledger text without rewriting the submitted bytes", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
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
    expect((await listDecisionLedger(db, LEDGER_ORG))).toHaveLength(5);
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
    expect(await listDecisionLedger(db, LEDGER_ORG)).toHaveLength(0);

    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
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
      LEDGER_ORG,
      [],
      LEDGER_PROVENANCE,
    )).resolves.toEqual([]);
    expect(consulted).toBe(false);
    expect(await listDecisionLedger(db, LEDGER_ORG)).toHaveLength(0);
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
      return recordDecision(db, {
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
    const snapshotResult = await recordDecision(db, {
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
    const bundleResult = await recordDecision(db, {
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
    const recordResult = await recordDecision(db, {
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
    const result = await recordDecision(db, {
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
    const evidenceResult = await recordDecision(db, {
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
    const decisionResult = await recordDecision(db, {
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
    expect((await verifyDecisionLedgerIntegrity(db, LEDGER_ORG)).ok).toBe(
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
    await expect(rebuildDecisionProjections(db, LEDGER_ORG)).rejects.toMatchObject({
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
    await expect(rebuildDecisionProjections(db, LEDGER_ORG)).rejects.toMatchObject({
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
    await expect(rebuildDecisionProjections(db, LEDGER_ORG)).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("integrity verification dispatches immutable sources by recorded version", async () => {
    await recordFixture(db);
    const intact = await verifyDecisionLedgerIntegrity(db, LEDGER_ORG);
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
    expect((await verifyDecisionLedger(db, LEDGER_ORG)).ok).toBe(true);
    const broken = await verifyDecisionLedgerIntegrity(db, LEDGER_ORG);
    expect(broken.ok).toBe(false);
    // The specific, PII-safe reason survives into the examiner-grade result: a gate
    // that reports only BROKEN leaves an unverifiable ledger undiagnosable.
    expect(broken.replaySourceReason).toBe(
      "unsupported evidence encoding 9.0.0/1.0.0 during replay",
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
    await expect(rebuildDecisionProjections(db, LEDGER_ORG)).rejects.toMatchObject({
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
    await expect(rebuildDecisionProjections(db, LEDGER_ORG)).rejects.toMatchObject({
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
      expect(project(await listDecisionLedger(other, LEDGER_ORG))).toEqual(
        project(await listDecisionLedger(db, LEDGER_ORG)),
      );
    } finally {
      await other.close();
    }
  });

  it("distinguishes a store constraint from a failure that is not one", async () => {
    await recordFixture(db);
    const duplicate = await recordDecision(db, decisionRecordingInput());
    expect(duplicate.ok).toBe(false);
    expect(duplicate.ok ? null : duplicate.error.code).toBe("STORE_CONSTRAINT");

    const unavailable: SqlDb = {
      ...db,
      transaction: () => Promise.reject(new TypeError("driver is gone")),
    };
    const failed = await recordDecision(unavailable, decisionRecordingInput());
    expect(failed.ok).toBe(false);
    // A bug or an outage must never be reported as a client-resolvable conflict.
    expect(failed.ok ? null : failed.error.code).toBe("INTERNAL");
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
      LEDGER_ORG,
      [later.event, cited],
      LEDGER_PROVENANCE,
      [later.snapshot],
    ))).resolves.toHaveLength(2);
    const promoted = await db.query<{ evidence_snapshot_id: string | null }>(
      "SELECT evidence_snapshot_id FROM decision_ledger WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, cited.id],
    );
    expect(promoted.rows[0]?.evidence_snapshot_id).toBe(later.snapshot.id);
    expect((await verifyDecisionLedger(db, LEDGER_ORG)).ok).toBe(true);

    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_ORG,
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
          LEDGER_ORG,
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
    expect((await listDecisionLedger(db, LEDGER_ORG))).toHaveLength(5);
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
          LEDGER_ORG,
          [accepted, refused],
          LEDGER_PROVENANCE,
        );
      } catch {
        // A future producer that swallows the abort must not be able to commit
        // ledger rows the anchor does not cover: L4 would break with no repair.
      }
    });
    const verdict = await verifyDecisionLedger(db, LEDGER_ORG);
    expect(verdict.ok, verdict.levels.at(-1)?.reason ?? "").toBe(true);
    expect(verdict.entriesChecked).toBe(5);
  });

  it("rejects a direct database handle where a transaction capability is required", async () => {
    expectTypeOf<SqlDb>().not.toMatchTypeOf<
      Parameters<typeof appendDecisionEvents>[0]
    >();
    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (sample) => sample.type === "ApprovalStageExpired",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(appendDecisionEvents(
      db as unknown as Parameters<typeof appendDecisionEvents>[0],
      LEDGER_ORG,
      [event],
      LEDGER_PROVENANCE,
    )).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listDecisionLedger(db, LEDGER_ORG))).toHaveLength(5);
  });

  it("composes CRM mutation, operational audit intent, and ledger append in one transaction", async () => {
    await recordFixture(db);
    const samples = allLedgerEventSamples();
    const started = samples.find((event) => event.type === "ExecutionStarted")!;
    const write = await auditedWrite({
      db,
      orgId: LEDGER_ORG,
      actor: "system:execution-test",
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
        await appendDecisionEvents(tx, LEDGER_ORG, [started], LEDGER_PROVENANCE);
        return { id: "task-ledger-ok" };
      },
    });
    expect(write.ok).toBe(true);
    expect((await listDecisionLedger(db, LEDGER_ORG))).toHaveLength(6);
    expect((await listOrgChain(db, LEDGER_ORG)).at(-1)?.action).toBe("task.create");

    const unsafe = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ExecutionFailed")!,
      sourceStatus: "reported by unsafe@firm.test",
    });
    const refused = await auditedWrite({
      db,
      orgId: LEDGER_ORG,
      actor: "system:execution-test",
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
        await appendDecisionEvents(tx, LEDGER_ORG, [unsafe], LEDGER_PROVENANCE);
        return { id: "task-ledger-refused" };
      },
    });
    expect(refused.ok).toBe(false);
    const tasks = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM tasks WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "task-ledger-refused"],
    );
    expect(Number(tasks.rows[0]!.n)).toBe(0);
    expect((await listDecisionLedger(db, LEDGER_ORG))).toHaveLength(6);
    expect((await listOrgChain(db, LEDGER_ORG)).at(-1)?.action).toBe(
      "task.create.failed",
    );
  });
});
