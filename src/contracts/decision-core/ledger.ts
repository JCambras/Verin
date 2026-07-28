/**
 * Typed decision ledger contracts (v3 §12; prompt 7). Operational occurrences
 * stay distinct from DecisionRecord: an execution failure may request another
 * decision, but it is never rewritten into one. Every reference that can cross a
 * tenant boundary carries firmId and is checked against the enclosing event.
 */
import { z } from "zod";
import {
  ConflictKeySchema,
  DecisionRefSchema,
  EvidenceSnapshotIdRefSchema,
  ExecutionStepIdSchema,
  FirmIdSchema,
  HashSchema,
  NonEmptyRoleRefSetSchema,
  ReasonCodeSchema,
  ReservationRefSchema,
  TimestampSchema,
  VerificationRuleRefSchema,
  compareCanonicalStrings,
  hasUniqueByComparator,
  normalizeCanonicalStrings,
} from "./ids";
import {
  ActorRefSchema,
  AnyActorRefSchema,
  TenantContextSchema,
} from "./actor";
import {
  CANONICAL_SERIALIZER_VERSION,
  CANONICAL_SERIALIZER_V1_0_0,
} from "./serialization";

const brandedString = <B extends string>() => z.string().min(1).brand<B>();

/**
 * Every ledger schema version whose bytes this build can still read, oldest first.
 * A version is only ever appended here. `LEDGER_SCHEMA_VERSION` selects WRITES; a
 * read dispatches on the version each row recorded.
 */
export const LEDGER_SCHEMA_VERSIONS = ["1.0.0", "1.1.0"] as const;
export type LedgerSchemaVersion = (typeof LEDGER_SCHEMA_VERSIONS)[number];
export const LEDGER_SCHEMA_VERSION = "1.1.0";

export const LedgerEntryIdSchema = brandedString<"LedgerEntryId">();
export type LedgerEntryId = z.infer<typeof LedgerEntryIdSchema>;

export const LedgerEntryRefSchema = z.strictObject({
  firmId: FirmIdSchema,
  id: LedgerEntryIdSchema,
}).readonly();
export type LedgerEntryRef = z.infer<typeof LedgerEntryRefSchema>;

export const ExecutionHandleIdSchema = brandedString<"ExecutionHandleId">();
export type ExecutionHandleId = z.infer<typeof ExecutionHandleIdSchema>;

export const ExecutionHandleRefSchema = z.strictObject({
  firmId: FirmIdSchema,
  id: ExecutionHandleIdSchema,
}).readonly();
export type ExecutionHandleRef = z.infer<typeof ExecutionHandleRefSchema>;

export const ObservedStatusSchema = z.enum([
  "Submitted",
  "InFlight",
  "Completed",
  "Rejected",
  "NIGO",
  "Unknown",
]);
export type ObservedStatus = z.infer<typeof ObservedStatusSchema>;

export const LEDGER_EVENT_TYPES = [
  "DecisionRecorded",
  "EvidenceSnapshotRecorded",
  "ApprovalRecorded",
  "ApprovalInvalidated",
  "ApprovalStageExpired",
  "ApprovalStageEscalated",
  "ReservationCreated",
  "ReservationReleased",
  "ExecutionStarted",
  "ExecutionSucceeded",
  "ExecutionPartiallySucceeded",
  "ExecutionFailed",
  "StatusObserved",
  "VerificationClosed",
  "VerificationStuck",
  "ExceptionDecisionRequested",
] as const;

export const LedgerEventTypeSchema = z.enum(LEDGER_EVENT_TYPES);
export type LedgerEventType = z.infer<typeof LedgerEventTypeSchema>;

/**
 * One encoder per shipped ledger schema version. Every registered version is
 * retained: recorded bytes are read with the encoder they were written by, never
 * with whichever version happens to be current.
 */
const ledgerEntrySchemaFor = <
  const V extends LedgerSchemaVersion,
  const S extends string,
