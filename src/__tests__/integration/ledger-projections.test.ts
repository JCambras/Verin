import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryDb,
  type SqlDb,
  type SqlResult,
  type SqlTx,
} from "@infra/store/db";
import {
  appendDecisionEvents,
  rebuildDecisionProjections,
  recordDecision,
} from "@infra/ledger/ledger-store";
import { listDecisionProjections } from "@infra/ledger/ledger-projection-store";
import { verifyDecisionLedgerIntegrity } from "@infra/ledger/ledger-verification";
import { readVerifiedDecisionRegister } from "@infra/ledger/ledger-register";
import { LedgerEntrySchema } from "@contracts/decision-core/ledger";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import {
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { canFeedComplianceDecision } from "@contracts/provenance";
import { createHash } from "node:crypto";
import {
  LEDGER_EXPORT_GRANT,
  LEDGER_ORG,
  LEDGER_PII_GRANT,
  LEDGER_PROVENANCE,
  LEDGER_TENANT,
  LEDGER_TIME,
  allLedgerEventSamples,
  decisionRecordingInput,
  reusedBundleRecordingInput,
} from "../helpers/ledger-fixtures";

const TS = "2026-07-26T13:30:00.000Z";

const verifyDecisionLedger = async (
  store: SqlDb,
  tenant: typeof LEDGER_TENANT,
) => (await verifyDecisionLedgerIntegrity(store, tenant)).ledger;

function blockedRecordingInput() {
  const input = decisionRecordingInput();
  const candidate = DecisionRecordSchema.parse({
    ...input.decisionRecord,
    result: {
      kind: "blocked",
      blockers: [{
        code: "additional-evidence-required",
        explanation: "additional-evidence-required",
        resolvingEvidence: [{
          evidenceKind: "account-balance",
          subjectRef: { firmId: LEDGER_ORG, id: "test:subject:0" },
          suppliableBy: ["external"],
        }],
      }],
    },
    decisionHash: "0".repeat(64),
  });
  const preimage = canonicalJson(
    decisionHashPreimage(candidate) as unknown as JsonValue,
  );
  if (!preimage.ok) throw preimage.error;
  const decisionRecord = DecisionRecordSchema.parse({
    ...candidate,
    decisionHash: createHash("sha256")
      .update(preimage.value, "utf8")
      .digest("hex"),
  });
  return {
    ...input,
    decisionRecord,
    events: [
      ...input.events.slice(0, -1),
      LedgerEntrySchema.parse({
        ...input.events.at(-1)!,
        decisionHash: decisionRecord.decisionHash,
      }),
    ],
  };
}

async function seed(db: SqlDb): Promise<void> {
  await db.query(
    `INSERT INTO orgs
      (id,name,created_at,prov_source,prov_asof,prov_confidence)
     VALUES ($1,'Synthetic Projection Firm',$2,'synthetic-ledger-test',$2,'high')`,
    [LEDGER_ORG, TS],
  );
}

const append = (
  db: SqlDb,
  events: Parameters<typeof appendDecisionEvents>[2],
) => db.transaction((tx) => appendDecisionEvents(tx, LEDGER_TENANT, events, LEDGER_PROVENANCE));

describe("deterministic decision-ledger projections", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("rebuilds an empty projection store byte-identically using the online fold", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const escalation = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "test:projection:escalation",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const expiry = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "test:projection:expiry",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(append(db, [escalation, expiry])).resolves.toHaveLength(2);
    const online = await listDecisionProjections(db, LEDGER_TENANT);

    await db.query(
      "DELETE FROM decision_state_projection WHERE org_id = $1",
      [LEDGER_ORG],
    );
    await db.query(
      "DELETE FROM decision_projection_checkpoint WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(await listDecisionProjections(db, LEDGER_TENANT)).toEqual([]);
    const rebuilt = await rebuildDecisionProjections(db, LEDGER_TENANT);

    expect(rebuilt.entriesReplayed).toBe(7);
    expect(rebuilt.projections).toEqual(online);
    expect(rebuilt.projections[0]?.projection).toMatchObject({
      lastEventType: "ApprovalStageExpired",
      lastSequence: 6,
      approvalStages: [{
        stageId: "ops-dual-approval",
        status: "expired",
        escalationStepIndex: 0,
        escalationMode: "add",
      }],
    });
  });

  it("repairs corrupted derived state but refuses a truncated ledger", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageEscalated",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(append(db, [event])).resolves.toHaveLength(1);
    const expected = await listDecisionProjections(db, LEDGER_TENANT);

    await db.query(
      "UPDATE decision_state_projection SET state_json = '{}' WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(await listDecisionProjections(db, LEDGER_TENANT)).not.toEqual(expected);
    expect(
      (
        await readVerifiedDecisionRegister(
          db,
          LEDGER_EXPORT_GRANT,
          LEDGER_PII_GRANT,
          200,
          50,
        )
      ).decisions,
    ).toEqual(expected);
    expect(
      (await rebuildDecisionProjections(db, LEDGER_TENANT)).projections,
    ).toEqual(expected);

    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_delete");
    await db.query(
      "DELETE FROM decision_ledger WHERE org_id = $1 AND sequence = 5",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_delete");
    await expect(rebuildDecisionProjections(db, LEDGER_TENANT)).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("releases a reservation against its owning decision and refuses a competing live claim", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const created = samples.find((event) => event.type === "ReservationCreated")!;
    const released = samples.find((event) => event.type === "ReservationReleased")!;
    await expect(append(db, [created])).resolves.toHaveLength(1);
    const owner = await db.query<{ decision_id: string; status: string }>(
      `SELECT decision_id, status FROM decision_reservation_index
        WHERE org_id = $1 AND reservation_id = $2`,
      [LEDGER_ORG, "test:reservation:1"],
    );
    expect(owner.rows[0]).toEqual({
      decision_id: "dec:GC-01:0001",
      status: "active",
    });

    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    const recorded = await recordDecision(db, LEDGER_TENANT, second);
    expect(recorded.ok, recorded.ok ? "" : recorded.error.message).toBe(true);
    const bundles = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM decision_input_bundles WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(Number(bundles.rows[0]!.n)).toBe(1);

    const competing = LedgerEntrySchema.parse({
      ...created,
      id: "test:projection:reservation-conflict",
      decisionRef: { firmId: LEDGER_ORG, id: "dec:GC-01:0002" },
    });
    await expect(append(db, [competing])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });

    await expect(append(db, [released])).resolves.toHaveLength(1);
    const state = (await listDecisionProjections(db, LEDGER_TENANT))[0]!.projection;
    expect(state.reservations).toEqual([
      {
        reservationId: "test:reservation:1",
        creationEntryId: created.id,
        status: "released",
      },
    ]);
    expect((await rebuildDecisionProjections(db, LEDGER_TENANT)).projections).toEqual(
      await listDecisionProjections(db, LEDGER_TENANT),
    );
  });

  it("does not insert a conflicting reservation event before projection validation", async () => {
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
      id: "test:projection:conflict-swallowed",
      decisionRef: { firmId: LEDGER_ORG, id: second.decisionRecord.id },
    });
    await db.transaction(async (tx) => {
      try {
        await appendDecisionEvents(
          tx,
          LEDGER_TENANT,
          [competing],
          LEDGER_PROVENANCE,
        );
      } catch {
        return;
      }
    });
    const rows = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM decision_ledger WHERE org_id = $1 AND id = $2",
      [LEDGER_ORG, competing.id],
    );
    expect(Number(rows.rows[0]!.n)).toBe(0);
    expect((await verifyDecisionLedger(db, LEDGER_TENANT)).ok).toBe(true);
  });

  it("refuses a competing reservation after its derived index row is deleted", async () => {
    const first = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, first)).ok).toBe(true);
    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    expect((await recordDecision(db, LEDGER_TENANT, second)).ok).toBe(true);
    const created = allLedgerEventSamples().find(
      (event) => event.type === "ReservationCreated",
    )!;
    await expect(append(db, [created])).resolves.toHaveLength(1);
    await db.query(
      "DELETE FROM decision_reservation_index WHERE org_id = $1 AND reservation_id = $2",
      [LEDGER_ORG, created.reservationRef.id],
    );
    const competing = LedgerEntrySchema.parse({
      ...created,
      id: "test:projection:reservation-conflict",
      decisionRef: { firmId: LEDGER_ORG, id: second.decisionRecord.id },
    });
    await expect(append(db, [competing])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
  });

  it("does not let a delayed release affect a reused reservation identifier", async () => {
    const first = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, first)).ok).toBe(true);
    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    expect((await recordDecision(db, LEDGER_TENANT, second)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const created = samples.find((event) => event.type === "ReservationCreated")!;
    const released = samples.find((event) => event.type === "ReservationReleased")!;
    await expect(append(db, [created, released])).resolves.toHaveLength(2);
    const reused = LedgerEntrySchema.parse({
      ...created,
      id: "test:projection:reservation-reused",
      decisionRef: { firmId: LEDGER_ORG, id: second.decisionRecord.id },
    });
    await expect(append(db, [reused])).resolves.toHaveLength(1);
    const crossOwner = LedgerEntrySchema.parse({
      ...released,
      id: "test:projection:cross-owner-release",
      reservationCreationRef: { firmId: LEDGER_ORG, id: reused.id },
    });
    await expect(append(db, [crossOwner])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    const wrongGeneration = LedgerEntrySchema.parse({
      ...released,
      id: "test:projection:wrong-generation-release",
      decisionRef: { firmId: LEDGER_ORG, id: second.decisionRecord.id },
      reservationCreationRef: {
        firmId: LEDGER_ORG,
        id: "test:projection:missing-generation",
      },
    });
    await expect(append(db, [wrongGeneration])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });
    const delayedRelease = LedgerEntrySchema.parse({
      ...released,
      id: "test:projection:delayed-release",
    });
    await expect(append(db, [delayedRelease])).resolves.toHaveLength(1);
    const projections = await listDecisionProjections(db, LEDGER_TENANT);
    const newOwner = projections.find(({ projection }) =>
      projection.decisionId === second.decisionRecord.id
    )!.projection;
    expect(newOwner.reservations).toContainEqual({
      reservationId: "test:reservation:1",
      creationEntryId: reused.id,
      status: "active",
    });
    expect((await rebuildDecisionProjections(db, LEDGER_TENANT)).projections).toEqual(
      await listDecisionProjections(db, LEDGER_TENANT),
    );
  });

  it("replaces an observed execution placeholder when the real step arrives", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const observedSample = samples.find(
      (event) => event.type === "StatusObserved",
    )!;
    if (observedSample.type !== "StatusObserved") {
      throw new Error("expected status observation fixture");
    }
    const observedWithoutEvidence = { ...observedSample };
    delete observedWithoutEvidence.evidenceSnapshotRef;
    const observed = LedgerEntrySchema.parse(observedWithoutEvidence);
    const succeeded = samples.find(
      (event) => event.type === "ExecutionSucceeded",
    )!;
    await expect(append(db, [observed, succeeded])).resolves.toHaveLength(2);
    const projection = (await listDecisionProjections(db, LEDGER_TENANT))[0]!
      .projection;
    expect(projection.executionSteps).toEqual([{
      stepId: succeeded.type === "ExecutionSucceeded" ? succeeded.stepId : "",
      status: "succeeded",
      sourceStatus: "submitted",
      executionHandleId: "test:handle:1",
    }]);
  });

  it("represents blocked decisions with no authority mode", async () => {
    const input = blockedRecordingInput();
    const recorded = await recordDecision(db, LEDGER_TENANT, input);
    expect(recorded.ok, recorded.ok ? "" : recorded.error.message).toBe(true);
    const state = (await listDecisionProjections(db, LEDGER_TENANT))[0]!.projection;
    expect(state.disposition).toBe("blocked");
    expect(state.approvalMode).toBe("none");
  });

  it("labels replayed state by its least trustworthy event, not by the recording one", async () => {
    const recorded = decisionRecordingInput();
    const real = await recordDecision(db, LEDGER_TENANT, {
      ...recorded,
      provenance: { source: "verin-crm", asOf: LEDGER_TIME, confidence: "high" },
    });
    expect(real.ok, real.ok ? "" : real.error.message).toBe(true);
    const clean = (await listDecisionProjections(db, LEDGER_TENANT))[0]!;
    expect(clean.provenance.demonstration).toBe(false);
    expect(canFeedComplianceDecision(clean.provenance)).toBe(true);

    const escalation = LedgerEntrySchema.parse({
      ...allLedgerEventSamples().find(
        (event) => event.type === "ApprovalStageEscalated",
      )!,
      priorDecisionHash: recorded.decisionRecord.decisionHash,
    });
    await expect(append(db, [escalation])).resolves.toHaveLength(1);
    const mixed = (await listDecisionProjections(db, LEDGER_TENANT))[0]!;
    // One synthetic event makes the whole displayed fold a demonstration (ADR-0022).
    expect(mixed.provenance.demonstration).toBe(true);
    expect(mixed.provenance.derivedFrom).toContain("fixture");
    expect(canFeedComplianceDecision(mixed.provenance)).toBe(false);
    expect(
      (await rebuildDecisionProjections(db, LEDGER_TENANT)).projections,
    ).toEqual([mixed]);
  });

  it("does not relabel a fixture bundle when a real producer reuses it", async () => {
    expect(
      (await recordDecision(db, LEDGER_TENANT, decisionRecordingInput())).ok,
    ).toBe(true);
    const reused = reusedBundleRecordingInput("dec:GC-01:0002");
    const result = await recordDecision(db, LEDGER_TENANT, {
      ...reused,
      provenance: {
        source: "verin-crm",
        asOf: LEDGER_TIME,
        confidence: "high",
      },
    });
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
    const projections = await listDecisionProjections(db, LEDGER_TENANT);
    const reusedProjection = projections.find(
      ({ projection }) => projection.decisionId === "dec:GC-01:0002",
    )!;
    expect(reusedProjection.provenance.demonstration).toBe(true);
    expect(reusedProjection.provenance.derivedFrom).toContain("fixture");
    expect(canFeedComplianceDecision(reusedProjection.provenance)).toBe(false);
    const register = await readVerifiedDecisionRegister(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      200,
      50,
    );
    const registeredReuse = register.decisions.find(
      ({ projection }) => projection.decisionId === "dec:GC-01:0002",
    )!;
    expect(registeredReuse.provenance.demonstration).toBe(true);
    expect(registeredReuse.provenance.derivedFrom).toContain("fixture");
    expect(
      (await rebuildDecisionProjections(db, LEDGER_TENANT)).projections,
    ).toEqual(projections);
  });

  it("bounds a request-path read while reporting how many decisions exist", async () => {
    expect((await recordDecision(db, LEDGER_TENANT, decisionRecordingInput())).ok).toBe(true);
    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    expect((await recordDecision(db, LEDGER_TENANT, second)).ok).toBe(true);
    const register = await readVerifiedDecisionRegister(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      200,
      1,
    );
    expect(register.decisions.map(({ projection }) => projection.decisionId))
      .toEqual(["dec:GC-01:0002"]);
    expect(register.decisionsTotal).toBe(2);
    expect(await listDecisionProjections(db, LEDGER_TENANT)).toHaveLength(2);
  });

  it("keeps derived decision state one row per decision, not per event", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageExpired",
    )!;
    const events = Array.from({ length: 80 }, (_, index) =>
      LedgerEntrySchema.parse({
        ...sample,
        id: `test:projection:bounded:${index}`,
        priorDecisionHash: input.decisionRecord.decisionHash,
      }));
    await expect(append(db, events)).resolves.toHaveLength(events.length);
    let largestResult = 0;
    const measured: SqlDb = {
      ...db,
      async query<T>(
        sql: string,
        params?: unknown[],
      ): Promise<SqlResult<T>> {
        const result = await db.query<T>(sql, params);
        largestResult = Math.max(largestResult, result.rows.length);
        return result;
      },
    };
    expect(await listDecisionProjections(measured, LEDGER_TENANT)).toHaveLength(1);
    expect(largestResult).toBe(1);
  });

  it("verifies a consistent register snapshot without holding the tenant write lock", async () => {
    expect((await recordDecision(db, LEDGER_TENANT, decisionRecordingInput())).ok).toBe(true);
    expect(
      (await recordDecision(
        db,
        LEDGER_TENANT,
        reusedBundleRecordingInput("dec:GC-01:0002"),
      )).ok,
    ).toBe(true);
    let directQueries = 0;
    let transactions = 0;
    const statements: string[] = [];
    const measured: SqlDb = {
      ...db,
      async query<T>(
        sql: string,
        params?: unknown[],
      ): Promise<SqlResult<T>> {
        directQueries += 1;
        statements.push(sql);
        return db.query<T>(sql, params);
      },
      transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
        transactions += 1;
        return db.transaction((tx) =>
          fn({
            ...tx,
            async query<U>(
              sql: string,
              params?: unknown[],
            ): Promise<SqlResult<U>> {
              statements.push(sql);
              return tx.query<U>(sql, params);
            },
          }));
      },
    };
    const snapshot = await readVerifiedDecisionRegister(
      measured,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      200,
      1,
    );
    expect(snapshot.verification.ok).toBe(true);
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.decisionsTotal).toBe(2);
    expect(directQueries).toBeGreaterThan(0);
    expect(transactions).toBe(0);
    expect(statements[0]).toMatch(
      /LEFT JOIN decision_ledger_anchor[\s\S]*LEFT JOIN decision_ledger/,
    );
    expect(statements.join("\n")).not.toMatch(/FOR UPDATE/);
    expect(
      statements.some((sql) => sql.includes("decision_state_projection")),
    ).toBe(false);
  });

  it("batch-loads register replay sources before folding the event window", async () => {
    expect(
      (await recordDecision(db, LEDGER_TENANT, decisionRecordingInput())).ok,
    ).toBe(true);
    for (let index = 2; index <= 14; index += 1) {
      expect(
        (await recordDecision(
          db,
          LEDGER_TENANT,
          reusedBundleRecordingInput(`dec:GC-01:${String(index).padStart(4, "0")}`),
        )).ok,
      ).toBe(true);
    }
    const statements: string[] = [];
    const measured: SqlDb = {
      ...db,
      async query<T>(
        sql: string,
        params?: unknown[],
      ): Promise<SqlResult<T>> {
        statements.push(sql);
        return db.query<T>(sql, params);
      },
      transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
        return db.transaction((tx) => fn({
          ...tx,
          async query<U>(
            sql: string,
            params?: unknown[],
          ): Promise<SqlResult<U>> {
            statements.push(sql);
            return tx.query<U>(sql, params);
          },
        }));
      },
    };
    const snapshot = await readVerifiedDecisionRegister(
      measured,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      200,
      1,
    );
    expect(snapshot.decisions).toHaveLength(1);
    expect(snapshot.decisionsTotal).toBe(14);
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.length).toBeLessThanOrEqual(13);
  });

  it("withholds decisions whose true source origins are outside the verified window", async () => {
    const first = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, first)).ok).toBe(true);
    const currentProvenance = {
      source: "verin-crm",
      asOf: LEDGER_TIME,
      confidence: "high",
    } as const;
    const repeatedEvidenceEvents = first.events.slice(0, -1).map((event, index) =>
      LedgerEntrySchema.parse({
        ...event,
        id: `test:register:repeated-evidence:${index}`,
      }));
    await expect(db.transaction((tx) =>
      appendDecisionEvents(
        tx,
        LEDGER_TENANT,
        repeatedEvidenceEvents,
        currentProvenance,
        first.evidenceSnapshots,
      ))).resolves.toHaveLength(first.evidenceSnapshots.length);
    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    expect(
      (await recordDecision(
        db,
        LEDGER_TENANT,
        { ...second, provenance: currentProvenance },
      )).ok,
    ).toBe(true);
    const snapshot = await readVerifiedDecisionRegister(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      5,
      50,
    );
    expect(snapshot.verification.ok).toBe(true);
    expect(snapshot.rows).toHaveLength(5);
    expect(snapshot.decisions).toEqual([]);
    expect(snapshot.decisionsWithheld).toBe(1);
  });

  it("withholds a recent event whose DecisionRecorded prerequisite is outside the window", async () => {
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
    const snapshot = await readVerifiedDecisionRegister(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      1,
      50,
    );
    expect(snapshot.verification.ok).toBe(true);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.decisions).toEqual([]);
    expect(snapshot.decisionsWithheld).toBe(1);
    expect(snapshot.decisionsWithheldProvenance).not.toBeNull();
  });

  it("returns an integrity failure when a replay source is corrupt", async () => {
    expect(
      (await recordDecision(db, LEDGER_TENANT, decisionRecordingInput())).ok,
    ).toBe(true);
    await db.exec(
      "ALTER TABLE evidence_snapshots DISABLE TRIGGER evidence_snapshots_no_update",
    );
    await db.query(
      `UPDATE evidence_snapshots
          SET canonical_json = canonical_json || ' '
        WHERE org_id = $1 AND id = $2`,
      [LEDGER_ORG, "evs:GC-01:balance"],
    );
    await db.exec(
      "ALTER TABLE evidence_snapshots ENABLE TRIGGER evidence_snapshots_no_update",
    );

    const snapshot = await readVerifiedDecisionRegister(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      200,
      50,
    );
    expect(snapshot.verification.ok).toBe(false);
    expect(snapshot.verification.levels.at(-1)).toMatchObject({
      level: "L2",
      reason: "immutable replay source verification failed",
    });
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.decisions).toEqual([]);
  });

  it("suppresses every register row when stored actor metadata fails verification", async () => {
    expect(
      (await recordDecision(db, LEDGER_TENANT, decisionRecordingInput())).ok,
    ).toBe(true);
    await db.exec(
      "ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_update",
    );
    await db.query(
      `UPDATE decision_ledger
          SET actor_json = '{"firmId":"firm-a","systemId":"unsafe@firm.test"}'
        WHERE org_id = $1 AND sequence = 4`,
      [LEDGER_ORG],
    );
    await db.exec(
      "ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_update",
    );
    const snapshot = await readVerifiedDecisionRegister(
      db,
      LEDGER_EXPORT_GRANT,
      LEDGER_PII_GRANT,
      200,
      50,
    );
    expect(snapshot.verification.ok).toBe(false);
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.decisions).toEqual([]);
    expect(snapshot.decisionsTotal).toBe(0);
  });

  it("records expiry then escalation in ledger order, not timestamp order", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, LEDGER_TENANT, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const expiry = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "test:projection:expiry-first",
      occurredAt: "2026-07-29T13:30:00.000Z",
      recordedAt: "2026-07-29T13:30:00.000Z",
      effectiveAt: "2026-07-29T13:30:00.000Z",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const escalation = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "test:projection:escalation-second",
      occurredAt: "2026-07-27T13:30:00.000Z",
      recordedAt: "2026-07-27T13:30:00.000Z",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(append(db, [expiry, escalation])).resolves.toHaveLength(2);
    const state = (await listDecisionProjections(db, LEDGER_TENANT))[0]!.projection;
    expect(state.lastEventType).toBe("ApprovalStageEscalated");
    expect(state.approvalStages[0]?.status).toBe("escalated");
  });
});
