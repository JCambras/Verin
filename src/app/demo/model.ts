/**
 * TYPED UI STATE MODEL for the Phase 1 investor-demo walking skeleton (v3 prompt 3;
 * demo contract §4; design language docs/demo-design-language.md §3). Every rendered
 * state in the twelve demo surfaces comes from one of these view models - there is NO
 * business logic and NO decision branch in the surface components (Gate 0: "the UI does
 * not invent decisions"). The disposition, station states, statuses, and provenance
 * labels are DATA here; the components are pure functions of these types.
 *
 * Nothing in this file computes a decision: it only declares the shape a decision,
 * once made elsewhere (a real engine in Wave D; a labeled fake now), takes on screen.
 *
 * This module is dependency-free of the app runtime (contracts types only), so the
 * fake service (./service.ts) and the surface components share exactly one vocabulary.
 */
import type { DisplayMetric } from "@contracts/metric";
import type { RecordProvenance, SourceSystem } from "@contracts/provenance";

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
  readonly ref: string; // versioned reference, font-mono
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
  readonly name: string;
  readonly kind: string; // "Taxable brokerage", "Roth IRA"
  readonly balance: DisplayMetric;
  readonly custodian: FactVM;
  readonly fakeClass: FakeClass;
}
export interface WorkspaceVM {
  readonly household: { readonly name: string; readonly advisor: string; readonly provenance: RecordProvenance; readonly fakeClass: FakeClass };
  readonly accounts: readonly AccountVM[];
  readonly liquidity: DisplayMetric;
  readonly plannedMonthlyWithdrawal: DisplayMetric;
  readonly pendingActivity: FactVM;
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
export type EvidenceRowVM =
  | { readonly kind: "fact"; readonly label: string; readonly fact: FactVM; readonly fakeClass: FakeClass; readonly why?: WhyVM }
  | { readonly kind: "metric"; readonly label: string; readonly metric: DisplayMetric; readonly retrievedAt: string; readonly fakeClass: FakeClass; readonly why?: WhyVM }
  | { readonly kind: "conflict"; readonly label: string; readonly rule: string; readonly a: FactVM; readonly b: FactVM; readonly fakeClass: FakeClass; readonly blockerAffordance?: string }
  | { readonly kind: "missing"; readonly text: string; readonly fakeClass: FakeClass };
export interface EvidenceVM {
  readonly spine: DecisionSpineVM;
  readonly rows: readonly EvidenceRowVM[];
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
  readonly firmPolicyVersion: string;
  readonly householdInstructionVersion: string;
  readonly rows: readonly PrecedenceRowVM[];
  readonly fakeClass: FakeClass;
}

// ── Surface 6: Approval stages and actor status ─────────────────────────────────────
export interface ActorSlotVM {
  readonly name: string;
  readonly role: string;
  readonly status: string; // StatusBadge key
  readonly statusLabel: string;
  readonly note?: string; // e.g. "You requested this - you cannot approve"
  readonly requesterExcluded?: boolean;
}
export interface ApprovalStageVM {
  readonly title: string;
  readonly requirement: string;
  readonly stepState: StationState;
  readonly actors: readonly ActorSlotVM[];
  readonly expiry?: string;
  readonly escalation?: string;
}
export interface ApprovalVM {
  readonly spine: DecisionSpineVM;
  readonly stages: readonly ApprovalStageVM[];
  readonly binding: { readonly decisionHash: string; readonly bundleHash: string };
  readonly gate: { readonly restatement: string; readonly figures: readonly DispositionFigureVM[]; readonly primaryLabel: string };
  readonly fakeClass: FakeClass;
}

// ── Surface 7: Pre-execution safety check (+ the invalidation moment §7.3) ───────────
export interface SafetyCheckVM {
  readonly label: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly detail?: string;
}
export interface InvalidationVM {
  readonly voidedActor: { readonly name: string; readonly role: string; readonly when: string };
  readonly deltaSentence: string;
  readonly before: FactVM;
  readonly after: FactVM;
  readonly why: WhyVM;
  readonly primaryLabel: string;
}
export interface SafetyVM {
  readonly spine: DecisionSpineVM;
  readonly revalidatedAt: FactVM;
  readonly checks: readonly SafetyCheckVM[];
  readonly reservationId: string;
  readonly conflictKeys: readonly string[];
  readonly idempotencyKey: string;
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
  readonly status: string; // StatusBadge key
  readonly statusLabel: string;
  readonly timestamp: string;
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
export interface VerificationVM {
  readonly spine: DecisionSpineVM;
  readonly proves: readonly FactVM[];
  readonly notProvenYet: readonly string[];
  readonly nextPoll: string;
  readonly appended: readonly ExecutionRowVM[]; // delayed NIGO / stuck rows
  readonly fakeClass: FakeClass;
}

// ── Surface 12: Printable examiner-grade decision artifact (§9) ──────────────────────
export interface RecordIdentityVM {
  readonly scenario: {
    readonly id: string;
    readonly label: string;
  };
  readonly firm: {
    readonly id: string;
    readonly label: string;
  };
  readonly decisionId: string;
  /** Shared across firms because it binds only the firm-neutral request/evidence. */
  readonly inputHash: string;
  readonly decisionHash: string;
  /** Firm-specific because the complete input bundle includes policy/configuration. */
  readonly bundleHash: string;
}

export interface ActivatedConfigurationRecordVM {
  readonly snapshotVersion: string;
  readonly snapshotHash: string;
  readonly configurationHash: string;
  /** The StatusBadge key and short wording for the authority this configuration
   * actually carries, so the exported claim reads as one of three distinct states
   * rather than signed-or-not. */
  readonly configurationPostureStatus: string;
  readonly configurationPostureLabel: string;
  readonly configurationProvenance: string;
}

/** Reserve reaches exactly one terminal state. Arithmetic exists only when the
 * precedence trace established that the signed inputs were evaluable. */
export type RecordReserveVM =
  | {
      readonly kind: "evaluated";
      readonly horizon: string;
      readonly floor: DisplayMetric;
      readonly headroom: DisplayMetric;
    }
  | {
      readonly kind: "not-evaluated";
      readonly reason: string;
    }
  | {
      readonly kind: "not-applicable";
      readonly reason: string;
    };

export interface RecordVM {
  readonly identity: RecordIdentityVM;
  readonly header: {
    readonly createdAt: string;
    readonly watermark: string | null; // DEMO_WATERMARK when demonstration-derived
  };
  readonly hashes: {
    readonly policyVersion: string;
    readonly instructionVersion: string;
    readonly auditPosition: string;
  };
  readonly activatedConfiguration: ActivatedConfigurationRecordVM | null;
  readonly intent: IntentVM;
  readonly evidence: readonly EvidenceRowVM[];
  readonly disposition: DispositionVM;
  readonly precedence: readonly PrecedenceRowVM[];
  readonly reserve: RecordReserveVM;
  /** Sections the record never reached print as an explicit "not reached" line -
   * the paper record is as honest as the screen (§9). */
  readonly approvalStages: readonly ApprovalStageVM[] | null;
  readonly safety: SafetyVM | null;
  readonly execution: readonly ExecutionRowVM[] | null;
  readonly verification: VerificationVM | null;
  readonly stopNote: string | null;
  readonly provenanceAppendix: readonly SourceSystem[];
}

// ── The full journey (one per scenario × firm) ──────────────────────────────────────
export interface DecisionJourneyVM {
  readonly scenarioId: string;
  readonly firmId: string;
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
  readonly record: RecordVM;
}
