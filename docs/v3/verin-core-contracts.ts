/**
 * Verin v3 canonical domain contracts.
 *
 * Purpose:
 * - Keep disposition separate from authority.
 * - Make blocked/prohibited/proceed states structurally distinct.
 * - Pin all data required for deterministic replay.
 * - Separate operational ledger events from decisions.
 * - Require tenant scope, actor attribution, idempotency, and conflict control.
 *
 * This file is intentionally framework-free. Wrap these contracts in Zod schemas
 * at every API, persistence, config, port, and LLM boundary.
 */

export type Brand<T, Tag extends string> = T & { readonly __brand: Tag };

export type Timestamp = Brand<string, 'Timestamp'>;
export type Hash = Brand<string, 'Hash'>;
export type Duration = Brand<string, 'Duration'>;

export type FirmId = Brand<string, 'FirmId'>;
export type ActorId = Brand<string, 'ActorId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type IntentId = Brand<string, 'IntentId'>;
export type DecisionId = Brand<string, 'DecisionId'>;
export type DecisionInputBundleId = Brand<string, 'DecisionInputBundleId'>;
export type EvidenceSnapshotId = Brand<string, 'EvidenceSnapshotId'>;
export type EvidenceSourceId = Brand<string, 'EvidenceSourceId'>;
export type PolicyVersionId = Brand<string, 'PolicyVersionId'>;
export type PolicyRuleId = Brand<string, 'PolicyRuleId'>;
export type HouseholdInstructionVersionId = Brand<string, 'HouseholdInstructionVersionId'>;
export type DomainConfigVersionId = Brand<string, 'DomainConfigVersionId'>;
export type PrimitiveId = Brand<string, 'PrimitiveId'>;
export type ApprovalTemplateId = Brand<string, 'ApprovalTemplateId'>;
export type ExecutionPlanId = Brand<string, 'ExecutionPlanId'>;
export type ExecutionStepId = Brand<string, 'ExecutionStepId'>;
export type ExecutionTargetId = Brand<string, 'ExecutionTargetId'>;
export type VerificationRuleId = Brand<string, 'VerificationRuleId'>;
export type ReservationId = Brand<string, 'ReservationId'>;
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;
export type ExecutionHandleId = Brand<string, 'ExecutionHandleId'>;
export type SecureRequestRef = Brand<string, 'SecureRequestRef'>;
export type SecureEventRef = Brand<string, 'SecureEventRef'>;
export type SecureBlobRef = Brand<string, 'SecureBlobRef'>;
export type SubjectRef = Brand<string, 'SubjectRef'>;
export type SlotRef = Brand<string, 'SlotRef'>;
export type ScopeRef = Brand<string, 'ScopeRef'>;
export type ConflictKey = Brand<string, 'ConflictKey'>;
export type ReasonCode = Brand<string, 'ReasonCode'>;

/**
 * NORMATIVE: Tokenized<T> is constructible ONLY through the scrubbing boundary
 * (the LLM adapter's scrub function and the evidence-to-LLM projection layer).
 * The `piiFree` flag proves nothing by itself; enforcement is structural:
 * - the scrubber module exports the sole factory;
 * - a lint/grep CI rule fails on any object literal or cast producing
 *   Tokenized outside that module;
 * - invariant 1 tests import-reachability.
 * Direct construction elsewhere is an invariant violation, not a style issue.
 */
export interface Tokenized<T> {
  readonly value: T;
  readonly piiFree: true;
}

export interface TenantContext {
  readonly firmId: FirmId;
}

export interface ActorRef extends TenantContext {
  readonly actorId: ActorId;
  readonly roleIds: readonly RoleId[];
}

export interface SystemActorRef extends TenantContext {
  readonly systemId: string;
}

export type Trigger =
  | {
      readonly kind: 'human_request';
      readonly requester: ActorRef;
      readonly requestRef: SecureRequestRef;
      readonly maskedRequest: Tokenized<string>;
    }
  | {
      readonly kind: 'system_event';
      readonly firmId: FirmId;
      readonly sourceId: EvidenceSourceId;
      readonly eventType: string;
      readonly eventRef: SecureEventRef;
      readonly tokenizedPayload: Tokenized<Readonly<Record<string, unknown>>>;
    };

export interface Intent extends TenantContext {
  readonly id: IntentId;
  readonly trigger: Trigger;
  readonly domainConfigVersionId: DomainConfigVersionId;
  readonly action: PrimitiveId;
  readonly slots: Readonly<Record<string, SlotRef>>;
  readonly createdAt: Timestamp;
}

