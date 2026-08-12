"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { flushSync } from "react-dom";
import { Button, EmptyState, StatusBadge } from "./ui";
import { compareSortValues, type TableSortValue } from "./table-order";

export interface TableColumn {
  readonly id: string;
  readonly header: string;
  readonly align?: "left" | "right";
  readonly sortable?: boolean;
  /**
   * How this column orders when it is the active sort, in the reader's words - the rule
   * `compareSortValues` applies to ITS values, not a generic description of the
   * comparator. Declared wherever the ordering is not the obvious one for the value on
   * screen: a reader looking at a re-ordered column of dispositions cannot otherwise tell
   * a severity order from an alphabet, nor an amount ordered by value from one ordered as
   * text. Carried in the caption and the landmark label, and shown as visible text beside
   * the restore control for as long as that sort is active.
   *
   * ONE note, true in both directions - the direction is stated alongside it rather than
   * written into it. `compareSortValues` reverses only the values inside a kind, never the
   * order the kinds are laid out in and never the blanks at the end, so a note that names
   * that layout holds whichever way the sort is running.
   */
  readonly sortNote?: string;
  readonly className?: string;
}

export type TableCell =
  | {
      readonly kind?: "content";
      readonly content: ReactNode;
      readonly sortValue?: TableSortValue;
      readonly className?: string;
    }
  | {
      readonly kind: "status";
      readonly status: string;
      readonly label?: string;
      readonly sortValue?: TableSortValue;
      readonly className?: string;
    };

export interface TableRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, TableCell>>;
  readonly className?: string;
}

interface SortState {
  readonly columnId: string;
  readonly direction: "ascending" | "descending";
}

export interface TableEmptyState {
  readonly title: string;
  readonly description: string;
  /** Omitted when the state has no honest next step; an invented one is a false affordance. */
  readonly action?: ReactNode;
}

export interface TableProps {
  readonly caption: string;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly loading?: boolean;
  readonly emptyState?: TableEmptyState;
  readonly initialSort?: SortState;
  readonly virtualizeAbove?: number;
  readonly className?: string;
}

/**
 * The virtual window is derived from MEASURED row heights, not from a fixed guess.
 * Registers stack content in a cell (the ledger's event cell carries a type, a
 * timestamp, and a provenance badge), so an assumed height makes the scroll extent
 * disagree with the rendered body: scrolling to the end of a taller register lands a
 * window start past the last row and the body renders blank. The estimate below only
 * seeds the first paint; every index is additionally clamped to the row count, so an
 * un-measured or mid-convergence height can never produce an empty window.
 */
const ESTIMATED_ROW_HEIGHT = 40;
const MIN_ROW_HEIGHT = 16;
const HEIGHT_TOLERANCE = 2;
const VIEWPORT_HEIGHT = 384;
const OVERSCAN = 6;

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function cellSortValue(cell: TableCell | undefined): TableSortValue {
  if (!cell) return null;
  if (cell.sortValue !== undefined && cell.sortValue !== null) return cell.sortValue;
  if (cell.kind === "status") return cell.label ?? cell.status;
  return typeof cell.content === "string" || typeof cell.content === "number" ? cell.content : null;
}

function TableCellContent({ cell }: { cell: TableCell | undefined }) {
  if (!cell) return null;
  return cell.kind === "status" ? <StatusBadge status={cell.status} label={cell.label} /> : cell.content;
}

