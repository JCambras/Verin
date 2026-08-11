"use client";

import { useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
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
  readonly action: ReactNode;
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

const ROW_HEIGHT = 40;
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

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
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
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [scrollTop, setScrollTop] = useState(0);

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
  const start = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const end = virtualized ? Math.min(sortedRows.length, start + visibleCount) : sortedRows.length;
  const visibleRows = loading ? [] : sortedRows.slice(start, end);
  const topSpace = start * ROW_HEIGHT;
  const bottomSpace = Math.max(0, (sortedRows.length - end) * ROW_HEIGHT);

  function changeSort(columnId: string) {
    setSort((current) => ({
      columnId,
      direction: current?.columnId === columnId && current.direction === "ascending" ? "descending" : "ascending",
    }));
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (virtualized) setScrollTop(event.currentTarget.scrollTop);
  }

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={caption}
      aria-busy={loading || undefined}
      tabIndex={0}
      onScroll={handleScroll}
      data-row-count={rows.length}
      data-rendered-row-count={visibleRows.length}
      className={joinClasses(
        "overflow-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-slate-600",
        virtualized && "max-h-96",
        className,
      )}
    >
      <table className="w-full text-left text-sm" aria-rowcount={rows.length + 1}>
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface text-xs uppercase tracking-wide text-slate-600">
          <tr>
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="table"
                      onClick={() => changeSort(column.id)}
                      className={joinClasses("w-full", column.align === "right" ? "justify-end" : "justify-start")}
                    >
                      {column.header}
                      <span aria-hidden>{activeSort === "ascending" ? "↑" : activeSort === "descending" ? "↓" : "↕"}</span>
                    </Button>
                  ) : column.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
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
}