export interface AmbiguityRef {
  readonly slotName: string;
  readonly candidateRefs: readonly SubjectRef[];
  readonly humanQuestionCode: string;
}

export type EvidenceKind = Brand<string, 'EvidenceKind'>;

export interface EvidenceRequest {
  readonly evidenceKind: EvidenceKind;
  readonly subjectRef: SubjectRef;
  readonly suppliableBy: readonly (RoleId | 'client' | 'external')[];
}

export interface ResolvableBlocker {
  readonly code: ReasonCode;
  readonly explanation: string;
  readonly resolvingEvidence: readonly EvidenceRequest[];
}

export interface ResolutionState {
  readonly bound: readonly SlotRef[];
  readonly ambiguous: readonly AmbiguityRef[];
  readonly gaps: readonly EvidenceRequest[];
}

export interface EvidenceSnapshotRef extends TenantContext {
  readonly id: EvidenceSnapshotId;
  readonly kind: EvidenceKind;
  readonly sourceId: EvidenceSourceId;
  readonly subjectRef: SubjectRef;
  readonly observedAt: Timestamp;
  readonly retrievedAt: Timestamp;
  readonly attribution: string;
  readonly schemaVersion: string;
  readonly encryptedStorageRef: SecureBlobRef;
  readonly contentHash: Hash;
  readonly freshness: 'fresh' | 'stale' | 'unknown';
}

export interface DecisionInputBundle extends TenantContext {
  readonly id: DecisionInputBundleId;
  readonly schemaVersion: string;
  readonly canonicalSerializerVersion: string;
  readonly engineVersion: string;
  readonly primitiveSetVersion: string;
  readonly domainConfigVersionId: DomainConfigVersionId;
  readonly policyVersionId: PolicyVersionId;
  readonly householdInstructionVersionIds: readonly HouseholdInstructionVersionId[];
  readonly evidenceSnapshotIds: readonly EvidenceSnapshotId[];
  readonly asOf: Timestamp;
  readonly timeZone: string;
  readonly bundleHash: Hash;
}

export type InstructionKind = Brand<string, 'InstructionKind'>;
export type AllowedContextKey = Brand<string, 'AllowedContextKey'>;
export type AllowedSelectionStrategy = Brand<string, 'AllowedSelectionStrategy'>;

export type Scalar = string | number | boolean | null;

export type ValueNode =
  | { readonly kind: 'constant'; readonly value: Scalar }
  | { readonly kind: 'evidence'; readonly evidenceKind: EvidenceKind; readonly path: string }
  | {
      readonly kind: 'household_instruction';
      readonly instructionKind: InstructionKind;
      readonly path: string;
    }
  | { readonly kind: 'context'; readonly key: AllowedContextKey };

export type PredicateNode =
  | { readonly op: 'all'; readonly nodes: readonly PredicateNode[] }
  | { readonly op: 'any'; readonly nodes: readonly PredicateNode[] }
  | { readonly op: 'not'; readonly node: PredicateNode }
  | { readonly op: 'exists'; readonly value: ValueNode }
  | { readonly op: 'is_fresh'; readonly evidenceKind: EvidenceKind; readonly maxAge: Duration }
  | {
      readonly op: 'compare';
      readonly comparator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      readonly left: ValueNode;
      readonly right: ValueNode;
    }
  | { readonly op: 'in'; readonly value: ValueNode; readonly set: readonly ValueNode[] };

export type PolicyEffect =
  | {
      readonly kind: 'require_evidence';
      readonly evidenceKind: EvidenceKind;
      readonly absence: 'block' | 'specialist_review';
    }
  | {
      readonly kind: 'set_parameter';
      readonly primitiveId: PrimitiveId;
      readonly parameter: string;
      readonly value: ValueNode;
    }
  | { readonly kind: 'require_approval'; readonly templateId: ApprovalTemplateId }
  | {
      readonly kind: 'block';
      readonly blockerCode: ReasonCode;
      readonly resolvingEvidenceKinds: readonly EvidenceKind[];
    }
  | { readonly kind: 'prohibit'; readonly prohibitionCode: ReasonCode }
  | {
      readonly kind: 'select_candidate';
      readonly primitiveId: PrimitiveId;
      readonly strategy: AllowedSelectionStrategy;
    };

export interface PolicyRule {
  readonly id: PolicyRuleId;
  readonly when: PredicateNode;
  readonly effects: readonly PolicyEffect[];
}

