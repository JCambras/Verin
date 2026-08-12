/**
 * The canonical register's ONE ordering (D-198). Pure, no React, no DOM: a column may
 * mix a disposition with an amount with a phrase, so the comparator needs a total order
 * it can state out loud - and the register does state it, in the caption, the landmark
 * label and visible text. An ordering the caption cannot name is one the reader will
 * misread, and an ordering the caption names WRONGLY is the same false claim as a sort
 * that never happened.
 */

/**
 * A value ordered by a DOMAIN lattice rather than by its own bytes - a disposition
 * ranked proceed before blocked before prohibited, say. It is its own band precisely so
 * it cannot compare incidentally as a string: the labels of a lattice almost never
 * alphabetize into the order the domain means, and a reader would take the alphabet for
 * the claim.
 */
export interface RankedSortValue {
  readonly rank: number;
}

/**
 * What a cell offers the comparator. RAW typed data, never the formatted text or the
 * element on screen: `$1,234.00` sorts below `$980.00` as text, whichever collator reads
 * it, and an element has no scalar at all - which is how a column came to advertise a
 * sort that could not move a row.
 */
export type TableSortValue = string | number | boolean | RankedSortValue | null | undefined;

type PresentSortValue = string | number | boolean | RankedSortValue;

/**
 * ONE collator for the whole tier. `localeCompare` only reaches its cached fast path
 * when it is called with no options; handing it an options object mints a fresh
 * collator per comparison, so the 5,000-row sort this register is built for paid for
 * ~60,000 of them on the main thread. Hoisting is order-preserving: the same numeric,
 * case-insensitive collation, constructed once. Numeric awareness is what puts "item 2"
 * before "item 10".
 */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The bands, in the order they sort: a domain lattice, then numbers, then text, then
 * booleans. A column that mixes kinds gets ONE total order out of them rather than
 * whatever coercing everything to a string happens to produce, and every band is
 * explicit - a disposition never falls into the text band and orders by its label.
 *
 * The band order is SCAFFOLDING, not subject matter: it is how unlike kinds are laid
 * beside each other, and the reader never asked for it. So it is fixed, and reversing
 * the sort does not reverse it.
 */
function sortBand(value: PresentSortValue): number {
  if (typeof value === "object") return 0;
  if (typeof value === "number") return 1;
  return typeof value === "string" ? 2 : 3;
}

/**
 * Nothing to order by. Never a `""` standing in for one - that ties every row silently -
 * and never a `NaN`, which is the absence of a number wearing a number's type: left in
 * the numeric band it makes every comparison against it return `NaN`, which `sort` reads
 * as non-negative, so the rows land in an implementation-defined order under a caption
 * announcing the one that was asked for.
 */
function presentSortValue(value: TableSortValue): PresentSortValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value === "object") return Number.isNaN(value.rank) ? null : value;
  return typeof value === "string" && value.trim() === "" ? null : value;
}

/** Never `left - right`: `Infinity - Infinity` is the same `NaN` comparator poison. */
function compareScalars(left: number, right: number): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function compareWithinBand(left: PresentSortValue, right: PresentSortValue): number {
  if (typeof left === "object" && typeof right === "object") return compareScalars(left.rank, right.rank);
  if (typeof left === "number" && typeof right === "number") return compareScalars(left, right);
  if (typeof left === "boolean" && typeof right === "boolean") return compareScalars(Number(left), Number(right));
  return COLLATOR.compare(String(left), String(right));
}

/**
 * The tier's one ordering, direction included - because the direction applies to the
 * SUBJECT of the sort and to nothing else, which cannot be expressed by negating an
 * ascending result.
 *
 * The subject is the values within a kind: dispositions reverse against their lattice,
 * numbers against their value, text against the collation, booleans against false-then-
 * true. Everything else is scaffolding and holds still. The BAND ORDER holds still,
 * because a reader who flips the direction asked for the amounts largest-first, not for
 * the dispositions to move from the top of the register to the bottom of it - and a
 * register that stated the band order out loud would be lying in one of the two
 * directions. Absent, null, empty and NaN values hold still at the END, because a blank
 * is not a value that is smaller than the others, it is the absence of one, and floating
 * the blanks to the top buries the rows the reader asked to see.
 *
 * Ties return exactly zero, so the caller's recorded order survives every sort and stays
 * one action from being restored (D-194). The result is never `NaN`.
 */
export function compareSortValues(
  left: TableSortValue,
  right: TableSortValue,
  direction: "ascending" | "descending",
): number {
  const leftValue = presentSortValue(left);
  const rightValue = presentSortValue(right);
  if (leftValue === null || rightValue === null) {
    if (leftValue === rightValue) return 0;
    return leftValue === null ? 1 : -1;
  }
  const bands = compareScalars(sortBand(leftValue), sortBand(rightValue));
  if (bands !== 0) return bands;
  const within = compareWithinBand(leftValue, rightValue);
  if (within === 0) return 0;
  return direction === "ascending" ? within : -within;
}