>(
  version: V,
  serializerVersion: S,
) => {
  const ledgerBaseShape = {
    ...TenantContextSchema.unwrap().shape,
    id: LedgerEntryIdSchema,
    schemaVersion: z.literal(version),
    serializerVersion: z.literal(serializerVersion),
    occurredAt: TimestampSchema,
    recordedAt: TimestampSchema,
    actor: AnyActorRefSchema,
    correlationId: z.string().min(1),
    causationRef: LedgerEntryRefSchema.optional(),
  };

  type LedgerTenant = {
    readonly firmId: string;
    readonly id: string;
    readonly actor: { readonly firmId: string };
    readonly causationRef?: { readonly firmId: string; readonly id: string };
  };

  function requireBaseTenant(
    event: LedgerTenant,
    ctx: z.core.$RefinementCtx,
  ): void {
    if (event.actor.firmId !== event.firmId) {
      ctx.addIssue({
        code: "custom",
        message: "ledger actor must belong to the event tenant",
        path: ["actor", "firmId"],
      });
    }
    if (
      event.causationRef !== undefined &&
      event.causationRef.firmId !== event.firmId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ledger causation must belong to the event tenant",
        path: ["causationRef", "firmId"],
      });
    }
    if (event.causationRef?.id === event.id) {
      ctx.addIssue({
        code: "custom",
        message: "ledger entry cannot cause itself",
        path: ["causationRef", "id"],
      });
    }
  }

  function requireRefTenant(
    event: { readonly firmId: string },
    ref: { readonly firmId: string },
    path: (string | number)[],
    ctx: z.core.$RefinementCtx,
  ): void {
    if (ref.firmId !== event.firmId) {
      ctx.addIssue({
        code: "custom",
        message: "ledger reference must belong to the event tenant",
        path,
      });
    }
  }

  const DecisionRecordedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("DecisionRecorded"),
    decisionRef: DecisionRefSchema,
    decisionHash: HashSchema,
    bundleHash: HashSchema.optional(),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    if (version !== "1.0.0" && event.bundleHash === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "ledger schema 1.1.0 binds the recorded input bundle hash",
        path: ["bundleHash"],
      });
    }
  });

  const EvidenceSnapshotRecordedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("EvidenceSnapshotRecorded"),
    evidenceSnapshotRef: EvidenceSnapshotIdRefSchema,
    contentHash: HashSchema,
    snapshotHash: HashSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.evidenceSnapshotRef, ["evidenceSnapshotRef", "firmId"], ctx);
  });

  const ApprovalRecordedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ApprovalRecorded"),
    decisionRef: DecisionRefSchema,
    decisionHash: HashSchema,
    inputBundleHash: HashSchema,
    stageId: z.string().min(1),
    approver: ActorRefSchema,
    outcome: z.enum(["approved", "rejected", "overridden"]),
    reasonCode: ReasonCodeSchema.optional(),
    structuredReason: z.string().min(1).optional(),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    requireRefTenant(event, event.approver, ["approver", "firmId"], ctx);
  });

  const ApprovalInvalidatedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ApprovalInvalidated"),
    decisionRef: DecisionRefSchema,
    priorDecisionHash: HashSchema,
    reasonCode: ReasonCodeSchema,
    newInputBundleHash: HashSchema.optional(),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
  });

  const ApprovalStageExpiredSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ApprovalStageExpired"),
    decisionRef: DecisionRefSchema,
    priorDecisionHash: HashSchema,
    stageId: z.string().min(1),
    effectiveAt: TimestampSchema,
    reasonCode: ReasonCodeSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
  });

  const ApprovalStageEscalatedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ApprovalStageEscalated"),
    decisionRef: DecisionRefSchema,
    priorDecisionHash: HashSchema,
    stageId: z.string().min(1),
    escalationStepIndex: z.int().nonnegative(),
    mode: z.enum(["add", "replace"]),
    roleIds: NonEmptyRoleRefSetSchema,
    newExpiresAt: TimestampSchema,
    effectiveAt: TimestampSchema,
    reasonCode: ReasonCodeSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    event.roleIds.forEach((role, index) =>
      requireRefTenant(event, role, ["roleIds", index, "firmId"], ctx),
    );
  });

  const conflictKeySet = z.array(ConflictKeySchema)
    .min(1)
    .refine(
      (keys) => hasUniqueByComparator(keys, compareCanonicalStrings),
      "duplicate conflict key",
    )
    .overwrite(normalizeCanonicalStrings)
    .readonly();

  const ReservationCreatedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ReservationCreated"),
    reservationRef: ReservationRefSchema,
    decisionRef: DecisionRefSchema,
    conflictKeys: conflictKeySet,
    expiresAt: TimestampSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.reservationRef, ["reservationRef", "firmId"], ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
  });

  const ReservationReleasedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ReservationReleased"),
    reservationRef: ReservationRefSchema,
    decisionRef: DecisionRefSchema,
    reservationCreationRef: LedgerEntryRefSchema,
    reasonCode: ReasonCodeSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.reservationRef, ["reservationRef", "firmId"], ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    requireRefTenant(
      event,
      event.reservationCreationRef,
      ["reservationCreationRef", "firmId"],
      ctx,
    );
  });

  const ExecutionStartedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ExecutionStarted"),
    decisionRef: DecisionRefSchema,
    stepId: ExecutionStepIdSchema,
    idempotencyKey: z.string().min(1),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
  });

  const ExecutionSucceededSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ExecutionSucceeded"),
    decisionRef: DecisionRefSchema,
    stepId: ExecutionStepIdSchema,
    executionHandleRef: ExecutionHandleRefSchema,
    sourceStatus: z.string().min(1),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    requireRefTenant(event, event.executionHandleRef, ["executionHandleRef", "firmId"], ctx);
  });

  const partSet = z.array(z.string().min(1))
    .min(1)
    .refine(
      (parts) => hasUniqueByComparator(parts, compareCanonicalStrings),
      "duplicate execution part",
    )
    .overwrite(normalizeCanonicalStrings)
    .readonly();

  const ExecutionPartiallySucceededSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ExecutionPartiallySucceeded"),
    decisionRef: DecisionRefSchema,
    stepId: ExecutionStepIdSchema,
    executionHandleRef: ExecutionHandleRefSchema.optional(),
    completedParts: partSet,
    incompleteParts: partSet,
    sourceStatus: z.string().min(1),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    if (event.executionHandleRef !== undefined) {
      requireRefTenant(event, event.executionHandleRef, ["executionHandleRef", "firmId"], ctx);
    }
    const completed = new Set(event.completedParts);
    if (event.incompleteParts.some((part) => completed.has(part))) {
      ctx.addIssue({
        code: "custom",
        message: "an execution part cannot be both complete and incomplete",
        path: ["incompleteParts"],
      });
    }
  });

  const ExecutionFailedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ExecutionFailed"),
    decisionRef: DecisionRefSchema,
    stepId: ExecutionStepIdSchema,
    failureCode: ReasonCodeSchema,
    retryable: z.boolean(),
    sourceStatus: z.string().min(1).optional(),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
  });

  const StatusObservedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("StatusObserved"),
    decisionRef: DecisionRefSchema,
    executionHandleRef: ExecutionHandleRefSchema,
    status: ObservedStatusSchema,
    sourceStatus: z.string().min(1),
    evidenceSnapshotRef: EvidenceSnapshotIdRefSchema.optional(),
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    requireRefTenant(event, event.executionHandleRef, ["executionHandleRef", "firmId"], ctx);
    if (event.evidenceSnapshotRef !== undefined) {
      requireRefTenant(event, event.evidenceSnapshotRef, ["evidenceSnapshotRef", "firmId"], ctx);
    }
  });

  const VerificationClosedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("VerificationClosed"),
    decisionRef: DecisionRefSchema,
    verificationRuleRef: VerificationRuleRefSchema,
    provenState: ObservedStatusSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    requireRefTenant(event, event.verificationRuleRef, ["verificationRuleRef", "firmId"], ctx);
  });

  const VerificationStuckSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("VerificationStuck"),
    decisionRef: DecisionRefSchema,
    executionHandleRef: ExecutionHandleRefSchema,
    lastObservedStatus: ObservedStatusSchema,
    reasonCode: ReasonCodeSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.decisionRef, ["decisionRef", "firmId"], ctx);
    requireRefTenant(event, event.executionHandleRef, ["executionHandleRef", "firmId"], ctx);
  });

  const ExceptionDecisionRequestedSchema = z.strictObject({
    ...ledgerBaseShape,
    type: z.literal("ExceptionDecisionRequested"),
    priorDecisionRef: DecisionRefSchema,
    triggeringEntryRef: LedgerEntryRefSchema,
    reasonCode: ReasonCodeSchema,
  }).superRefine((event, ctx) => {
    requireBaseTenant(event, ctx);
    requireRefTenant(event, event.priorDecisionRef, ["priorDecisionRef", "firmId"], ctx);
    requireRefTenant(event, event.triggeringEntryRef, ["triggeringEntryRef", "firmId"], ctx);
    if (event.triggeringEntryRef.id === event.id) {
      ctx.addIssue({
        code: "custom",
        message: "exception request cannot trigger itself",
        path: ["triggeringEntryRef", "id"],
      });
    }
  });

    return z.discriminatedUnion("type", [
    DecisionRecordedSchema,
    EvidenceSnapshotRecordedSchema,
    ApprovalRecordedSchema,
    ApprovalInvalidatedSchema,
    ApprovalStageExpiredSchema,
    ApprovalStageEscalatedSchema,
    ReservationCreatedSchema,
    ReservationReleasedSchema,
    ExecutionStartedSchema,
    ExecutionSucceededSchema,
    ExecutionPartiallySucceededSchema,
    ExecutionFailedSchema,
    StatusObservedSchema,
    VerificationClosedSchema,
    VerificationStuckSchema,
    ExceptionDecisionRequestedSchema,
  ]).readonly();
};

