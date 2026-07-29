// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
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
import { ControlsBody } from "@app/demo/surfaces/setup-governance";
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

  it("pairs accountable roles to firm labels by identity after profile reordering", () => {
    const original = buildMoneyMovementSetup();
    const vm = {
      ...original,
      profiles: [original.profiles[1], original.profiles[0]],
      roles: original.roles.map((role, index) =>
        index === 0
          ? {
              ...role,
              firms: {
                "firm-a": "Firm A accountable owner",
                "firm-b": "Firm B accountable owner",
              },
            }
          : role,
      ),
    } satisfies typeof original;
    render(<ControlsBody vm={vm} />);

    const responsibility = screen
      .getByRole("heading", { name: "Policy proposal and approval" })
      .closest("article");
    expect(responsibility).not.toBeNull();
    const labels = within(responsibility!).getAllByRole("term");
    expect(labels.map((label) => label.textContent)).toEqual([
      "Firm B",
      "Firm A",
    ]);
    const assignments = within(responsibility!).getAllByRole("definition");
    expect(assignments.map((assignment) => assignment.textContent)).toEqual([
      "Firm B accountable owner",
      "Firm A accountable owner",
    ]);
  });
});
