// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getJourney } from "@app/demo/journey";
import { PolicyTraceSurface } from "@app/demo/surfaces/policy-trace";

/**
 * A register whose ROW ORDER IS THE CLAIM offers no way to reorder itself (D-194).
 * The precedence trace says "the rules that governed this decision, in the order they
 * were applied"; a viewer who sorted it by Result would be reading a different claim
 * under a caption that still promised application order. `Table` defaults every column
 * to unsortable, so this is a property of the caller's column declaration and belongs
 * beside the caller.
 */
describe("order-carrying registers", () => {
  function renderPolicyTrace() {
    const journey = getJourney("dual-approval", "firm-a");
    render(
      <PolicyTraceSurface
        vm={journey.policyTrace}
        scenarioId={journey.scenarioId}
        firmId={journey.firmId}
        journeyContinues
      />,
    );
    return journey.policyTrace;
  }

  it("gives the precedence trace no sortable header and no sort state", () => {
    renderPolicyTrace();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["#", "Rule", "Result", "Provision"]);
    for (const header of headers) {
      expect(header).not.toHaveAttribute("aria-sort");
      expect(header.querySelector("button")).toBeNull();
    }
    expect(screen.queryAllByRole("button", { name: /Rule|Result|Provision/ })).toEqual([]);
  });

  it("renders precedence rows in the order the rules were applied", () => {
    const vm = renderPolicyTrace();
    expect(vm.rows.length).toBeGreaterThan(1);
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows.map((row) => row.querySelector("td")?.textContent)).toEqual(
      vm.rows.map((row) => String(row.order)),
    );
  });
});
