"use client";

/**
 * THE HOUSEHOLD DIRECTORY SURFACE (ADR-0057).
 *
 * A hundred named households with computed health, searchable and windowed.
 * The component renders the view model and decides nothing: every label,
 * statement, and number arrives built, and search is a substring test against
 * the `searchText` the builder composed - so what is searchable is a decision
 * recorded once in the view model, not a guess repeated in a component.
 *
 * Four households are called Smith. That is the point of the surname line under
 * each name: a directory that makes "Smith" look like one household is a
 * directory that will eventually route work to the wrong one.
 */
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Field, TextInput, StatusBadge, EmptyState } from "@app/presentation/ui";
import { Metric } from "@app/presentation/metric";
import type { DirectoryVM, HouseholdRowVM } from "./model";
import { VirtualList } from "./virtual-list";

// The window has to know how tall a row is before it renders one, so the height
// is a number rather than a class - and ONE number cannot serve both layouts.
// Above `sm` the row is two columns and 108px holds it; below, the same content
// stacks (a name whose badges wrap, meta, counts, and a balance carrying its
// provenance label and its demonstration watermark) and 108px overlapped the
// next row's title. Measured against the widest row the world produces.
const TWO_COLUMN_ROW = 108;
const STACKED_ROW = 148;
const VIEWPORT_HEIGHT = 648;

// Tailwind's `sm`, the breakpoint the row's own classes switch on: the two must
// agree, or the height is reserved for a layout that is not on screen.
const TWO_COLUMN_QUERY = "(min-width: 40rem)";

/** Which layout the row is actually in. `useSyncExternalStore` rather than an
 * effect so the first paint is already correct and no row is measured against a
 * height it never had. */
function useRowHeight(): number {
  const twoColumn = useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(TWO_COLUMN_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(TWO_COLUMN_QUERY).matches,
    () => true,
  );
  return twoColumn ? TWO_COLUMN_ROW : STACKED_ROW;
}

const BAND_STATUS: Record<string, string> = {
  healthy: "proceed", watch: "blocked", "needs-attention": "rejected",
};

/**
 * One row. The balance is the only metric-class value here, so it is the only
 * `<Metric>`: three of them side by side put three "· Sample data · as of …"
 * labels into eighty pixels each and the row became unreadable (D-192). The
 * counts are composed into one line by the builder, and the record they count
 * states its provenance through the balance beside them.
 *
 * The health badge carries the BAND WORD and no figure. A score is a
 * demonstration-derived number, so it may reach a screen only through `<Metric>`
 * with its watermark - and a bare one on a hundred rows is exactly the number a
 * reader would screenshot and take for a measurement. The figure itself belongs
 * to the household's own page, where it renders once, labeled.
 */
function HouseholdRow({ row }: { row: HouseholdRowVM }) {
  return (
    <Link
      href={`/app/households/${row.key}`}
      className="flex h-full items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-500"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-slate-900">{row.displayName}</span>
          <StatusBadge status={BAND_STATUS[row.health.band] ?? "pending"} label={row.health.bandLabel} />
          {row.state !== "active" ? <StatusBadge status="unknown" label={row.stateLabel} /> : null}
        </span>
        <span className="truncate text-xs text-slate-600">
          {row.surname} household · {row.city} · {row.advisorName}
        </span>
        <span className="truncate text-xs text-slate-600">
          {row.countsLabel} · {row.serviceTier} · {row.authoringLabel}
        </span>
        {/* Below `sm` there is no room for a right-hand column, so the balance
            sits in the stack rather than disappearing - it is the number a
            person came to the list for. */}
        <span className="text-xs text-slate-600 sm:hidden">
          <Metric metric={row.totalBalance} />
        </span>
      </span>
      {/* Wide enough for the balance's watermark to sit on ONE line: the total
          folds over every account, so it is demonstration-derived and carries
          the badge, and a 208px column wrapped it across two lines on every row. */}
      <span className="hidden w-64 shrink-0 flex-col items-end text-right text-xs text-slate-600 sm:flex">
        <Metric metric={row.totalBalance} />
        <span>across all accounts</span>
      </span>
    </Link>
  );
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-lg">{children}</p>
    </div>
  );
}

export function HouseholdDirectory({ directory }: { directory: DirectoryVM }) {
  const rowHeight = useRowHeight();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => (needle === "" ? directory.rows : directory.rows.filter((row) => row.searchText.includes(needle))),
    [directory.rows, needle],
  );

  return (
    <div className="flex flex-col gap-6" data-household-surface="directory">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Households</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every household this firm advises, with a health score computed from the evidence behind it.
        </p>
      </div>

      {/* Two up, never four: the shell is 768px wide, and four cards leaves
          each provenance label ~140px, which clips it. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Households"><Metric metric={directory.totalHouseholds} /></SummaryCard>
        <SummaryCard label="People"><Metric metric={directory.totalPeople} /></SummaryCard>
        <SummaryCard label="Accounts"><Metric metric={directory.totalAccounts} /></SummaryCard>
        <SummaryCard label="Open items"><Metric metric={directory.totalOpenItems} /></SummaryCard>
      </div>

      <Field label="Search households" htmlFor="household-search" hint="Matches names, people, cities, advisors, accounts, and custodians.">
        <TextInput
          id="household-search"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Smith, Granite Bay, Roth IRA…"
        />
      </Field>

      <p className="text-sm text-slate-600" data-testid="household-directory" aria-live="polite">
        Showing {rows.length} of {directory.rows.length} households
      </p>

      <VirtualList
        items={rows}
        rowHeight={rowHeight}
        height={VIEWPORT_HEIGHT}
        keyOf={(row) => row.key}
        label="Households"
        emptyState={
          <EmptyState
            title="No household matches that search"
            description="Try a surname, a city, an advisor, or an account type. Four households here share the surname Smith, so a first name narrows it fastest."
          />
        }
      >
        {(row) => <HouseholdRow row={row} />}
      </VirtualList>

      <p className="text-xs text-slate-600">
        {directory.worldVersion
          ? `Demonstration world ${directory.worldVersion} · digest ${directory.worldDigest?.slice(0, 12)}. `
          : ""}
        {directory.provenanceNote}
      </p>
    </div>
  );
}
