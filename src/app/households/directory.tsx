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
import { FreshValue } from "@app/presentation/fresh-value";
import type { DirectoryVM, EmptyBookVM, HouseholdRowVM, NoEvidenceVM } from "./model";
import { VirtualList } from "./virtual-list";

// The window has to know how tall a row is before it renders one, so the height
// is a number rather than a class - and ONE number cannot serve both layouts.
// Above `sm` the row is two columns; below, the same content stacks (a name and
// its provenance, the badges, meta, counts, and a balance carrying its own
// provenance label and its demonstration watermark), and the two-column height
// overlapped the next row's title.
//
// MEASURED IN A BROWSER, not reasoned about: the tallest row the world produces,
// at 1280 / 768 / 700 / 640 px two-column (128px of content) and 639 / 500 / 414
// / 375 / 360 px stacked (170px). Both figures grew when the household's name
// started carrying its own provenance, and the previous pair had never been
// measured below 640px - where the stacked row already overflowed by 40px.
// Anything that changes what a row renders re-measures these.
const TWO_COLUMN_ROW = 132;
const STACKED_ROW = 176;
const VIEWPORT_HEIGHT = 648;

// Tailwind's `sm`, the breakpoint the row's own classes switch on: the two must
// agree, or the height is reserved for a layout that is not on screen.
const TWO_COLUMN_QUERY = "(min-width: 40rem)";

/**
 * Which layout the row is actually in. `useSyncExternalStore` rather than a
 * layout-measurement effect: the media query answers directly, so nothing has to
 * render at one height to discover another.
 *
 * The SERVER snapshot cannot know the viewport - React uses it for SSR and for
 * the hydration render, where no window exists - so it reserves the STACKED
 * height, the taller of the two. That is the safe direction and the only one:
 * reserving too much leaves a gap under a narrow row for one frame, reserving
 * too little overlaps the next row's name, which is the defect the second
 * constant was added for. On a wide viewport the first client render corrects
 * it downward.
 */
function useRowHeight(): number {
  const twoColumn = useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(TWO_COLUMN_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(TWO_COLUMN_QUERY).matches,
    () => false,
  );
  return twoColumn ? TWO_COLUMN_ROW : STACKED_ROW;
}

const BAND_STATUS: Record<string, string> = {
  healthy: "proceed", watch: "blocked", "needs-attention": "rejected",
};

/**
 * The household's name AND where that name came from - the record store's row,
 * not the fixture's. A seeded name reads as sample data and recedes with age; a
 * renamed one reads as user-entered and does neither, which is the only place a
 * reader can see the difference the two provenance facts exist to keep apart.
 *
 * It takes the WHOLE line (`basis-full`), so the badges after it start the next
 * one on every row. Sharing a line with them made the wrap point depend on how
 * long the name happened to be, and a hundred rows whose badges each sit
 * somewhere else is a list a reader has to re-find their place in. Only the name
 * is bold: the label is the same weight and colour it carries everywhere else,
 * because a provenance label that shouts competes with the value it describes.
 */
function HouseholdName({ row }: { row: HouseholdRowVM }) {
  return (
    <span className="min-w-0 basis-full text-sm font-normal text-slate-900">
      <FreshValue provenance={row.provenance}>
        <span className="font-semibold">{row.displayName}</span>
      </FreshValue>
    </span>
  );
}

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
  if (row.evidence === null) return <UnevidencedRow row={row} />;
  const evidence = row.evidence;
  return (
    <Link
      href={row.href}
      className="flex h-full items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-500"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <HouseholdName row={row} />
          <StatusBadge status={BAND_STATUS[evidence.health.band] ?? "pending"} label={evidence.health.bandLabel} />
          {row.state !== "active" ? <StatusBadge status="unknown" label={row.stateLabel} /> : null}
        </span>
        <span className="truncate text-xs text-slate-600">
          {evidence.surname} household · {evidence.city} · {evidence.advisorName}
        </span>
        <span className="truncate text-xs text-slate-600">
          {evidence.countsLabel} · {evidence.serviceTier} · {evidence.authoringLabel}
        </span>
        {/* Below `sm` there is no room for a right-hand column, so the balance
            sits in the stack rather than disappearing - it is the number a
            person came to the list for. */}
        <span className="text-xs text-slate-600 sm:hidden">
          <Metric metric={evidence.totalBalance} />
        </span>
      </span>
      {/* Wide enough for the balance's watermark to sit on ONE line: the total
          folds over every account, so it is demonstration-derived and carries
          the badge, and a 208px column wrapped it across two lines on every row. */}
      <span className="hidden w-64 shrink-0 flex-col items-end text-right text-xs text-slate-600 sm:flex">
        <Metric metric={evidence.totalBalance} />
        <span>across all accounts</span>
      </span>
    </Link>
  );
}

/**
 * A household the firm's record store holds and no evidence describes - which
 * is what every household looks like for the first minutes of its life. It is
 * NOT a link: its own page would have nothing on it, and an affordance that can
 * only land on emptiness is not one. The row states the position plainly and
 * carries the one action that does something about it.
 */
function UnevidencedRow({ row }: { row: HouseholdRowVM & { noEvidence: NoEvidenceVM } }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1 px-4 py-3">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <HouseholdName row={row} />
        <StatusBadge status="unknown" label={row.noEvidence.badgeLabel} />
        {row.state !== "active" ? <StatusBadge status="unknown" label={row.stateLabel} /> : null}
      </span>
      {/* Not truncated: it is the whole content of the row, and a sentence a
          reader cannot finish explains nothing. Two lines at the narrowest width
          still sit inside the stacked row's reserved height. */}
      <span className="text-xs text-slate-600">{row.noEvidence.note}</span>
      <Link
        href={row.noEvidence.actionHref}
        className="w-fit text-xs text-slate-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
      >
        {row.noEvidence.actionLabel}
      </Link>
    </div>
  );
}

function BookIsEmpty({ empty }: { empty: EmptyBookVM }) {
  return (
    <EmptyState
      title={empty.title}
      description={empty.description}
      action={
        <Link
          href={empty.actionHref}
          className="text-sm text-slate-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
        >
          {empty.actionLabel}
        </Link>
      }
    />
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

      {/* Every household is listed, including the ones no evidence describes
          yet. Three of these four cards read only the described ones, so when
          they differ the cards say which - a figure that silently counts a
          subset of the list beside it is the quiet kind of wrong. */}
      {directory.evidenceCoverageNote
        ? <p className="text-xs text-slate-600" data-testid="evidence-coverage">{directory.evidenceCoverageNote}</p>
        : null}

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
          // TWO QUESTIONS, TWO STATES. An empty book is not a search that found
          // nothing: answering both with the search copy tells a reader no
          // household matched a search they never made, and names four Smiths
          // that are not there - two false statements in one view. The book's
          // own empty state comes from the builder and carries a next action.
          directory.emptyBook !== null
            ? <BookIsEmpty empty={directory.emptyBook} />
            : <EmptyState
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
