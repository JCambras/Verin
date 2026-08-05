import {
  SETUP_FIRM_IDS,
  SETUP_POLICY_GROUP_IDS,
  type SetupSelections,
} from "../setup-model";
import type { SetupActivationDraft } from "../setup-activation-contract";

function cloneSelections(selections: SetupSelections): SetupSelections {
  return {
    "firm-a": { ...selections["firm-a"] },
    "firm-b": { ...selections["firm-b"] },
  };
}

export function captureSetupActivationDraft(
  generation: number,
  selections: SetupSelections,
  setupVersionDigest: string,
): SetupActivationDraft {
  return {
    generation,
    selections: cloneSelections(selections),
    setupVersionDigest,
  };
}

export function activationResponseMatchesDraft(
  captured: SetupActivationDraft,
  currentGeneration: number,
  currentSelections: SetupSelections,
  currentSetupVersionDigest: string,
): boolean {
  if (captured.generation !== currentGeneration) return false;
  if (captured.setupVersionDigest !== currentSetupVersionDigest) return false;
  return SETUP_FIRM_IDS.every((firmId) =>
    SETUP_POLICY_GROUP_IDS.every(
      (groupId) =>
        captured.selections[firmId][groupId] ===
        currentSelections[firmId][groupId],
    ),
  );
}
