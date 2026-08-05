import { FIRMS } from "./data";
import type { DecisionEvidenceSnapshot } from "./decision-evidence";
import {
  hashCanonicalPreimage,
  toJsonValue,
} from "./decision-identity";
import {
  SETUP_POLICY_GROUP_IDS,
  optionPosture,
  type MoneyMovementSetupVM,
  type SetupFirmId,
  type SetupSelections,
} from "./setup-model";
import { optionFor } from "./setup-activation-input";
import {
  evaluateSetupPolicy,
  setupResolvedConfiguration,
  type SetupPolicyEvaluation,
  type SetupResolvedConfiguration,
} from "./setup-policy";

interface SetupProfileIdentity {
  readonly activeProfile: boolean;
  readonly configurationHash: string;
  readonly policyVersion: string;
}

function initialSetupSelections(
  vm: MoneyMovementSetupVM,
): SetupSelections {
  const selections = {
    "firm-a": {},
    "firm-b": {},
  } as SetupSelections;
  for (const group of vm.policyGroups) {
    for (const firm of group.firms) {
      selections[firm.firmId][group.id] =
        firm.initialOptionId;
    }
  }
  return selections;
}

function configurationHash(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  selections: SetupSelections,
  resolvedConfiguration: SetupResolvedConfiguration,
): string {
  return hashCanonicalPreimage(toJsonValue({
    hashKind: "money-movement-demo-profile-configuration",
    preimageVersion:
      "money-movement-demo-profile-configuration/4.0.0",
    payload: {
      firmId,
      resolvedConfiguration,
      selections: SETUP_POLICY_GROUP_IDS.map((groupId) => {
        const option = optionFor(
          vm,
          firmId,
          groupId,
          selections[firmId][groupId],
        )!;
        return {
          groupId,
          optionId: option.id,
          posture: optionPosture(option.truthLabel),
        };
      }),
    },
  }));
}

export function setupProfileIdentity(
  vm: MoneyMovementSetupVM,
  firmId: SetupFirmId,
  selections: SetupSelections,
  evaluation: SetupPolicyEvaluation,
  evidence: DecisionEvidenceSnapshot,
): SetupProfileIdentity {
  const resolvedConfiguration = setupResolvedConfiguration(
    selections,
    firmId,
    evaluation,
  );
  const actualConfigurationHash = configurationHash(
    vm,
    firmId,
    selections,
    resolvedConfiguration,
  );
  const initialSelections = initialSetupSelections(vm);
  const activeEvaluation = evaluateSetupPolicy(
    initialSelections,
    firmId,
    evidence,
  );
  const activeResolvedConfiguration = setupResolvedConfiguration(
    initialSelections,
    firmId,
    {
      ...activeEvaluation,
      requesterParticipation:
        FIRMS[firmId]!.requesterParticipation,
    },
  );
  const activeProfile =
    actualConfigurationHash ===
    configurationHash(
      vm,
      firmId,
      initialSelections,
      activeResolvedConfiguration,
    );
  const activeVersion = vm.profiles.find(
    (candidate) => candidate.firmId === firmId,
  )!.activeVersion;
  return {
    activeProfile,
    configurationHash: actualConfigurationHash,
    policyVersion: activeProfile
      ? activeVersion
      : `${firmId === "firm-a" ? "FA" : "FB"}-MM-DEMO-${actualConfigurationHash
          .slice(0, 12)
          .toUpperCase()}`,
  };
}
