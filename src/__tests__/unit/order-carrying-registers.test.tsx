// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metric } from "@contracts/metric";
import { getJourney } from "@app/demo/journey";
import { demoVocabulary } from "@app/demo/vocabulary";
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
/** The journey is built from the REAL configured vocabulary, which the shipped
 * document resolves; a deployment that could not is a rendered refusal rather than
 * a journey, so there is nothing to order-check in that case (D-251). */
function resolvedVocabulary() {
  const vocabulary = demoVocabulary("firm-a");
  if (!vocabulary.ok) throw new Error("the published money-movement configuration must resolve");
  return vocabulary.value;
}

describe("order-carrying registers", () => {
  function renderPolicyTrace() {
    const journey = getJourney("dual-approval", "firm-a", resolvedVocabulary());
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
  /** The landmark's name is the register's identity, not its sentence (D-200). */
  const REGION = "Simulation delta";
  const RESTORE = `Restore recorded order: ${REGION}`;
  const SORT_NOTE =
    "dispositions by restrictiveness, then numbers by value, then text alphabetically with numbers in numeric order; that grouping is fixed, the direction reverses the values inside each group, and blanks stay last";

  function renderSimulation() {
    const journey = getJourney("dual-approval", "firm-a", resolvedVocabulary());
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

  const register = () => screen.getByRole("region", { name: REGION });
  const caption = () => register().querySelector("caption")?.textContent ?? "";
  const cases = () =>
    within(register())
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

  /**
   * The caption states the active sort; the landmark's NAME states which register this
   * is and holds still while it does. A name is met on every landmark entry and again in
   * the rotor, so splicing a 209-character ordering rule into it made the reader hear an
   * essay to learn where they were standing (D-200).
   */
  it("keeps the caption true through several sorts while the landmark name holds still", async () => {
    const user = userEvent.setup();
    renderSimulation();
    expect(caption()).toBe(CAPTION);

    await user.click(within(register()).getByRole("button", { name: /Dimension/ }));
    expect(caption()).toBe(`${CAPTION} (re-sorted by Dimension, ascending)`);
    expect(register().getAttribute("aria-label")).toBe(REGION);

    await user.click(within(register()).getByRole("button", { name: /Under the draft/ }));
    expect(caption()).toBe(`${CAPTION} (re-sorted by Under the draft, ascending, ${SORT_NOTE})`);
    expect(register().getAttribute("aria-label")).toBe(REGION);
    expect(screen.getAllByRole("region", { name: REGION })).toHaveLength(1);
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
    expect(register()).toHaveTextContent(`Sorted by Today, ascending: ${SORT_NOTE}.`);

    // ONE note for both directions, with the direction stated beside it - a reader cannot
    // check a rule against the rows without knowing which way the sort is running.
    await user.click(within(register()).getByRole("button", { name: /^Today/ }));
    expect(register()).toHaveTextContent(`Sorted by Today, descending: ${SORT_NOTE}.`);

    // A column with no declared ordering rule claims none.
    await user.click(within(register()).getByRole("button", { name: /Dimension/ }));
    expect(register()).not.toHaveTextContent(SORT_NOTE);
    expect(caption()).toContain("re-sorted by Dimension");
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
    const authored = vm.simulationDelta.map((_, index) => String(index + 1));

    for (const label of ["#", "Dimension", "Today", "Under the draft"]) {
      const name = new RegExp(`^${label}`);
      await user.click(within(register()).getByRole("button", { name }));
      const ascending = cases();
      await user.click(within(register()).getByRole("button", { name }));
      const descending = cases();
      expect(descending, `${label} sorts identically in both directions`).not.toEqual(ascending);
      expect(descending, `${label} descending leaves the authored order`).not.toEqual(authored);
      expect([...descending].sort()).toEqual([...authored].sort());
      await user.click(screen.getByRole("button", { name: RESTORE }));
    }
  });

  /**
   * What the direction may and may not touch. The value columns mix a disposition with
   * money and counts, so they are the two that prove it on shipped data: the disposition
   * band leads in BOTH directions, exactly as the visible note says, while the amounts
   * inside the numeric band reverse. Negating the band comparison along with the values
   * sent the disposition to the BOTTOM under a note still promising it came first.
   */
  it("reverses the values inside a group without moving the groups", async () => {
    const user = userEvent.setup();
    const vm = renderSimulation();
    const disposition = String(vm.simulationDelta.findIndex((row) => row.before.badge) + 1);
    expect(disposition).not.toBe("0");

    for (const label of ["Today", "Under the draft"]) {
      const name = new RegExp(`^${label}`);
      await user.click(within(register()).getByRole("button", { name }));
      const ascending = cases();
      await user.click(within(register()).getByRole("button", { name }));
      const descending = cases();

      expect(ascending[0], `${label} ascending buries the disposition`).toBe(disposition);
      expect(descending[0], `${label} descending buries the disposition`).toBe(disposition);
      // Everything below it is the numeric band, and THAT is what the direction reverses.
      expect(descending.slice(1)).toEqual([...ascending.slice(1)].reverse());
      await user.click(screen.getByRole("button", { name: RESTORE }));
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
    expect(cases()).not.toEqual(authored);

    await user.click(within(register()).getByRole("button", { name: /#/ }));
    expect(cases()).toEqual(authored);
    expect(caption()).toContain("re-sorted by #");

    await user.click(within(register()).getByRole("button", { name: /Dimension/ }));
    await user.click(screen.getByRole("button", { name: RESTORE }));
    expect(cases()).toEqual(authored);
    expect(caption()).toBe(CAPTION);
    expect(screen.queryByRole("button", { name: /Restore recorded order/ })).not.toBeInTheDocument();
  });
});

/**
 * The other half of D-194: a register MAY be sortable, and the audit trail and the
 * decision ledger are the two that are - a compliance reader legitimately re-orders by
 * actor or action. The permission is conditional, so each condition is asserted on the
 * shipped surface rather than on a fixture: the sequence column that carries recorded
 * order is visible and sortable, the CAPTION states whatever order the rows are in right
 * now - the declared recorded order until the reader moves them, the active sort after -
 * while the LANDMARK's name identifies the register and holds still, and ONE action puts
 * the recorded order back.
 *
 * Both registers used to caption themselves "…entries, newest first" and let the landmark
 * default to that sentence, so the name a screen-reader user meets on every entry and in
 * the rotor went on promising newest-first over rows they had ordered by actor (D-201).
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
      region: "Audit log",
      caption: "Audit log entries",
      element: <AuditPage />,
      body: { verdict: { ok: true, entriesChecked: 3, reason: null }, entries: AUDIT_ENTRIES, total: 3 },
      sortBy: "Actor",
    },
    {
      name: "decision ledger",
      region: "Decision ledger",
      caption: "Decision ledger entries",
      element: <DecisionLedgerPage />,
      body: LEDGER_MODEL,
      sortBy: "Event",
    },
  ] as const;

  /** Newest first IS the sequence column descending, and each register declares it. */
  const RECORDED = ", by #, descending";

  async function openRegister(surface: (typeof SURFACES)[number]) {
    stubFetch(surface.body);
    render(surface.element);
    return screen.findByRole("region", { name: surface.region });
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
      // The recorded order is DECLARED, so the column carrying it says so from first paint.
      expect(sequence).toHaveAttribute("aria-sort", "descending");
      expect(within(sequence).getByRole("button", { name: /#/ })).toBeVisible();
      expect(sequences(register)).toEqual(["3", "2", "1"]);
    });

    /**
     * The landmark's name may not carry an order claim, because it is the one place the
     * register speaks BEFORE a reader has gone in - and it cannot be re-read after a sort.
     * So it names the register, the caption states the order, and the two are asserted
     * apart: the name is stable and free of the words the sort makes false, and the
     * caption moves from the declared recorded order to the reader's own.
     */
    it(`keeps the ${surface.name} caption true to the active sort under a stable landmark name`, async () => {
      const user = userEvent.setup();
      const register = await openRegister(surface);
      expect(register.getAttribute("aria-label")).toBe(surface.region);
      // Rendered, not declared: the name claims nothing about the order of the rows.
      expect(register.getAttribute("aria-label")).not.toMatch(/newest|first|order|sorted/i);
      expect(register.querySelector("caption")).toHaveTextContent(
        `${surface.caption} (in recorded order${RECORDED})`,
      );

      for (const direction of ["ascending", "descending"]) {
        await user.click(within(register).getByRole("button", { name: new RegExp(surface.sortBy) }));
        expect(register.querySelector("caption")).toHaveTextContent(
          `${surface.caption} (re-sorted by ${surface.sortBy}, ${direction})`,
        );
        // The name identifies the register and holds still; the caption carries the sort.
        expect(screen.getByRole("region", { name: surface.region })).toBe(register);
        expect(register.getAttribute("aria-label")).toBe(surface.region);
      }
      expect(screen.getAllByRole("region", { name: surface.region })).toHaveLength(1);
    });

    it(`restores the ${surface.name}'s recorded order in one action`, async () => {
      const user = userEvent.setup();
      const register = await openRegister(surface);
      const restoreName = `Restore recorded order: ${surface.region}`;
      expect(screen.queryByRole("button", { name: restoreName })).not.toBeInTheDocument();

      await user.click(within(register).getByRole("button", { name: new RegExp(surface.sortBy) }));
      expect(sequences(register)).not.toEqual(["3", "2", "1"]);

      // The control is INSIDE its own register's landmark, so a reader who enters the
      // landmark meets the one action that owes them the recorded order back.
      const restore = within(register).getByRole("button", { name: restoreName });
      restore.focus();
      await user.keyboard("{Enter}");

      const restored = screen.getByRole("region", { name: surface.region });
      expect(sequences(restored)).toEqual(["3", "2", "1"]);
      expect(restored.querySelector("caption")).toHaveTextContent(
        `${surface.caption} (in recorded order${RECORDED})`,
      );
      expect(screen.queryByRole("button", { name: restoreName })).not.toBeInTheDocument();
      expect(document.activeElement).not.toBe(document.body);
      expect(restored.contains(document.activeElement)).toBe(true);
    });
  }

  /**
   * Not every ledger event belongs to a decision, and those rows have nothing to order by:
   * they group at the END whichever way the sort runs, which is not what a reader expects
   * from a column that otherwise reverses. So the register says so - in the caption and,
   * for a sighted reader who cannot hear it, as visible text while that sort is active.
   */
  it("says that events with no decision id stay last, and they do, in both directions", async () => {
    const user = userEvent.setup();
    const note =
      "decision ids alphabetically, with numbers in numeric order; an event that belongs to no decision has nothing to order by, so those rows stay last in both directions";
    stubFetch({
      ...LEDGER_MODEL,
      entries: LEDGER_MODEL.entries.map((entry) =>
        entry.sequence === 3 ? { ...entry, decisionId: null } : entry,
      ),
    });
    render(<DecisionLedgerPage />);
    const register = await screen.findByRole("region", { name: "Decision ledger" });
    expect(register).not.toHaveTextContent(note);

    for (const direction of ["ascending", "descending"]) {
      await user.click(within(register).getByRole("button", { name: /^Decision$/ }));
      expect(register.querySelector("caption")).toHaveTextContent(
        `Decision ledger entries (re-sorted by Decision, ${direction}, ${note})`,
      );
      expect(register).toHaveTextContent(`Sorted by Decision, ${direction}: ${note}.`);
      expect(sequences(register).at(-1)).toBe("3");
    }
  });
});
