"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { Button, EmptyState, StatusBadge } from "./ui";

export interface TableColumn {
  readonly id: string;
  readonly header: string;
  readonly align?: "left" | "right";
  readonly sortable?: boolean;
  readonly className?: string;
}

export type TableCell =
  | {
      readonly kind?: "content";
      readonly content: ReactNode;
      readonly sortValue?: string | number | null;
      readonly className?: string;
    }
  | {
      readonly kind: "status";
      readonly status: string;
      readonly label?: string;
      readonly sortValue?: string | number | null;
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

function cellSortValue(cell: TableCell | undefined): string | number {
  if (!cell) return "";
  if (cell.sortValue !== undefined && cell.sortValue !== null) return cell.sortValue;
  if (cell.kind === "status") return cell.label ?? cell.status;
  return typeof cell.content === "string" || typeof cell.content === "number" ? cell.content : "";
}

/**
 * ONE collator for the whole tier. `localeCompare` only reaches its cached fast path
 * when it is called with no options; handing it an options object mints a fresh
 * collator per comparison, so the 5,000-row sort this register is built for paid for
 * ~60,000 of them on the main thread. Hoisting is order-preserving: the same numeric,
 * case-insensitive collation, constructed once.
 */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return COLLATOR.compare(String(left), String(right));
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

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const indexed = rows.map((row, index) => ({ row, index }));
    indexed.sort((left, right) => {
      const result = compareValues(
        cellSortValue(left.row.cells[sort.columnId]),
        cellSortValue(right.row.cells[sort.columnId]),
      );
      if (result === 0) return left.index - right.index;
      return sort.direction === "ascending" ? result : -result;
    });
    return indexed.map(({ row }) => row);
  }, [rows, sort]);

  const virtualized = !loading && sortedRows.length > virtualizeAbove;
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / rowHeight) + OVERSCAN * 2;
  const maxStart = Math.max(0, sortedRows.length - visibleCount);
  const start = virtualized
    ? Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN))
    : 0;
  const end = virtualized ? Math.min(sortedRows.length, start + visibleCount) : sortedRows.length;
  const visibleRows = loading ? [] : sortedRows.slice(start, end);
  const topSpace = virtualized ? start * rowHeight : 0;
  const bottomSpace = virtualized ? Math.max(0, (sortedRows.length - end) * rowHeight) : 0;

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
  const sortedCaption = sort && sortedColumn
    ? `${caption} (re-sorted by ${sortedColumn.header}, ${sort.direction})`
    : caption;

  const register = (
    <div
      ref={scrollRef}
      data-table-scroll=""
      tabIndex={0}
      onScroll={handleScroll}
      className={joinClasses(
        "overflow-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-slate-600",
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
      {reordered ? (
        <div className="flex justify-end print-hide">
          <Button
            type="button"
            variant="secondary"
            size="compact"
            aria-label={`Restore recorded order: ${caption}`}
            onClick={restoreRecordedOrder}
          >
            Restore recorded order
          </Button>
        </div>
      ) : null}
    </div>
  );
}
