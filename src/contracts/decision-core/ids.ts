/**
 * Decision-core branded identifiers (v3 §5; ratified shapes: docs/v3/verin-core-contracts.ts;
 * ADR-0029, D-040). Every ID is a BRANDED string: a plain string cannot cross an ID
 * boundary without parsing through its schema, so a DecisionId can never be handed
 * where an IntentId is required - the tenant-scoping and replay guarantees start here.
 *
 * Scope discipline (charter #2): only the IDs the prompt-5 contract surface needs.
 * Deferred with their owning prompts: PolicyRuleId (9), LedgerEntryId +
 * ExecutionHandleId (7), InstructionKind / AllowedContextKey /
 * AllowedSelectionStrategy (9–10).
 */
import { z } from "zod";

/** A non-empty string carrying a type-level brand. Zod's .brand is compile-time only. */
const brandedString = <B extends string>() => z.string().min(1).brand<B>();

// ── Temporal + integrity primitives ─────────────────────────────────────────────

/**
 * Canonical UTC instant, pinned to EXACTLY the Date.prototype.toISOString() byte
 * form: YYYY-MM-DDTHH:MM:SS.mmmZ (three fractional digits, Z suffix). Offset,
 * local, second-precision, and sub-millisecond forms are all rejected. This is
 * the store discipline (db.ts OID 1184 parser → toISOString()): one byte form
 * per instant is what keeps bundle/decision hashes replay-stable.
 */
export const TimestampSchema = z.iso.datetime({ precision: 3 }).brand<"Timestamp">();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** SHA-256 content hash, lowercase hex (the audit-chain convention, ADR-0007). */
export const HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "sha256 lowercase hex")
  .brand<"Hash">();
export type Hash = z.infer<typeof HashSchema>;

/** ISO-8601 duration (e.g. P3D, PT30M) - the golden truth set's expiresAfter vocabulary. */
export const DurationSchema = z.iso.duration().brand<"Duration">();
export type Duration = z.infer<typeof DurationSchema>;

// ── Tenant + actor identity ─────────────────────────────────────────────────────

/** v3's FirmId ≡ the store layer's org_id (ADR-0026). */
export const FirmIdSchema = brandedString<"FirmId">();
export type FirmId = z.infer<typeof FirmIdSchema>;

export const ActorIdSchema = brandedString<"ActorId">();
export type ActorId = z.infer<typeof ActorIdSchema>;

/**
 * Firm-configurable role identifier (e.g. "operations", "operations-manager" in
 * the golden truth set). Deliberately NOT constrained to the app-shell Role union
 * (contracts/roles.ts) - firm authority configuration owns this vocabulary.
 */
export const RoleIdSchema = brandedString<"RoleId">();
export type RoleId = z.infer<typeof RoleIdSchema>;

// ── Decision-pipeline entity IDs ────────────────────────────────────────────────

export const IntentIdSchema = brandedString<"IntentId">();
export type IntentId = z.infer<typeof IntentIdSchema>;

export const DecisionIdSchema = brandedString<"DecisionId">();
export type DecisionId = z.infer<typeof DecisionIdSchema>;

export const DecisionInputBundleIdSchema = brandedString<"DecisionInputBundleId">();
export type DecisionInputBundleId = z.infer<typeof DecisionInputBundleIdSchema>;

export const EvidenceSnapshotIdSchema = brandedString<"EvidenceSnapshotId">();
export type EvidenceSnapshotId = z.infer<typeof EvidenceSnapshotIdSchema>;

export const EvidenceSourceIdSchema = brandedString<"EvidenceSourceId">();
export type EvidenceSourceId = z.infer<typeof EvidenceSourceIdSchema>;

export const PolicyIdSchema = brandedString<"PolicyId">();
export type PolicyId = z.infer<typeof PolicyIdSchema>;

