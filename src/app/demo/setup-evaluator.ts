import { buildDisposition, buildPolicyTrace } from "./build-decision";
import { loadMoneyMovementSetup } from "./build-setup";
import {
  DEMO_NOW,
  SETUP_SCENARIO_ID,
  scenarioById,
  type DecisionConfiguration,
  type FirmData,
} from "./data";
import {
  APPROVAL_CLOCKS,
} from "./closed-choices";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
} from "./decision-evidence";
import {
  decisionAuthorityClaimFor,
  decisionIdentityFor,
  hashCanonicalPreimage,
} from "./decision-identity";
import {
  ACTIVATED_RESERVE_HORIZON,
  RESERVE_FLOOR_INPUTS,
  derivedMetric,
  prov,
} from "./provenance";
import {
  POSTURE_CONFIGURATION_LABEL,
  POSTURE_OPTION_LABEL,
  POSTURE_STATUS,
  SETUP_ATTESTATION_STATEMENT_VERSION,
  SETUP_FIRM_IDS,
  SETUP_POLICY_GROUP_IDS,
  configurationPosture,
  optionPosture,
  type MoneyMovementSetupVM,
  type SetupActivatedSnapshotVM,
  type SetupActivationResult,
  type SetupFirmId,
  type SetupProofFirmVM,
  type SetupSelections,
  type SetupTruthLabel,
} from "./setup-model";
import { evaluateAuthorityPlan } from "./setup-authority";
import {
  optionFor,
  setupActivationPreimageFor,
  validateSetupActivationDraft,
  type SetupActivationAuthorityBinding,
} from "./setup-activation-input";
import {
  evaluateSetupPolicy,
  setupRuntimeFirm,
  type SetupPolicyEvaluation,
} from "./setup-policy";
import { setupProfileIdentity } from "./setup-profile-identity";
import {
  materializeActivatedRecords,
  type SetupActivatedRecords,
} from "./setup-records";

/** The truth label of each selected option, in group order. */
function selectedTruthLabels(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  selections: SetupSelections,
): readonly SetupTruthLabel[] {
  return SETUP_POLICY_GROUP_IDS.map(
    (groupId) => optionFor(vm, firmId, groupId, selections[firmId][groupId])!.truthLabel,
  );
}

function decisionConfiguration(
  firm: FirmData,
  evaluation: SetupPolicyEvaluation,
  selections: SetupSelections,
  snapshotHash: string,
  authority: SetupActivationAuthorityBinding,
): DecisionConfiguration {
  return {
    policyVersion: firm.policyVersion,
    reserveMonths: firm.reserveMonths,
    freshnessDays: evaluation.freshnessDays,
    bankChangeHandling: firm.bankChangeHandling,
    dualApprovalThresholdMinor: firm.dualApprovalThresholdMinor,
    approvalsRequired: firm.approvalsRequired,
    distinctActorsRequired: firm.distinctActorsRequired,
    standardApprovalRole: firm.standardApprovalRole,
    requesterParticipation: firm.requesterParticipation,
    approvalClockId: selections[firm.id as SetupFirmId].expiry,
    activatedSnapshotHash: snapshotHash,
    activationAuthority: {
      actorId: authority.actor.opaqueId,
      role: authority.actor.role,
      attestationStatementVersion: authority.statementVersion,
      draftGeneration: authority.draftGeneration,
      selectionsHash: authority.selectionsHash,
      setupVersionDigest: authority.setupVersionDigest,
    },
  };
}

/**
 * Everything about one firm's activated outcome that does NOT depend on the
 * activation snapshot hash. The snapshot hash is itself computed FROM the authority
 * plans, so this projection has to exist before it - building it once (rather than
 * running the whole evaluation against a placeholder hash and again against the real
 * one) is what keeps the two passes from disagreeing as well as what makes activation
 * affordable on the request path.
 */
interface FirmProjection {
  readonly firmId: SetupFirmId;
  readonly profile: MoneyMovementSetupVM["profiles"][number];
  readonly posture: ReturnType<typeof configurationPosture>;
  readonly selectedOptions: SetupProofFirmVM["selectedOptions"];
  readonly policyEvaluation: SetupPolicyEvaluation;
  readonly requesterParticipation: SetupProofFirmVM["requesterParticipation"];
  readonly activeProfile: boolean;
  readonly configurationHash: string;
  readonly policyVersion: string;
  readonly firm: FirmData;
  readonly disposition: SetupProofFirmVM["disposition"];
  readonly authorityPlan: SetupProofFirmVM["authorityPlan"];
  readonly authorityClaim: ReturnType<typeof decisionAuthorityClaimFor>;
}

