// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Table, type TableColumn, type TableRow } from "@app/presentation/table";

/**
 * The print pass and the virtual window have to agree about where the register is
 * scrolled to (D-198). The print pass lifts the height cap, so the box stops
 * overflowing and the browser clamps its `scrollTop`; the scroll handler is gated on
 * windowing being ON and refuses every scroll the pass causes, so React keeps the offset
 * it held before. Resuming from that stale offset puts the rendered slice hundreds of
 * pixels below a box that is scrolled to the top, and the register reads as BLANK.
 *
 * In a real browser this self-heals whenever the clamp's scroll event happens to land
 * after the transition, or whenever the browser hands the position back on the way out -
 * which is exactly why it is asserted here instead. jsdom performs no layout, so the
 * offset is whatever the test sets and the row height is the seeded estimate: the
 * disagreement is FORCED rather than hoped for, and the window index is arithmetic.
 */
const ROW_HEIGHT = 40;
const OVERSCAN = 6;
const ROWS = 200;
const DEEP_OFFSET = 4000;

const COLUMNS: readonly TableColumn[] = [{ id: "sequence", header: "#" }];
const rows: readonly TableRow[] = Array.from({ length: ROWS }, (_, index) => ({
  id: String(index),
  cells: { sequence: { content: index } },
}));

describe("a windowed register across a print pass", () => {
  function renderRegister() {
    const view = render(<Table caption="Register" layout="scroll-region" columns={COLUMNS} rows={rows} />);
    const box = view.container.querySelector<HTMLDivElement>("[data-table-scroll]")!;
    const firstRenderedIndex = () =>
      Number(view.container.querySelector("tr[data-table-row]")!.getAttribute("aria-rowindex")) - 2;
    const renderedCount = () => view.container.querySelectorAll("tr[data-table-row]").length;
    const scrollTo = (offset: number) =>
      act(() => {
        box.scrollTop = offset;
        box.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
    const print = (printing: boolean) =>
      act(() => {
        // The browser pins an uncapped, non-overflowing box at the top.
        if (printing) box.scrollTop = 0;
        window.dispatchEvent(new Event(printing ? "beforeprint" : "afterprint"));
      });
    return { box, firstRenderedIndex, renderedCount, scrollTo, print };
  }

  it("renders the whole register while printing and only its window otherwise", () => {
    const register = renderRegister();
    expect(register.renderedCount()).toBeLessThan(ROWS);
    register.print(true);
    expect(register.renderedCount()).toBe(ROWS);
    register.print(false);
    expect(register.renderedCount()).toBeLessThan(ROWS);
  });

  it("resumes the window at the offset the element actually has, not the one it had", () => {
    const register = renderRegister();
    register.scrollTo(DEEP_OFFSET);
    expect(register.firstRenderedIndex()).toBe(Math.floor(DEEP_OFFSET / ROW_HEIGHT) - OVERSCAN);

    register.print(true);
    register.print(false);

    // The element is at the top, so the window is at the top. Holding the pre-print
    // offset here is the blank register: a slice 94 rows down, over a box showing row 0.
    expect(register.box.scrollTop).toBe(0);
    expect(register.firstRenderedIndex()).toBe(0);
  });

  it("keeps the reader's place when the element keeps it, so the fix is not a rewind", () => {
    const register = renderRegister();
    register.scrollTo(DEEP_OFFSET);

    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });

    expect(register.box.scrollTop).toBe(DEEP_OFFSET);
    expect(register.firstRenderedIndex()).toBe(Math.floor(DEEP_OFFSET / ROW_HEIGHT) - OVERSCAN);
  });
});

/**
 * Printing is not the only way out of windowing, and the disagreement it caused was never
 * about printing: the scroll handler is gated on windowing being ON, so ANY suspension
 * leaves React holding an offset the element is free to move without it. A row count
 * falling to the threshold, a refetch flipping `loading`, a caller widening
 * `virtualizeAbove` - through each of those the reader, a resize, or a zoom can put the
 * box somewhere else, and resuming from the held offset puts the rendered slice below a
 * box scrolled elsewhere. So the reconciliation is keyed on the WINDOWING TRANSITION
 * rather than on the print pass that first exposed it.
 */
describe("a register that leaves and re-enters windowing", () => {
  const HELD_OFFSET = 4000;
  const WINDOWED = { virtualizeAbove: 100 } as const;

  /** Every way windowing can be suspended, and the prop change that resumes it. */
  const SUSPENSIONS = [
    { name: "the row count falls to the threshold", suspended: { virtualizeAbove: ROWS } },
    { name: "a refetch flips loading", suspended: { ...WINDOWED, loading: true } },
  ] as const;

  for (const suspension of SUSPENSIONS) {
    it(`resumes at the element's offset when ${suspension.name}`, () => {
      const view = render(<Table caption="Register" layout="scroll-region" columns={COLUMNS} rows={rows} {...WINDOWED} />);
      const box = view.container.querySelector<HTMLDivElement>("[data-table-scroll]")!;
      const firstRenderedIndex = () =>
        Number(view.container.querySelector("tr[data-table-row]")!.getAttribute("aria-rowindex")) - 2;

      act(() => {
        box.scrollTop = HELD_OFFSET;
        box.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      expect(firstRenderedIndex()).toBe(Math.floor(HELD_OFFSET / ROW_HEIGHT) - OVERSCAN);

      view.rerender(<Table caption="Register" layout="scroll-region" columns={COLUMNS} rows={rows} {...suspension.suspended} />);
      // The element moves while the handler is refusing scrolls - here, all the way back.
      act(() => {
        box.scrollTop = 0;
      });
      view.rerender(<Table caption="Register" layout="scroll-region" columns={COLUMNS} rows={rows} {...WINDOWED} />);

      expect(box.scrollTop).toBe(0);
      expect(firstRenderedIndex()).toBe(0);
    });
  }

  it("keeps the reader's place across a suspension the element survives", () => {
    const view = render(<Table caption="Register" layout="scroll-region" columns={COLUMNS} rows={rows} {...WINDOWED} />);
    const box = view.container.querySelector<HTMLDivElement>("[data-table-scroll]")!;
    act(() => {
      box.scrollTop = HELD_OFFSET;
      box.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    view.rerender(<Table caption="Register" layout="scroll-region" columns={COLUMNS} rows={rows} {...WINDOWED} loading />);
    view.rerender(<Table caption="Register" layout="scroll-region" columns={COLUMNS} rows={rows} {...WINDOWED} />);

    expect(box.scrollTop).toBe(HELD_OFFSET);
    const first = Number(view.container.querySelector("tr[data-table-row]")!.getAttribute("aria-rowindex")) - 2;
    expect(first).toBe(Math.floor(HELD_OFFSET / ROW_HEIGHT) - OVERSCAN);
  });
});
