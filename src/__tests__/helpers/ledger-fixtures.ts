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
  canonicalJson,
  decisionHashPreimage,
} from "@contracts/decision-core/serialization";
import type { RecordProvenance } from "@contracts/provenance";
import { unwrap } from "@contracts/result";
import {
  actorRefOf,
  authorizeGovernedAction,
} from "@contracts/authz";
import {
  principalFromIdentity,
  systemWriteActor,
} from "@contracts/principal";
import {
  registerTestSystemActor,
  systemTenant,
} from "@contracts/tenant";
import { FIRM_RECORD_ORIGIN } from "@infra/store/record-origin";
import type { RecordDecisionInput } from "@infra/ledger/ledger-store";
import {
  registerTestLedgerIdentifier,
  registerTestLedgerIdentifierPrefix,
  retainedTextReference,
} from "@infra/ledger/ledger-pii";

/**
 * THE ledger test vocabulary. Fixture identifiers reach the immutable-source PII
 * boundary through this seam and the reserved `test` namespace, never through the
 * shipped allowlists in ledger-pii.ts - a production boundary that accepts a string
 * only a test needs is a boundary that grows with the suite.
 */
[
  "test:blob:status", "test:causal:forward", "test:causal:later",
  "test:corr:ledger-test", "test:crm-record", "test:custodian-submit",
  "test:decision:b", "test:evidence:atomic-refusal", "test:firm-b:event",
  "test:later-evidence:test:evidence:atomic-refusal", "test:ledger-test",
  "test:ledger:evidence:collision", "test:missing-cause", "test:ordered:first",
  "test:ordered:second", "test:projection:conflict-swallowed",
  "test:projection:cross-owner-release", "test:projection:delayed-release",
  "test:projection:escalation", "test:projection:escalation-second",
  "test:projection:expiry", "test:projection:expiry-first",
  "test:projection:missing-generation", "test:projection:reservation-conflict",
  "test:projection:reservation-reused",
  "test:projection:wrong-generation-release", "test:reservation:b",
  "test:sample:approval", "test:sample:approval-escalated",
  "test:sample:approval-expired", "test:sample:approval-invalidated",
  "test:sample:decision", "test:sample:evidence",
  "test:sample:exception-requested", "test:sample:execution-failed",
  "test:sample:execution-partial", "test:sample:execution-started",
  "test:sample:execution-succeeded", "test:sample:reservation-created",
  "test:sample:reservation-released", "test:sample:status-observed",
  "test:sample:verification-closed", "test:sample:verification-stuck",
  "test:source", "test:subject:status", "test:trigger:forward",
].forEach(registerTestLedgerIdentifier);
[
  "test:actor:ops", "test:blob", "test:evidence", "test:evidence:status",
  "test:handle", "test:later-evidence:test:evidence:status",
  "test:ledger:decision", "test:ledger:decision:dec:GC-01",
  "test:ledger:evidence", "test:projection:bounded",
  "test:register:repeated-evidence", "test:subject",
].forEach(registerTestLedgerIdentifierPrefix);

export const LEDGER_ORG = "firm-a";
export const LEDGER_OTHER_ORG = "firm-b";
export const LEDGER_TIME = "2026-07-26T13:30:00.000Z";
export const LEDGER_LATER = "2026-07-27T13:30:00.000Z";
export const LEDGER_HASH = "a".repeat(64);
export const LEDGER_PROVENANCE: RecordProvenance = {
  source: "fixture",
  asOf: LEDGER_TIME,
  confidence: "high",
};
const LEDGER_TEST_ACTOR = registerTestSystemActor("test.ledger");
export const LEDGER_TENANT = systemTenant(LEDGER_TEST_ACTOR, LEDGER_ORG);
export const LEDGER_OTHER_TENANT = systemTenant(
  LEDGER_TEST_ACTOR,
  LEDGER_OTHER_ORG,
);
export const LEDGER_WRITE_ACTOR = systemWriteActor(
  LEDGER_TEST_ACTOR,
  LEDGER_ORG,
);
const LEDGER_TEST_ACTOR_REF = actorRefOf(principalFromIdentity({
  userId: "test-ledger-user",
  orgId: LEDGER_ORG,
  role: "cco",
  actor: "ledger-user@example.test",
  sessionId: "test-ledger-session",
}));
export const LEDGER_EXPORT_GRANT = unwrap(authorizeGovernedAction(
  LEDGER_TEST_ACTOR_REF,
  "audit.export",
));
export const LEDGER_PII_GRANT = unwrap(authorizeGovernedAction(
  LEDGER_TEST_ACTOR_REF,
  "pii.view",
));

