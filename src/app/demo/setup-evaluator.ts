import { createHash } from "node:crypto";
import { projectReserve } from "@domain/money-movement/reserve-projection";
import { buildDisposition } from "./build-decision";
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
  decisionIdentityFor,
  scenarioById,
  type DecisionConfiguration,
  type FirmData,
} from "./data";
import { ACTIVATED_RESERVE_HORIZON, RESERVE_FLOOR_INPUTS, derivedMetric } from "./provenance";
import {
  POSTURE_CONFIGURATION_LABEL,
  POSTURE_OPTION_LABEL,
  POSTURE_STATUS,
  SETUP_FIRM_IDS,
  SETUP_POLICY_GROUP_IDS,
  configurationPosture,
  optionPosture,
  type MoneyMovementSetupVM,
  type SetupActivatedSnapshotVM,
  type SetupActivationResult,
  type SetupFirmId,
  type SetupPolicyGroupId,
  type SetupProofFirmVM,
  type SetupSelections,
  type SetupTruthLabel,
} from "./setup-model";
import type { RecordVM } from "./model";
import { evaluateAuthorityPlan } from "./setup-authority";

const SETUP_SCENARIO_ID = "recent-bank-change-block";
const RESERVE_MONTHS: Readonly<Record<string, number>> = {
  "6-months": 6,
  "9-months": 9,
  "12-months": 12,
};
const FRESHNESS_DAYS: Readonly<Record<string, number>> = {
  "7-days": 7,
  "14-days": 14,
  "30-days": 30,
};
const BANK_HANDLING: Readonly<Record<string, FirmData["bankChangeHandling"]>> = {
  specialist: "specialist-review",
  block: "block-until-independently-verified",
};
const THRESHOLD_MINOR: Readonly<Record<string, number>> = {
  "25000": 2_500_000,
  "50000": 5_000_000,
  "100000": 10_000_000,
};
function digest(value: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 80);
  if (value === undefined) return "(missing)";
  if (value === null) return "(null)";
  return `(${typeof value})`;
}

function combinationName(value: unknown): string {
  if (!isPlainRecord(value)) return `input=${displayValue(value)}`;
  return SETUP_FIRM_IDS.map((firmId) => {
    const firm = isPlainRecord(value[firmId]) ? value[firmId] : {};
    const choices = SETUP_POLICY_GROUP_IDS.map(
      (groupId) => `${groupId}=${displayValue(firm[groupId])}`,
    ).join(", ");
    return `${firmId}[${choices}]`;
  }).join(" | ");
}

function normalizedSelections(value: unknown): SetupSelections | null {
  if (!isPlainRecord(value)) return null;
  if (
    Object.keys(value).sort().join("|") !== [...SETUP_FIRM_IDS].sort().join("|")
  ) {
    return null;
  }
  const normalized = {
    "firm-a": {} as Record<SetupPolicyGroupId, string>,
    "firm-b": {} as Record<SetupPolicyGroupId, string>,
  };
  for (const firmId of SETUP_FIRM_IDS) {
    const firm = value[firmId];
    if (!isPlainRecord(firm)) return null;
    if (
      Object.keys(firm).sort().join("|") !==
      [...SETUP_POLICY_GROUP_IDS].sort().join("|")
    ) {
      return null;
    }
    for (const groupId of SETUP_POLICY_GROUP_IDS) {
      const optionId = firm[groupId];
      if (typeof optionId !== "string") return null;
      normalized[firmId][groupId] = optionId;
    }
  }
  return normalized;
}

function canonicalConfiguration(selections: SetupSelections): string {
  return SETUP_FIRM_IDS.map(
    (firmId) =>
      `${firmId}[${SETUP_POLICY_GROUP_IDS.map(
        (groupId) => `${groupId}=${selections[firmId][groupId]}`,
      ).join(";")}]`,
  ).join("|");
}

function optionFor(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  groupId: SetupPolicyGroupId,
  optionId: string,
) {
  const group = vm.policyGroups.find((candidate) => candidate.id === groupId);
  const firm = group?.firms.find((candidate) => candidate.firmId === firmId);
  return firm?.options.find((candidate) => candidate.id === optionId) ?? null;
}