export interface PolicyAst {
  readonly schemaVersion: string;
  readonly primitiveSetVersion: string;
  readonly rules: readonly PolicyRule[];
}

export interface VersionedSourceRef {
  readonly sourceType: 'firm_policy' | 'household_instruction' | 'regulatory';
  readonly sourceId: string;
  readonly versionId: string;
}

export interface PrecedenceStep {
  readonly left: VersionedSourceRef;
  readonly right: VersionedSourceRef;
  readonly resolution: 'left_wins' | 'right_wins' | 'narrowed' | 'exception_required' | 'blocked';
  readonly reasonCode: ReasonCode;
}

export interface ExplanationNode {
  readonly code: string;
  readonly messageTemplate: string;
  readonly evidenceSnapshotIds: readonly EvidenceSnapshotId[];
  readonly sourceRefs: readonly VersionedSourceRef[];
  readonly childNodes: readonly ExplanationNode[];
}

export interface Recommendation {
  readonly code: string;
  readonly summary: string;
  readonly parameters: Readonly<Record<string, Scalar>>;
  readonly alternatives: readonly RecommendationAlternative[];
}

export interface RecommendationAlternative {
  readonly code: string;
  readonly summary: string;
  readonly rejectedBecause: readonly ReasonCode[];
}

export interface EscalationStep {
  readonly after: Duration;
  readonly roleIds: readonly RoleId[];
  readonly reasonCode: ReasonCode;
}

export interface ApprovalRequirement {
  readonly eligibleRoleIds: readonly RoleId[];
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly requesterMayApprove: boolean;
  readonly priorExecutorMayApprove: boolean;
  readonly reasonRequiredOnOverride: boolean;
}

/**
 * Template form: lives in firm configuration, referenced by ApprovalTemplateId.
 * Carries a relative expiration because a reusable template cannot know
 * the wall-clock time of any future decision.
 */
export interface ApprovalStageTemplate {
  readonly stageId: string;
  readonly order: number;
  readonly executionMode: 'sequential' | 'parallel';
  readonly requirements: readonly ApprovalRequirement[];
  readonly expiresAfter: Duration;
  readonly escalationPath: readonly EscalationStep[];
}

export interface ApprovalTemplate {
  readonly id: ApprovalTemplateId;
  readonly stages: readonly ApprovalStageTemplate[];
}

/**
 * Instance form: attached to a specific ProceedDecision's AuthorityRequirement.
 * expiresAt is computed at instantiation from the template's expiresAfter and
 * the decision's creation time. Instantiation is deterministic and recorded.
 */
export interface ApprovalStage {
  readonly stageId: string;
  readonly templateId: ApprovalTemplateId;
  readonly order: number;
  readonly executionMode: 'sequential' | 'parallel';
  readonly requirements: readonly ApprovalRequirement[];
  readonly expiresAt: Timestamp;
  readonly escalationPath: readonly EscalationStep[];
}

export type AuthorityRequirement =
  | { readonly mode: 'automatic' }
  | { readonly mode: 'approval'; readonly stages: readonly ApprovalStage[] }
  | {
      readonly mode: 'specialist_review';
      readonly specialistRoleIds: readonly RoleId[];
      readonly stages: readonly ApprovalStage[];
    };

export interface ExecutionPrecondition {
  readonly code: string;
  readonly requiredEvidenceSnapshotIds: readonly EvidenceSnapshotId[];
  readonly mustStillHoldAtExecution: boolean;
}

export interface CompensatingAction {
  readonly targetId: ExecutionTargetId;
  readonly command: ExecutionCommand;
  readonly reasonCode: ReasonCode;
}

export interface ExecutionCommand {
  readonly commandType: string;
  readonly payloadRef: SecureBlobRef;
  readonly payloadHash: Hash;
}

export interface ExecutionStep {
  readonly id: ExecutionStepId;
  readonly targetId: ExecutionTargetId;
  readonly command: ExecutionCommand;
  readonly idempotencyKey: string;
  readonly conflictKeys: readonly ConflictKey[];
  readonly reservationRefs: readonly ReservationId[];
  readonly preconditions: readonly ExecutionPrecondition[];
  readonly verificationRuleId: VerificationRuleId;
  readonly dependsOn: readonly ExecutionStepId[];
  readonly compensatingAction?: CompensatingAction;
}

export interface ExecutionPlan {
  readonly id: ExecutionPlanId;
  readonly steps: readonly ExecutionStep[];
}

export interface Prohibition {
  readonly source: VersionedSourceRef;
  readonly scope: ScopeRef;
  readonly reasonCode: ReasonCode;
  readonly explanation: string;
}