const ROOT = join(import.meta.dirname, "../../..");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(
    join(ROOT, "fixtures", "decision-core", `${name}.json`),
    "utf8",
  ));

/**
 * The plan-owned payload fields of the golden proceed decision, read from the plan
 * itself: an execution, reservation, or verification the immutable plan does not
 * authorize is refused at both the append and the verification boundary, so a sample
 * that hard-coded its own values would only ever exercise the refusal.
 */
const PLAN_STEP_FIXTURE = (fixture("decision-record-proceed") as {
  result: {
    executionPlan: {
      steps: readonly {
        id: string;
        idempotencyKey: string;
        conflictKeys: readonly string[];
        reservationRefs: readonly { id: string }[];
        verificationRuleRef: { id: string };
      }[];
    };
  };
}).result.executionPlan.steps[0]!;
export const PLAN_STEP = PLAN_STEP_FIXTURE.id;
export const PLAN_IDEMPOTENCY_KEY = PLAN_STEP_FIXTURE.idempotencyKey;
export const PLAN_CONFLICT_KEY = PLAN_STEP_FIXTURE.conflictKeys[0]!;
export const PLAN_RESERVATION = PLAN_STEP_FIXTURE.reservationRefs[0]!.id;
export const PLAN_VERIFICATION_RULE = PLAN_STEP_FIXTURE.verificationRuleRef.id;

function retainedTextProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(retainedTextProjection);
  if (value === null || typeof value !== "object") return value;
  const projected = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      retainedTextProjection(nested),
    ]),
  );
  if (typeof projected.code === "string") {
    if ("summary" in projected) projected.summary = projected.code;
    if ("messageTemplate" in projected) {
      projected.messageTemplate = projected.code;
    }
  }
  if (
    typeof projected.reasonCode === "string" &&
    "explanation" in projected
  ) {
    projected.explanation = projected.reasonCode;
  }
  return projected;
}

const actor = { firmId: LEDGER_ORG, systemId: "test:ledger-test" };
const decisionRef = { firmId: LEDGER_ORG, id: "dec:GC-01:0001" };
const base = (id: string, occurredAt = LEDGER_TIME) => ({
  firmId: LEDGER_ORG,
  id,
  schemaVersion: LEDGER_SCHEMA_VERSION,
  serializerVersion: CANONICAL_SERIALIZER_VERSION,
  occurredAt,
  recordedAt: occurredAt,
  actor,
  correlationId: "test:corr:ledger-test",
});

const canonicalHash = (value: unknown): string =>
  createHash("sha256")
    .update(unwrap(canonicalJson(value as never)), "utf8")
    .digest("hex");

