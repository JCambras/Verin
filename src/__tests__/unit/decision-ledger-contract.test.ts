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
import type { DecisionInputBundle } from "@contracts/decision-core/evidence";
import { assertReplaySourcePiiBoundary } from "@infra/ledger/ledger-pii";
import { parseRecordedLedgerEvent } from "@infra/ledger/ledger-schema-registry";
import { parseRecordedReplaySource } from "@infra/ledger/ledger-source-registry";
import { createRecordedVersionRegistry } from "@infra/ledger/recorded-version-registry";
import {
  recordedBundleV1_7,
  recordedDecisionV1_7,
  recordedEvidenceV1_7,
  recordedLedgerV1_1,
} from "@infra/ledger/recorded-schemas";
import {
  allLedgerEventSamples,
  decisionRecordingInput,
} from "../helpers/ledger-fixtures";

const DIGESTS = JSON.parse(readFileSync(
  join(
    import.meta.dirname,
    "../../../fixtures/decision-core/ledger-event-digests.json",
  ),
  "utf8",
)) as Record<string, string>;

const RECORDED_SCHEMA_DIGESTS = {
  bundle: [recordedBundleV1_7, "c370e321e347a804bc2e15788948e1df9c3373366ee07dd60f7645541f6b4926"],
  decision: [recordedDecisionV1_7, "c52559a855402e995b1307a4f720ca38962a686f2d1fb99a9aae0f59c0156758"],
  evidence: [recordedEvidenceV1_7, "5cf703d93c4d72342a5cd97cfada7b3d657cf9e33d7c8a3b4c38ff5f869f6847"],
  ledger: [recordedLedgerV1_1, "122d6dcac1dbdeed8f9c7a76d4544c26098c8ee32f705acdeee9be8b1806d7ee"],
} as const;

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

  it("dispatches frozen ledger and replay-source codecs by recorded version", () => {
    // The write path validates with the LIVE schema, the read path with the PINNED
    // one. A frozen arm narrower than its contract anywhere - a dropped optional, a
    // lost union member - is write-accepted and read-rejected, which reports the whole
    // tenant chain BROKEN with no forward repair. Byte equality against the live
    // canonicalization is what proves the two accept the same value, per variant.
    for (const event of allLedgerEventSamples()) {
      const parsed = parseRecordedLedgerEvent(
        event.type,
        "1.1.0",
        "1.0.0",
        event,
      );
      expect(parsed.ok ? null : parsed.reason).toBe(null);
      const canonical = canonicalJson(event as unknown as JsonValue);
      expect(canonical.ok).toBe(true);
      if (!parsed.ok || !canonical.ok) continue;
      expect(parsed.canonicalBytes).toBe(canonical.value);
      expect(parsed.event.type).toBe(event.type);
    }

    const input = decisionRecordingInput();
    const sources = [
      ["evidence", input.evidenceSnapshots[0]!, null],
      ["bundle", input.inputBundle, "decision-input-bundle"],
      ["decision", input.decisionRecord, "decision-record"],
    ] as const;
    for (const [kind, value, hashKind] of sources) {
      const parsed = parseRecordedReplaySource(kind, "1.7.0", "1.0.0", value);
      expect(parsed.ok ? null : parsed.reason).toBe(null);
      const canonical = canonicalJson(value as unknown as JsonValue);
      expect(canonical.ok).toBe(true);
      if (!parsed.ok || !canonical.ok) continue;
      expect(parsed.canonicalBytes).toBe(canonical.value);
      expect(parsed.hashPreimage?.hashKind ?? null).toBe(hashKind);
    }

    const sample = allLedgerEventSamples()[0]!;
    expect(parseRecordedLedgerEvent(
      sample.type,
      "1.2.0",
      "1.0.0",
      sample,
    ).ok).toBe(false);
    expect(parseRecordedReplaySource(
      "bundle",
      "1.8.0",
      "1.0.0",
      input.inputBundle,
    ).ok).toBe(false);
  });

  it("keeps multiple recorded versions independently dispatchable", () => {
    const registry = createRecordedVersionRegistry([
      { schemaVersion: "1", serializerVersion: "1", codec: "first" },
      { schemaVersion: "2", serializerVersion: "1", codec: "second" },
    ]);
    expect(registry.resolve("1", "1")).toBe("first");
    expect(registry.resolve("2", "1")).toBe("second");
  });

  it("pins every frozen recorded schema by content digest", () => {
    for (const [schema, digest] of Object.values(RECORDED_SCHEMA_DIGESTS)) {
      const bytes = JSON.stringify(schema);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
    }
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

  it("scans a shared container in plain context after an identifier-context visit", () => {
    // A registered machine identifier is accepted in identifier context and refused
    // as plain retained text, so a container reachable both ways must be scanned in
    // BOTH: identifier-context traversal never applies the ambiguous-text check.
    const shared = { statusNote: "idem:GC-01:smiths-75000-2026-08-15" };
    const versions = { engineVersion: "1.0.0", primitiveSetVersion: "1" };
    expect(() =>
      assertReplaySourcePiiBoundary(
        "bundle",
        { ...versions, subjectRef: shared } as unknown as DecisionInputBundle,
      )
    ).not.toThrow();
    expect(() =>
      assertReplaySourcePiiBoundary(
        "bundle",
        { ...versions, note: shared, subjectRef: shared } as unknown as
          DecisionInputBundle,
      )
    ).toThrowError(expect.objectContaining({ code: "PII_VIOLATION" }));
  });
});
