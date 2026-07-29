import { buildDisposition, buildPolicyTrace } from "./build-decision";
import { buildMoneyMovementSetup } from "./build-setup";
import { buildRecord } from "./build-summary";
import {
  APPROVAL_CLOCKS,
  DEMO_NOW,
  FIRMS,
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
  toJsonValue,
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
import type { RecordVM } from "./model";
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
  type SetupPolicyEvaluation,
} from "./setup-policy";

/** Whether every selected option is still the firm's ACTIVE-profile value. This decides
 * policy VERSION identity (an untouched profile keeps FA-4.2 / FB-2.1); it deliberately
 * does NOT decide signoff - a firm's default can be a house recommendation the captain
 * never signed, which is exactly why the two questions have separate answers. */
function matchesActiveProfile(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  selections: SetupSelections,
): boolean {
  return vm.policyGroups.every((group) => {
    const firm = group.firms.find((candidate) => candidate.firmId === firmId);
    return firm?.initialOptionId === selections[firmId][group.id];
  });
}

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

function runtimeFirm(
  firmId: SetupFirmId,
  evaluation: SetupPolicyEvaluation,
  policyVersion: string,
): FirmData {
  const base = FIRMS[firmId]!;
  return {
    ...base,
    reserveMonths: evaluation.reserveMonths,
    dualApprovalThresholdMinor:
      evaluation.dualApprovalThresholdMinor,
    bankChangeHandling: evaluation.bankChangeHandling,
    eligibleRole: evaluation.authority.eligibleRole,
    requesterParticipation: evaluation.requesterParticipation,
    policyVersion,
  };
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
    eligibleRole: firm.eligibleRole,
    requesterParticipation: firm.requesterParticipation,
    approvalClockId: selections[firm.id as SetupFirmId].expiry,
    activatedSnapshotHash: snapshotHash,
    activationAuthority: {
      actorId: authority.actor.opaqueId,
      role: authority.actor.role,
      attestationStatementVersion: authority.statementVersion,
      draftGeneration: authority.draftGeneration,
      selectionsHash: authority.selectionsHash,
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
  const activeProfile = matchesActiveProfile(vm, firmId, selections);
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
  const baseFirm = FIRMS[firmId]!;
  const policyEvaluation = evaluateSetupPolicy(
    selections,
    firmId,
    evidence,
  );
  const resolvedConfiguration = {
    reserveMonths: policyEvaluation.reserveMonths,
    freshnessDays: policyEvaluation.freshnessDays,
    bankChangeHandling: policyEvaluation.bankChangeHandling,
    dualApprovalThresholdMinor:
      policyEvaluation.dualApprovalThresholdMinor,
    approvalsRequired: baseFirm.approvalsRequired,
    authorityMode: policyEvaluation.authority.mode,
    eligibleRole: policyEvaluation.authority.eligibleRole,
    requesterParticipation:
      policyEvaluation.requesterParticipation,
    approvalClock: APPROVAL_CLOCKS[selections[firmId].expiry]!,
  };
  const configurationHash = hashCanonicalPreimage(toJsonValue({
    hashKind: "money-movement-demo-profile-configuration",
    preimageVersion:
      "money-movement-demo-profile-configuration/3.0.0",
    payload: {
      firmId,
      resolvedConfiguration,
      selections: selectedOptions.map((option) => ({
        groupId: option.groupId,
        optionId: selections[firmId][option.groupId],
        posture: option.posture,
      })),
    },
  }));
  const policyVersion = activeProfile
    ? profile.activeVersion
    : `${firmId === "firm-a" ? "FA" : "FB"}-MM-DEMO-${configurationHash
        .slice(0, 12)
        .toUpperCase()}`;
  const firm = runtimeFirm(firmId, policyEvaluation, policyVersion);
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
    configurationPosture: posture,
    configurationProvenance: POSTURE_CONFIGURATION_LABEL[posture],
    disposition,
    authorityPlan: evaluatedAuthority,
    eligibleRole: policyEvaluation.authority.eligibleRole,
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
      eligibleRole: evaluated.eligibleRole,
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

export function activateMoneyMovementSetup(
  value: unknown,
  authority: SetupActivationAuthorityBinding | undefined,
): SetupActivationResult {
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
  );
  if (!draft.ok) return draft;
  if (
    authority.actor.role !== "principal" ||
    authority.statementVersion !==
      SETUP_ATTESTATION_STATEMENT_VERSION ||
    authority.selectionsHash !== draft.selectionsHash
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
  const firms: [SetupProofFirmVM, SetupProofFirmVM] = [
    {
      ...evaluatedA,
      exportHref: `/app/demo/record?scenario=${evaluatedA.scenarioId}&firm=${evaluatedA.firmId}&activation=${snapshotHash}`,
    },
    {
      ...evaluatedB,
      exportHref: `/app/demo/record?scenario=${evaluatedB.scenarioId}&firm=${evaluatedB.firmId}&activation=${snapshotHash}`,
    },
  ];
  return {
    ok: true,
    snapshot: deepFreeze({
      snapshotVersion,
      snapshotHash,
      canonicalConfiguration: draft.canonicalConfiguration,
      activatedAt: vm.activation.effectiveAt,
      activationAcknowledgment: {
        actor: authority.actor,
        statementVersion: authority.statementVersion,
        draftGeneration: authority.draftGeneration,
        selectionsHash: authority.selectionsHash,
        statement: vm.activation.attestationStatement,
      },
      evidence,
      selections: draft.selections,
      firms,
    }),
  };
}

export function buildActivatedRecord(
  snapshot: SetupActivatedSnapshotVM,
  firmId: SetupFirmId,
): RecordVM {
  const evaluated = snapshot.firms.find(
    (candidate) => candidate.firmId === firmId,
  );
  if (!evaluated) {
    throw new Error(`Activated setup snapshot does not contain ${firmId}`);
  }
  const policyEvaluation = evaluateSetupPolicy(
    snapshot.selections,
    firmId,
    snapshot.evidence,
  );
  const firm = runtimeFirm(
    firmId,
    policyEvaluation,
    evaluated.policyVersion,
  );
  const reached = {
    authority: evaluated.authorityPlan.mode !== "not-reached",
    safety: evaluated.authorityPlan.mode !== "not-reached",
    execution: evaluated.authorityPlan.mode !== "not-reached",
  };
  const stopNote = evaluated.authorityPlan.mode !== "not-reached"
    ? null
    : "This journey stopped at Decision: the named conditions must be resolved before authority can be requested.";
  return buildRecord(
    scenarioById(evaluated.scenarioId),
    firm,
    reached,
    stopNote,
    {
      identity: {
        decisionId: evaluated.decisionId,
        inputHash: evaluated.inputHash,
        decisionHash: evaluated.decisionHash,
        bundleHash: evaluated.bundleHash,
      },
      disposition: evaluated.disposition,
      authority: evaluated.authorityPlan,
      activatedConfiguration: {
        snapshotVersion: snapshot.snapshotVersion,
        snapshotHash: snapshot.snapshotHash,
        configurationHash: evaluated.configurationHash,
        configurationPostureStatus: POSTURE_STATUS[evaluated.configurationPosture],
        configurationPostureLabel: POSTURE_OPTION_LABEL[evaluated.configurationPosture],
        configurationProvenance: evaluated.configurationProvenance,
        eligibleRole: evaluated.eligibleRole,
        requesterParticipation:
          evaluated.requesterParticipation.mode,
        activationActorId:
          snapshot.activationAcknowledgment.actor.opaqueId,
        activationActorRole:
          snapshot.activationAcknowledgment.actor.role,
        attestationStatementVersion:
          snapshot.activationAcknowledgment.statementVersion,
        attestedDraftGeneration:
          snapshot.activationAcknowledgment.draftGeneration,
        attestedSelectionsHash:
          snapshot.activationAcknowledgment.selectionsHash,
        attestationStatement:
          snapshot.activationAcknowledgment.statement,
      },
      reserveHorizon: ACTIVATED_RESERVE_HORIZON,
      evidence: snapshot.evidence,
    },
  );
}
