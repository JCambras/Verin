import { createHash } from "node:crypto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
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
} from "@infra/ledger/ledger-verification";
import { FIRM_RECORD_ORIGIN } from "@infra/store/record-origin";
import { computeChainHash, GENESIS_HASH } from "@infra/audit/hash-chain";
import { auditedWrite } from "@infra/audit/audited-write";
import { verifyAndListOrgChain } from "@infra/audit/audit-store";
import { decisionLedgerChainPreimage } from "@infra/ledger/ledger-schema-registry";
import {
  LedgerEntrySchema,
  type LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { DecisionInputBundleSchema } from "@contracts/decision-core/evidence";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import {
  deriveArtifactProvenance,
  parseRecordProvenance,
} from "@contracts/provenance";
import {
  LEDGER_EXPORT_GRANT,
  LEDGER_LATER,
  LEDGER_ORG,
  LEDGER_OTHER_ORG,
  LEDGER_OTHER_TENANT,
  LEDGER_PII_GRANT,
  LEDGER_PROVENANCE,
  LEDGER_TENANT,
  LEDGER_WRITE_ACTOR,
  PLAN_COMPENSATION_IDEMPOTENCY_KEY,
  allLedgerEventSamples,
  compensatedRecordingInput,
  decisionRecordingInput,
  laterEvidenceRecording,
} from "../helpers/ledger-fixtures";

const TS = "2026-07-26T13:30:00.000Z";
/** Well-formed, machine-shaped, and absent from the immutable plan. */
const UNPLANNED_ID = "52345678-1234-4123-8123-123456789012";

/**
 * The shipped reads are the verified ones: a grant-authorized listing comes with its
 * integrity verdict, and a chain verdict comes with retained-source verification.
 * These projections keep the assertions below aimed at one of those two facts.
 */
const listDecisionLedger = async (
  store: SqlDb,
  exportGrant: typeof LEDGER_EXPORT_GRANT,
  piiGrant: typeof LEDGER_PII_GRANT,
) => (await verifyAndListDecisionLedger(store, exportGrant, piiGrant)).rows;

const verifyDecisionLedger = async (
  store: SqlDb,
  tenant: typeof LEDGER_TENANT,
) => (await verifyDecisionLedgerIntegrity(store, tenant)).ledger;

function hashPreimage(value: unknown): string {
  const canonical = canonicalJson(value as JsonValue);
  if (!canonical.ok) throw canonical.error;
  return createHash("sha256").update(canonical.value, "utf8").digest("hex");
}

async function rewriteLastLedgerEvent(
  db: SqlDb,
  transform: (event: LedgerEntry) => LedgerEntry,
): Promise<void> {
  const stored = await db.query<{
    sequence: number | string;
    payload_json: string;
    prev_hash: string;
    schema_version: string;
    serializer_version: string;
    prov_source: string;
    prov_asof: string;
    prov_confidence: string;
  }>(
    `SELECT sequence, payload_json, prev_hash, schema_version, serializer_version,
            prov_source, prov_asof, prov_confidence
       FROM decision_ledger
      WHERE org_id = $1
      ORDER BY sequence DESC
      LIMIT 1`,
    [LEDGER_ORG],
  );
  const row = stored.rows[0]!;
  const event = transform(LedgerEntrySchema.parse(JSON.parse(row.payload_json)));
  const payload = canonicalJson(event as unknown as JsonValue);
  const actor = canonicalJson(event.actor as unknown as JsonValue);
  const provenance = parseRecordProvenance({
    source: row.prov_source,
    asOf: row.prov_asof,
    confidence: row.prov_confidence,
  });
  expect(payload.ok && actor.ok && provenance).toBeTruthy();
  if (!payload.ok || !actor.ok || !provenance) return;
  const preimage = decisionLedgerChainPreimage(
    row.schema_version,
    row.serializer_version,
    payload.value,
    provenance,
  );
  expect(preimage).not.toBeNull();
  if (!preimage) return;
  const entryHash = computeChainHash(preimage, row.prev_hash);
  await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
  await db.query(
    `UPDATE decision_ledger
        SET payload_json = $2, actor_json = $3, entry_hash = $4
      WHERE org_id = $1 AND sequence = $5`,
    [LEDGER_ORG, payload.value, actor.value, entryHash, Number(row.sequence)],
  );
  await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
  await db.query(
    "UPDATE decision_ledger_anchor SET head_hash = $2 WHERE org_id = $1",
    [LEDGER_ORG, entryHash],
  );
}

async function rechainLedger(db: SqlDb): Promise<void> {
  const stored = await db.query<{
    id: string;
    sequence: number | string;
    payload_json: string;
    schema_version: string;
    serializer_version: string;
    prov_source: string;
    prov_asof: string;
    prov_confidence: string;
  }>(
    `SELECT id, sequence, payload_json, schema_version, serializer_version,
            prov_source, prov_asof, prov_confidence
       FROM decision_ledger
      WHERE org_id = $1
      ORDER BY sequence ASC`,
    [LEDGER_ORG],
  );
  let previous = GENESIS_HASH;
  for (const row of stored.rows) {
    const provenance = parseRecordProvenance({
      source: row.prov_source,
      asOf: row.prov_asof,
      confidence: row.prov_confidence,
    });
    expect(provenance).not.toBeNull();
    if (!provenance) return;
    const preimage = decisionLedgerChainPreimage(
      row.schema_version,
      row.serializer_version,
      row.payload_json,
      provenance,
    );
    expect(preimage).not.toBeNull();
    if (!preimage) return;
    const entryHash = computeChainHash(preimage, previous);
    await db.query(
      `UPDATE decision_ledger
          SET prev_hash = $3, entry_hash = $4
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, row.id, previous, entryHash],
    );
    previous = entryHash;
  }
  const head = stored.rows.at(-1);
  await db.query(
    `UPDATE decision_ledger_anchor
        SET max_sequence = $2, entry_count = $3, head_hash = $4
      WHERE org_id = $1`,
    [LEDGER_ORG, Number(head?.sequence ?? 0), stored.rows.length, previous],
  );
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

const append = (
  db: SqlDb,
  events: Parameters<typeof appendDecisionEvents>[2],
) => db.transaction((tx) => appendDecisionEvents(tx, LEDGER_TENANT, events, LEDGER_PROVENANCE, FIRM_RECORD_ORIGIN));

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
    // The decision row's own codec key: replay dispatches the DECISION decoder from
    // these two columns, so they state the decision's encoding, not the bundle's.
    const decisionEncoding = await db.query<{
      schema_version: string;
      serializer_version: string;
    }>(
      `SELECT schema_version, serializer_version
         FROM decision_records WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, "dec:GC-01:0001"],
    );
    expect(decisionEncoding.rows[0]).toEqual({
      schema_version: DECISION_CORE_SCHEMA_VERSION,
      serializer_version: CANONICAL_SERIALIZER_VERSION,
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
      causationRef: { firmId: LEDGER_ORG, id: "test:missing-cause" },
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

  it("refuses a sealed authority for another tenant before opening a transaction", async () => {
    let transactionOpened = false;
    const measured: SqlDb = {
      ...db,
      transaction: async () => {
        transactionOpened = true;
        throw new Error("unexpected transaction");
      },
    };
    const result = await recordDecision(
      measured,
      LEDGER_OTHER_TENANT,
      decisionRecordingInput(),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("AUTH_FAILED");
    expect(transactionOpened).toBe(false);
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

  it("L2 reapplies the ledger PII boundary to correctly rechained bytes", async () => {
    await recordFixture(db);
    await rewriteLastLedgerEvent(db, (event) => LedgerEntrySchema.parse({
      ...event,
      actor: { firmId: LEDGER_ORG, systemId: "unsafe@firm.test" },
    }));
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L2");
  });

  it("L2 rechecks immutable decision hashes after a privileged rechain", async () => {
    await recordFixture(db);
    await rewriteLastLedgerEvent(db, (event) => LedgerEntrySchema.parse({
      ...event,
      decisionHash: "f".repeat(64),
    }));
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L2");
  });

  it("refuses approval and execution identifiers absent from the immutable decision", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const approval = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalRecorded")!,
      id: "22345678-1234-4123-8123-123456789012",
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
      stageId: "12345678-1234-4123-8123-123456789012",
    });
    await expect(append(db, [approval])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    const execution = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ExecutionStarted")!,
      id: "32345678-1234-4123-8123-123456789012",
      stepId: "12345678-1234-4123-8123-123456789012",
    });
    await expect(append(db, [execution])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    const escalation = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "42345678-1234-4123-8123-123456789012",
      priorDecisionHash: input.decisionRecord.decisionHash,
      roleIds: [{ firmId: LEDGER_ORG, id: "operations" }],
    });
    await expect(append(db, [escalation])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
  });

  it("refuses payload fields the immutable execution plan does not authorize", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const started = samples.find((event) => event.type === "ExecutionStarted")!;
    const created = samples.find((event) => event.type === "ReservationCreated")!;
    const closed = samples.find((event) => event.type === "VerificationClosed")!;
    const refusals = [
      [
        { ...started, idempotencyKey: UNPLANNED_ID },
        "ledger idempotency key is absent from the immutable execution step",
      ],
      [
        { ...created, reservationRef: { firmId: LEDGER_ORG, id: UNPLANNED_ID } },
        "ledger reservation is absent from the immutable execution plan",
      ],
      [
        { ...created, conflictKeys: [UNPLANNED_ID] },
        "ledger conflict keys differ from the immutable execution plan",
      ],
      [
        {
          ...closed,
          verificationRuleRef: { firmId: LEDGER_ORG, id: UNPLANNED_ID },
        },
        "ledger verification rule is absent from the immutable execution plan",
      ],
    ] as const;
    for (const [candidate, message] of refusals) {
      await expect(append(db, [LedgerEntrySchema.parse(candidate)]))
        .rejects.toMatchObject({ code: "STORE_CONSTRAINT", message });
    }
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
    // The plan-authorized values, unchanged, are the ones history accepts.
    await expect(append(db, [started, created, closed])).resolves.toHaveLength(3);
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
  });

  it("authorizes the compensating action's own key, and still refuses an unrelated one", async () => {
    const input = compensatedRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const started = allLedgerEventSamples().find(
      (event) => event.type === "ExecutionStarted",
    )!;
    await expect(append(db, [LedgerEntrySchema.parse({
      ...started,
      idempotencyKey: UNPLANNED_ID,
    })])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
      message: "ledger idempotency key is absent from the immutable execution step",
    });
    await expect(append(db, [LedgerEntrySchema.parse({
      ...started,
      idempotencyKey: PLAN_COMPENSATION_IDEMPOTENCY_KEY,
    })])).resolves.toHaveLength(1);
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
  });

  it.each([
    [
      "ExecutionStarted",
      { idempotencyKey: UNPLANNED_ID },
      "ledger idempotency key is absent from the immutable execution step",
    ],
    [
      "ReservationCreated",
      { conflictKeys: [UNPLANNED_ID] },
      "ledger conflict keys differ from the immutable execution plan",
    ],
    [
      "VerificationClosed",
      { verificationRuleRef: { firmId: LEDGER_ORG, id: UNPLANNED_ID } },
      "ledger verification rule is absent from the immutable execution plan",
    ],
  ] as const)(
    "L2 re-proves the plan binding of a correctly rechained %s",
    async (type, patch, reason) => {
      const input = decisionRecordingInput();
      expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
      const sample = allLedgerEventSamples().find(
        (event) => event.type === type,
      )!;
      await expect(append(db, [sample])).resolves.toHaveLength(1);
      expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);

      await rewriteLastLedgerEvent(db, (event) => LedgerEntrySchema.parse({
        ...event,
        ...patch,
      }));
      const result = await verifyDecisionLedger(db, LEDGER_TENANT);
      expect(result.ok).toBe(false);
      expect(result.levels.at(-1)).toMatchObject({ level: "L2", reason });
    },
  );

  it("L2 rejects a correctly rechained event with an unknown approval stage", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const approval = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (event) => event.type === "ApprovalRecorded",
      )!,
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
    });
    await expect(append(db, [approval])).resolves.toHaveLength(1);
    await rewriteLastLedgerEvent(db, (event) => LedgerEntrySchema.parse({
      ...event,
      stageId: "12345678-1234-4123-8123-123456789012",
    }));
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L2");
  });

  it("L2 rejects a correctly rechained causal reference to a later entry", async () => {
    await recordFixture(db);
    const samples = allLedgerEventSamples();
    const stuck = samples.find((event) => event.type === "VerificationStuck")!;
    const exception = samples.find(
      (event) => event.type === "ExceptionDecisionRequested",
    )!;
    await expect(append(db, [stuck, exception])).resolves.toHaveLength(2);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET sequence = sequence + 1000 WHERE org_id = $1 AND sequence IN (5,6)",
      [LEDGER_ORG],
    );
    await db.query(
      `UPDATE decision_ledger
          SET sequence = CASE WHEN id = $2 THEN 5 ELSE 6 END
        WHERE org_id = $1 AND id IN ($2,$3)`,
      [LEDGER_ORG, exception.id, stuck.id],
    );
    await rechainLedger(db);
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const result = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(result.ok).toBe(false);
    expect(result.levels.at(-1)?.level).toBe("L2");
  });

  it("L2 rejects a correctly rechained decision event before its recording fact", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const approval = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (event) => event.type === "ApprovalRecorded",
      )!,
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
    });
    await expect(append(db, [approval])).resolves.toHaveLength(1);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET sequence = sequence + 1000 WHERE org_id = $1 AND sequence IN (4,5)",
      [LEDGER_ORG],
    );
    await db.query(
      `UPDATE decision_ledger
          SET sequence = CASE WHEN id = $2 THEN 4 ELSE 5 END
        WHERE org_id = $1 AND id IN ($2,$3)`,
      [LEDGER_ORG, approval.id, input.events.at(-1)!.id],
    );
    await rechainLedger(db);
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");

    const full = await verifyDecisionLedger(db, LEDGER_TENANT);
    expect(full.ok).toBe(false);
    expect(full.levels.at(-1)).toMatchObject({
      level: "L2",
      brokenAtSequence: 4,
    });
    const bounded = await verifyAndListDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      2,
    );
    expect(bounded.verification.ok).toBe(false);
    expect(bounded.verification.levels.at(-1)?.level).toBe("L2");
  });

  it("does not trust a tampered historical prerequisite outside the requested tail", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const approval = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (event) => event.type === "ApprovalRecorded",
      )!,
      decisionHash: input.decisionRecord.decisionHash,
      inputBundleHash: input.inputBundle.bundleHash,
    });
    await expect(append(db, [approval])).resolves.toHaveLength(1);
    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      `UPDATE decision_ledger
          SET event_type = 'DecisionRecorded', decision_id = $2
        WHERE org_id = $1 AND sequence = 0`,
      [LEDGER_ORG, input.decisionRecord.id],
    );
    await db.query(
      `UPDATE decision_ledger
          SET event_type = 'EvidenceSnapshotRecorded', decision_id = NULL
        WHERE org_id = $1 AND sequence = 4`,
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");

    const bounded = await verifyAndListDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      1,
    );
    expect(bounded.verification.ok).toBe(false);
    expect(bounded.verification.levels.at(-1)?.level).toBe("L2");
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

  it("refuses derived producer provenance that immutable rows cannot retain", async () => {
    const provenance = deriveArtifactProvenance(
      [LEDGER_PROVENANCE],
      LEDGER_PROVENANCE.asOf,
    );
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...decisionRecordingInput(),
      provenance,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("VALIDATION");
    expect((await sourceCounts(db)).decision_ledger).toBe(0);
  });

  it("refuses derived provenance on later event appends", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const provenance = deriveArtifactProvenance(
      [LEDGER_PROVENANCE],
      LEDGER_PROVENANCE.asOf,
    );
    const event = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (sample) => sample.type === "ApprovalInvalidated",
      )!,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(
      db.transaction((tx) =>
        appendDecisionEvents(tx, LEDGER_TENANT, [event], provenance, FIRM_RECORD_ORIGIN)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
  });

  it("holds the tenant lock before reading any verification snapshot", async () => {
    await recordFixture(db);
    const statements: string[] = [];
    const measured: SqlDb = {
      ...db,
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
    expect((await verifyDecisionLedger(measured, LEDGER_TENANT)).ok).toBe(true);
    expect(statements[0]).toMatch(
      /SELECT id FROM orgs WHERE id = \$1 FOR UPDATE/,
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

  it("a windowed register authenticates the full chain before returning its tail", async () => {
    await recordFixture(db);
    const windowed = await verifyAndListDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      2,
    );
    expect(windowed.verification.ok).toBe(true);
    expect(windowed.verification.entriesChecked).toBe(5);
    expect(windowed.verification.entriesStored).toBe(5);
    expect(windowed.rows.map((row) => row.sequence)).toEqual([3, 4]);

    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update");
    await db.query(
      "UPDATE decision_ledger SET entry_hash = $2 WHERE org_id = $1 AND sequence = 2",
      [LEDGER_ORG, "f".repeat(64)],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update");
    const broken = await verifyAndListDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      2,
    );
    expect(broken.verification.ok).toBe(false);
    expect(broken.verification.levels.at(-1)).toMatchObject({
      level: "L1",
      reason: "entry_hash does not match stored canonical bytes",
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
      id: "test:firm-b:event",
      actor: { firmId: LEDGER_OTHER_ORG, systemId: "test:ledger-test" },
      reservationRef: { firmId: LEDGER_OTHER_ORG, id: "test:reservation:b" },
      decisionRef: { firmId: LEDGER_OTHER_ORG, id: "test:decision:b" },
      causationRef: { firmId: LEDGER_OTHER_ORG, id: "test:ledger:decision:0" },
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
      id: "test:ordered:first",
      recordedAt: LEDGER_LATER,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const earlierSecond = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "test:ordered:second",
      recordedAt: TS,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const result = await append(db, [laterFirst, earlierSecond]);
    expect(result.map((entry) => [entry.id, entry.sequence])).toEqual([
      ["test:ordered:first", 5],
      ["test:ordered:second", 6],
    ]);
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
  });

  it("requires causation and exception triggers to precede the citing event", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const later = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "test:causal:later",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const forwardCause = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "test:causal:forward",
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
      id: "test:trigger:forward",
      triggeringEntryRef: { firmId: LEDGER_ORG, id: later.id },
    });
    await expect(append(db, [exception, later])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
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
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
  });

  it.each([
    ["reasonCode", "ApprovalInvalidated"],
    ["failureCode", "ExecutionFailed"],
  ] as const)(
    "refuses an unregistered retained %s",
    async (field, type) => {
      const input = decisionRecordingInput();
      expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
      const sample = allLedgerEventSamples().find(
        (event) => event.type === type,
      )!;
      const event = LedgerEntrySchema.parse({
        ...sample,
        ...(type === "ApprovalInvalidated"
          ? { priorDecisionHash: input.decisionRecord.decisionHash }
          : {}),
        [field]: "robert-smith",
      });
      await expect(append(db, [event])).rejects.toMatchObject({
        code: "PII_VIOLATION",
      });
      expect((await listDecisionLedger(
        db,
        LEDGER_EXPORT_GRANT,
        LEDGER_PII_GRANT,
      ))).toHaveLength(5);
    },
  );

  it("accepts a future bundle version and names an unsupported one precisely", async () => {
    const withVersions = (engineVersion: string, primitiveSetVersion: string) => {
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
      return {
        ...input,
        inputBundle,
        events: [
          ...input.events.slice(0, -1),
          LedgerEntrySchema.parse({
            ...input.events.at(-1)!,
            bundleHash: inputBundle.bundleHash,
          }),
        ],
      };
    };
    const unsupported = await recordDecision(
      db,
      LEDGER_TENANT,
      withVersions("engine build 7", "0"),
    );
    expect(unsupported.ok).toBe(false);
    expect(unsupported.ok ? null : unsupported.error).toMatchObject({
      code: "VALIDATION",
      message: "decision input bundle declares an unsupported engine version",
    });
    // A grammar alone would let an account number through as a "version".
    const accountShaped = await recordDecision(
      db,
      LEDGER_TENANT,
      withVersions("0.0.0", "123456789012"),
    );
    expect(accountShaped.ok).toBe(false);
    expect(accountShaped.ok ? null : accountShaped.error.code).toBe("PII_VIOLATION");
    const forward = await recordDecision(
      db,
      LEDGER_TENANT,
      withVersions("1.4.2-rc.1", "3"),
    );
    expect(forward.ok, forward.ok ? "" : forward.error.message).toBe(true);
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

  it("accepts a canonical machine UUID that contains account-like digit runs", async () => {
    const input = decisionRecordingInput();
    const snapshot = {
      ...input.evidenceSnapshots[0]!,
      sourceRef: {
        ...input.evidenceSnapshots[0]!.sourceRef,
        id: "12345678-1234-4123-8123-123456789012",
      },
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
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
  });

  it("refuses a person name used only as an immutable source identifier", async () => {
    const input = decisionRecordingInput();
    const snapshot = {
      ...input.evidenceSnapshots[0]!,
      sourceRef: {
        ...input.evidenceSnapshots[0]!.sourceRef,
        id: "Robert Smith",
      },
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

  it.each([
    "unsafe@firm.test",
    "123456789012",
    "robert-smith",
    "subject:ROBERT-SMITH",
    "subject:ROBERT-SMITH:1",
    "subject:robert-smith",
    "subject:robert-smith:1",
    "subject:first",
    "source:grace",
    "robert@1",
  ])(
    "refuses a PII-shaped immutable source identifier (%s)",
    async (id) => {
      const input = decisionRecordingInput();
      const snapshot = {
        ...input.evidenceSnapshots[0]!,
        sourceRef: { ...input.evidenceSnapshots[0]!.sourceRef, id },
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
      expect((await sourceCounts(db)).decision_ledger).toBe(0);
    },
  );

  it("refuses an unclassified sensitive-length numeric recommendation parameter", async () => {
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
          parameters: {
            ...input.decisionRecord.result.recommendation.parameters,
            unclassifiedNumber: 123456789,
          },
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
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe("PII_VIOLATION");
    expect((await sourceCounts(db)).decision_ledger).toBe(0);
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
    expect(broken.replaySourceReason).toBe(
      "unsupported evidence encoding 9.0.0/1.0.0 during replay",
    );
  });

  it("re-throws an outage instead of reporting a broken decision chain", async () => {
    await recordFixture(db);
    const unavailable: SqlDb = {
      ...db,
      transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
        return db.transaction((tx) => fn({
          ...tx,
          async query<U>(sql: string, params?: unknown[]) {
            if (sql.includes("decision_input_bundle_evidence")) {
              throw new Error("connection terminated unexpectedly");
            }
            return tx.query<U>(sql, params);
          },
        }));
      },
    };
    await expect(
      verifyDecisionLedgerIntegrity(unavailable, LEDGER_TENANT),
    ).rejects.toThrow("connection terminated unexpectedly");
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
      expect(project(await listDecisionLedger(
        other,
        LEDGER_EXPORT_GRANT,
        LEDGER_PII_GRANT,
      ))).toEqual(
        project(await listDecisionLedger(
          db,
          LEDGER_EXPORT_GRANT,
          LEDGER_PII_GRANT,
        )),
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

  it("keeps the classified refusal when savepoint recovery itself fails", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const event = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (sample) => sample.type === "ApprovalStageExpired",
      )!,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const abort = new Error("test abort");
    await expect(db.transaction(async (tx) => {
      const exec = tx.exec.bind(tx);
      tx.exec = (sql: string) =>
        sql.startsWith("ROLLBACK TO SAVEPOINT")
          ? Promise.reject(new TypeError("connection lost mid-recovery"))
          : exec(sql);
      await appendDecisionEvents(tx, LEDGER_TENANT, [event], LEDGER_PROVENANCE, FIRM_RECORD_ORIGIN);
      // The same entry twice: the substrate refuses, and recovery cannot run. The
      // caller still owes its transaction a verdict it can act on.
      await expect(
        appendDecisionEvents(tx, LEDGER_TENANT, [event], LEDGER_PROVENANCE, FIRM_RECORD_ORIGIN),
      ).rejects.toMatchObject({
        code: "STORE_CONSTRAINT",
        message: "decision ledger append violated a store constraint",
      });
      throw abort;
    })).rejects.toBe(abort);
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
  });

  it("classifies a prologue failure and leaves an unopened savepoint alone", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const event = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (sample) => sample.type === "ApprovalStageExpired",
      )!,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const abort = new Error("test abort");
    await expect(db.transaction(async (tx) => {
      const query = tx.query.bind(tx);
      const statements: string[] = [];
      const exec = tx.exec.bind(tx);
      tx.exec = (sql: string) => {
        statements.push(sql);
        return exec(sql);
      };
      // The tenant row is the designed contention point for concurrent appends: a
      // deadlock or lock timeout there is a store failure, not raw driver prose.
      tx.query = ((sql: string, params?: unknown[]) =>
        sql.includes("FROM orgs")
          ? Promise.reject(new TypeError("lock wait timeout on the tenant row"))
          : query(sql, params)) as typeof tx.query;
      await expect(
        appendDecisionEvents(tx, LEDGER_TENANT, [event], LEDGER_PROVENANCE, FIRM_RECORD_ORIGIN),
      ).rejects.toMatchObject({
        code: "INTERNAL",
        message: "decision ledger append failed",
      });
      // A typed refusal from the same prologue still reaches the caller unchanged.
      tx.query = ((sql: string, params?: unknown[]) =>
        sql.includes("FROM orgs")
          ? Promise.resolve({ rows: [] })
          : query(sql, params)) as typeof tx.query;
      await expect(
        appendDecisionEvents(tx, LEDGER_TENANT, [event], LEDGER_PROVENANCE, FIRM_RECORD_ORIGIN),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "decision ledger tenant does not exist",
      });
      // Recovery never ran against a savepoint the prologue never opened.
      expect(statements).toEqual([]);
      throw abort;
    })).rejects.toBe(abort);
    expect(await listDecisionLedger(db, LEDGER_EXPORT_GRANT, LEDGER_PII_GRANT))
      .toHaveLength(5);
  });

  it("persists evidence gathered after the decision and refuses an uncited snapshot", async () => {
    await recordFixture(db);
    const observed = allLedgerEventSamples().find(
      (event) => event.type === "StatusObserved",
    )!;
    await expect(append(db, [observed])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });

    const later = laterEvidenceRecording("test:evidence:status:1");
    const cited = LedgerEntrySchema.parse({
      ...observed,
      evidenceSnapshotRef: { firmId: LEDGER_ORG, id: later.snapshot.id },
    });
    await expect(db.transaction((tx) => appendDecisionEvents(
      tx,
      LEDGER_TENANT,
      [later.event, cited],
      LEDGER_PROVENANCE,
      FIRM_RECORD_ORIGIN,
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
      [laterEvidenceRecording("test:evidence:status:2").event],
      LEDGER_PROVENANCE,
      FIRM_RECORD_ORIGIN,
    ))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("preflights every later evidence source before inserting any of them", async () => {
    await recordFixture(db);
    const later = laterEvidenceRecording("test:evidence:atomic-refusal");
    const input = decisionRecordingInput();
    const collision = {
      ...input.evidenceSnapshots[0]!,
      freshness: "stale" as const,
    };
    const collisionEvent = LedgerEntrySchema.parse({
      ...input.events[0]!,
      id: "test:ledger:evidence:collision",
      snapshotHash: hashPreimage(collision),
    });
    await db.transaction(async (tx) => {
      try {
        await appendDecisionEvents(
          tx,
          LEDGER_TENANT,
          [later.event, collisionEvent],
          LEDGER_PROVENANCE,
          FIRM_RECORD_ORIGIN,
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
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
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
          FIRM_RECORD_ORIGIN,
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

  it("updates the ledger anchor once per committed batch and writes no other cursor", async () => {
    const statements: string[] = [];
    const measured: SqlDb = {
      ...db,
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
    const result = await recordDecision(
      measured,
      LEDGER_TENANT,
      decisionRecordingInput(),
    );
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    expect(
      statements.filter((sql) => sql.includes("INSERT INTO decision_ledger_anchor")),
    ).toHaveLength(1);
    expect(
      statements.filter((sql) =>
        sql.includes("decision_projection_checkpoint")),
    ).toEqual([]);
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
      FIRM_RECORD_ORIGIN,
    )).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(5);
  });

  it("accepts a transaction capability created by another module evaluation", async () => {
    vi.resetModules();
    const bundledStore = await import("@infra/store/db");
    const bundledDb = await bundledStore.createMemoryDb();
    try {
      await seedOrg(bundledDb, LEDGER_ORG);
      const input = decisionRecordingInput();
      expect((await recordDecision(bundledDb, LEDGER_TENANT, input)).ok).toBe(
        true,
      );
      const event = LedgerEntrySchema.parse({
        ...allLedgerEventSamples().find(
          (sample) => sample.type === "ApprovalStageExpired",
        )!,
        priorDecisionHash: input.decisionRecord.decisionHash,
      });
      await expect(bundledDb.transaction((tx) =>
        appendDecisionEvents(
          tx,
          LEDGER_TENANT,
          [event],
          LEDGER_PROVENANCE,
          FIRM_RECORD_ORIGIN,
        ))).resolves.toHaveLength(1);
    } finally {
      await bundledDb.close();
    }
  });

  it("composes CRM mutation, operational audit intent, and ledger append in one transaction", async () => {
    await recordFixture(db);
    const samples = allLedgerEventSamples();
    const started = samples.find((event) => event.type === "ExecutionStarted")!;
    const write = await auditedWrite({
      db,
      actor: LEDGER_WRITE_ACTOR,
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
        await appendDecisionEvents(tx, LEDGER_TENANT, [started], LEDGER_PROVENANCE, FIRM_RECORD_ORIGIN);
        return { id: "task-ledger-ok" };
      },
    });
    expect(write.ok).toBe(true);
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(6);
    expect(
      (await verifyAndListOrgChain(db, LEDGER_EXPORT_GRANT)).rows.at(-1)?.action,
    ).toBe("task.create");

    const unsafe = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ExecutionFailed")!,
      sourceStatus: "reported by unsafe@firm.test",
    });
    const refused = await auditedWrite({
      db,
      actor: LEDGER_WRITE_ACTOR,
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
        await appendDecisionEvents(tx, LEDGER_TENANT, [unsafe], LEDGER_PROVENANCE, FIRM_RECORD_ORIGIN);
        return { id: "task-ledger-refused" };
      },
    });
    expect(refused.ok).toBe(false);
    const tasks = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM tasks WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, "task-ledger-refused"],
    );
    expect(Number(tasks.rows[0]!.n)).toBe(0);
    expect((await listDecisionLedger(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
    ))).toHaveLength(6);
    expect(
      (await verifyAndListOrgChain(db, LEDGER_EXPORT_GRANT)).rows.at(-1)?.action,
    ).toBe("task.create.failed");
  });
});
