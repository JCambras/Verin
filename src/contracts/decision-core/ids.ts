/**
 * Decision-core branded identifiers (v3 §5; ratified shapes: docs/v3/verin-core-contracts.ts;
 * ADR-0029, D-040). Every ID is a BRANDED string: a plain string cannot cross an ID
 * boundary without parsing through its schema, so a DecisionId can never be handed
 * where an IntentId is required - the tenant-scoping and replay guarantees start here.
 *
 * Scope discipline (charter #2): only the IDs the shipped contract surfaces need.
 * Prompt 9 landed PolicyRuleId, InstructionKind, AllowedContextKey, and
 * AllowedSelectionStrategy (the policy-AST vocabulary; ADR-0053). Still deferred
 * with their owning prompts: LedgerEntryId + ExecutionHandleId (7).
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

export const RoleRefSchema = tenantScopedReference(RoleIdSchema);
export type RoleRef = z.infer<typeof RoleRefSchema>;

/** The shape every tenant-scoped reference shares: firm plus opaque branded id. */
export type ScopedReference = { readonly firmId: string; readonly id: string };

export const compareCanonicalStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const normalizeCanonicalStrings = <T extends string>(
  values: readonly T[],
): T[] => [...values].sort(compareCanonicalStrings);

/**
 * THE canonical order for tenant-scoped references - firm first, then opaque id.
 * Every set-like collection and every hash preimage sorts through this one
 * comparator: a second ordering would let a parsed record and its hash preimage
 * disagree the day references stop being single-tenant (ADR-0029, D-051).
 */
export const compareScopedReferences = (left: ScopedReference, right: ScopedReference): number => {
  const firmOrder = compareCanonicalStrings(left.firmId, right.firmId);
  return firmOrder === 0 ? compareCanonicalStrings(left.id, right.id) : firmOrder;
};

export const normalizeScopedReferences = <T extends ScopedReference>(
  references: readonly T[],
): T[] => [...references].sort(compareScopedReferences);

export const hasUniqueByComparator = <T>(
  values: readonly T[],
  comparator: (left: T, right: T) => number,
): boolean => {
  const ordered = [...values].sort(comparator);
  return ordered.every((value, index) => index === 0 || comparator(ordered[index - 1]!, value) !== 0);
};

/** Set semantics for tenant-scoped references: identity is the (firm, id) pair. */
export const hasUniqueScopedReferences = (references: readonly ScopedReference[]): boolean =>
  hasUniqueByComparator(references, compareScopedReferences);

export type VersionedScopedReference = {
  readonly sourceType: string;
  readonly sourceRef: ScopedReference;
  readonly versionRef: ScopedReference;
};

export const compareVersionedScopedReferences = (
  left: VersionedScopedReference,
  right: VersionedScopedReference,
): number => {
  const typeOrder = compareCanonicalStrings(left.sourceType, right.sourceType);
  if (typeOrder !== 0) return typeOrder;
  const sourceOrder = compareScopedReferences(left.sourceRef, right.sourceRef);
  return sourceOrder === 0
    ? compareScopedReferences(left.versionRef, right.versionRef)
    : sourceOrder;
};

export const normalizeVersionedScopedReferences = <
  T extends VersionedScopedReference,
>(
  references: readonly T[],
): T[] => [...references].sort(compareVersionedScopedReferences);

export const compareStringOrScopedReferences = (
  left: string | ScopedReference,
  right: string | ScopedReference,
): number => {
  if (typeof left === "string") {
    return typeof right === "string"
      ? compareCanonicalStrings(left, right)
      : -1;
  }
  return typeof right === "string"
    ? 1
    : compareScopedReferences(left, right);
};

export const normalizeStringOrScopedReferences = <
  T extends string | ScopedReference,
>(
  references: readonly T[],
): T[] => [...references].sort(compareStringOrScopedReferences);

export type ExecutionPreconditionReferenceSet = {
  readonly code: string;
  readonly requiredEvidenceSnapshotRefs: readonly ScopedReference[];
  readonly mustStillHoldAtExecution: true;
};

const compareScopedReferenceLists = (
  left: readonly ScopedReference[],
  right: readonly ScopedReference[],
): number => {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = compareScopedReferences(left[index]!, right[index]!);
    if (order !== 0) return order;
  }
  return left.length - right.length;
};

