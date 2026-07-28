import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import {
  appendDecisionEvents,
  listDecisionProjections,
  rebuildDecisionProjections,
  recordDecision,
} from "@infra/ledger/ledger-store";
import { LedgerEntrySchema } from "@contracts/decision-core/ledger";
import {
  LEDGER_ORG,
  allLedgerEventSamples,
  decisionRecordingInput,
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
) => db.transaction((tx) => appendDecisionEvents(tx, LEDGER_ORG, events));

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
    expect(rebuilt[0]).toMatchObject({
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
    expect(truncated[0]?.lastEventType).toBe("DecisionRecorded");
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
    const state = (await listDecisionProjections(db, LEDGER_ORG))[0]!;
    expect(state.lastEventType).toBe("ApprovalStageEscalated");
    expect(state.approvalStages[0]?.status).toBe("escalated");
  });
});
