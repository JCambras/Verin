// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getJourney } from "@app/demo/journey";
import { PolicyAuthoringSurface } from "@app/demo/surfaces/policy-authoring";
import { PolicyTraceSurface } from "@app/demo/surfaces/policy-trace";
import { ExecutionTimeline } from "@app/presentation/execution-timeline";
import AuditPage from "@app/app/audit/page";
import DecisionLedgerPage from "@app/app/ledger/page";
import type { LedgerRegisterViewModel } from "@app/ledger/model";

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

  it("gives the execution timeline no column that reconstructs its position", () => {
    render(
      <ExecutionTimeline
        caption="Execution timeline"
        rows={[1, 2].map((step) => ({
          step: `Step ${step}`,
          target: "Custodian",
          status: "submitted",
          statusLabel: "Submitted",
          timestamp: `2026-08-11T12:0${step}:00.000Z`,
          identifiers: [],
          devBadgeLabel: "Demonstration data",
        }))}
      />,
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["Step", "Target", "Status", "When"]);
    for (const header of headers) expect(header).not.toHaveAttribute("aria-sort");
    expect(screen.queryByRole("button", { name: /Restore recorded order/ })).not.toBeInTheDocument();
  });
});

/**
 * The set-versus-sequence test (D-196). The simulation delta is a SET of affected
 * cases - no row is a consequence of the one above it - so a reviewer may legitimately
 * gather the changed dimensions together, and D-194 permits the sort because the case
 * number is VISIBLE and sortable: the authored order survives in data the reader can
 * see rather than in the position a row holds. A causal sequence has no such column,
 * which is why the trace and the timeline above stay unsortable.
 */