export type ProceedDecision = {
  readonly kind: 'proceed';
  readonly recommendation: Recommendation;
  readonly authority: AuthorityRequirement;
  readonly executionPlan: ExecutionPlan;
};

export type BlockedDecision = {
  readonly kind: 'blocked';
  readonly blockers: readonly ResolvableBlocker[];
  // What resolves the block is derived from blockers[].resolvingEvidence.
  // Do not store a second copy; two sources of truth will drift.
};

export type ProhibitedDecision = {
  readonly kind: 'prohibited';
  readonly prohibition: Prohibition;
};

export type DecisionResult = ProceedDecision | BlockedDecision | ProhibitedDecision;

export type RiskClass = 'low' | 'medium' | 'high' | 'critical';

export interface RevaluationCondition {
  readonly kind:
    | 'evidence_changed'
    | 'policy_changed'
    | 'instruction_changed'
    | 'approval_expired'
    | 'reservation_expired'
    | 'status_changed'
    | 'deadline_reached';
  readonly subjectRef?: SubjectRef;
  readonly evidenceKind?: EvidenceKind;
  readonly deadline?: Timestamp;
}

export interface DecisionRecord extends TenantContext {
  readonly id: DecisionId;
  readonly intentId: IntentId;
  readonly inputBundleId: DecisionInputBundleId;
  readonly result: DecisionResult;
  readonly precedenceTrace: readonly PrecedenceStep[];
  readonly explanationTrace: readonly ExplanationNode[];
  readonly riskClass: RiskClass;
  readonly reversibility: 'reversible' | 'partially_reversible' | 'irreversible';
  readonly reevaluateWhen: readonly RevaluationCondition[];
  readonly derivedFromDecisionId?: DecisionId;
  readonly decisionHash: Hash;
  readonly createdBy: ActorRef | SystemActorRef;
  readonly createdAt: Timestamp;
}

export interface LedgerBase extends TenantContext {
  readonly id: LedgerEntryId;
  readonly occurredAt: Timestamp;
  readonly recordedAt: Timestamp;
  readonly actor: ActorRef | SystemActorRef;
  readonly correlationId: string;
  readonly causationId?: LedgerEntryId;
}

export interface DecisionRecorded extends LedgerBase {
  readonly type: 'DecisionRecorded';
  readonly decisionId: DecisionId;
  readonly decisionHash: Hash;
}

export interface EvidenceSnapshotRecorded extends LedgerBase {
  readonly type: 'EvidenceSnapshotRecorded';
  readonly evidenceSnapshotId: EvidenceSnapshotId;
  readonly contentHash: Hash;
}

export interface ApprovalRecorded extends LedgerBase {
  readonly type: 'ApprovalRecorded';
  readonly decisionId: DecisionId;
  readonly decisionHash: Hash;
  readonly inputBundleHash: Hash;
  readonly stageId: string;
  readonly approver: ActorRef;
  readonly outcome: 'approved' | 'rejected' | 'overridden';
  readonly reasonCode?: ReasonCode;
  readonly structuredReason?: string;
}

export interface ApprovalInvalidated extends LedgerBase {
  readonly type: 'ApprovalInvalidated';
  readonly decisionId: DecisionId;
  readonly priorDecisionHash: Hash;
  readonly reasonCode: ReasonCode;
  readonly newInputBundleHash?: Hash;
}

export interface ReservationCreated extends LedgerBase {
  readonly type: 'ReservationCreated';
  readonly reservationId: ReservationId;
  readonly decisionId: DecisionId;
  readonly conflictKeys: readonly ConflictKey[];
  readonly expiresAt: Timestamp;
}

export interface ReservationReleased extends LedgerBase {
  readonly type: 'ReservationReleased';
  readonly reservationId: ReservationId;
  readonly reasonCode: ReasonCode;
}

export interface ExecutionStarted extends LedgerBase {
  readonly type: 'ExecutionStarted';
  readonly decisionId: DecisionId;
  readonly stepId: ExecutionStepId;
  readonly idempotencyKey: string;
}

export interface ExecutionSucceeded extends LedgerBase {
  readonly type: 'ExecutionSucceeded';
  readonly decisionId: DecisionId;
  readonly stepId: ExecutionStepId;
  readonly executionHandleId: ExecutionHandleId;
  readonly sourceStatus: string;
}

