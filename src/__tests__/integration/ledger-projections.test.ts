import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import {
  appendDecisionEvents,
  rebuildDecisionProjections,
  recordDecision,
} from "@infra/ledger/ledger-store";
import { listDecisionProjections } from "@infra/ledger/ledger-projection-store";
import { LedgerEntrySchema } from "@contracts/decision-core/ledger";
import {
  LEDGER_ORG,
  LEDGER_PROVENANCE,
  allLedgerEventSamples,
  decisionRecordingInput,
  reusedBundleRecordingInput,
} from "../helpers/ledger-fixtures";

const TS = "2026-07-26T13:30:00.000Z";

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
) => db.transaction((tx) => appendDecisionEvents(tx, LEDGER_ORG, events, LEDGER_PROVENANCE));

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
    expect((await recordDecision(db, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const escalation = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "projection:escalation",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const expiry = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "projection:expiry",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(append(db, [escalation, expiry])).resolves.toHaveLength(2);
    const online = await listDecisionProjections(db, LEDGER_ORG);

    await db.query(
      "DELETE FROM decision_state_projection WHERE org_id = $1",
      [LEDGER_ORG],
    );
    await db.query(
      "DELETE FROM decision_projection_checkpoint WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(await listDecisionProjections(db, LEDGER_ORG)).toEqual([]);
    const rebuilt = await rebuildDecisionProjections(db, LEDGER_ORG);

    expect(rebuilt).toEqual(online);
    expect(rebuilt[0]?.projection).toMatchObject({
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

  it("repairs corrupted derived state while a truncated replay produces different state", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
    const sample = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageEscalated",
    )!;
    const event = LedgerEntrySchema.parse({
      ...sample,
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(append(db, [event])).resolves.toHaveLength(1);
    const expected = await listDecisionProjections(db, LEDGER_ORG);

    await db.query(
      "UPDATE decision_state_projection SET state_json = '{}' WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(await listDecisionProjections(db, LEDGER_ORG)).not.toEqual(expected);
    expect(await rebuildDecisionProjections(db, LEDGER_ORG)).toEqual(expected);

    await db.exec("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_no_delete");
    await db.query(
      "DELETE FROM decision_ledger WHERE org_id = $1 AND sequence = 5",
      [LEDGER_ORG],
    );
    await db.exec("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_no_delete");
    const truncated = await rebuildDecisionProjections(db, LEDGER_ORG);
    expect(truncated).not.toEqual(expected);
    expect(truncated[0]?.projection.lastEventType).toBe("DecisionRecorded");
  });

  it("releases a reservation against its owning decision and refuses a competing live claim", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const created = samples.find((event) => event.type === "ReservationCreated")!;
    const released = samples.find((event) => event.type === "ReservationReleased")!;
    await expect(append(db, [created])).resolves.toHaveLength(1);
    const owner = await db.query<{ decision_id: string; status: string }>(
      `SELECT decision_id, status FROM decision_reservation_index
        WHERE org_id = $1 AND reservation_id = $2`,
      [LEDGER_ORG, "reservation:1"],
    );
    expect(owner.rows[0]).toEqual({
      decision_id: "dec:GC-01:0001",
      status: "active",
    });

    const second = reusedBundleRecordingInput("dec:GC-01:0002");
    const recorded = await recordDecision(db, second);
    expect(recorded.ok, recorded.ok ? "" : recorded.error.message).toBe(true);
    const bundles = await db.query<{ n: number | string }>(
      "SELECT count(*) AS n FROM decision_input_bundles WHERE org_id = $1",
      [LEDGER_ORG],
    );
    expect(Number(bundles.rows[0]!.n)).toBe(1);

    const competing = LedgerEntrySchema.parse({
      ...created,
      id: "projection:reservation-conflict",
      decisionRef: { firmId: LEDGER_ORG, id: "dec:GC-01:0002" },
    });
    await expect(append(db, [competing])).rejects.toMatchObject({
      code: "STORE_CONSTRAINT",
    });

    await expect(append(db, [released])).resolves.toHaveLength(1);
    const state = (await listDecisionProjections(db, LEDGER_ORG))[0]!.projection;
    expect(state.reservations).toEqual([
      { reservationId: "reservation:1", status: "released" },
    ]);
    expect(await rebuildDecisionProjections(db, LEDGER_ORG)).toEqual(
      await listDecisionProjections(db, LEDGER_ORG),
    );
  });

  it("records expiry then escalation in ledger order, not timestamp order", async () => {
    const input = decisionRecordingInput();
    expect((await recordDecision(db, input)).ok).toBe(true);
    const samples = allLedgerEventSamples();
    const expiry = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageExpired")!,
      id: "projection:expiry-first",
      occurredAt: "2026-07-29T13:30:00.000Z",
      recordedAt: "2026-07-29T13:30:00.000Z",
      effectiveAt: "2026-07-29T13:30:00.000Z",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    const escalation = LedgerEntrySchema.parse({
      ...samples.find((event) => event.type === "ApprovalStageEscalated")!,
      id: "projection:escalation-second",
      occurredAt: "2026-07-27T13:30:00.000Z",
      recordedAt: "2026-07-27T13:30:00.000Z",
      priorDecisionHash: input.decisionRecord.decisionHash,
    });
    await expect(append(db, [expiry, escalation])).resolves.toHaveLength(2);
    const state = (await listDecisionProjections(db, LEDGER_ORG))[0]!.projection;
    expect(state.lastEventType).toBe("ApprovalStageEscalated");
    expect(state.approvalStages[0]?.status).toBe("escalated");
  });
});
