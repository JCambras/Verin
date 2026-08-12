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
 * The bands, in order: a domain lattice, then numbers, then text, then booleans - the
 * same order in BOTH directions, because the band layout is scaffolding the reader never
 * asked for. Blanks are scaffolding too, and hold at the end. What the direction reverses
 * is the SUBJECT: the values inside a kind.
 */
describe("the canonical register ordering", () => {
  const ascending = (values: readonly TableSortValue[]) =>
    [...values].sort((left, right) => compareSortValues(left, right, "ascending"));
  const descending = (values: readonly TableSortValue[]) =>
    [...values].sort((left, right) => compareSortValues(left, right, "descending"));
  const band = (value: TableSortValue) =>
    value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))
      ? "blank"
      : typeof value === "object"
        ? "ranked"
        : typeof value === "string"
          ? value.trim() === ""
            ? "blank"
            : "text"
          : typeof value;

  /**
   * The defect this replaces: the band comparison was negated along with the values, so a
   * descending sort moved the dispositions from the top of the register to the bottom -
   * under a visible note telling the reader dispositions come first. A reader who flips
   * the direction asked for the amounts largest-first, not for the kinds to change places.
   */
  it("lays the bands out identically in both directions: ranked, numbers, text, booleans", () => {
    const mixed: readonly TableSortValue[] = ["text", true, 7, { rank: 2 }, false, "9"];
    expect(ascending(mixed)).toEqual([{ rank: 2 }, 7, "9", "text", false, true]);
    expect(descending(mixed)).toEqual([{ rank: 2 }, 7, "text", "9", true, false]);

    const layout = ["ranked", "number", "text", "text", "boolean", "boolean"];
    expect(ascending(mixed).map(band)).toEqual(layout);
    expect(descending(mixed).map(band)).toEqual(layout);
  });

  it("reverses only the values inside a band, never the bands and never the blanks", () => {
    const mixed: readonly TableSortValue[] = [{ rank: 1 }, { rank: 3 }, 2, 9, "a", "b", null];
    expect(ascending(mixed)).toEqual([{ rank: 1 }, { rank: 3 }, 2, 9, "a", "b", null]);
    expect(descending(mixed)).toEqual([{ rank: 3 }, { rank: 1 }, 9, 2, "b", "a", null]);

    // Cross-band and present-versus-absent comparisons are identical in both directions.
    for (const [left, right] of [[{ rank: 1 }, 5], [5, "a"], ["a", true], [{ rank: 1 }, true], ["a", null]] as const) {
      expect(compareSortValues(left, right, "ascending")).toBe(compareSortValues(left, right, "descending"));
    }
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
   * The scaffolding rule, and the reason the comparator takes a direction rather than
   * having its result negated by the caller: flipping the sort to bring the blanks to the
   * top buries the rows the reader asked to see under the ones with nothing to show.
   *
   * A `NaN` is an absence wearing a number's type. Left in the numeric band it makes every
   * comparison against it return `NaN`, which `Array.prototype.sort` reads as non-negative,
   * so the rows land in an implementation-defined order under a caption announcing the one
   * the reader asked for - the same false claim by a quieter route.
   */
  it("groups absent, null, empty and NaN values at the end in both directions", () => {
    const withBlanks: readonly TableSortValue[] = ["b", null, 2, "", { rank: 1 }, "   ", "a", Number.NaN];
    expect(ascending(withBlanks)).toEqual([{ rank: 1 }, 2, "a", "b", null, "", "   ", Number.NaN]);
    expect(descending(withBlanks)).toEqual([{ rank: 1 }, 2, "b", "a", null, "", "   ", Number.NaN]);

    for (const direction of ["ascending", "descending"] as const) {
      for (const blank of [null, undefined, "", "  ", Number.NaN, { rank: Number.NaN }]) {
        expect(compareSortValues(blank, "a", direction), `${String(blank)} before a`).toBe(1);
        expect(compareSortValues("a", blank, direction), `a after ${String(blank)}`).toBe(-1);
        expect(compareSortValues(blank, blank, direction)).toBe(0);
        expect(compareSortValues(blank, 7, direction)).toBe(1);
        expect(compareSortValues(blank, { rank: 1 }, direction)).toBe(1);
      }
    }
    // A blank and a zero are different things: zero is a value and stays in its band.
    for (const direction of ["ascending", "descending"] as const) {
      expect(compareSortValues(0, null, direction)).toBe(-1);
      expect(compareSortValues(0, false, direction)).toBeLessThan(0);
    }
  });

  /** A comparator that returns NaN orders nothing, whatever the caption says. */
  it("never returns NaN, for any pair of values in any direction", () => {
    const everything: readonly TableSortValue[] = [
      { rank: 1 }, { rank: Number.NaN }, { rank: Number.POSITIVE_INFINITY }, { rank: Number.NEGATIVE_INFINITY },
      0, -1, 3.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      "", "  ", "a", "10", true, false, null, undefined,
    ];
    for (const left of everything) {
      for (const right of everything) {
        for (const direction of ["ascending", "descending"] as const) {
          const result = compareSortValues(left, right, direction);
          expect(Number.isNaN(result), `${String(left)} vs ${String(right)} ${direction}`).toBe(false);
          // Total: whatever one comparison says, the mirror says the opposite.
          expect(Math.sign(result) + Math.sign(compareSortValues(right, left, direction))).toBe(0);
        }
      }
    }
  });

  it("is stable on ties, so equal rows keep the order the caller recorded", () => {
    for (const direction of ["ascending", "descending"] as const) {
      expect(compareSortValues("same", "SAME", direction)).toBe(0);
      expect(compareSortValues(4, 4, direction)).toBe(0);
      expect(compareSortValues({ rank: 2 }, { rank: 2 }, direction)).toBe(0);
    }
  });
});