export interface ExecutionPartiallySucceeded extends LedgerBase {
  readonly type: 'ExecutionPartiallySucceeded';
  readonly decisionId: DecisionId;
  readonly stepId: ExecutionStepId;
  readonly executionHandleId?: ExecutionHandleId;
  readonly completedParts: readonly string[];
  readonly incompleteParts: readonly string[];
  readonly sourceStatus: string;
}

export interface ExecutionFailed extends LedgerBase {
  readonly type: 'ExecutionFailed';
  readonly decisionId: DecisionId;
  readonly stepId: ExecutionStepId;
  readonly failureCode: ReasonCode;
  readonly retryable: boolean;
  readonly sourceStatus?: string;
}

export type ObservedStatus = 'Submitted' | 'InFlight' | 'Completed' | 'Rejected' | 'NIGO' | 'Unknown';

export interface StatusObserved extends LedgerBase {
  readonly type: 'StatusObserved';
  readonly decisionId: DecisionId;
  readonly executionHandleId: ExecutionHandleId;
  readonly status: ObservedStatus;
  readonly sourceStatus: string;
  readonly evidenceSnapshotId?: EvidenceSnapshotId;
}

export interface VerificationClosed extends LedgerBase {
  readonly type: 'VerificationClosed';
  readonly decisionId: DecisionId;
  readonly verificationRuleId: VerificationRuleId;
  readonly provenState: ObservedStatus;
}

export interface VerificationStuck extends LedgerBase {
  readonly type: 'VerificationStuck';
  readonly decisionId: DecisionId;
  readonly executionHandleId: ExecutionHandleId;
  readonly lastObservedStatus: ObservedStatus;
  readonly reasonCode: ReasonCode;
}

export interface ExceptionDecisionRequested extends LedgerBase {
  readonly type: 'ExceptionDecisionRequested';
  readonly priorDecisionId: DecisionId;
  readonly triggeringEntryId: LedgerEntryId;
  readonly reasonCode: ReasonCode;
}

export type LedgerEntry =
  | DecisionRecorded
  | EvidenceSnapshotRecorded
  | ApprovalRecorded
  | ApprovalInvalidated
  | ReservationCreated
  | ReservationReleased
  | ExecutionStarted
  | ExecutionSucceeded
  | ExecutionPartiallySucceeded
  | ExecutionFailed
  | StatusObserved
  | VerificationClosed
  | VerificationStuck
  | ExceptionDecisionRequested;

export interface EvidenceQuery {
  readonly subjectRefs: readonly SubjectRef[];
  readonly evidenceKinds: readonly EvidenceKind[];
  readonly asOf: Timestamp;
}

export interface SystemEvent extends TenantContext {
  readonly sourceId: EvidenceSourceId;
  readonly eventType: string;
  readonly eventRef: SecureEventRef;
  readonly occurredAt: Timestamp;
}

export interface EvidenceSource {
  snapshot(query: EvidenceQuery, ctx: TenantContext): Promise<readonly EvidenceSnapshotRef[]>;
  subscribe?(eventTypes: readonly string[], ctx: TenantContext): AsyncIterable<SystemEvent>;
}

export interface ExecutionContext extends TenantContext {
  readonly decisionId: DecisionId;
  readonly actor: ActorRef | SystemActorRef;
  readonly approvedDecisionHash: Hash;
  readonly currentInputBundleHash: Hash;
}

export interface ExecutionReceipt {
  readonly outcome: 'accepted' | 'rejected' | 'partial' | 'timeout' | 'duplicate_suppressed';
  readonly handleId?: ExecutionHandleId;
  readonly sourceStatus: string;
  readonly completedParts?: readonly string[];
  readonly incompleteParts?: readonly string[];
  readonly failureCode?: ReasonCode;
}

export interface ExecutionTarget {
  execute(step: ExecutionStep, ctx: ExecutionContext): Promise<ExecutionReceipt>;
}

export interface StatusObservation {
  readonly status: ObservedStatus;
  readonly sourceStatus: string;
  readonly observedAt: Timestamp;
  readonly evidenceSnapshotId?: EvidenceSnapshotId;
}

export interface StatusSource {
  poll(handleId: ExecutionHandleId, ctx: TenantContext): Promise<StatusObservation>;
}

/**
 * Compile-time helpers that make narrowing obvious in consuming code.
 */
export function isProceedDecision(result: DecisionResult): result is ProceedDecision {
  return result.kind === 'proceed';
}

export function isBlockedDecision(result: DecisionResult): result is BlockedDecision {
  return result.kind === 'blocked';
}

export function isProhibitedDecision(result: DecisionResult): result is ProhibitedDecision {
  return result.kind === 'prohibited';
}