export function Table({
  caption,
  columns,
  rows,
  loading = false,
  emptyState,
  initialSort,
  virtualizeAbove = 100,
  className,
}: TableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const headerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT);
  const [printing, setPrinting] = useState(false);

  /**
   * The window index and the element's scroll offset must agree, and the scroll handler
   * alone cannot keep them agreeing: it is gated on windowing being ON, so every scroll
   * that happens while windowing is suspended is refused and React keeps whatever offset
   * it held before. Suspending windowing drops the height cap, the box stops overflowing,
   * and the browser clamps the offset to 0; restoring the cap lets the browser put an
   * offset back. Resuming a window from an offset the element no longer has places the
   * rendered slice hundreds of pixels away from the visible band and the register reads as
   * blank. Whatever the element settles on IS the offset; the only thing owed is that state
   * agrees with it.
   */
  function reconcileScrollOffset() {
    const box = scrollRef.current;
    setScrollTop(box ? box.scrollTop : 0);
  }

  /**
   * A windowed register holds only its current window in the DOM behind a capped
   * scroll box, so printing one emits a cropped box with blank spacer bands where the
   * rest of the record should be - and both compliance registers exceed the threshold
   * in ordinary use. No stylesheet can fix that: the missing rows do not exist. So
   * windowing is SUSPENDED for the print pass, which drops the height cap and the
   * spacers with it and prints the complete sorted register.
   *
   * The commit is synchronous because `window.print()` blocks the main thread: a
   * batched update would land after the page had already been captured, and so would the
   * passive effect below. This runs the SAME reconciliation, only forced into the same
   * synchronous commit - it closes over nothing but a ref and a setter, both stable. What
   * drives it is the TRANSITION into print media, which is what both `window.print()` and a
   * print preview perform; the `print:` height-cap escape below is the backstop for a
   * context that was already printing before this mounted.
   */
  useEffect(() => {
    const apply = (next: boolean) => {
      flushSync(() => setPrinting(next));
      flushSync(reconcileScrollOffset);
    };
    const onBeforePrint = () => apply(true);
    const onAfterPrint = () => apply(false);
    const onMediaChange = (event: MediaQueryListEvent) => apply(event.matches);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    const query = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    query?.addEventListener("change", onMediaChange);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      query?.removeEventListener("change", onMediaChange);
    };
  }, []);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const indexed = rows.map((row, index) => ({ row, index }));
    indexed.sort((left, right) => {
      const result = compareSortValues(
        cellSortValue(left.row.cells[sort.columnId]),
        cellSortValue(right.row.cells[sort.columnId]),
        sort.direction,
      );
      return result === 0 ? left.index - right.index : result;
    });
    return indexed.map(({ row }) => row);
  }, [rows, sort]);

  const virtualized = !loading && !printing && sortedRows.length > virtualizeAbove;
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / rowHeight) + OVERSCAN * 2;
  const maxStart = Math.max(0, sortedRows.length - visibleCount);
  const start = virtualized
    ? Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN))
    : 0;
  const end = virtualized ? Math.min(sortedRows.length, start + visibleCount) : sortedRows.length;
  const visibleRows = loading ? [] : sortedRows.slice(start, end);
  const topSpace = virtualized ? start * rowHeight : 0;
  const bottomSpace = virtualized ? Math.max(0, (sortedRows.length - end) * rowHeight) : 0;

  /**
   * Reconciliation is keyed on WINDOWING ITSELF, in either direction and whatever moved
   * it - the print pass above, a row count crossing the threshold, a refetch flipping
   * `loading`, a caller changing `virtualizeAbove`. Keying it on the print pass alone left
   * every other transition holding an offset the element no longer had.
   */
  useEffect(() => {
    reconcileScrollOffset();
  }, [virtualized]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!virtualized || !body || sortedRows.length === 0) return;
    const heights = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr[data-table-row]"))
      .map((element) => element.offsetHeight)
      .filter((height) => height > 0);
    if (heights.length === 0) return;
    const measured = Math.max(
      MIN_ROW_HEIGHT,
      Math.round(heights.reduce((total, height) => total + height, 0) / heights.length),
    );
    setRowHeight((current) => (Math.abs(current - measured) >= HEIGHT_TOLERANCE ? measured : current));
  }, [virtualized, sortedRows]);

  function rewind() {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }

  function changeSort(columnId: string) {
    setSort((current) => ({
      columnId,
      direction: current?.columnId === columnId && current.direction === "ascending" ? "descending" : "ascending",
    }));
    rewind();
  }

  /**
   * Sortability is only honest on a register whose recorded order the viewer can get
   * BACK, and getting it back may not be a puzzle of repeat header clicks: from any
   * sorted state this is the single action that returns the rows exactly as the caller
   * supplied them (D-194).
   *
   * The control REMOVES ITSELF by succeeding, so focus is placed before the state
   * change lands: a keyboard user who activates it would otherwise be dropped on
   * <body> and lose their place entirely. Focus goes to the header of the restored
   * recorded order where the caller declared one, else to the header whose sort was
   * just undone, else to the register itself - each of which outlives the control.
   */
  function restoreRecordedOrder() {
    const recordedColumn = initialSort?.columnId ?? sort?.columnId;
    const header = recordedColumn ? headerRefs.current.get(recordedColumn) : undefined;
    (header ?? scrollRef.current)?.focus();
    setSort(initialSort ?? null);
    rewind();
  }

  const reordered = sort?.columnId !== initialSort?.columnId || sort?.direction !== initialSort?.direction;

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (virtualized) setScrollTop(event.currentTarget.scrollTop);
  }

  const sortedColumn = sort ? columns.find((column) => column.id === sort.columnId) : undefined;
  const activeSortNote = sortedColumn?.sortNote;
  const sortedCaption = sort && sortedColumn
    ? `${caption} (re-sorted by ${sortedColumn.header}, ${sort.direction}${activeSortNote ? `, ${activeSortNote}` : ""})`
    : caption;
  /**
   * The same words as the caption, and the DIRECTION with them: a note is one rule, not an
   * ascending rule and a descending one, but a reader cannot check a rule against the rows
   * without knowing which way the sort is running.
   */
  const sortDisclosure = sort && sortedColumn && activeSortNote
    ? `Sorted by ${sortedColumn.header}, ${sort.direction}: ${activeSortNote}.`
    : null;

  const register = (
    <div
      ref={scrollRef}
      data-table-scroll=""
      tabIndex={0}
      onScroll={handleScroll}
      className={joinClasses(
        "overflow-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-slate-600",
        "print:max-h-none print:overflow-visible",
        virtualized && "max-h-96",
        className,
      )}
    >
      <table className="w-full text-left text-sm" aria-rowcount={rows.length + 1}>
        <caption className="sr-only">{sortedCaption}</caption>
        <thead className="sticky top-0 z-10 bg-surface text-xs uppercase tracking-wide text-slate-600">
          <tr aria-rowindex={1}>
            {columns.map((column) => {
              const activeSort = sort?.columnId === column.id ? sort.direction : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={column.sortable ? activeSort ?? "none" : undefined}
                  className={joinClasses(
                    "px-3 py-2",
                    column.align === "right" && "text-right",
                    column.className,
                  )}
                >
                  {column.sortable ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="table"
                        ref={(node) => {
                          if (node) headerRefs.current.set(column.id, node);
                          else headerRefs.current.delete(column.id);
                        }}
                        onClick={() => changeSort(column.id)}
                        className={joinClasses("w-full", column.align === "right" ? "justify-end" : "justify-start")}
                      >
                        {column.header}
                        <span aria-hidden>{activeSort === "ascending" ? "↑" : activeSort === "descending" ? "↓" : "↕"}</span>
                      </Button>
                      {/* Controls are hidden in print (globals.css §print), so the sortable
                          label needs a printed twin or the register prints headerless. */}
                      <span aria-hidden className="hidden print:block">{column.header}</span>
                    </>
                  ) : column.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={bodyRef} className="divide-y divide-slate-100">
          {loading ? (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-slate-600"><span role="status">Loading…</span></td></tr>
          ) : null}
          {!loading && sortedRows.length === 0 && emptyState ? (
            <tr>
              <td colSpan={columns.length} className="p-3">
                <EmptyState title={emptyState.title} description={emptyState.description} action={emptyState.action} />
              </td>
            </tr>
          ) : null}
          {!loading && sortedRows.length === 0 && !emptyState ? (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-slate-600">No rows to show.</td></tr>
          ) : null}
          {topSpace > 0 ? (
            <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: topSpace }} className="p-0" /></tr>
          ) : null}
          {visibleRows.map((row, index) => (
            <tr
              key={row.id}
              data-table-row=""
              aria-rowindex={start + index + 2}
              className={joinClasses("print-avoid-break", row.className)}
            >
              {columns.map((column) => {
                const cell = row.cells[column.id];
                return (
                  <td
                    key={column.id}
                    className={joinClasses(
                      "px-3 py-2 align-top text-slate-700",
                      column.align === "right" && "text-right tabular-nums",
                      cell?.className,
                    )}
                  >
                    <TableCellContent cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
          {bottomSpace > 0 ? (
            <tr aria-hidden="true"><td colSpan={columns.length} style={{ height: bottomSpace }} className="p-0" /></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );

  /**
   * The restore control lives INSIDE the landmark and AFTER the register. Inside,
   * because a reader who navigates by landmark into the register must meet the control
   * that owes them their recorded order back; after, because a control that appears
   * above the table pushes the header the viewer just clicked out from under their
   * pointer. Its accessible name carries the caption, so two registers on one page name
   * different controls (the visible text is the name's prefix - WCAG 2.5.3).
   *
   * The active column's `sortNote` shares that row as VISIBLE text. The caption carries
   * it too, but the caption is sr-only: a sighted reader looking at dispositions ordered
   * "Proceed, Blocked, Prohibited" has no way to tell a severity order from an alphabet
   * unless the register says which one it applied. It sits here rather than under the
   * header so a column's width cannot wrap a sentence, and it prints with the register.
   */
  return (
    <div
      role="region"
      aria-label={sortedCaption}
      aria-busy={loading || undefined}
      data-row-count={rows.length}
      data-rendered-row-count={visibleRows.length}
      className="flex flex-col gap-2"
    >
      {register}
      {reordered || sortDisclosure ? (
        <div className="flex flex-wrap items-center gap-2">
          {sortDisclosure ? <p className="text-xs text-slate-600">{sortDisclosure}</p> : null}
          {reordered ? (
            <Button
              type="button"
              variant="secondary"
              size="compact"
              className="ml-auto print-hide"
              aria-label={`Restore recorded order: ${caption}`}
              onClick={restoreRecordedOrder}
            >
              Restore recorded order
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