export const compareExecutionPreconditions = (
  left: ExecutionPreconditionReferenceSet,
  right: ExecutionPreconditionReferenceSet,
): number => {
  const codeOrder = compareCanonicalStrings(left.code, right.code);
  return codeOrder === 0
    ? compareScopedReferenceLists(
        left.requiredEvidenceSnapshotRefs,
        right.requiredEvidenceSnapshotRefs,
      )
    : codeOrder;
};

export const normalizeExecutionPreconditions = <
  T extends ExecutionPreconditionReferenceSet,
>(
  preconditions: readonly T[],
): T[] => [...preconditions].sort(compareExecutionPreconditions);

const roleRefSet = (minimum: number) =>
  z
    .array(RoleRefSchema)
    .min(minimum)
    .refine(hasUniqueScopedReferences, "duplicate role reference")
    .refine((refs) => refs.every((ref) => ref.firmId === refs[0]?.firmId), "role references must belong to one tenant")
    .overwrite(normalizeScopedReferences)
    .readonly();

export const RoleRefSetSchema = roleRefSet(0);
export const NonEmptyRoleRefSetSchema = roleRefSet(1);

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

// ── Policy-AST vocabulary (v3 §6.1; prompt 9, ADR-0053) ─────────────────────────

export const PolicyRuleIdSchema = brandedString<"PolicyRuleId">();
export type PolicyRuleId = z.infer<typeof PolicyRuleIdSchema>;

/** Household-instruction taxonomy id (prompt 21 owns the full lifecycle vocabulary). */
export const InstructionKindSchema = brandedString<"InstructionKind">();
export type InstructionKind = z.infer<typeof InstructionKindSchema>;

/**
 * A context key admitted by the load-time closure: intent slots plus the keys
 * published by the primitives a domain configuration binds (v3 §6.1 closed
 * vocabularies; the registry that closes it lives in domain/policy).
 */
export const AllowedContextKeySchema = brandedString<"AllowedContextKey">();
export type AllowedContextKey = z.infer<typeof AllowedContextKeySchema>;

/** A selection strategy admitted per primitive by its own closed strategy list. */
export const AllowedSelectionStrategySchema = brandedString<"AllowedSelectionStrategy">();
export type AllowedSelectionStrategy = z.infer<typeof AllowedSelectionStrategySchema>;

/** Evidence taxonomy id (golden truth set: "account-balance", "planned-withdrawals"). */
export const EvidenceKindSchema = brandedString<"EvidenceKind">();
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

// ── Domain-configuration vocabulary (v3 §5/§16; prompt 10, ADR-0058) ────────────
//
// ONE brand, not the configuration schema's whole identifier vocabulary. The
// rest of that vocabulary (domain config id, execution capability id, command
// type, conflict-key template id, plan template id) is minted where the schema
// that uses it lives, in `src/domain/config/` (D-220): a second declaration here
// had no contracts consumer, and the two disagreed at RUNTIME while agreeing at
// compile time - `brandedString` admits any non-empty string, `kebabId` does
// not - so a value one layer parsed the other would refuse under the same type.
//
// THAT DISAGREEMENT IS REMOVED FOR THE FIVE DELETED BRANDS AND REMAINS FOR THIS
// ONE. `ActionIdSchema` below is a `brandedString`, while `src/domain/config/`
// mints the same `"ActionId"` brand as a `kebabId`, so a non-kebab value parsed
// here is typed `ActionId` and `compileFlowDefinition` could never resolve it
// against the document's intents. Aligning the two is a real narrowing, not a
// comment fix - `src/__tests__/unit/decision-core.test.ts` parses an `Intent`
// whose action is `"primitive:distribute-cash"`, a value left over from the
// PrimitiveId this field used to carry (D-221) - so it is recorded as the named
// obligation PC-3a in docs/domain-config-gaps.md, owned by prompt 14, the prompt
// that first CONSTRUCTS an Intent and therefore first has real values to narrow
// against. Nothing constructs one today, so the disagreement is unreachable now.

/**
 * A domain's ACTION vocabulary ("distribute-cash", "open-account"), distinct
 * from PrimitiveId. Intent.action used to carry PrimitiveId, which conflated
 * the two closed vocabularies: prompt 9's loader rejects an unknown primitive
 * against the catalog, so a domain action sharing that brand made the check
 * ambiguous and parked a domain-named value inside a type whose name says
 * "primitive". Both are branded `string` at runtime, so this is a compile-time
 * separation only - no hash preimage and no stored byte changes (D-187).
 */
export const ActionIdSchema = brandedString<"ActionId">();
export type ActionId = z.infer<typeof ActionIdSchema>;
