import { describe, expect, it } from "vitest";
import {
  LedgerEntrySchema,
  type LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  assertRecordedLedgerStructure,
  type LedgerStructureLookup,
  type StructuralLedgerEntry,
} from "@infra/ledger/ledger-structural-validator";
import {
  allLedgerEventSamples,
  decisionRecordingInput,
  LEDGER_ORG,
} from "../helpers/ledger-fixtures";

describe("recorded ledger structural validator", () => {
  it("tracks alternating reservation generations incrementally", async () => {
    const input = decisionRecordingInput();
    const samples = allLedgerEventSamples();
    const created = samples.find(
      (event) => event.type === "ReservationCreated",
    )!;
    const released = samples.find(
      (event) => event.type === "ReservationReleased",
    )!;
    const recording = input.events.find(
      (event) => event.type === "DecisionRecorded",
    )!;
    const events: LedgerEntry[] = [recording];
    for (let generation = 0; generation < 250; generation += 1) {
      const creationId = `reservation:generation:${generation}:created`;
      events.push(
        LedgerEntrySchema.parse({
          ...created,
          id: creationId,
        }),
        LedgerEntrySchema.parse({
          ...released,
          id: `reservation:generation:${generation}:released`,
          reservationCreationRef: {
            firmId: LEDGER_ORG,
            id: creationId,
          },
        }),
      );
    }
    let activeReservationReads = 0;
    const base: LedgerStructureLookup = {
      decision: async (id) =>
        id === input.decisionRecord.id
          ? {
              record: input.decisionRecord,
              bundleHash: input.inputBundle.bundleHash,
            }
          : null,
      entry: async () => null,
      decisionRecording: async () => null,
      evidenceRecording: async () => null,
      activeReservation: async () => {
        activeReservationReads += 1;
        return null;
      },
    };
    const entries: StructuralLedgerEntry[] = events.map((event, sequence) => ({
      event,
      sequence,
    }));

    await expect(assertRecordedLedgerStructure(entries, base)).resolves
      .toBeUndefined();
    expect(activeReservationReads).toBe(1);
  });
});