describe("the policy simulation delta as a set of cases", () => {
  const CAPTION = "Simulated impact of the drafted policy";

  function renderSimulation() {
    const journey = getJourney("dual-approval", "firm-a");
    render(
      <PolicyAuthoringSurface
        vm={journey.policyAuthoring}
        scenarioId={journey.scenarioId}
        firmId={journey.firmId}
        approved={false}
      />,
    );
    return journey.policyAuthoring;
  }

  const register = (name: string | RegExp = CAPTION) => screen.getByRole("region", { name });
  const cases = (name?: string | RegExp) =>
    within(register(name))
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")?.textContent);

  it("carries every case's own identity in a visible sortable column", () => {
    const vm = renderSimulation();
    expect(vm.simulationDelta.length).toBeGreaterThan(1);
    const labels = ["#", "Dimension", "Today", "Under the draft"];
    const headers = within(register()).getAllByRole("columnheader");
    expect(headers).toHaveLength(labels.length);
    headers.forEach((header, index) => {
      expect(header).toHaveAttribute("aria-sort", "none");
      expect(within(header).getByRole("button").textContent).toContain(labels[index]!);
    });
    expect(cases()).toEqual(vm.simulationDelta.map((_, index) => String(index + 1)));
  });

  it("keeps the caption and the landmark true through several sorts", async () => {
    const user = userEvent.setup();
    renderSimulation();
    await user.click(within(register()).getByRole("button", { name: /Dimension/ }));
    let sorted = `${CAPTION} (re-sorted by Dimension, ascending)`;
    expect(screen.queryByRole("region", { name: CAPTION })).not.toBeInTheDocument();
    expect(register(sorted).querySelector("caption")).toHaveTextContent(sorted);

    await user.click(within(register(sorted)).getByRole("button", { name: /Under the draft/ }));
    sorted = `${CAPTION} (re-sorted by Under the draft, ascending)`;
    expect(register(sorted).querySelector("caption")).toHaveTextContent(sorted);
  });

  it("reconstructs the authored order from the case column and from one restore action", async () => {
    const user = userEvent.setup();
    const vm = renderSimulation();
    const authored = vm.simulationDelta.map((_, index) => String(index + 1));

    await user.click(within(register()).getByRole("button", { name: /Dimension/ }));
    expect(cases(/re-sorted by Dimension/)).not.toEqual(authored);

    await user.click(within(register(/re-sorted by/)).getByRole("button", { name: /#/ }));
    expect(cases(/re-sorted by #/)).toEqual(authored);

    await user.click(within(register(/re-sorted by/)).getByRole("button", { name: /Dimension/ }));
    await user.click(screen.getByRole("button", { name: `Restore recorded order: ${CAPTION}` }));
    expect(cases()).toEqual(authored);
    expect(screen.queryByRole("button", { name: /Restore recorded order/ })).not.toBeInTheDocument();
  });
});

/**
 * The other half of D-194: a register MAY be sortable, and the audit trail and the
 * decision ledger are the two that are - a compliance reader legitimately re-orders by
 * actor or action. The permission is conditional, so each condition is asserted on the
 * shipped surface rather than on a fixture: the sequence column that carries recorded
 * order is visible and sortable, the caption and the landmark both disclose the active
 * sort instead of still promising "newest first", and ONE action puts the recorded
 * order back.
 */
describe("sortable compliance registers", () => {
  afterEach(() => vi.unstubAllGlobals());

  const FOLD = {
    source: "computed",
    asOf: "2026-08-05T12:00:00.000Z",
    confidence: "high",
    demonstration: false,
    derivedFrom: ["verin-crm"],
  } as const;

  function stubFetch(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
    );
  }

  /** Recorded order is newest first, so the register's own sequence column reads down. */
  const AUDIT_ENTRIES = [3, 2, 1].map((sequence) => ({
    sequence,
    actor: sequence === 2 ? "ada" : `actor-${sequence}`,
    action: "household.created",
    entityType: "household",
    detail: `Entry ${sequence}`,
    createdAt: `2026-08-11T12:00:0${sequence}.000Z`,
    entryHash: `hash-${sequence}`,
  }));

  const LEDGER_MODEL: LedgerRegisterViewModel = {
    verification: {
      ok: true,
      levels: (["L1", "L2", "L3", "L4"] as const).map((level) => ({
        level,
        ok: true,
        entriesChecked: 3,
        reason: null,
      })),
    },
    total: { value: 3, format: "count", provenance: FOLD },
    decisionsTotal: null,
    decisionsWithheld: null,
    decisions: [],
    entries: [3, 2, 1].map((sequence) => ({
      sequence,
      occurredAt: `2026-08-11T12:00:0${sequence}.000Z`,
      eventType: sequence === 2 ? "DecisionApproved" : "DecisionRecorded",
      actor: `actor-${sequence}`,
      decisionId: `dec:GC-01:000${sequence}`,
      entryHash: `hash-${sequence}`,
      provenanceLabel: null,
    })),
  };

  const SURFACES = [
    {
      name: "audit trail",
      caption: "Audit log entries, newest first",
      element: <AuditPage />,
      body: { verdict: { ok: true, entriesChecked: 3, reason: null }, entries: AUDIT_ENTRIES, total: 3 },
      sortBy: "Actor",
    },
    {
      name: "decision ledger",
      caption: "Decision ledger entries, newest first",
      element: <DecisionLedgerPage />,
      body: LEDGER_MODEL,
      sortBy: "Event",
    },
  ] as const;

  async function openRegister(surface: (typeof SURFACES)[number]) {
    stubFetch(surface.body);
    render(surface.element);
    return screen.findByRole("region", { name: surface.caption });
  }

  const sequences = (register: HTMLElement) =>
    within(register)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("td")?.textContent);

  for (const surface of SURFACES) {
    it(`shows a sortable sequence column on the ${surface.name}`, async () => {
      const register = await openRegister(surface);
      const sequence = within(register).getAllByRole("columnheader")[0]!;
      expect(sequence).toHaveTextContent("#");
      expect(sequence).toHaveAttribute("aria-sort", "none");
      expect(within(sequence).getByRole("button", { name: /#/ })).toBeVisible();
      expect(sequences(register)).toEqual(["3", "2", "1"]);
    });

    it(`keeps the ${surface.name} caption and landmark true to the active sort`, async () => {
      const user = userEvent.setup();
      const register = await openRegister(surface);
      await user.click(within(register).getByRole("button", { name: new RegExp(surface.sortBy) }));

      const sorted = `${surface.caption} (re-sorted by ${surface.sortBy}, ascending)`;
      expect(screen.queryByRole("region", { name: surface.caption })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: sorted })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: sorted }).querySelector("caption")).toHaveTextContent(sorted);
    });

    it(`restores the ${surface.name}'s recorded order in one action`, async () => {
      const user = userEvent.setup();
      const register = await openRegister(surface);
      const restoreName = `Restore recorded order: ${surface.caption}`;
      expect(screen.queryByRole("button", { name: restoreName })).not.toBeInTheDocument();

      await user.click(within(register).getByRole("button", { name: new RegExp(surface.sortBy) }));
      const sorted = screen.getByRole("region", { name: new RegExp(surface.sortBy) });
      expect(sequences(sorted)).not.toEqual(["3", "2", "1"]);

      // The control is INSIDE its own register's landmark, so a reader who enters the
      // landmark meets the one action that owes them the recorded order back.
      const restore = within(sorted).getByRole("button", { name: restoreName });
      restore.focus();
      await user.keyboard("{Enter}");

      const restored = screen.getByRole("region", { name: surface.caption });
      expect(sequences(restored)).toEqual(["3", "2", "1"]);
      expect(screen.queryByRole("button", { name: restoreName })).not.toBeInTheDocument();
      expect(document.activeElement).not.toBe(document.body);
      expect(restored.contains(document.activeElement)).toBe(true);
    });
  }
});