export const PolicyVersionIdSchema = brandedString<"PolicyVersionId">();
export type PolicyVersionId = z.infer<typeof PolicyVersionIdSchema>;

export const HouseholdInstructionIdSchema = brandedString<"HouseholdInstructionId">();
export type HouseholdInstructionId = z.infer<typeof HouseholdInstructionIdSchema>;

export const HouseholdInstructionVersionIdSchema = brandedString<"HouseholdInstructionVersionId">();
export type HouseholdInstructionVersionId = z.infer<typeof HouseholdInstructionVersionIdSchema>;

export const RegulatorySourceIdSchema = brandedString<"RegulatorySourceId">();
export type RegulatorySourceId = z.infer<typeof RegulatorySourceIdSchema>;

export const RegulatoryVersionIdSchema = brandedString<"RegulatoryVersionId">();
export type RegulatoryVersionId = z.infer<typeof RegulatoryVersionIdSchema>;

export const DomainConfigVersionIdSchema = brandedString<"DomainConfigVersionId">();
export type DomainConfigVersionId = z.infer<typeof DomainConfigVersionIdSchema>;

export const SubjectIdSchema = brandedString<"SubjectId">();
export type SubjectId = z.infer<typeof SubjectIdSchema>;

export const ScopeIdSchema = brandedString<"ScopeId">();
export type ScopeId = z.infer<typeof ScopeIdSchema>;

const tenantScopedReference = <T>(id: z.ZodType<T>) =>
  z.strictObject({ firmId: FirmIdSchema, id }).readonly();

export const DomainConfigVersionRefSchema = tenantScopedReference(DomainConfigVersionIdSchema);
export type DomainConfigVersionRef = z.infer<typeof DomainConfigVersionRefSchema>;

export const IntentRefSchema = tenantScopedReference(IntentIdSchema);
export type IntentRef = z.infer<typeof IntentRefSchema>;

export const DecisionRefSchema = tenantScopedReference(DecisionIdSchema);
export type DecisionRef = z.infer<typeof DecisionRefSchema>;

export const DecisionInputBundleRefSchema = tenantScopedReference(DecisionInputBundleIdSchema);
export type DecisionInputBundleRef = z.infer<typeof DecisionInputBundleRefSchema>;

export const EvidenceSnapshotIdRefSchema = tenantScopedReference(EvidenceSnapshotIdSchema);
export type EvidenceSnapshotIdRef = z.infer<typeof EvidenceSnapshotIdRefSchema>;

export const EvidenceSourceRefSchema = tenantScopedReference(EvidenceSourceIdSchema);
export type EvidenceSourceRef = z.infer<typeof EvidenceSourceRefSchema>;

export const PolicyRefSchema = tenantScopedReference(PolicyIdSchema);
export type PolicyRef = z.infer<typeof PolicyRefSchema>;

export const PolicyVersionRefSchema = tenantScopedReference(PolicyVersionIdSchema);
export type PolicyVersionRef = z.infer<typeof PolicyVersionRefSchema>;

export const HouseholdInstructionRefSchema = tenantScopedReference(HouseholdInstructionIdSchema);
export type HouseholdInstructionRef = z.infer<typeof HouseholdInstructionRefSchema>;

export const HouseholdInstructionVersionRefSchema = tenantScopedReference(HouseholdInstructionVersionIdSchema);
export type HouseholdInstructionVersionRef = z.infer<typeof HouseholdInstructionVersionRefSchema>;

export const RegulatorySourceRefSchema = tenantScopedReference(RegulatorySourceIdSchema);
export type RegulatorySourceRef = z.infer<typeof RegulatorySourceRefSchema>;

export const RegulatoryVersionRefSchema = tenantScopedReference(RegulatoryVersionIdSchema);
export type RegulatoryVersionRef = z.infer<typeof RegulatoryVersionRefSchema>;

export const SubjectRefSchema = tenantScopedReference(SubjectIdSchema);
export type SubjectRef = z.infer<typeof SubjectRefSchema>;

