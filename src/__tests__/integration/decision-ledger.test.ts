import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import {
  appendDecisionEvents,
  recordDecision,
} from "@infra/ledger/ledger-store";
import {
  verifyAndListDecisionLedger,
  verifyDecisionLedger,
  listDecisionLedger,
} from "@infra/ledger/ledger-verification";
import { computeChainHash, GENESIS_HASH } from "@infra/audit/hash-chain";
import { auditedWrite } from "@infra/audit/audited-write";
import { listOrgChain } from "@infra/audit/audit-store";
import { LedgerEntrySchema } from "@contracts/decision-core/ledger";
import {
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import {
  LEDGER_LATER,
  LEDGER_ORG,
  LEDGER_OTHER_ORG,
  LEDGER_PROVENANCE,
  allLedgerEventSamples,
  decisionRecordingInput,
} from "../helpers/ledger-fixtures";

const TS = "2026-07-26T13:30:00.000Z";

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
    }>(
      "SELECT payload_json, prev_hash FROM decision_ledger WHERE org_id = $1 AND sequence = 4",
      [LEDGER_ORG],
    );
    const payload = `${row.rows[0]!.payload_json} `;
    const hash = computeChainHash(payload, row.rows[0]!.prev_hash);
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

  it("L2 refuses an unregistered recorded schema or serializer version", async () => {
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
      level: "L2",
      reason: "unsupported ledger encoding 1.0.0/9.0.0",
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
      (event) => event.type === "ReservationReleased",
    )!;
    const event = LedgerEntrySchema.parse({
      ...raw,
      firmId: LEDGER_OTHER_ORG,
      id: "firm-b:event",
      actor: { firmId: LEDGER_OTHER_ORG, systemId: "ledger-test" },
      reservationRef: { firmId: LEDGER_OTHER_ORG, id: "reservation:b" },
      causationRef: { firmId: LEDGER_OTHER_ORG, id: "ledger:decision:0" },
    });
    const payload = canonicalJson(event as unknown as JsonValue);
    const actor = canonicalJson(event.actor as unknown as JsonValue);
    expect(payload.ok && actor.ok).toBe(true);
    if (!payload.ok || !actor.ok) return;
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
        computeChainHash(payload.value, GENESIS_HASH),
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

  it("scrubs structured reasons and fails closed on PII elsewhere in a ledger event", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const approval = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalRecorded")!,
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
      structuredReason: "Reviewed by analyst@firm.test.",
    });
    await expect(append(db, [approval])).resolves.toHaveLength(1);
    const appended = (await listDecisionLedger(db, LEDGER_ORG)).at(-1)!;
    expect(appended.payloadJson).not.toContain("analyst@firm.test");
    expect(appended.payloadJson).toContain("[REDACTED]");

    const unsafeStatus = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ExecutionFailed")!,
      sourceStatus: "forwarded by analyst@firm.test",
    });
    await expect(append(db, [unsafeStatus])).rejects.toMatchObject({
      code: "PII_VIOLATION",
    });
    expect((await listDecisionLedger(db, LEDGER_ORG))).toHaveLength(6);
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
