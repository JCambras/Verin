import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEDGER_EVENT_TYPES,
  LedgerEntrySchema,
} from "@contracts/decision-core/ledger";
import {
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { allLedgerEventSamples } from "../helpers/ledger-fixtures";

const DIGESTS = JSON.parse(readFileSync(
  join(
    import.meta.dirname,
    "../../../fixtures/decision-core/ledger-event-digests.json",
  ),
  "utf8",
)) as Record<string, string>;

describe("decision ledger contract", () => {
  it("locks the ratified 16-event discriminated union", () => {
    const samples = allLedgerEventSamples();
    expect(samples.map((event) => event.type)).toEqual(LEDGER_EVENT_TYPES);
    expect(new Set(samples.map((event) => event.type)).size).toBe(16);
  });

  it("locks canonical serializer bytes for every event shape", () => {
    const actual: Record<string, string> = {};
    for (const event of allLedgerEventSamples()) {
      const canonical = canonicalJson(event as unknown as JsonValue);
      expect(canonical.ok).toBe(true);
      if (!canonical.ok) continue;
      actual[event.type] = createHash("sha256")
        .update(canonical.value, "utf8")
        .digest("hex");
    }
    expect(actual).toEqual(DIGESTS);
    expect(Object.keys(DIGESTS).sort()).toEqual([...LEDGER_EVENT_TYPES].sort());
  });

  it("rejects malformed cross-tenant attribution and references", () => {
    for (const event of allLedgerEventSamples()) {
      expect(LedgerEntrySchema.safeParse({
        ...event,
        actor: { firmId: "firm-b", systemId: "cross-tenant" },
      }).success).toBe(false);
      if ("decisionRef" in event) {
        expect(LedgerEntrySchema.safeParse({
          ...event,
          decisionRef: { ...event.decisionRef, firmId: "firm-b" },
        }).success).toBe(false);
      }
    }
  });

  it("binds decision recordings to the exact input bundle and rejects causal loops", () => {
    const decision = allLedgerEventSamples().find(
      (event) => event.type === "DecisionRecorded",
    )!;
    expect(
      decision.type === "DecisionRecorded" ? decision.bundleHash : null,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(LedgerEntrySchema.safeParse({
      ...decision,
      bundleHash: undefined,
    }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({
      ...decision,
      causationRef: { firmId: decision.firmId, id: decision.id },
    }).success).toBe(false);

    const exception = allLedgerEventSamples().find(
      (event) => event.type === "ExceptionDecisionRequested",
    )!;
    expect(LedgerEntrySchema.safeParse({
      ...exception,
      triggeringEntryRef: {
        firmId: exception.firmId,
        id: exception.id,
      },
    }).success).toBe(false);
  });

  it("normalizes set-like escalation roles and rejects overlapping parts", () => {
    const escalation = allLedgerEventSamples().find(
      (event) => event.type === "ApprovalStageEscalated",
    )!;
    const parsed = LedgerEntrySchema.parse({
      ...escalation,
      roleIds: [
        { firmId: "firm-a", id: "z-role" },
        { firmId: "firm-a", id: "a-role" },
      ],
    });
    expect(
      parsed.type === "ApprovalStageEscalated"
        ? parsed.roleIds.map((role) => role.id)
        : [],
    ).toEqual(["a-role", "z-role"]);
    const partial = allLedgerEventSamples().find(
      (event) => event.type === "ExecutionPartiallySucceeded",
    )!;
    expect(LedgerEntrySchema.safeParse({
      ...partial,
      completedParts: ["same"],
      incompleteParts: ["same"],
    }).success).toBe(false);
  });
});
