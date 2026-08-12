// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metric } from "@contracts/metric";
import { getJourney } from "@app/demo/journey";
import { DISPOSITION_LABELS, type DispositionKind } from "@app/demo/model";
import { comparisonSortValue, PolicyAuthoringSurface } from "@app/demo/surfaces/policy-authoring";
import { PolicyTraceSurface } from "@app/demo/surfaces/policy-trace";
import { compareSortValues } from "@app/presentation/table-order";
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
  const PROVENANCE = { source: "verin-crm", asOf: "2026-08-05T12:00:00.000Z", confidence: "high" } as const;
  const CAPTION = "Simulated impact of the drafted policy";
  const SORT_NOTE =
    "dispositions by restrictiveness, then numbers by value, then text alphabetically with numbers in numeric order, blanks last";

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
    sorted = `${CAPTION} (re-sorted by Under the draft, ascending, ${SORT_NOTE})`;
    expect(register(sorted).querySelector("caption")).toHaveTextContent(sorted);
  });

  /**
   * A value column mixes dispositions with money and counts, so the order it sorts in is
   * not the one a reader would assume from the values on screen. The caption carries the
   * rule, but the caption is sr-only: a SIGHTED reader looking at "Proceed, Blocked,
   * Prohibited" has no way to tell a severity order from an alphabet unless the register
   * says which one it applied - and only while it is applying it.
   */
  it("discloses the active ordering as visible text inside the landmark", async () => {
    const user = userEvent.setup();
    renderSimulation();
    expect(register()).not.toHaveTextContent(SORT_NOTE);

    await user.click(within(register()).getByRole("button", { name: /^Today/ }));
    expect(register(/re-sorted by Today/)).toHaveTextContent(`Sorted by Today: ${SORT_NOTE}.`);

    // A column with no declared ordering rule claims none.
    await user.click(within(register(/re-sorted by/)).getByRole("button", { name: /Dimension/ }));
    expect(register(/re-sorted by Dimension/)).not.toHaveTextContent(SORT_NOTE);
  });

  /**
   * The defect this replaces: both value columns declared `sortable` against a sort
   * value that was always `undefined`, so every comparison tied, both directions left
   * the authored order untouched, and the caption announced a re-sort that had not
   * happened. Asserting per column that ascending and descending differ is what catches
   * an advertised sort with no scalar behind it, whichever column acquires one next.
   */
  it("moves rows in both directions for every column it advertises as sortable", async () => {
    const user = userEvent.setup();
    const vm = renderSimulation();
    expect(vm.simulationDelta.length).toBeGreaterThan(2);

    for (const label of ["#", "Dimension", "Today", "Under the draft"]) {
      const name = new RegExp(`^${label}`);
      await user.click(within(register(/^Simulated impact/)).getByRole("button", { name }));
      const ascending = cases(/re-sorted by/);
      await user.click(within(register(/re-sorted by/)).getByRole("button", { name }));
      const descending = cases(/re-sorted by/);
      expect(descending, `${label} sorts identically in both directions`).toEqual([...ascending].reverse());
      await user.click(screen.getByRole("button", { name: `Restore recorded order: ${CAPTION}` }));
    }
  });

  /**
   * Dispositions order by the ratified §5 restrictiveness lattice. Their LABELS order
   * "Blocked - resolvable" < "Proceed" < "Prohibited", an alphabet that reads as a
   * severity claim the product never makes - so the two orders are asserted to differ,
   * or the test would pass on the very bug it exists to prevent.
   */
  it("ranks dispositions by restrictiveness rather than by label, identically in both columns", () => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const badge = (kind: DispositionKind) => ({ badge: { status: kind, label: DISPOSITION_LABELS[kind] } });
    const shuffled: readonly DispositionKind[] = ["prohibited", "proceed", "blocked"];

    const byRestrictiveness = [...shuffled].sort((left, right) =>
      compareSortValues(comparisonSortValue(badge(left)), comparisonSortValue(badge(right)), "ascending"),
    );
    expect(byRestrictiveness).toEqual(["proceed", "blocked", "prohibited"]);

    const byLabel = [...shuffled].sort((left, right) =>
      collator.compare(DISPOSITION_LABELS[left], DISPOSITION_LABELS[right]),
    );
    expect(byLabel).not.toEqual(byRestrictiveness);

    // One ranking serves both value columns, so "Today" and "Under the draft" compare directly.
    for (const kind of shuffled) {
      expect(comparisonSortValue(badge(kind))).toEqual(
        comparisonSortValue({ badge: { status: kind, label: "anything" } }),
      );
    }
    // A value outside the lattice falls back to the text the reader can see, never to nothing.
    expect(comparisonSortValue({ display: "Twelve months" })).toContain("Twelve months");
    expect(comparisonSortValue({ badge: { status: "escalated", label: "Escalated" } })).toContain("Escalated");
    expect(comparisonSortValue({})).toBeNull();
  });

  /**
   * The defect this replaces: a metric cell sorted on its FORMATTED string, so the
   * ordering the note promised and the ordering the collator performed were two different
   * things - and money written with a thousands separator does not even order correctly as
   * text, which `$1,234.00` below `$980.00` is the shipped-shape proof of.
   */
  it("orders money by its value rather than by the string it is printed as", () => {
    const money = (minor: number) => ({ metric: metric(minor, "currency-minor" as const, PROVENANCE) });
    expect(comparisonSortValue(money(123400))).toBe(1234);
    expect(compareSortValues(comparisonSortValue(money(123400)), comparisonSortValue(money(98000)), "ascending"))
      .toBeGreaterThan(0);
    expect(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare("$1,234.00", "$980.00"))
      .toBeLessThan(0);

    // Money is stored in minor units, so a column mixing it with counts compares the
    // numbers the reader is actually looking at.
    const count = { metric: metric(3, "count" as const, PROVENANCE) };
    expect(comparisonSortValue({ metric: metric(50, "currency-minor" as const, PROVENANCE) })).toBe(0.5);
    expect(compareSortValues(comparisonSortValue(count), comparisonSortValue(money(50)), "ascending"))
      .toBeGreaterThan(0);
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
