import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
  type EvidenceSnapshotRef,
} from "@contracts/decision-core/evidence";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import {
  LedgerEntrySchema,
  LEDGER_SCHEMA_VERSION,
  type LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
} from "@contracts/decision-core/serialization";
import type { DirectLedgerProducerProvenance } from "@contracts/provenance";
import { unwrap } from "@contracts/result";
import {
  registerTestSystemActor,
  systemTenant,
  type TenantContext,
} from "@contracts/tenant";
import type { RecordDecisionInput } from "@infra/ledger/ledger-store";
import { retainedTextReference } from "@infra/ledger/ledger-pii";
import { retainedTextProjection } from "../../../scripts/seed-decision-ledger";

export const LEDGER_ORG = "firm-a";
export const LEDGER_OTHER_ORG = "firm-b";
const LEDGER_TEST_ACTOR = registerTestSystemActor("test.ledger");
export const ledgerTenant = (orgId: string): TenantContext =>
  systemTenant(LEDGER_TEST_ACTOR, orgId);
export const LEDGER_TENANT = ledgerTenant(LEDGER_ORG);
export const LEDGER_TIME = "2026-07-26T13:30:00.000Z";
export const LEDGER_LATER = "2026-07-27T13:30:00.000Z";
export const LEDGER_HASH = "a".repeat(64);
export const LEDGER_PROVENANCE: DirectLedgerProducerProvenance = {
  source: "fixture",
  asOf: LEDGER_TIME,
  confidence: "high",
};

const ROOT = join(import.meta.dirname, "../../..");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(
    join(ROOT, "fixtures", "decision-core", `${name}.json`),
    "utf8",
  ));

const actor = { firmId: LEDGER_ORG, systemId: "ledger-test" };
const decisionRef = { firmId: LEDGER_ORG, id: "dec:GC-01:0001" };
const ledgerEntryId = (label: string): string =>
  createHash("sha256").update(`ledger-entry:${label}`, "utf8").digest("hex");
const base = (id: string, occurredAt = LEDGER_TIME) => ({
  firmId: LEDGER_ORG,
  id: id === "ledger:evidence:0" ? ledgerEntryId(id) : id,
  schemaVersion: LEDGER_SCHEMA_VERSION,
  serializerVersion: CANONICAL_SERIALIZER_VERSION,
  occurredAt,
  recordedAt: occurredAt,
  actor,
  correlationId: "corr:ledger-test",
});

const canonicalHash = (value: unknown): string =>
  createHash("sha256")
    .update(unwrap(canonicalJson(value as never)), "utf8")
    .digest("hex");

export function retainedDecisionSourceFixtures() {
  return ["proceed", "blocked", "prohibited"].map((kind) =>
    DecisionRecordSchema.parse(
      retainedTextProjection(fixture(`decision-record-${kind}`)),
    ));
}

