import {
  CANONICAL_SERIALIZER_VERSION,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { IANA_TIME_ZONE_DATA_VERSION } from "@contracts/time-zone";
import { loadMoneyMovementSetup } from "./build-setup";
import {
  DEMO_REQUEST_REF,
  DEMO_TIME_ZONE,
  DEMO_TIMELINE,
  SETUP_SCENARIO_ID,
  scenarioById,
} from "./data";
import {
  APPROVAL_CLOCKS,
  BANK_HANDLING,
  FRESHNESS_DAYS,
  RESERVE_MONTHS,
  THRESHOLD_MINOR,
} from "./closed-choices";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
} from "./decision-evidence";
import {
  DEMO_DECISION_ENGINE_VERSION,
  DEMO_DECISION_SCHEMA_VERSION,
  decisionInputPreimageFor,
  hashCanonicalPreimage,
  toJsonValue,
  type DecisionAuthorityClaim,
} from "./decision-identity";
import {
  SETUP_ATTESTATION_STATEMENT_VERSION,
  SETUP_FIRM_IDS,
  SETUP_POLICY_GROUP_IDS,
  type MoneyMovementSetupVM,
  type SetupChoiceOptionVM,
  type SetupFirmId,
  type SetupPolicyGroupId,
  type SetupSelections,
} from "./setup-model";
import { setupVersionPreimageFor } from "./setup-version";

export interface SetupActivationAuthorityBinding {
  readonly actor: {
    readonly opaqueId: string;
    readonly role: "principal";
  };
  readonly statementVersion: typeof SETUP_ATTESTATION_STATEMENT_VERSION;
  readonly draftGeneration: number;
  readonly selectionsHash: string;
  readonly setupVersionDigest: string;
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

export function optionFor(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  groupId: SetupPolicyGroupId,
  optionId: string,
): SetupChoiceOptionVM | null {
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

export type ValidatedSetupDraft =
  | {
      readonly ok: true;
      readonly generation: number;
      readonly selections: SetupSelections;
      readonly canonicalConfiguration: string;
      readonly selectionsHash: string;
      readonly setupVersionDigest: string;
    }
  | { readonly ok: false; readonly error: string };

export function selectionPreimage(selections: SetupSelections): JsonValue {
  return toJsonValue({
    hashKind: "money-movement-setup-selections",
    preimageVersion: "money-movement-setup-selections/1.0.0",
    payload: {
      firms: SETUP_FIRM_IDS.map((firmId) => ({
        firmId,
        choices: SETUP_POLICY_GROUP_IDS.map((groupId) => ({
          groupId,
          optionId: selections[firmId][groupId],
        })),
      })),
    },
  });
}

export function validateSetupActivationDraft(
  generation: unknown,
  value: unknown,
  setupVersionDigest: unknown,
): ValidatedSetupDraft {
  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    return {
      ok: false,
      error:
        "The setup draft generation is missing or invalid. Review the current selections before trying again.",
    };
  }
  const selections = normalizedSelections(value);
  if (!selections) {
    return {
      ok: false,
      error: `Unsupported setup combination: ${combinationName(value)}. Both firms and all five closed choice groups are required.`,
    };
  }
  const setup = loadMoneyMovementSetup();
  if (!setup.ok) return setup;
  const vm = setup.vm;
  if (
    typeof setupVersionDigest !== "string" ||
    setupVersionDigest !== vm.setupVersionDigest
  ) {
    return {
      ok: false,
      error:
        "The setup definition changed. Reload and review the current rules and acknowledgment before trying again.",
    };
  }
  const validationError = validateSelections(vm, selections);
  if (validationError) return { ok: false, error: validationError };
  return {
    ok: true,
    generation,
    selections,
    canonicalConfiguration: canonicalConfiguration(selections),
    selectionsHash: hashCanonicalPreimage(selectionPreimage(selections)),
    setupVersionDigest,
  };
}

export function setupActivationPreimageFor(
  vm: MoneyMovementSetupVM,
  draft: Extract<ValidatedSetupDraft, { readonly ok: true }>,
  authority: SetupActivationAuthorityBinding,
  authorityPlans: readonly {
    readonly firmId: SetupFirmId;
    readonly authority: DecisionAuthorityClaim;
    readonly standardApprovalRole: "operations" | null;
    readonly requesterParticipation: { readonly mode: "unbound" };
  }[],
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(
    scenarioById(SETUP_SCENARIO_ID),
  ),
): JsonValue {
  const setupVersion = setupVersionPreimageFor(vm, evidence);
  if (
    hashCanonicalPreimage(setupVersion) !== vm.setupVersionDigest ||
    authority.setupVersionDigest !== vm.setupVersionDigest ||
    draft.setupVersionDigest !== vm.setupVersionDigest
  ) {
    throw new Error(
      "Setup activation inputs do not match the reviewed setup version",
    );
  }
  return toJsonValue({
    hashKind: "money-movement-demo-activation",
    preimageVersion: "money-movement-demo-activation/4.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
      evaluatorVersion: DEMO_DECISION_ENGINE_VERSION,
      evaluation: {
        effectiveAt: DEMO_TIMELINE.activationAt,
        asOf: DEMO_TIMELINE.decisionCreatedAt,
        timeZone: DEMO_TIME_ZONE,
        timeZoneDataVersion: IANA_TIME_ZONE_DATA_VERSION,
      },
      requestRef: DEMO_REQUEST_REF,
      evidenceRef: evidence.ref,
      requestAndEvidence: decisionInputPreimageFor(
        scenarioById(SETUP_SCENARIO_ID),
        {},
        evidence,
      ),
      setupVersionDigest: vm.setupVersionDigest,
      setupVersion,
      draft: {
        generation: draft.generation,
        selectionsHash: draft.selectionsHash,
        setupVersionDigest: draft.setupVersionDigest,
        canonicalConfiguration: draft.canonicalConfiguration,
        selections: selectionPreimage(draft.selections),
      },
      decisionAuthority: authorityPlans,
      authority,
    },
  });
}
