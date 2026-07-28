import {
  SETUP_FIRM_IDS,
  SETUP_POLICY_GROUP_IDS,
  type SetupSelections,
} from "../setup-model";

export interface SetupActivationDraft {
  readonly generation: number;
  readonly selections: SetupSelections;
}

function cloneSelections(selections: SetupSelections): SetupSelections {
  return {
    "firm-a": { ...selections["firm-a"] },
    "firm-b": { ...selections["firm-b"] },
  };
}

export function captureSetupActivationDraft(
  generation: number,
  selections: SetupSelections,
): SetupActivationDraft {
  return {
    generation,
    selections: cloneSelections(selections),
  };
}

export function activationResponseMatchesDraft(
  captured: SetupActivationDraft,
  currentGeneration: number,
  currentSelections: SetupSelections,
): boolean {
  if (captured.generation !== currentGeneration) return false;
  return SETUP_FIRM_IDS.every((firmId) =>
    SETUP_POLICY_GROUP_IDS.every(
      (groupId) =>
        captured.selections[firmId][groupId] ===
        currentSelections[firmId][groupId],
    ),
  );
}