export function decisionRecordingInput(): RecordDecisionInput {
  const inputBundle = DecisionInputBundleSchema.parse(
    fixture("decision-input-bundle"),
  );
  const candidate = DecisionRecordSchema.parse({
    ...(retainedTextProjection(
      fixture("decision-record-proceed"),
    ) as Record<string, unknown>),
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
  const evidenceSnapshots = inputBundle.evidenceSnapshotRefs.map((ref, index) =>
    EvidenceSnapshotRefSchema.parse({
      firmId: ref.firmId,
      id: ref.id,
      kind: index === 0 ? "account-balance" : "household-instruction",
      sourceRef: { firmId: ref.firmId, id: "test:source" },
      subjectRef: { firmId: ref.firmId, id: `test:subject:${index}` },
      observedAt: LEDGER_TIME,
      retrievedAt: LEDGER_TIME,
      attribution: retainedTextReference("1".repeat(64)),
      schemaVersion: "evidence/1.0.0",
      encryptedStorageRef: { firmId: ref.firmId, id: `test:blob:${index}` },
      contentHash: String(index + 1).repeat(64),
      freshness: "fresh",
    }));
  const events = [
    ...evidenceSnapshots.map((snapshot, index) =>
      LedgerEntrySchema.parse({
        ...base(`test:ledger:evidence:${index}`),
        type: "EvidenceSnapshotRecorded",
        evidenceSnapshotRef: { firmId: snapshot.firmId, id: snapshot.id },
        contentHash: snapshot.contentHash,
        snapshotHash: canonicalHash(snapshot),
      })),
    LedgerEntrySchema.parse({
      ...base("test:ledger:decision:0"),
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
    // A test firm's own flow, so the ROW's origin is a firm record. The fixture
    // states it rather than letting the column default answer for it: the
    // clean-slate sweep counts this column, and a default is a claim about rows
    // nobody wrote.
    recordOrigin: FIRM_RECORD_ORIGIN,
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
    recordOrigin: FIRM_RECORD_ORIGIN,
    inputBundle: first.inputBundle,
    decisionRecord,
    events: [LedgerEntrySchema.parse({
      ...base(`test:ledger:decision:${decisionId}`),
      type: "DecisionRecorded",
      decisionRef: { firmId: LEDGER_ORG, id: decisionId },
      decisionHash: decisionRecord.decisionHash,
      bundleHash: first.inputBundle.bundleHash,
    })],
    provenance: LEDGER_PROVENANCE,
  };
}

/** The compensation's OWN idempotency key - the schema forbids reusing the step's. */
export const PLAN_COMPENSATION_IDEMPOTENCY_KEY = registerTestLedgerIdentifier(
  "test:idem:compensate",
);

/**
 * The same recording whose single plan step also carries a compensating action. The
 * compensation is a retry-safe external action in its own right, so the key it
 * declares is plan-authorized exactly as the step's own key is.
 */
export function compensatedRecordingInput(): RecordDecisionInput {
  const first = decisionRecordingInput();
  const raw = JSON.parse(JSON.stringify(first.decisionRecord)) as Record<
    string,
    unknown
  > & {
    result: { executionPlan: { steps: Record<string, unknown>[] } };
  };
  const step = raw.result.executionPlan.steps[0]!;
  const action = { ...step };
  delete action.id;
  delete action.dependsOn;
  delete action.compensatingAction;
  step.compensatingAction = {
    ...action,
    idempotencyKey: PLAN_COMPENSATION_IDEMPOTENCY_KEY,
    reasonCode: "custodian-timeout",
  };
  const candidate = DecisionRecordSchema.parse({
    ...raw,
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
    ...first,
    decisionRecord,
    events: first.events.map((event) =>
      event.type === "DecisionRecorded"
        ? LedgerEntrySchema.parse({
          ...event,
          decisionHash: decisionRecord.decisionHash,
        })
        : event),
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
    sourceRef: { firmId: LEDGER_ORG, id: "test:source" },
    subjectRef: { firmId: LEDGER_ORG, id: "test:subject:status" },
    observedAt: LEDGER_LATER,
    retrievedAt: LEDGER_LATER,
    attribution: retainedTextReference("1".repeat(64)),
    schemaVersion: "evidence/1.0.0",
    encryptedStorageRef: { firmId: LEDGER_ORG, id: "test:blob:status" },
    contentHash: "9".repeat(64),
    freshness: "fresh",
  });
  return {
    snapshot,
    event: LedgerEntrySchema.parse({
      ...base(`test:later-evidence:${id}`, LEDGER_LATER),
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
    actorId: "test:actor:ops:1",
    roleIds: [{ firmId: LEDGER_ORG, id: "operations" }],
  };
  return [
    {
      ...base("test:sample:decision"),
      type: "DecisionRecorded",
      decisionRef,
      decisionHash: LEDGER_HASH,
      bundleHash: LEDGER_HASH,
    },
    {
      ...base("test:sample:evidence"),
      type: "EvidenceSnapshotRecorded",
      evidenceSnapshotRef: { firmId: LEDGER_ORG, id: "test:evidence:1" },
      contentHash: LEDGER_HASH,
      snapshotHash: LEDGER_HASH,
    },
    {
      ...base("test:sample:approval"),
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
      ...base("test:sample:approval-invalidated"),
      type: "ApprovalInvalidated",
      decisionRef,
      priorDecisionHash: LEDGER_HASH,
      reasonCode: "material-input-changed",
      newInputBundleHash: "b".repeat(64),
    },
    {
      ...base("test:sample:approval-expired", LEDGER_LATER),
      type: "ApprovalStageExpired",
      decisionRef,
      priorDecisionHash: LEDGER_HASH,
      stageId: "ops-dual-approval",
      effectiveAt: LEDGER_LATER,
      reasonCode: "approval-stage-expired",
    },
    {
      ...base("test:sample:approval-escalated", LEDGER_LATER),
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
      ...base("test:sample:reservation-created"),
      type: "ReservationCreated",
      reservationRef: { firmId: LEDGER_ORG, id: PLAN_RESERVATION },
      decisionRef,
      conflictKeys: [PLAN_CONFLICT_KEY],
      expiresAt: LEDGER_LATER,
    },
    {
      ...base("test:sample:reservation-released"),
      type: "ReservationReleased",
      reservationRef: { firmId: LEDGER_ORG, id: PLAN_RESERVATION },
      decisionRef,
      reservationCreationRef: {
        firmId: LEDGER_ORG,
        id: "test:sample:reservation-created",
      },
      reasonCode: "decision-closed",
    },
    {
      ...base("test:sample:execution-started"),
      type: "ExecutionStarted",
      decisionRef,
      stepId: PLAN_STEP,
      idempotencyKey: PLAN_IDEMPOTENCY_KEY,
    },
    {
      ...base("test:sample:execution-succeeded"),
      type: "ExecutionSucceeded",
      decisionRef,
      stepId: PLAN_STEP,
      executionHandleRef: { firmId: LEDGER_ORG, id: "test:handle:1" },
      sourceStatus: "submitted",
    },
    {
      ...base("test:sample:execution-partial"),
      type: "ExecutionPartiallySucceeded",
      decisionRef,
      stepId: PLAN_STEP,
      executionHandleRef: { firmId: LEDGER_ORG, id: "test:handle:1" },
      completedParts: ["test:crm-record"],
      incompleteParts: ["test:custodian-submit"],
      sourceStatus: "partial",
    },
    {
      ...base("test:sample:execution-failed"),
      type: "ExecutionFailed",
      decisionRef,
      stepId: PLAN_STEP,
      failureCode: "custodian-timeout",
      retryable: true,
      sourceStatus: "timeout",
    },
    {
      ...base("test:sample:status-observed"),
      type: "StatusObserved",
      decisionRef,
      executionHandleRef: { firmId: LEDGER_ORG, id: "test:handle:1" },
      status: "InFlight",
      sourceStatus: "pending-review",
      evidenceSnapshotRef: { firmId: LEDGER_ORG, id: "test:evidence:status:1" },
    },
    {
      ...base("test:sample:verification-closed"),
      type: "VerificationClosed",
      decisionRef,
      verificationRuleRef: { firmId: LEDGER_ORG, id: PLAN_VERIFICATION_RULE },
      provenState: "Completed",
    },
    {
      ...base("test:sample:verification-stuck"),
      type: "VerificationStuck",
      decisionRef,
      executionHandleRef: { firmId: LEDGER_ORG, id: "test:handle:1" },
      lastObservedStatus: "Unknown",
      reasonCode: "status-source-unavailable",
    },
    {
      ...base("test:sample:exception-requested"),
      type: "ExceptionDecisionRequested",
      priorDecisionRef: decisionRef,
      triggeringEntryRef: {
        firmId: LEDGER_ORG,
        id: "test:sample:verification-stuck",
      },
      reasonCode: "verification-stuck",
    },
  ].map((event) => LedgerEntrySchema.parse(event));
}