export const LedgerEntryV1_0_0Schema = ledgerEntrySchemaFor(
  "1.0.0",
  CANONICAL_SERIALIZER_V1_0_0,
);
export const LedgerEntryV1_1_0Schema = ledgerEntrySchemaFor(
  "1.1.0",
  CANONICAL_SERIALIZER_V1_0_0,
);
export const LedgerEntrySchema = ledgerEntrySchemaFor(
  LEDGER_SCHEMA_VERSION,
  CANONICAL_SERIALIZER_VERSION,
);

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type DecisionRecorded = Extract<LedgerEntry, { type: "DecisionRecorded" }>;
export type EvidenceSnapshotRecorded = Extract<LedgerEntry, { type: "EvidenceSnapshotRecorded" }>;
export type ApprovalRecorded = Extract<LedgerEntry, { type: "ApprovalRecorded" }>;
export type ApprovalInvalidated = Extract<LedgerEntry, { type: "ApprovalInvalidated" }>;
export type ApprovalStageExpired = Extract<LedgerEntry, { type: "ApprovalStageExpired" }>;
export type ApprovalStageEscalated = Extract<LedgerEntry, { type: "ApprovalStageEscalated" }>;
export type ReservationCreated = Extract<LedgerEntry, { type: "ReservationCreated" }>;
export type ReservationReleased = Extract<LedgerEntry, { type: "ReservationReleased" }>;
export type ExecutionStarted = Extract<LedgerEntry, { type: "ExecutionStarted" }>;
export type ExecutionSucceeded = Extract<LedgerEntry, { type: "ExecutionSucceeded" }>;
export type ExecutionPartiallySucceeded = Extract<LedgerEntry, { type: "ExecutionPartiallySucceeded" }>;
export type ExecutionFailed = Extract<LedgerEntry, { type: "ExecutionFailed" }>;
export type StatusObserved = Extract<LedgerEntry, { type: "StatusObserved" }>;
export type VerificationClosed = Extract<LedgerEntry, { type: "VerificationClosed" }>;
export type VerificationStuck = Extract<LedgerEntry, { type: "VerificationStuck" }>;
export type ExceptionDecisionRequested = Extract<LedgerEntry, { type: "ExceptionDecisionRequested" }>;
