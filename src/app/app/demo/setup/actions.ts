"use server";

import { cookies } from "next/headers";
import type { Role } from "@contracts/roles";
import { requirePrincipalWithRole } from "@app/_server/context";
import {
  activateMoneyMovementSetup,
} from "@app/demo/setup-evaluator";
import { validateSetupActivationDraft } from "@app/demo/setup-activation-input";
import {
  registerActivatedSetupSnapshot,
  type SetupActivationScope,
} from "@app/demo/setup-activation-store";
import {
  consumeSetupAttestation,
  issueSetupAttestation,
} from "@app/demo/setup-attestation-store";
import type {
  SetupActivationResult,
} from "@app/demo/setup-model";
import type {
  SetupActivationCommand,
  SetupActivationDraft,
  SetupAttestationResult,
} from "@app/demo/setup-activation-contract";

/** The scope key BOTH sides of the activation store use. The role comes from the
 * live session on the write side exactly as it does on the read side, so the two
 * keys are symmetric by construction rather than by a literal that happens to
 * agree with the role gate above it. */
function activationScope(
  principal: {
    readonly orgId: string;
    readonly userId: string;
    readonly sessionLineageId: string;
    readonly role: Role;
  },
): SetupActivationScope {
  return {
    orgId: principal.orgId,
    userId: principal.userId,
    sessionLineageId: principal.sessionLineageId,
    role: principal.role,
  };
}

export async function attestSetupDraft(
  draft: SetupActivationDraft,
): Promise<SetupAttestationResult> {
  const principal = await requirePrincipalWithRole(
    { cookies: await cookies() },
    ["principal"],
  );
  if (!principal.ok) {
    return {
      ok: false,
      error:
        "Setup activation requires the signed-in Principal role.",
    };
  }
  const validated = validateSetupActivationDraft(
    draft?.generation,
    draft?.selections,
    draft?.setupVersionDigest,
  );
  if (!validated.ok) return validated;
  return {
    ok: true,
    challenge: issueSetupAttestation(activationScope(principal.value), {
      generation: validated.generation,
      selectionsHash: validated.selectionsHash,
      setupVersionDigest: validated.setupVersionDigest,
    }),
  };
}

export async function activateSetup(
  command: SetupActivationCommand,
): Promise<SetupActivationResult> {
  const principal = await requirePrincipalWithRole(
    { cookies: await cookies() },
    ["principal"],
  );
  if (!principal.ok) {
    return {
      ok: false,
      error:
        "Setup activation requires the signed-in Principal role.",
    };
  }
  const validated = validateSetupActivationDraft(
    command?.draftGeneration,
    command?.selections,
    command?.setupVersionDigest,
  );
  if (!validated.ok) return validated;
  const scope = activationScope(principal.value);
  const challenge = consumeSetupAttestation(
    scope,
    command,
    {
      selectionsHash: validated.selectionsHash,
      setupVersionDigest: validated.setupVersionDigest,
    },
  );
  if (!challenge) {
    return {
      ok: false,
      error:
        "The demonstration attestation is missing, expired, already used, or does not match this authenticated Principal and exact setup draft.",
    };
  }
  const result = activateMoneyMovementSetup(validated.selections, {
    actor: {
      opaqueId: principal.value.userId,
      role: "principal",
    },
    statementVersion: challenge.statementVersion,
    draftGeneration: challenge.draftGeneration,
    selectionsHash: challenge.selectionsHash,
    setupVersionDigest: challenge.setupVersionDigest,
  });
  if (!result.ok) return result;
  registerActivatedSetupSnapshot(scope, result.snapshot, result.records);
  return { ok: true, snapshot: result.snapshot };
}