function validateSelections(
  vm: MoneyMovementSetupVM,
  selections: SetupSelections,
): string | null {
  for (const firmId of SETUP_FIRM_IDS) {
    for (const groupId of SETUP_POLICY_GROUP_IDS) {
      const optionId = selections[firmId][groupId];
      if (!optionFor(vm, firmId, groupId, optionId)) {
        return `Unsupported setup combination: ${canonicalConfiguration(selections)}. ${firmId}:${groupId}=${optionId} is not a supported closed choice.`;
      }
      const evaluatorSupports =
        groupId === "reserve"
          ? Object.hasOwn(RESERVE_MONTHS, optionId)
          : groupId === "freshness"
            ? Object.hasOwn(FRESHNESS_DAYS, optionId)
            : groupId === "bank-change"
              ? Object.hasOwn(BANK_HANDLING, optionId)
              : groupId === "threshold"
                ? Object.hasOwn(THRESHOLD_MINOR, optionId)
                : Object.hasOwn(APPROVAL_CLOCKS, optionId);
      if (!evaluatorSupports) {
        return `Unsupported setup combination: ${canonicalConfiguration(selections)}. The deterministic evaluator does not support ${firmId}:${groupId}=${optionId}.`;
      }
    }
  }
  return null;
}

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
  };
}

function evaluateFirm(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  selections: SetupSelections,
  snapshotHash: string,
): Omit<SetupProofFirmVM, "exportHref"> {
  const profile = vm.profiles.find((candidate) => candidate.firmId === firmId)!;
  const activeProfile = matchesActiveProfile(vm, firmId, selections);
  const posture = configurationPosture(selectedTruthLabels(vm, firmId, selections));
  const configurationHash = digest([
    "verin-demo-profile-configuration-v1",
    firmId,
    ...SETUP_POLICY_GROUP_IDS.flatMap((groupId) => [
      groupId,
      selections[firmId][groupId],
    ]),
  ]);
  const policyVersion = activeProfile
    ? profile.activeVersion
    : `${firmId === "firm-a" ? "FA" : "FB"}-MM-DEMO-${configurationHash
        .slice(0, 12)
        .toUpperCase()}`;
  const firm = runtimeFirm(firmId, selections, policyVersion);
  const configuration = decisionConfiguration(firm, selections, snapshotHash);
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
  const identity = decisionIdentityFor(scenario, firm, {
    configuration,
    disposition: disposition.kind,
    explanation: disposition.why.reason,
  });
  const dualApproval =
    CANONICAL_REQUEST.amountMinor > configuration.dualApprovalThresholdMinor;
  const approvalClock = APPROVAL_CLOCKS[configuration.approvalClockId]!;
  const evaluatedAuthority = evaluateAuthorityPlan(
    firm,
    disposition,
    dualApproval,
    approvalClock,
  );
  const selectedOptions = SETUP_POLICY_GROUP_IDS.map((groupId) => {
    const option = optionFor(vm, firmId, groupId, selections[firmId][groupId])!;
    return {
      groupId,
      groupTitle: vm.policyGroups.find((group) => group.id === groupId)!.title,
      label: option.label,
      posture: optionPosture(option.truthLabel),
    };
  });
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

export function activateMoneyMovementSetup(value: unknown): SetupActivationResult {
  const selections = normalizedSelections(value);
  if (!selections) {
    return {
      ok: false,
      error: `Unsupported setup combination: ${combinationName(value)}. Both firms and all five closed choice groups are required.`,
    };
  }
  const vm = buildMoneyMovementSetup();
  const validationError = validateSelections(vm, selections);
  if (validationError) return { ok: false, error: validationError };
  const canonical = canonicalConfiguration(selections);
  const snapshotHash = digest([
    "verin-demo-activated-snapshot-v1",
    canonical,
    vm.activation.proposer,
    vm.activation.approver,
    vm.activation.simulationRef,
    vm.activation.effectiveAt,
  ]);
  const snapshotVersion = `MM-DEMO-SNAPSHOT-${snapshotHash
    .slice(0, 12)
    .toUpperCase()}`;
  const evaluatedA = evaluateFirm(vm, "firm-a", selections, snapshotHash);
  const evaluatedB = evaluateFirm(vm, "firm-b", selections, snapshotHash);
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
      canonicalConfiguration: canonical,
      activatedAt: vm.activation.effectiveAt,
      selections,
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
      },
      reserveHorizon: ACTIVATED_RESERVE_HORIZON,
    },
  );
}
