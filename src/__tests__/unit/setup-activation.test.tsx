// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import { activateMoneyMovementSetup } from "@app/demo/setup-evaluator";
import type {
  SetupActivationResult,
  SetupSelections,
} from "@app/demo/setup-model";
import {
  activationResponseMatchesDraft,
  captureSetupActivationDraft,
} from "@app/demo/surfaces/setup-activation-state";
import { MoneyMovementSetupSurface } from "@app/demo/surfaces/setup";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function setupSelections(): SetupSelections {
  const vm = buildMoneyMovementSetup();
  const selections = {
    "firm-a": {} as SetupSelections["firm-a"],
    "firm-b": {} as SetupSelections["firm-b"],
  };
  for (const group of vm.policyGroups) {
    for (const firm of group.firms) {
      selections[firm.firmId][group.id] = firm.initialOptionId;
    }
  }
  return selections;
}

describe("setup activation", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("disables activation navigation and attestation until the atomic action completes", async () => {
    const user = userEvent.setup();
    let resolveActivation:
      | ((result: SetupActivationResult) => void)
      | undefined;
    const activate = vi.fn(
      () =>
        new Promise<SetupActivationResult>((resolve) => {
          resolveActivation = resolve;
        }),
    );
    render(
      <MoneyMovementSetupSurface
        vm={buildMoneyMovementSetup()}
        activate={activate}
      />,
    );

    for (const label of [
      "Continue with both firms",
      "Confirm required controls",
      "Use this starting posture",
      "Review signed impact",
      "Send for approval",
    ]) {
      await user.click(screen.getByRole("button", { name: label }));
    }
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", {
        name: "Acknowledge and activate demonstration",
      }),
    );

    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();

    const result = activateMoneyMovementSetup(setupSelections());
    expect(result.ok).toBe(true);
    resolveActivation?.(result);
    await screen.findByRole("heading", {
      name: "Run the Smiths request under both profiles",
    });
  });

  it("rejects a response when either the generation or exact selections changed", () => {
    const selections = setupSelections();
    const captured = captureSetupActivationDraft(4, selections);
    const changed = setupSelections();
    changed["firm-a"].reserve = "9-months";

    expect(activationResponseMatchesDraft(captured, 5, selections)).toBe(false);
    expect(activationResponseMatchesDraft(captured, 4, changed)).toBe(false);
    expect(activationResponseMatchesDraft(captured, 4, selections)).toBe(true);
  });
});
