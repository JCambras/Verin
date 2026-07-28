/**
 * Typed view models for the bounded setup-first money-movement demonstration.
 *
 * These types contain presentation-ready choices and effects. The client surface
 * selects among them, but it never derives reserve arithmetic, evaluates policy,
 * or decides a disposition. Those results must arrive already formed.
 */
import type { DisplayMetric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";
import type { ApprovalStageVM, DispositionVM, FakeClass } from "./model";

export const SETUP_FIRM_IDS = ["firm-a", "firm-b"] as const;
export type SetupFirmId = (typeof SETUP_FIRM_IDS)[number];

export const SETUP_POLICY_GROUP_IDS = [
  "reserve",
  "freshness",
  "bank-change",
  "threshold",
  "expiry",
] as const;
export type SetupPolicyGroupId = (typeof SETUP_POLICY_GROUP_IDS)[number];
export type SetupSelections = Record<
  SetupFirmId,
  Record<SetupPolicyGroupId, string>
>;

export const SETUP_STEP_IDS = [
  "profiles",
  "controls",
  "posture",
  "choices",
  "impact",
  "activation",
  "request",
  "outcomes",
  "proof",
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export interface SetupStepVM {
  readonly id: SetupStepId;
  readonly shortLabel: string;
  readonly kicker: string;
  readonly title: string;
  readonly description: string;
  readonly primaryLabel: string;
}

export interface SetupProfileVM {
  readonly firmId: SetupFirmId;
  readonly firmLabel: string;
  readonly name: string;
  readonly draftVersion: string;
  readonly activeVersion: string;
  readonly lastApproval: string;
  readonly description: string;
  readonly fakeClass: FakeClass;
}

export interface RequiredControlVM {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly proof: string;
}

export interface AccountableRoleVM {
  readonly responsibility: string;
  readonly firmA: string;
  readonly firmB: string;
  readonly rule: string;
}

export interface BaselineValueVM {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}

export interface ChoiceStatusVM {
  readonly status: string;
  readonly label: string;
}

export interface ChoiceEffectVM {
  readonly status: ChoiceStatusVM;
  readonly summary: string;
  readonly detail: string;
  readonly reachesAuthority?: boolean;
}

export interface SetupChoiceOptionVM {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly truthLabel: "Signed" | "Recommended" | "Supported";
  readonly reserveMetric?: DisplayMetric;
  readonly smithsEffect: ChoiceEffectVM;
  readonly signedCaseEffect: ChoiceEffectVM;
}

export interface FirmChoiceVM {
  readonly firmId: SetupFirmId;
  readonly initialOptionId: string;
  readonly options: readonly SetupChoiceOptionVM[];
}

export interface SetupPolicyGroupVM {
  readonly id: SetupPolicyGroupId;
  readonly title: string;
  readonly question: string;
  readonly rationale: string;
  readonly caseRef: string;
  readonly firms: readonly [FirmChoiceVM, FirmChoiceVM];
}

export interface SignedImpactVM {
  readonly id: string;
  readonly title: string;
  readonly caseRef: string;
  readonly facts: string;
  readonly groupId: SetupPolicyGroupVM["id"] | null;
  readonly universalEffect?: string;
}

export interface SetupFactVM {
  readonly label: string;
  readonly value?: string;
  readonly metric?: DisplayMetric;
  readonly category:
    | "Household instruction"
    | "Regulatory or product constraint"
    | "Adapter fact"
    | "Derived value"
    | "Synthetic fixture";
  readonly provenance: RecordProvenance;
  readonly fakeClass: FakeClass;
}

export interface SetupActivationVM {
  readonly proposer: string;
  readonly proposerRole: string;
  readonly approver: string;
  readonly approverRole: string;
  readonly effectiveAt: string;
  readonly simulationRef: string;
  readonly requesterDecisionNotice: string;
  readonly demonstrationNotice: string;
}

export interface SetupRequestVM {
  readonly title: string;
  readonly summary: string;
  readonly facts: readonly SetupFactVM[];
  readonly evidenceRef: string;
  readonly requestRef: string;
}

/** One firm's export identity, projected from the SAME decision-record view model the
 * export target renders. Everything shown immediately before export is what the
 * exported record shows, so the proof step cannot assert a hash-bound identity it
 * then breaks by navigating somewhere else. */
export interface SetupProofFirmVM {
  readonly firmId: SetupFirmId;
  readonly firmLabel: string;
  readonly scenarioId: string;
  readonly scenarioLabel: string;
  readonly decisionId: string;
  readonly inputHash: string;
  readonly decisionHash: string;
  readonly bundleHash: string;
  readonly policyVersion: string;
  readonly configurationHash: string;
  readonly configurationProvenance: string;
  readonly disposition: DispositionVM;
  readonly authorityPlan: {
    readonly mode: "none" | "specialist-review";
    readonly reached: boolean;
    readonly summary: string;
    readonly detail: string;
    readonly stages: readonly ApprovalStageVM[];
  };
  readonly reserveMetric: DisplayMetric;
  readonly reserveSummary: string;
  readonly reserveDetail: string;
  readonly freshnessSummary: string;
  readonly freshnessDetail: string;
  readonly strongestProofTitle: string;
  readonly strongestProofDetail: string;
  readonly selectedOptions: readonly {
    readonly groupId: SetupPolicyGroupId;
    readonly label: string;
  }[];
  readonly approvalClock: {
    readonly id: string;
    readonly escalation: string;
    readonly expiry: string;
  };
  readonly exportHref: string;
  readonly exportLabel: string;
}

export interface SetupProofVM {
  readonly engineLabel: string;
  readonly exportQuestion: string;
  readonly exportHint: string;
  readonly exportError: string;
}

export interface SetupActivatedSnapshotVM {
  readonly snapshotVersion: string;
  readonly snapshotHash: string;
  readonly canonicalConfiguration: string;
  readonly activatedAt: string;
  readonly selections: SetupSelections;
  readonly firms: readonly [SetupProofFirmVM, SetupProofFirmVM];
}

export type SetupActivationResult =
  | { readonly ok: true; readonly snapshot: SetupActivatedSnapshotVM }
  | { readonly ok: false; readonly error: string };

export interface MoneyMovementSetupVM {
  readonly steps: readonly SetupStepVM[];
  readonly profiles: readonly [SetupProfileVM, SetupProfileVM];
  readonly controls: readonly RequiredControlVM[];
  readonly roles: readonly AccountableRoleVM[];
  readonly baseline: readonly BaselineValueVM[];
  readonly policyGroups: readonly SetupPolicyGroupVM[];
  readonly impacts: readonly SignedImpactVM[];
  readonly activation: SetupActivationVM;
  readonly request: SetupRequestVM;
  readonly proof: SetupProofVM;
  readonly fakeClass: FakeClass;
}
