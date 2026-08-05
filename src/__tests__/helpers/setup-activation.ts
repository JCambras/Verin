import {
  validateSetupActivationDraft,
  type SetupActivationAuthorityBinding,
} from "@app/demo/setup-activation-input";
import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import { SETUP_ATTESTATION_STATEMENT_VERSION } from "@app/demo/setup-model";
import type { SetupSelections } from "@app/demo/setup-model";

export function setupActivationAuthority(
  selections: SetupSelections,
  generation = 0,
  actorId = "test-principal",
): SetupActivationAuthorityBinding {
  const setupVersionDigest = buildMoneyMovementSetup().setupVersionDigest;
  const draft = validateSetupActivationDraft(
    generation,
    selections,
    setupVersionDigest,
  );
  if (!draft.ok) throw new Error(draft.error);
  return {
    actor: { opaqueId: actorId, role: "principal" },
    statementVersion: SETUP_ATTESTATION_STATEMENT_VERSION,
    draftGeneration: draft.generation,
    selectionsHash: draft.selectionsHash,
    setupVersionDigest: draft.setupVersionDigest,
  };
}