function projectFirm(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  selections: SetupSelections,
  evidence: DecisionEvidenceSnapshot,
): FirmProjection {
  const profile = vm.profiles.find((candidate) => candidate.firmId === firmId)!;
  const posture = configurationPosture(selectedTruthLabels(vm, firmId, selections));
  const selectedOptions = SETUP_POLICY_GROUP_IDS.map((groupId) => {
    const option = optionFor(vm, firmId, groupId, selections[firmId][groupId])!;
    return {
      groupId,
      groupTitle: vm.policyGroups.find((group) => group.id === groupId)!.title,
      label: option.label,
      posture: optionPosture(option.truthLabel),
    };
  });
  const policyEvaluation = evaluateSetupPolicy(
    selections,
    firmId,
    evidence,
  );
  const requesterParticipation =
    policyEvaluation.requesterParticipation;
  if (requesterParticipation.mode !== "unbound") {
    throw new Error(
      "Setup evaluation must preserve unbound requester participation",
    );
  }
  const {
    activeProfile,
    configurationHash,
    policyVersion,
  } = setupProfileIdentity(
    vm,
    firmId,
    selections,
    policyEvaluation,
    evidence,
  );
  const firm = setupRuntimeFirm(
    firmId,
    policyEvaluation,
    policyVersion,
  );
  const scenario = scenarioById(SETUP_SCENARIO_ID);
  const disposition = buildDisposition(
    scenario,
    firm,
    policyEvaluation.dispositionKind,
    ACTIVATED_RESERVE_HORIZON,
  );
  const authorityPlan = evaluateAuthorityPlan(
    firm,
    policyEvaluation,
    APPROVAL_CLOCKS[selections[firmId].expiry]!,
    prov("user-entered-demo-input", DEMO_NOW),
  );
  return {
    firmId,
    profile,
    posture,
    selectedOptions,
    policyEvaluation,
    requesterParticipation,
    activeProfile,
    configurationHash,
    policyVersion,
    firm,
    disposition,
    authorityPlan,
    authorityClaim: decisionAuthorityClaimFor(authorityPlan),
  };
}

function evaluateFirm(
  projection: FirmProjection,
  snapshotHash: string,
  authority: SetupActivationAuthorityBinding,
  selections: SetupSelections,
  evidence: DecisionEvidenceSnapshot,
): Omit<SetupProofFirmVM, "exportHref"> {
  const {
    firmId,
    profile,
    posture,
    selectedOptions,
    policyEvaluation,
    activeProfile,
    configurationHash,
    policyVersion,
    firm,
    disposition,
    authorityPlan: evaluatedAuthority,
  } = projection;
  const configuration = decisionConfiguration(
    firm,
    policyEvaluation,
    selections,
    snapshotHash,
    authority,
  );
  const reserveProjection = policyEvaluation.projection;
  const freshnessSatisfied = policyEvaluation.freshnessSatisfied;
  const scenario = scenarioById(SETUP_SCENARIO_ID);
  const approvalClock = APPROVAL_CLOCKS[configuration.approvalClockId]!;
  const identity = decisionIdentityFor(
    scenario,
    firm,
    configuration,
    {
      disposition,
      precedence: buildPolicyTrace(
        scenario,
        firm,
        disposition.kind,
        reserveProjection,
      ).rows,
      authority: projection.authorityClaim,
    },
    evidence,
  );
  return {
    firmId,
    firmLabel: profile.firmLabel,
    scenarioId: scenario.id,
    scenarioLabel: scenario.title,
    decisionId: identity.decisionId,
    inputHash: identity.inputHash,
    decisionHash: identity.decisionHash,
    bundleHash: identity.bundleHash,
    policyVersion,
    configurationHash,
    configurationPostureStatus: activeProfile
      ? POSTURE_STATUS[posture]
      : "pending",
    configurationPostureLabel: activeProfile
      ? POSTURE_OPTION_LABEL[posture]
      : "Projected configuration",
    configurationProvenance: activeProfile
      ? POSTURE_CONFIGURATION_LABEL[posture]
      : `Projected demonstration configuration · differs from ${profile.activeVersion}`,
    disposition,
    authorityPlan: evaluatedAuthority,
    standardApprovalRole:
      policyEvaluation.authority.standardApprovalRole,
    requesterParticipation: projection.requesterParticipation,
    reserveMetric: derivedMetric(
      reserveProjection.requiredReserveMinor,
      "currency-minor",
      RESERVE_FLOOR_INPUTS,
      DEMO_NOW,
    ),
    reserveSummary: reserveProjection.reserveSatisfied
      ? "The projected balance remains above the activated reserve floor."
      : "The projected balance falls below the activated reserve floor.",
    reserveDetail: `${configuration.reserveMonths} months derived from the signed monthly withdrawal schedule.`,
    freshnessSummary: freshnessSatisfied
      ? "Reserve evidence is fresh under the activated window."
      : "Reserve evidence is outside the activated freshness window.",
    freshnessDetail: `${configuration.freshnessDays} calendar days in the activated configuration.`,
    strongestProofTitle:
      evaluatedAuthority.mode === "not-reached"
        ? "Blocked decision recorded"
        : evaluatedAuthority.mode === "automatic"
          ? "Automatic authority · submitted, not verified"
          : "Submitted · not verified",
    strongestProofDetail:
      evaluatedAuthority.mode === "not-reached"
        ? "No authority, reservation, execution plan, adapter call, or external status exists for this branch."
        : evaluatedAuthority.mode === "automatic"
          ? "Authority resolved without approval stages. One idempotent instruction reached the labeled fake adapter; settlement and Salesforce parity remain unproven."
          : "One idempotent instruction reached the labeled fake adapter. Settlement and Salesforce parity remain unproven.",
    selectedOptions,
    approvalClock,
    exportLabel: `${profile.firmLabel} decision record`,
  };
}

