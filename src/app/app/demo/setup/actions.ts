"use server";

import { cookies } from "next/headers";
import { requirePrincipal } from "@app/_server/context";
import {
  activateMoneyMovementSetup,
} from "@app/demo/setup-evaluator";
import {
  registerActivatedSetupSnapshot,
} from "@app/demo/setup-activation-store";
import type {
  SetupActivationResult,
  SetupSelections,
} from "@app/demo/setup-model";

export async function activateSetup(
  selections: SetupSelections,
): Promise<SetupActivationResult> {
  const principal = await requirePrincipal({ cookies: await cookies() });
  if (!principal.ok) {
    return {
      ok: false,
      error: "Activation requires a signed-in demonstration principal.",
    };
  }
  const result = activateMoneyMovementSetup(selections);
  if (result.ok) registerActivatedSetupSnapshot(result.snapshot);
  return result;
}
