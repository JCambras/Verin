import { projectReserve } from "@domain/money-movement/reserve-projection";
import { buildDisposition, buildPolicyTrace } from "./build-decision";
import { buildMoneyMovementSetup } from "./build-setup";
import { buildRecord } from "./build-summary";
import {
  APPROVAL_CLOCKS,
  CANONICAL_REQUEST,
  DEMO_NOW,
  FIRMS,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  scenarioById,
  type DecisionConfiguration,
  type FirmData,
} from "./data";
import {
  decisionAuthorityRequirementsFor,
  decisionIdentityFor,
  hashCanonicalPreimage,
  toJsonValue,
} from "./decision-identity";
import { ACTIVATED_RESERVE_HORIZON, RESERVE_FLOOR_INPUTS, derivedMetric } from "./provenance";
import {
  POSTURE_CONFIGURATION_LABEL,
  POSTURE_OPTION_LABEL,
  POSTURE_STATUS,
  SETUP_ATTESTATION_STATEMENT_VERSION,
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
  BANK_HANDLING,
  FRESHNESS_DAYS,
  RESERVE_MONTHS,
  SETUP_SCENARIO_ID,
  THRESHOLD_MINOR,
  optionFor,
  setupActivationPreimageFor,
  validateSetupActivationDraft,
  type SetupActivationAuthorityBinding,
} from "./setup-activation-input";

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
  selections: SetupSelections,
  policyVersion: string,
): FirmData {
  const base = FIRMS[firmId]!;
  return {
    ...base,
    reserveMonths: RESERVE_MONTHS[selections[firmId].reserve]!,
    dualApprovalThresholdMinor:
      THRESHOLD_MINOR[selections[firmId].threshold]!,
    bankChangeHandling: BANK_HANDLING[selections[firmId]["bank-change"]]!,
    policyVersion,
  };
}

function decisionConfiguration(
  firm: FirmData,
  selections: SetupSelections,
  snapshotHash: string,
  authority: SetupActivationAuthorityBinding,
): DecisionConfiguration {
  return {
    policyVersion: firm.policyVersion,
    reserveMonths: firm.reserveMonths,
    freshnessDays: FRESHNESS_DAYS[selections[firm.id as SetupFirmId].freshness]!,
    bankChangeHandling: firm.bankChangeHandling,
    dualApprovalThresholdMinor: firm.dualApprovalThresholdMinor,
    approvalsRequired: firm.approvalsRequired,
    eligibleRole: firm.eligibleRole,
    requesterConstraint: firm.requesterConstraint,
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
  const resolvedConfiguration = {
    reserveMonths: RESERVE_MONTHS[selections[firmId].reserve]!,
    freshnessDays:
      FRESHNESS_DAYS[selections[firmId].freshness]!,
    bankChangeHandling:
      BANK_HANDLING[selections[firmId]["bank-change"]]!,
    dualApprovalThresholdMinor:
      THRESHOLD_MINOR[selections[firmId].threshold]!,
    approvalsRequired: baseFirm.approvalsRequired,
    eligibleRole: baseFirm.eligibleRole,
    requesterConstraint: baseFirm.requesterConstraint,
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
  const firm = runtimeFirm(firmId, selections, policyVersion);
  const configuration = decisionConfiguration(
    firm,
    selections,
    snapshotHash,
    authority,
  );
  const projection = projectReserve({
    availableMinor: SMITHS_LIQUIDITY.availableMinor,
    pendingMinor: SMITHS_LIQUIDITY.pendingMinor,
    requestMinor: SMITHS_LIQUIDITY.requestMinor,
    plannedMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    reserveMonths: configuration.reserveMonths,
  });
  const evidenceAgeDays =
    (Date.parse(DEMO_NOW) - Date.parse(OBSERVED_RECENT)) / 86_400_000;
  const freshnessSatisfied = evidenceAgeDays <= configuration.freshnessDays;
  const bankSatisfied =
    configuration.bankChangeHandling === "specialist-review";
  const kind =
    projection.reserveSatisfied && freshnessSatisfied && bankSatisfied
      ? "proceed"
      : "blocked";
  const scenario = scenarioById(SETUP_SCENARIO_ID);
  const disposition = buildDisposition(scenario, firm, kind, ACTIVATED_RESERVE_HORIZON);
  const dualApproval =
    CANONICAL_REQUEST.amountMinor > configuration.dualApprovalThresholdMinor;
  const approvalClock = APPROVAL_CLOCKS[configuration.approvalClockId]!;
  const evaluatedAuthority = evaluateAuthorityPlan(
    firm,
    disposition,
    dualApproval,
    approvalClock,
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
      authority: {
        reached: evaluatedAuthority.reached,
        requirements: decisionAuthorityRequirementsFor(
          evaluatedAuthority.stages,
        ),
      },
    },
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
    strongestProofTitle: evaluatedAuthority.reached
      ? "Submitted · not verified"
      : "Blocked decision recorded",
    strongestProofDetail: evaluatedAuthority.reached
      ? "One idempotent instruction reached the labeled fake adapter. Settlement and Salesforce parity remain unproven."
      : "No authority, reservation, execution plan, adapter call, or external status exists for this branch.",
    selectedOptions,
    approvalClock,
    exportLabel: `${profile.firmLabel} decision record`,
  };
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
  const vm = buildMoneyMovementSetup();
  const snapshotHash = hashCanonicalPreimage(
    setupActivationPreimageFor(vm, draft, authority),
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
  );
  const evaluatedB = evaluateFirm(
    vm,
    "firm-b",
    draft.selections,
    snapshotHash,
    authority,
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
  const firm = runtimeFirm(firmId, snapshot.selections, evaluated.policyVersion);
  const reached = {
    authority: evaluated.authorityPlan.reached,
    safety: evaluated.authorityPlan.reached,
    execution: evaluated.authorityPlan.reached,
  };
  const stopNote = evaluated.authorityPlan.reached
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
      approvalStages: evaluated.authorityPlan.reached
        ? evaluated.authorityPlan.stages
        : null,
      activatedConfiguration: {
        snapshotVersion: snapshot.snapshotVersion,
        snapshotHash: snapshot.snapshotHash,
        configurationHash: evaluated.configurationHash,
        configurationPostureStatus: POSTURE_STATUS[evaluated.configurationPosture],
        configurationPostureLabel: POSTURE_OPTION_LABEL[evaluated.configurationPosture],
        configurationProvenance: evaluated.configurationProvenance,
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
    },
  );
}
