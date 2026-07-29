/**
 * Typed view models for the bounded setup-first money-movement demonstration.
 *
 * These types contain presentation-ready choices and effects. The client surface
 * selects among them, but it never derives reserve arithmetic, evaluates policy,
 * or decides a disposition. Those results must arrive already formed.
 */
import type { DisplayMetric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";
import type { Role } from "@contracts/roles";
import type {
  AuthorityPlanVM,
  DispositionVM,
  FakeClass,
  RequesterParticipation,
} from "./model";
import type { DecisionEvidenceSnapshot } from "./decision-evidence";

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

export function setupFirmSelectionKey(
  selections: SetupSelections[SetupFirmId],
): string {
  return SETUP_POLICY_GROUP_IDS.map(
    (groupId) => `${groupId}=${selections[groupId]}`,
  ).join("|");
}

export const SETUP_ATTESTATION_STATEMENT_VERSION =
  "money-movement-demo-attestation/1.0.0";

export interface SetupAttestationChallengeVM {
  readonly token: string;
  readonly draftGeneration: number;
  readonly selectionsHash: string;
  readonly statementVersion: typeof SETUP_ATTESTATION_STATEMENT_VERSION;
  readonly actor: {
    readonly opaqueId: string;
    readonly role: Role;
  };
}

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
  readonly firms: Readonly<Record<SetupFirmId, string>>;
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

/**
 * What a closed choice ACTUALLY carries. Three states, never two: "Recommended" is a
 * house recommendation the captain has not signed, and describing it as captain-signed
 * makes the exported provenance claim stronger than the screen that produced it.
 */
export type SetupTruthLabel = "Signed" | "Recommended" | "Supported";
export type SetupAuthorityPosture = "signed" | "recommended" | "house-default";

const POSTURE_OF_LABEL: Record<SetupTruthLabel, SetupAuthorityPosture> = {
  Signed: "signed",
  Recommended: "recommended",
  Supported: "house-default",
};

/** The weakest posture in a set governs the whole: one unsigned choice means the
 * configuration is not captain-signed, whichever other four are. */
const POSTURE_STRENGTH: Record<SetupAuthorityPosture, number> = {
  signed: 2,
  recommended: 1,
  "house-default": 0,
};

export function optionPosture(truthLabel: SetupTruthLabel): SetupAuthorityPosture {
  return POSTURE_OF_LABEL[truthLabel];
}

/** Derived from the COMPLETE truth-label set of the selected options - never from
 * "did the operator touch the defaults", which says nothing about signoff. */
export function configurationPosture(
  truthLabels: readonly SetupTruthLabel[],
): SetupAuthorityPosture {
  if (truthLabels.length === 0) {
    throw new Error("A configuration posture requires at least one selected option");
  }
  return truthLabels.reduce<SetupAuthorityPosture>((weakest, label) => {
    const posture = optionPosture(label);
    return POSTURE_STRENGTH[posture] < POSTURE_STRENGTH[weakest] ? posture : weakest;
  }, "signed");
}

/** The StatusBadge key each posture renders under, so the three states are visually
 * distinct and not just differently worded. */
export const POSTURE_STATUS: Record<SetupAuthorityPosture, string> = {
  signed: "done",
  recommended: "suspended",
  "house-default": "pending",
};

/** The badge beside one option. */
export const POSTURE_OPTION_LABEL: Record<SetupAuthorityPosture, string> = {
  signed: "Captain-signed",
  recommended: "Recommended · not signed",
  "house-default": "Supported house default",
};

/** The provenance claim a whole configuration may make, on screen and on export. */
export const POSTURE_CONFIGURATION_LABEL: Record<SetupAuthorityPosture, string> = {
  signed: "Captain-signed configuration",
  recommended: "Recommended configuration · pending captain signoff",
  "house-default": "House-default demonstration configuration",
};

export interface SetupChoiceOptionVM {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly truthLabel: SetupTruthLabel;
  readonly reserveMetric?: DisplayMetric;
  readonly smithsEffect: ChoiceEffectVM;
  /** Present only for the groups a signed-impact card actually compares. A group no
   * card reaches carries none, so an unreachable second copy of signed-case copy
   * cannot sit here and drift from the card that owns it (charter #5). */
  readonly signedCaseEffect?: ChoiceEffectVM;
}

export interface FirmChoiceVM {
  readonly firmId: SetupFirmId;
  readonly firmLabel: string;
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
  readonly selectionEffects?: Readonly<
    Record<
      SetupFirmId,
      readonly {
        readonly selectionKey: string;
        readonly effect: ChoiceEffectVM;
      }[]
    >
  >;
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
    | "User-entered demo input"
    | "Synthetic fixture";
  readonly provenance: RecordProvenance;
  readonly fakeClass: FakeClass;
}

export interface SetupActivationVM {
  readonly lifecyclePreview: {
    readonly proposer: string;
    readonly proposerRole: string;
    readonly approver: string;
    readonly approverRole: string;
    readonly fakeClass: FakeClass;
  };
  readonly effectiveAt: string;
  readonly simulationRef: string;
  readonly requesterDecisionNotice: string;
  readonly demonstrationNotice: string;
  readonly attestationStatement: string;
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
  /** The authority this exact configuration carries, derived from every selected
   * option's truth label. Rendered as a distinct badge so the screen and the export
   * make the same claim. */
  readonly configurationPosture: SetupAuthorityPosture;
  readonly configurationProvenance: string;
  readonly disposition: DispositionVM;
  readonly authorityPlan: AuthorityPlanVM;
  readonly eligibleRole: "operations" | null;
  readonly requesterParticipation: Extract<
    RequesterParticipation,
    { readonly mode: "unbound" }
  >;
  readonly reserveMetric: DisplayMetric;
  readonly reserveSummary: string;
  readonly reserveDetail: string;
  readonly freshnessSummary: string;
  readonly freshnessDetail: string;
  readonly strongestProofTitle: string;
  readonly strongestProofDetail: string;
  readonly selectedOptions: readonly {
    readonly groupId: SetupPolicyGroupId;
    readonly groupTitle: string;
    readonly label: string;
    readonly posture: SetupAuthorityPosture;
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
  readonly dataProvenance: string;
  readonly exportQuestion: string;
  readonly exportHint: string;
  readonly exportError: string;
}

/** The outcome-step framing. It names both firms, so it is BUILT from the profile
 * labels rather than typed into the surface - one profile can never carry two names. */
export interface SetupComparisonVM {
  readonly question: string;
  readonly fairness: string;
}

export interface SetupActivatedSnapshotVM {
  readonly snapshotVersion: string;
  readonly snapshotHash: string;
  readonly canonicalConfiguration: string;
  readonly activatedAt: string;
  readonly activationAcknowledgment: {
    readonly actor: {
      readonly opaqueId: string;
      readonly role: Role;
    };
    readonly statementVersion: typeof SETUP_ATTESTATION_STATEMENT_VERSION;
    readonly draftGeneration: number;
    readonly selectionsHash: string;
    readonly statement: string;
  };
  readonly evidence: DecisionEvidenceSnapshot;
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
  readonly comparison: SetupComparisonVM;
  readonly proof: SetupProofVM;
  readonly fakeClass: FakeClass;
}