function authorityClaimsFrom(
  projections: readonly FirmProjection[],
) {
  return projections.map((projection) => ({
    firmId: projection.firmId,
    authority: projection.authorityClaim,
    standardApprovalRole:
      projection.policyEvaluation.authority.standardApprovalRole,
    requesterParticipation: projection.requesterParticipation,
  }));
}

export function setupActivationAuthorityClaims(
  vm: MoneyMovementSetupVM,
  selections: SetupSelections,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(
    scenarioById(SETUP_SCENARIO_ID),
  ),
) {
  return authorityClaimsFrom(
    SETUP_FIRM_IDS.map((firmId) =>
      projectFirm(vm, firmId, selections, evidence),
    ),
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

type MaterializedSetupActivationResult =
  | {
      readonly ok: true;
      readonly snapshot: SetupActivatedSnapshotVM;
      readonly records: SetupActivatedRecords;
    }
  | Extract<SetupActivationResult, { readonly ok: false }>;

export function activateMoneyMovementSetup(
  value: unknown,
  authority: SetupActivationAuthorityBinding | undefined,
): MaterializedSetupActivationResult {
  if (!authority) {
    return {
      ok: false,
      error:
        "Activation requires a server-verified demonstration attestation.",
    };
  }
  const draft = validateSetupActivationDraft(
    authority.draftGeneration,
    value,
    authority.setupVersionDigest,
  );
  if (!draft.ok) return draft;
  if (
    authority.actor.role !== "principal" ||
    authority.statementVersion !==
      SETUP_ATTESTATION_STATEMENT_VERSION ||
    authority.selectionsHash !== draft.selectionsHash ||
    authority.setupVersionDigest !== draft.setupVersionDigest
  ) {
    return {
      ok: false,
      error:
        "The demonstration attestation does not match the authenticated Principal and exact setup draft.",
    };
  }
  const scenario = scenarioById(SETUP_SCENARIO_ID);
  const evidence = decisionEvidenceSnapshotFor(scenario);
  const setup = loadMoneyMovementSetup(evidence);
  if (!setup.ok) return setup;
  const vm = setup.vm;
  const projections = SETUP_FIRM_IDS.map((firmId) =>
    projectFirm(vm, firmId, draft.selections, evidence),
  );
  const snapshotHash = hashCanonicalPreimage(
    setupActivationPreimageFor(
      vm,
      draft,
      authority,
      authorityClaimsFrom(projections),
      evidence,
    ),
  );
  const snapshotVersion = `MM-DEMO-SNAPSHOT-${snapshotHash
    .slice(0, 12)
    .toUpperCase()}`;
  const [evaluatedA, evaluatedB] = projections.map((projection) =>
    evaluateFirm(
      projection,
      snapshotHash,
      authority,
      draft.selections,
      evidence,
    ),
  ) as [
    Omit<SetupProofFirmVM, "exportHref">,
    Omit<SetupProofFirmVM, "exportHref">,
  ];
  const activationAcknowledgment = {
    actor: authority.actor,
    statementVersion: authority.statementVersion,
    draftGeneration: authority.draftGeneration,
    selectionsHash: authority.selectionsHash,
    setupVersionDigest: authority.setupVersionDigest,
    statement: vm.activation.attestationStatement,
  };
  const firms: SetupActivatedSnapshotVM["firms"] = [
    {
      ...evaluatedA,
      exportHref: `/app/demo/record?scenario=${evaluatedA.scenarioId}&firm=${evaluatedA.firmId}&activation=${snapshotHash}`,
    },
    {
      ...evaluatedB,
      exportHref: `/app/demo/record?scenario=${evaluatedB.scenarioId}&firm=${evaluatedB.firmId}&activation=${snapshotHash}`,
    },
  ];
  const snapshot = deepFreeze({
    snapshotVersion,
    snapshotHash,
    canonicalConfiguration: draft.canonicalConfiguration,
    activatedAt: vm.activation.effectiveAt,
    activationAcknowledgment,
    evidence,
    selections: draft.selections,
    firms,
    presentation: {
      steps: vm.steps,
      request: vm.request,
      comparison: vm.comparison,
      proof: vm.proof,
      fakeClass: vm.fakeClass,
    },
  });
  return deepFreeze({
    ok: true,
    snapshot,
    records: materializeActivatedRecords(snapshot),
  });
}