export const ScopeRefSchema = tenantScopedReference(ScopeIdSchema);
export type ScopeRef = z.infer<typeof ScopeRefSchema>;

export const PrimitiveIdSchema = brandedString<"PrimitiveId">();
export type PrimitiveId = z.infer<typeof PrimitiveIdSchema>;

export const ApprovalTemplateIdSchema = brandedString<"ApprovalTemplateId">();
export type ApprovalTemplateId = z.infer<typeof ApprovalTemplateIdSchema>;

export const ApprovalTemplateRefSchema = tenantScopedReference(ApprovalTemplateIdSchema);
export type ApprovalTemplateRef = z.infer<typeof ApprovalTemplateRefSchema>;

export const ExecutionPlanIdSchema = brandedString<"ExecutionPlanId">();
export type ExecutionPlanId = z.infer<typeof ExecutionPlanIdSchema>;

export const ExecutionStepIdSchema = brandedString<"ExecutionStepId">();
export type ExecutionStepId = z.infer<typeof ExecutionStepIdSchema>;

export const ExecutionTargetIdSchema = brandedString<"ExecutionTargetId">();
export type ExecutionTargetId = z.infer<typeof ExecutionTargetIdSchema>;

export const ExecutionTargetRefSchema = tenantScopedReference(ExecutionTargetIdSchema);
export type ExecutionTargetRef = z.infer<typeof ExecutionTargetRefSchema>;

export const VerificationRuleIdSchema = brandedString<"VerificationRuleId">();
export type VerificationRuleId = z.infer<typeof VerificationRuleIdSchema>;

export const VerificationRuleRefSchema = tenantScopedReference(VerificationRuleIdSchema);
export type VerificationRuleRef = z.infer<typeof VerificationRuleRefSchema>;

export const ReservationIdSchema = brandedString<"ReservationId">();
export type ReservationId = z.infer<typeof ReservationIdSchema>;

export const ReservationRefSchema = tenantScopedReference(ReservationIdSchema);
export type ReservationRef = z.infer<typeof ReservationRefSchema>;

// ── Opaque references (PII stays behind these - the value is a pointer, never content) ──

export const SecureRequestIdSchema = brandedString<"SecureRequestId">();
export type SecureRequestId = z.infer<typeof SecureRequestIdSchema>;

export const SecureRequestRefSchema = tenantScopedReference(SecureRequestIdSchema);
export type SecureRequestRef = z.infer<typeof SecureRequestRefSchema>;

export const SecureEventIdSchema = brandedString<"SecureEventId">();
export type SecureEventId = z.infer<typeof SecureEventIdSchema>;

export const SecureEventRefSchema = tenantScopedReference(SecureEventIdSchema);
export type SecureEventRef = z.infer<typeof SecureEventRefSchema>;

export const SecureBlobIdSchema = brandedString<"SecureBlobId">();
export type SecureBlobId = z.infer<typeof SecureBlobIdSchema>;

export const SecureBlobRefSchema = tenantScopedReference(SecureBlobIdSchema);
export type SecureBlobRef = z.infer<typeof SecureBlobRefSchema>;

export const SlotRefSchema = brandedString<"SlotRef">();
export type SlotRef = z.infer<typeof SlotRefSchema>;

// ── Coordination + explanation vocabulary ───────────────────────────────────────

export const ConflictKeySchema = brandedString<"ConflictKey">();
export type ConflictKey = z.infer<typeof ConflictKeySchema>;

/** Kebab-case reason vocabulary (golden truth set: "cash-reserve-breach", "approval-stage-idle"). */
export const ReasonCodeSchema = brandedString<"ReasonCode">();
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

/** Evidence taxonomy id (golden truth set: "account-balance", "planned-withdrawals"). */
export const EvidenceKindSchema = brandedString<"EvidenceKind">();
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
