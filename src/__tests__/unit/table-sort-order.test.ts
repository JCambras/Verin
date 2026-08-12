import { describe, expect, it } from "vitest";
import { compareSortValues, type TableSortValue } from "@app/presentation/table-order";

/**
 * The canonical register's ONE ordering (D-198). A column may mix kinds - a disposition
 * beside an amount beside a phrase - so the comparator needs a total order it can state
 * out loud, or the caption announces a rule the rows do not follow. That is not a
 * hypothetical: the simulation delta's value columns once sorted a money-formatted string
 * through a numeric-aware collator under a note promising alphabetical order, which puts
 * `$1,234.00` below `$980.00`.
 *
 * The bands, in order: a domain lattice, then numbers, then text, then booleans - and
 * blanks last in BOTH directions, because a missing value is not a small one.
 */
describe("the canonical register ordering", () => {
  const ascending = (values: readonly TableSortValue[]) =>
    [...values].sort((left, right) => compareSortValues(left, right, "ascending"));
  const descending = (values: readonly TableSortValue[]) =>
    [...values].sort((left, right) => compareSortValues(left, right, "descending"));

  it("orders the bands: ranked, then numbers, then text, then booleans", () => {
    const mixed: readonly TableSortValue[] = ["text", true, 7, { rank: 2 }, false, "9"];
    expect(ascending(mixed)).toEqual([{ rank: 2 }, 7, "9", "text", false, true]);
    expect(descending(mixed)).toEqual([true, false, "text", "9", 7, { rank: 2 }]);
  });

  it("ranks a domain lattice by its rank, never by the label beside it", () => {
    const dispositions = [{ rank: 3 }, { rank: 1 }, { rank: 2 }];
    expect(ascending(dispositions)).toEqual([{ rank: 1 }, { rank: 2 }, { rank: 3 }]);
    expect(descending(dispositions)).toEqual([{ rank: 3 }, { rank: 2 }, { rank: 1 }]);
  });

  it("compares numbers as numbers, including negatives and fractions", () => {
    expect(ascending([1234, 980, -5, 0, 0.5])).toEqual([-5, 0, 0.5, 980, 1234]);
    expect(descending([1234, 980, -5, 0, 0.5])).toEqual([1234, 980, 0.5, 0, -5]);
  });

  it("compares text case-insensitively and numerically, so item 2 precedes item 10", () => {
    expect(ascending(["item 10", "Item 2", "item 1"])).toEqual(["item 1", "Item 2", "item 10"]);
    expect(compareSortValues("ITEM 2", "item 2", "ascending")).toBe(0);
    expect(compareSortValues("item 2", "item 10", "descending")).toBeGreaterThan(0);
  });

  it("orders booleans false before true", () => {
    expect(ascending([true, false, true])).toEqual([false, true, true]);
    expect(descending([false, true, false])).toEqual([true, false, false]);
  });

  /**
   * The asymmetric rule, and the reason the comparator takes a direction rather than
   * having its result negated by the caller: flipping the sort to bring the blanks to the
   * top buries the rows the reader asked to see under the ones with nothing to show.
   */
  it("groups absent, null and empty values at the end in both directions", () => {
    const withBlanks: readonly TableSortValue[] = ["b", null, 2, "", { rank: 1 }, "   ", "a"];
    expect(ascending(withBlanks)).toEqual([{ rank: 1 }, 2, "a", "b", null, "", "   "]);
    expect(descending(withBlanks)).toEqual(["b", "a", 2, { rank: 1 }, null, "", "   "]);

    for (const direction of ["ascending", "descending"] as const) {
      for (const blank of [null, undefined, "", "  "]) {
        expect(compareSortValues(blank, "a", direction), `${String(blank)} before a`).toBe(1);
        expect(compareSortValues("a", blank, direction), `a after ${String(blank)}`).toBe(-1);
        expect(compareSortValues(blank, blank, direction)).toBe(0);
      }
    }
    // A blank and a zero are different things: zero is a value and stays in its band.
    expect(compareSortValues(0, null, "ascending")).toBe(-1);
    expect(compareSortValues(0, false, "ascending")).toBeLessThan(0);
  });

  it("is stable on ties, so equal rows keep the order the caller recorded", () => {
    for (const direction of ["ascending", "descending"] as const) {
      expect(compareSortValues("same", "SAME", direction)).toBe(0);
      expect(compareSortValues(4, 4, direction)).toBe(0);
      expect(compareSortValues({ rank: 2 }, { rank: 2 }, direction)).toBe(0);
    }
  });
});