export function decisionRecordingInput(): RecordDecisionInput {
  const bundleCandidate = DecisionInputBundleSchema.parse({
    ...(retainedTextProjection(
      fixture("decision-input-bundle"),
    ) as Record<string, unknown>),
    bundleHash: "0".repeat(64),
  });
  const inputBundle = DecisionInputBundleSchema.parse({
    ...bundleCandidate,
    bundleHash: canonicalHash(bundleHashPreimage(bundleCandidate)),
  });
  const recorded = DecisionRecordSchema.parse({
    ...(retainedTextProjection(
      fixture("decision-record-proceed"),
    ) as Record<string, unknown>),
    decisionHash: "0".repeat(64),
  });
  if (
    recorded.result.kind !== "proceed" ||
    recorded.result.authority.mode === "automatic"
  ) {
    throw new Error("ledger fixture decision must carry an executable approval plan");
  }
  const candidate = DecisionRecordSchema.parse({
    ...recorded,
    result: {
      ...recorded.result,
      authority: {
        ...recorded.result.authority,
        stages: recorded.result.authority.stages.map((stage) => ({
          ...stage,
          expiresAt: LEDGER_LATER,
        })),
      },
      executionPlan: {
        ...recorded.result.executionPlan,
        steps: recorded.result.executionPlan.steps.map((step) => ({
          ...step,
          idempotencyKey: "idem:ledger:1",
          conflictKeys: ["conflict:household-liquidity"],
          reservationRefs: [{
            firmId: LEDGER_ORG,
            id: "reservation:1",
          }],
          verificationRuleRef: {
            firmId: LEDGER_ORG,
            id: "verify:1",
          },
        })),
      },
    },
  });
  const decisionRecord = DecisionRecordSchema.parse({
    ...candidate,
    decisionHash: createHash("sha256")
      .update(
        unwrap(canonicalJson(decisionHashPreimage(candidate) as never)),
        "utf8",
      )
      .digest("hex"),
  });
  const evidenceSnapshots = inputBundle.evidenceSnapshotRefs.map((ref, index) =>
    EvidenceSnapshotRefSchema.parse({
      firmId: ref.firmId,
      id: ref.id,
      kind: index === 0 ? "account-balance" : "household-instruction",
      sourceRef: { firmId: ref.firmId, id: "source:test:1" },
      subjectRef: { firmId: ref.firmId, id: `subject:test:${index}` },
      observedAt: LEDGER_TIME,
      retrievedAt: LEDGER_TIME,
      attribution: retainedTextReference("1".repeat(64)),
      schemaVersion: "evidence/1.0.0",
      encryptedStorageRef: { firmId: ref.firmId, id: `blob:test:${index}` },
      contentHash: String(index + 1).repeat(64),
      freshness: "fresh",
    }));
  const events = [
    ...evidenceSnapshots.map((snapshot, index) =>
      LedgerEntrySchema.parse({
        ...base(`ledger:evidence:${index}`),
        type: "EvidenceSnapshotRecorded",
        evidenceSnapshotRef: { firmId: snapshot.firmId, id: snapshot.id },
        contentHash: snapshot.contentHash,
        snapshotHash: canonicalHash(snapshot),
      })),
    LedgerEntrySchema.parse({
      ...base("ledger:decision:0"),
      type: "DecisionRecorded",
      decisionRef,
      decisionHash: decisionRecord.decisionHash,
      bundleHash: inputBundle.bundleHash,
    }),
  ];
  return {
    evidenceSnapshots,
    inputBundle,
    decisionRecord,
    events,
    provenance: LEDGER_PROVENANCE,
  };
}

/**
 * A second decision over the SAME immutable input bundle - the shape an exception
 * re-decision takes. The bundle bytes are reused, never re-inserted.
 */
export function reusedBundleRecordingInput(decisionId: string): RecordDecisionInput {
  const first = decisionRecordingInput();
  const candidate = DecisionRecordSchema.parse({
    ...first.decisionRecord,
    id: decisionId,
    decisionHash: "0".repeat(64),
  });
  const decisionRecord = DecisionRecordSchema.parse({
    ...candidate,
    decisionHash: createHash("sha256")
      .update(
        unwrap(canonicalJson(decisionHashPreimage(candidate) as never)),
        "utf8",
      )
      .digest("hex"),
  });
  return {
    evidenceSnapshots: [],
    inputBundle: first.inputBundle,
    decisionRecord,
    events: [LedgerEntrySchema.parse({
      ...base(`ledger:decision:${decisionId}`),
      type: "DecisionRecorded",
      decisionRef: { firmId: LEDGER_ORG, id: decisionId },
      decisionHash: decisionRecord.decisionHash,
      bundleHash: first.inputBundle.bundleHash,
    })],
    provenance: LEDGER_PROVENANCE,
  };
}

