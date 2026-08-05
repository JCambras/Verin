import type { DisplayMetric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";
import type { ExecutionReceiptId, ObservedStatusId, VerificationProjectionId } from "@contracts/execution-status";
import type { PolicyAuthoringVM } from "./policy-model";
import type { RecordVM } from "./record-model";
import type { SignedCaseId } from "./signed-case-types";
export type { RecordVM } from "./record-model";
export type {
  DemoPolicyApprovalEventVM,
  DemoPolicyRerunResultVM,
  PolicyAuthoringVM,
  SimulationDeltaRowVM,
} from "./policy-model";
// ── Fake-class taxonomy (demo contract §6 / design §11.1) ───────────────────────────
// Every visible element in the skeleton is backed by a fake (no engine, adapter, or LLM
// has landed yet), so every element carries one of these classes and a DevProvenanceBadge
// (§11.2) that is removable ONLY in the PR that lands its real path (§11.3, charter #5
// ADR-0027). `real-salesforce-sandbox-response` is deferred-pending-sandbox and can never
// be produced now, so it is deliberately absent from this union.
export type FakeClass =
  | "synthetic-fixture"
  | "real-derived-fixture"
  | "fake-adapter-response"
  | "user-entered-demo-input"
  | "deterministic-engine-output"
  | "llm-proposed-draft";

/** The DevProvenanceBadge text per class - lowercase and plain (§11.2). "engine output ·
 * fake" and the rest are honest: in the skeleton NO real path has landed. */
export const DEV_BADGE_TEXT: Record<FakeClass, string> = {
  "synthetic-fixture": "synthetic fixture",
  "real-derived-fixture": "sample data · anonymized history",
  "fake-adapter-response": "fake adapter",
  "user-entered-demo-input": "demo input",
  "deterministic-engine-output": "engine output · fake",
  "llm-proposed-draft": "llm draft",
};

// ── Decision Spine (design §4) ──────────────────────────────────────────────────────
// Seven fixed stations. The spine shows POSITION, never disposition; it is generated
// from the typed view model only and never renders a station the record has not reached.
export const SPINE_STATIONS = ["Intent", "Evidence", "Decision", "Authority", "Safety", "Execution", "Verification"] as const;
export type SpineStationId = (typeof SPINE_STATIONS)[number];
export type StationState = "done" | "active" | "pending";
export interface SpineStationVM {
  readonly id: SpineStationId;
  readonly state: StationState;
}
export interface DecisionSpineVM {
  /** Exactly seven stations, in SPINE_STATIONS order. */
  readonly stations: readonly SpineStationVM[];
  /** Optional single StatusBadge at the spine's right end (e.g. "Blocked - resolvable"). */
  readonly stateSlot?: { readonly status: string; readonly label: string } | null;
}

// ── Shared value shapes ─────────────────────────────────────────────────────────────
/** A sourced fact rendered through FreshValue. `provenance.asOf` is the OBSERVED time
 * (freshness keys off it); `retrievedAt` is trailing metadata (§6.1). */
export interface FactVM {
  readonly display: string;
  readonly provenance: RecordProvenance;
  readonly retrievedAt: string;
}
export interface VerificationProofVM extends FactVM {
  readonly ledgerEvent:
    | "ExecutionSucceeded"
    | "ExecutionPartiallySucceeded"
    | "StatusObserved";
}
export interface WhyVM {
  readonly reason: string;
  readonly regulation?: string;
}

// ── Disposition treatments (design §5) ──────────────────────────────────────────────
export type DispositionKind = "proceed" | "blocked" | "prohibited";
/** The §5 badge labels - one vocabulary for every surface, the printable record
 * included: "blocked" never loses its "resolvable" qualifier (doctrine, not
 * decoration). */
export const DISPOSITION_LABELS: Record<DispositionKind, string> = {
  proceed: "Proceed",
  blocked: "Blocked - resolvable",
  prohibited: "Prohibited",
};
export interface DispositionFigureVM {
  readonly label: string;
  readonly metric: DisplayMetric;
}
/** One blocker with its resolving affordance (§5.2 blocked). Never an approve/override. */
export interface BlockerVM {
  readonly condition: string;
  readonly affordanceLabel: string;
}
export interface ProhibitionSourceVM {
  readonly kind: "firm-policy" | "household-instruction" | "regulatory";
  readonly id: string;
  readonly ref: string; // versioned reference, font-mono
  readonly scope: string;
  readonly reasonCode: string;
  readonly provenance: RecordProvenance; // source · as of label
}
export interface DispositionVM {
  readonly kind: DispositionKind;
  readonly headline: string;
  readonly why: WhyVM;
  readonly fakeClass: FakeClass;
  // proceed
  readonly authoritySummary?: string;
  readonly figures?: readonly DispositionFigureVM[];
  // blocked
  readonly blockers?: readonly BlockerVM[];
  // prohibited
  readonly prohibitedScope?: string;
  readonly source?: ProhibitionSourceVM;
  readonly doctrine?: string;
}

// ── Surface 1: Household workspace ──────────────────────────────────────────────────
export interface AccountVM {
  readonly id: string;
  readonly evidence: Extract<EvidenceRowVM, { readonly kind: "fact" | "metric" }>;
  readonly unavailableFields: readonly string[];
}
export interface WorkspaceVM {
  readonly household: { readonly name: string; readonly advisor: string; readonly provenance: RecordProvenance; readonly fakeClass: FakeClass };
  readonly accounts: readonly AccountVM[];
  readonly accountsUnavailable: string | null;
  readonly liquidity: DisplayMetric | null;
  readonly plannedMonthlyWithdrawal: DisplayMetric | null;
  readonly plannedWithdrawalAuthorityMissing: string | null;
  readonly pendingActivity: FactVM | null;
  readonly liquidityAuthorityMissing: string | null;
  readonly onRamp: { readonly title: string; readonly description: string };
}

// ── Surface 2: Contextual intent panel ──────────────────────────────────────────────
export interface IntentSlotVM {
  readonly label: string;
  /** Plain wording (LLM-drafted, set apart per §6.5) ... */
  readonly value?: string;
  /** ... or a figure, which is NEVER LLM-drafted: it renders through Metric (§6.5). */
  readonly metric?: DisplayMetric;
}
export interface IntentVM {
  readonly spine: DecisionSpineVM;
  readonly household: string;
  readonly requestText: string;
  readonly requestAt: FactVM;
  readonly requestProvenance: RecordProvenance;
  readonly requestFakeClass: FakeClass;
  /** The interpreted intent echoed back as typed slots - LLM-drafted, set apart (§6.5). */
  readonly interpreted: {
    readonly slots: readonly IntentSlotVM[];
    readonly draftLabel: string;
    readonly fakeClass: FakeClass;
  };
}

// ── Surface 3: Evidence and conflict view ───────────────────────────────────────────
export interface EvidenceSourceBindingVM {
  readonly evidenceKind: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly freshness: string;
  readonly source: string;
  readonly provenance: string;
  readonly summary: string;
  readonly liquidityPhase: string | null;
  readonly observedAbsent: boolean;
  readonly displayValue: {
    readonly valueMinor: number;
    readonly unit: "USD" | "USD/month";
  } | null;
  readonly freshnessWindowDays: number | null;
}
export type EvidenceRowVM =
  | { readonly kind: "fact"; readonly label: string; readonly fact: FactVM; readonly sourceBinding: EvidenceSourceBindingVM; readonly fakeClass: FakeClass; readonly why?: WhyVM }
  | { readonly kind: "metric"; readonly label: string; readonly metric: DisplayMetric; readonly summary: string; readonly retrievedAt: string; readonly sourceBinding: EvidenceSourceBindingVM; readonly fakeClass: FakeClass; readonly why?: WhyVM }
  | { readonly kind: "conflict"; readonly label: string; readonly rule: string; readonly a: FactVM; readonly b: FactVM; readonly fakeClass: FakeClass; readonly blockerAffordance?: string }
  | { readonly kind: "missing"; readonly text: string; readonly fakeClass: FakeClass };
export interface EvidenceVM {
  readonly spine: DecisionSpineVM;
  readonly rows: readonly EvidenceRowVM[];
  readonly refreshNotice: {
    readonly fact: FactVM;
    readonly fakeClass: FakeClass;
  } | null;
}

// ── Surface 4: Recommendation and alternatives ──────────────────────────────────────
export interface AlternativeVM {
  readonly title: string;
  readonly rejectedReason: string;
  readonly why?: WhyVM;
}
export interface RecommendationVM {
  readonly spine: DecisionSpineVM;
  readonly disposition: DispositionVM;
  readonly derivedDecision: boolean;
  readonly recommendation?: { readonly amount: DisplayMetric; readonly source: FactVM };
  readonly alternatives: readonly AlternativeVM[];
}

// ── Surface 5: Policy and precedence trace ──────────────────────────────────────────
export interface PrecedenceRowVM {
  readonly order: number;
  readonly rule: string;
  readonly result: string;
  readonly version: string; // font-mono
  readonly why?: WhyVM;
}
export interface PolicyTraceVM {
  readonly spine: DecisionSpineVM;
  readonly domainConfigVersion: string;
  readonly firmPolicyVersion: string;
  readonly householdInstructionVersions: readonly string[];
  readonly regulatoryVersion: string | null;
  readonly rows: readonly PrecedenceRowVM[];
  readonly fakeClass: FakeClass;
}

// ── Surface 6: Approval stages and actor status ─────────────────────────────────────
export interface ActorSlotVM {
  readonly actorId: string | null;
  readonly name: string;
  readonly roleId: string | null;
  readonly role: string;
  readonly status: string; // StatusBadge key
  readonly statusLabel: string;
  readonly timestampIso?: string;
  readonly note?: string; // e.g. "You requested this - you cannot approve"
  readonly requesterExcluded?: boolean;
  readonly bindingComplete: boolean;
}
export interface ApprovalStageVM {
  readonly stageId: string;
  readonly order: number;
  readonly title: string;
  readonly requirement: string;
  readonly eligibleRoleIds: readonly string[];
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly requesterMayApprove: boolean;
  readonly executionMode: "sequential" | "parallel";
  readonly expiresAfter: string;
  readonly escalationPath: readonly {
    readonly after: string;
    readonly roleIds: readonly string[];
    readonly reasonCode: string;
  }[];
  readonly satisfied: boolean;
  readonly stepState: StationState;
  readonly actors: readonly ActorSlotVM[];
  readonly authorityEvents?: readonly {
    readonly type: "ApprovalStageEscalated" | "ApprovalStageExpired";
    readonly timestamp: string;
    readonly display: string;
  }[];
  readonly expired?: boolean;
}
export interface AutomaticAuthorityVM {
  readonly title: string;
  readonly summary: string;
  readonly policyRef: string;
}
export interface ApprovalVM {
  readonly spine: DecisionSpineVM;
  readonly mode: "automatic" | "staged";
  readonly stages: readonly ApprovalStageVM[];
  readonly satisfied: boolean;
  readonly pass: "initial" | "revalidated";
  readonly automaticAuthority: AutomaticAuthorityVM | null;
  readonly binding: { readonly decisionHash: string; readonly bundleHash: string } | null;
  readonly gate: { readonly restatement: string; readonly figures: readonly DispositionFigureVM[]; readonly primaryLabel: string };
  readonly fakeClass: FakeClass;
}

// ── Surface 7: Pre-execution safety check (+ the invalidation moment §7.3) ───────────
export interface SafetyCheckVM {
  readonly label: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly detail?: string;
  readonly relatedDecision?: {
    readonly sourceCaseId: string;
    readonly disposition: DispositionKind;
    readonly requestAtIso: string;
    readonly decidedAtIso: string;
    readonly requestAt: string;
    readonly decidedAt: string;
  };
}
export interface InvalidationVM {
  readonly voidedActors: readonly {
    readonly name: string;
    readonly role: string;
    readonly when: string;
    readonly timestampIso: string;
  }[];
  readonly deltaSentence: string;
  readonly before: { readonly label: string; readonly metric: DisplayMetric; readonly retrievedAt: string };
  readonly after: { readonly label: string; readonly metric: DisplayMetric; readonly retrievedAt: string };
  readonly why: WhyVM;
  readonly primaryLabel: string;
}
export interface SafetyVM {
  readonly spine: DecisionSpineVM;
  readonly revalidatedAt: FactVM;
  readonly revalidatedAtIso: string;
  readonly checks: readonly SafetyCheckVM[];
  readonly reservationId: string | null;
  readonly reservationAt: string | null;
  readonly reservationAtIso: string | null;
  readonly conflictKeys: readonly string[];
  readonly idempotencyKey: string | null;
  readonly executionEligibility: {
    readonly eligible: boolean;
    readonly reason: string;
    readonly idempotencyKey: string | null;
    readonly reservations: readonly {
      readonly reservationId: string;
      readonly conflictKeys: readonly string[];
      readonly expiresAfter: string;
    }[];
    readonly preconditions: readonly {
      readonly code: string;
      readonly requiredEvidence: readonly string[];
      readonly mustStillHoldAtExecution: boolean;
    }[];
  } | null;
  readonly invalidation: InvalidationVM | null;
  readonly fakeClass: FakeClass;
}

// ── Surface 8 / 9: Execution timeline + verification (honest status, §8) ─────────────
export interface IdentifierVM {
  readonly label: string;
  readonly value: string; // font-mono
}
export interface ExecutionRowVM {
  readonly step: string;
  readonly target: string;
  readonly status: ObservedStatusId | VerificationProjectionId | ExecutionReceiptId; // labels cannot mint states
  readonly statusLabel: string;
  readonly timestamp: string;
  readonly timestampIso: string;
  readonly honestyLine?: string; // "Accepted for processing - settlement not yet confirmed"
  readonly plainClaim?: string; // idempotency in plain words (§8.3)
  readonly affordanceLabel?: string; // NIGO / stuck resolving affordance
  readonly identifiers: readonly IdentifierVM[];
  readonly fakeClass: FakeClass;
}
export interface ExecutionVM {
  readonly spine: DecisionSpineVM;
  readonly rows: readonly ExecutionRowVM[];
  readonly deferredNote: string;
  readonly fakeClass: FakeClass;
}
export interface ExceptionDecisionVM {
  readonly eventType: "ExceptionDecisionRequested";
  readonly reason: "partial-execution" | "delayed-nigo";
  readonly priorDecisionId: string;
  readonly triggeringLedgerEvent: "ExecutionPartiallySucceeded" | "StatusObserved";
  readonly requestedAt: string;
  readonly requestedAtIso: string;
  readonly summary: string;
}
export interface VerificationVM {
  readonly spine: DecisionSpineVM;
  readonly state: {
    readonly observedStatus: "submitted" | "unknown" | "nigo";
    readonly settledClaim:
      | "submitted-is-not-settled"
      | "partial-is-not-settled";
    readonly observedAtIso: string;
    readonly currentReason: string;
    readonly custodianReason: string | null;
  };
  readonly proves: readonly VerificationProofVM[];
  readonly notProvenYet: readonly string[];
  readonly polling:
    | {
        readonly state: "scheduled";
        readonly interval: "PT12H";
        readonly latestObservationAtIso: string;
        readonly nextPollAtIso: string;
        readonly display: string;
      }
    | {
        readonly state: "stopped";
        readonly reason: "terminal-nigo-exception-opened";
        readonly latestObservationAtIso: string;
        readonly nextPollAtIso: null;
        readonly display: string;
      };
  readonly appended: readonly ExecutionRowVM[]; // delayed NIGO / stuck rows
  readonly exceptionDecision: ExceptionDecisionVM | null;
  readonly fakeClass: FakeClass;
}

// ── Surface 10: Firm A / Firm B comparison ──────────────────────────────────────────
export interface ComparisonCellVM {
  readonly display?: string;
  readonly metric?: DisplayMetric;
  /** Dispositions inside the comparison use the standard §5 badges. */
  readonly badge?: { readonly status: string; readonly label: string };
}
export interface ComparisonRowVM {
  readonly dimension: string;
  readonly a: ComparisonCellVM;
  readonly b: ComparisonCellVM;
  readonly differs: boolean;
  readonly why?: WhyVM;
}
export interface ComparisonColumnVM {
  readonly firmId: string;
  readonly firm: string;
  readonly policyVersion: string;
  readonly activeSince: string;
  readonly sourceCaseId: SignedCaseId | null;
}
export interface ComparisonVM {
  readonly description: string;
  readonly columns: readonly [ComparisonColumnVM, ComparisonColumnVM];
  readonly rows: readonly ComparisonRowVM[];
  readonly fakeClass: FakeClass;
}

// ── The full journey (one per scenario × firm) ──────────────────────────────────────
export interface DecisionJourneyVM {
  readonly scenarioId: string;
  readonly firmId: string;
  readonly sourceCaseId: SignedCaseId | null;
  readonly scenarioTitle: string;
  readonly firmName: string;
  readonly outcomeClass: string;
  readonly workspace: WorkspaceVM;
  readonly intent: IntentVM;
  readonly evidence: EvidenceVM;
  readonly recommendation: RecommendationVM;
  readonly policyTrace: PolicyTraceVM;
  /** Null when the record never reached the station (blocked/prohibited journeys):
   * the surface then renders an honest not-reached state - it NEVER renders a
   * station the record has not reached (design §4; charter #4 applied to UI). */
  readonly approvals: ApprovalVM | null;
  readonly safety: SafetyVM | null;
  readonly execution: ExecutionVM | null;
  readonly verification: VerificationVM | null;
  /** Copy for the not-reached state of any null surface above. */
  readonly stopNote: string | null;
  readonly comparison: ComparisonVM;
  readonly policyAuthoring: PolicyAuthoringVM;
  readonly record: RecordVM;
}
