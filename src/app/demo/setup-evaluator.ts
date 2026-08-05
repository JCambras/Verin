import { buildDisposition, buildPolicyTrace } from "./build-decision";
import { buildMoneyMovementSetup } from "./build-setup";
import {
  APPROVAL_CLOCKS,
  DEMO_NOW,
  scenarioById,
  type DecisionConfiguration,
  type FirmData,
} from "./data";
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
  SETUP_SCENARIO_ID,
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

function evaluateFirm(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  selections: SetupSelections,
  snapshotHash: string,
  authority: SetupActivationAuthorityBinding,
  evidence: DecisionEvidenceSnapshot,
): Omit<SetupProofFirmVM, "exportHref"> {
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
  if (
    policyEvaluation.requesterParticipation.mode !==
    "unbound"
  ) {
    throw new Error(
      "Setup evaluation must preserve unbound requester participation",
    );
  }
  const profileIdentity = setupProfileIdentity(
    vm,
    firmId,
    selections,
    policyEvaluation,
    evidence,
  );
  const {
    activeProfile,
    configurationHash,
    policyVersion,
  } = profileIdentity;
  const firm = setupRuntimeFirm(
    firmId,
    policyEvaluation,
    policyVersion,
  );
  const configuration = decisionConfiguration(
    firm,
    policyEvaluation,
    selections,
    snapshotHash,
    authority,
  );
  const projection = policyEvaluation.projection;
  const freshnessSatisfied = policyEvaluation.freshnessSatisfied;
  const kind = policyEvaluation.dispositionKind;
  const scenario = scenarioById(SETUP_SCENARIO_ID);
  const disposition = buildDisposition(scenario, firm, kind, ACTIVATED_RESERVE_HORIZON);
  const approvalClock = APPROVAL_CLOCKS[configuration.approvalClockId]!;
  const evaluatedAuthority = evaluateAuthorityPlan(
    firm,
    policyEvaluation,
    approvalClock,
    prov("user-entered-demo-input", DEMO_NOW),
  );
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
      ).rows,
      authority: decisionAuthorityClaimFor(evaluatedAuthority),
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
    requesterParticipation:
      policyEvaluation.requesterParticipation,
    reserveMetric: derivedMetric(
      projection.requiredReserveMinor,
      "currency-minor",
      RESERVE_FLOOR_INPUTS,
      DEMO_NOW,
    ),
    reserveSummary: projection.reserveSatisfied
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

export function setupActivationAuthorityClaims(
  vm: MoneyMovementSetupVM,
  selections: SetupSelections,
  authority: SetupActivationAuthorityBinding,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(
    scenarioById(SETUP_SCENARIO_ID),
  ),
) {
  return SETUP_FIRM_IDS.map((firmId) => {
    const evaluated = evaluateFirm(
      vm,
      firmId,
      selections,
      "0".repeat(64),
      authority,
      evidence,
    );
    return {
      firmId,
      authority: decisionAuthorityClaimFor(
        evaluated.authorityPlan,
      ),
      standardApprovalRole: evaluated.standardApprovalRole,
      requesterParticipation: evaluated.requesterParticipation,
    };
  });
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
  const vm = buildMoneyMovementSetup(evidence);
  const authorityPlans = setupActivationAuthorityClaims(
    vm,
    draft.selections,
    authority,
    evidence,
  );
  const snapshotHash = hashCanonicalPreimage(
    setupActivationPreimageFor(
      vm,
      draft,
      authority,
      authorityPlans,
      evidence,
    ),
  );
  const snapshotVersion = `MM-DEMO-SNAPSHOT-${snapshotHash
    .slice(0, 12)
    .toUpperCase()}`;
  const evaluatedA = evaluateFirm(
    vm,
    "firm-a",
    draft.selections,
    snapshotHash,
    authority,
    evidence,
  );
  const evaluatedB = evaluateFirm(
    vm,
    "firm-b",
    draft.selections,
    snapshotHash,
    authority,
    evidence,
  );
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