export function decisionRecordingInputWithEvidenceCount(
  count: number,
): RecordDecisionInput {
  const input = decisionRecordingInput();
  const extras = Array.from({
    length: Math.max(0, count - input.evidenceSnapshots.length),
  }, (_, index) =>
    EvidenceSnapshotRefSchema.parse({
      ...input.evidenceSnapshots[index % input.evidenceSnapshots.length]!,
      id: `evs:bounded:${String(index).padStart(4, "0")}`,
      subjectRef: {
        firmId: LEDGER_ORG,
        id: `subject:bounded:${String(index).padStart(4, "0")}`,
      },
      encryptedStorageRef: {
        firmId: LEDGER_ORG,
        id: `blob:bounded:${String(index).padStart(4, "0")}`,
      },
      contentHash: createHash("sha256")
        .update(`bounded-evidence:${index}`, "utf8")
        .digest("hex"),
    }));
  const evidenceSnapshots = [
    ...input.evidenceSnapshots,
    ...extras,
  ].slice(0, count);
  const bundleCandidate = DecisionInputBundleSchema.parse({
    ...input.inputBundle,
    evidenceSnapshotRefs: evidenceSnapshots.map(({ firmId, id }) => ({
      firmId,
      id,
    })),
    bundleHash: "0".repeat(64),
  });
  const inputBundle = DecisionInputBundleSchema.parse({
    ...bundleCandidate,
    bundleHash: canonicalHash(bundleHashPreimage(bundleCandidate)),
  });
  return {
    ...input,
    evidenceSnapshots,
    inputBundle,
    events: [
      ...evidenceSnapshots.map((snapshot, index) =>
        LedgerEntrySchema.parse({
          ...base(`ledger:bounded-evidence:${index}`),
          type: "EvidenceSnapshotRecorded",
          evidenceSnapshotRef: {
            firmId: snapshot.firmId,
            id: snapshot.id,
          },
          contentHash: snapshot.contentHash,
          snapshotHash: canonicalHash(snapshot),
        })),
      LedgerEntrySchema.parse({
        ...input.events.at(-1)!,
        bundleHash: inputBundle.bundleHash,
      }),
    ],
  };
}

/**
 * Evidence gathered AFTER the decision, with the event that records it - the pair a
 * verification-time `StatusObserved` cites.
 */
export function laterEvidenceRecording(id: string): {
  snapshot: EvidenceSnapshotRef;
  event: LedgerEntry;
} {
  const snapshot = EvidenceSnapshotRefSchema.parse({
    firmId: LEDGER_ORG,
    id,
    kind: "external-status",
    sourceRef: { firmId: LEDGER_ORG, id: "source:test:1" },
    subjectRef: { firmId: LEDGER_ORG, id: "subject:test:status" },
    observedAt: LEDGER_LATER,
    retrievedAt: LEDGER_LATER,
    attribution: retainedTextReference("1".repeat(64)),
    schemaVersion: "evidence/1.0.0",
    encryptedStorageRef: { firmId: LEDGER_ORG, id: "blob:test:status" },
    contentHash: "9".repeat(64),
    freshness: "fresh",
  });
  return {
    snapshot,
    event: LedgerEntrySchema.parse({
      ...base(`ledger:later-evidence:${id}`, LEDGER_LATER),
      type: "EvidenceSnapshotRecorded",
      evidenceSnapshotRef: { firmId: snapshot.firmId, id: snapshot.id },
      contentHash: snapshot.contentHash,
      snapshotHash: canonicalHash(snapshot),
    }),
  };
}

export function allLedgerEventSamples(): LedgerEntry[] {
  const approver = {
    firmId: LEDGER_ORG,
    actorId: "actor:ops:1",
    roleIds: [{ firmId: LEDGER_ORG, id: "operations" }],
  };
  return [
    {
      ...base("sample:decision"),
      type: "DecisionRecorded",
      decisionRef,
      decisionHash: LEDGER_HASH,
      bundleHash: LEDGER_HASH,
    },
    {
      ...base("sample:evidence"),
      type: "EvidenceSnapshotRecorded",
      evidenceSnapshotRef: { firmId: LEDGER_ORG, id: "evidence:1" },
      contentHash: LEDGER_HASH,
      snapshotHash: LEDGER_HASH,
    },
    {
      ...base("sample:approval"),
      type: "ApprovalRecorded",
      decisionRef,
      decisionHash: LEDGER_HASH,
      inputBundleHash: LEDGER_HASH,
      stageId: "ops-dual-approval",
      approver,
      outcome: "approved",
      reasonCode: "approved-after-review",
      structuredReason: "approved-after-review",
    },
    {
      ...base("sample:approval-invalidated"),
      type: "ApprovalInvalidated",
      decisionRef,
      priorDecisionHash: LEDGER_HASH,
      reasonCode: "material-input-changed",
      newInputBundleHash: "b".repeat(64),
    },
    {
      ...base("sample:approval-expired", LEDGER_LATER),
      type: "ApprovalStageExpired",
      decisionRef,
      priorDecisionHash: LEDGER_HASH,
      stageId: "ops-dual-approval",
      effectiveAt: LEDGER_LATER,
      reasonCode: "approval-stage-expired",
    },
    {
      ...base("sample:approval-escalated", LEDGER_LATER),
      type: "ApprovalStageEscalated",
      decisionRef,
      priorDecisionHash: LEDGER_HASH,
      stageId: "ops-dual-approval",
      escalationStepIndex: 0,
      mode: "add",
      roleIds: [{ firmId: LEDGER_ORG, id: "operations-manager" }],
      newExpiresAt: "2026-07-28T13:30:00.000Z",
      effectiveAt: LEDGER_LATER,
      reasonCode: "approval-stage-idle",
    },
    {
      ...base("sample:reservation-created"),
      type: "ReservationCreated",
      reservationRef: { firmId: LEDGER_ORG, id: "reservation:1" },
      decisionRef,
      conflictKeys: ["conflict:household-liquidity"],
      expiresAt: LEDGER_LATER,
    },
    {
      ...base("sample:reservation-released"),
      type: "ReservationReleased",
      reservationRef: { firmId: LEDGER_ORG, id: "reservation:1" },
      decisionRef,
      reservationCreationRef: {
        firmId: LEDGER_ORG,
        id: "sample:reservation-created",
      },
      reasonCode: "decision-closed",
    },
    {
      ...base("sample:execution-started"),
      type: "ExecutionStarted",
      decisionRef,
      stepId: "step:GC-01:0001",
      idempotencyKey: "idem:ledger:1",
    },
    {
      ...base("sample:execution-succeeded"),
      type: "ExecutionSucceeded",
      decisionRef,
      stepId: "step:GC-01:0001",
      executionHandleRef: { firmId: LEDGER_ORG, id: "handle:1" },
      sourceStatus: "submitted",
    },
    {
      ...base("sample:execution-partial"),
      type: "ExecutionPartiallySucceeded",
      decisionRef,
      stepId: "step:GC-01:0001",
      executionHandleRef: { firmId: LEDGER_ORG, id: "handle:1" },
      completedParts: ["crm-record"],
      incompleteParts: ["custodian-submit"],
      sourceStatus: "partial",
    },
    {
      ...base("sample:execution-failed"),
      type: "ExecutionFailed",
      decisionRef,
      stepId: "step:GC-01:0001",
      failureCode: "custodian-timeout",
      retryable: true,
      sourceStatus: "timeout",
    },
    {
      ...base("sample:status-observed"),
      type: "StatusObserved",
      decisionRef,
      executionHandleRef: { firmId: LEDGER_ORG, id: "handle:1" },
      status: "InFlight",
      sourceStatus: "pending-review",
      evidenceSnapshotRef: { firmId: LEDGER_ORG, id: "evidence:status:1" },
    },
    {
      ...base("sample:verification-closed"),
      type: "VerificationClosed",
      decisionRef,
      verificationRuleRef: { firmId: LEDGER_ORG, id: "verify:1" },
      provenState: "Completed",
    },
    {
      ...base("sample:verification-stuck"),
      type: "VerificationStuck",
      decisionRef,
      executionHandleRef: { firmId: LEDGER_ORG, id: "handle:1" },
      lastObservedStatus: "Unknown",
      reasonCode: "status-source-unavailable",
    },
    {
      ...base("sample:exception-requested"),
      type: "ExceptionDecisionRequested",
      priorDecisionRef: decisionRef,
      triggeringEntryRef: {
        firmId: LEDGER_ORG,
        id: "sample:verification-stuck",
      },
      reasonCode: "verification-stuck",
    },
  ].map((event) => LedgerEntrySchema.parse(event));
}
