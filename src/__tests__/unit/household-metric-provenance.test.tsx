// @vitest-environment jsdom
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { metricWatermark } from "@contracts/metric";
import { Metric } from "@app/presentation/metric";
import { StatusBadge } from "@app/presentation/ui";
import { canFeedComplianceDecision, isDemonstration } from "@contracts/provenance";
import { buildDirectoryVM } from "@app/households/build";
import { buildHouseholdDetailVM } from "@app/households/build-detail";
import { HouseholdDirectory } from "@app/households/directory";
import { HouseholdDetail } from "@app/households/detail";
import { computeHouseholdHealth } from "@domain/world/health";
import type { WorldHousehold } from "@domain/world/household-world";
import type { Household } from "@domain/schema/entities";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * NO METRIC-CLASS FIGURE REACHES A SCREEN OUTSIDE `<Metric>`, AND A SUM IS
 * LABELED BY WHAT IT SUMS (charter #3, ADR-0022, ADR-0057).
 *
 * Two defects of the same shape. The directory row rendered the composite health
 * score inside its band badge and the health panel rendered each factor's score
 * as a bare figure - demonstration-derived numbers with no provenance and no
 * watermark, a hundred and six of them per page respectively, and precisely the
 * numbers a reader would screenshot. And "total across all accounts" published
 * the FIRST account's own record provenance rather than a fold over the accounts
 * it sums, so the headline figure claimed a cleanliness it does not have, beside
 * four summary cards that fold correctly.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

/** jsdom ships no `matchMedia`, and the directory asks it which layout the row
 * is in before it reserves a height for one. Stubbing it is also what lets the
 * stacked case be asserted at all. */
function stubLayout(twoColumn: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: twoColumn,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}
beforeEach(() => stubLayout(true));

const SPEC = loadWorldSpec();
const WORLD: readonly WorldHousehold[] = generateWorld(SPEC, WORLD_SEED).households;
const AS_OF = SPEC.roster.clock.asOf;
/** Deep enough to hold several accounts with different observation instants. */
const SAMPLE = WORLD.filter((household) => household.accounts.length > 1).slice(0, 12);

const crmRow = (household: WorldHousehold): Household => ({
  id: household.id,
  orgId: "org-metric",
  name: household.displayName,
  primaryContactId: null,
  advisorUserId: null,
  status: "active",
  createdAt: household.provenance.asOf,
  provenance: household.provenance,
});

const directoryOf = (households: readonly WorldHousehold[]) =>
  buildDirectoryVM({
    crmHouseholds: households.map(crmRow),
    worldHouseholds: households,
    identity: { version: "test", digest: `digest-${households.length}`, asOf: AS_OF, provenanceNote: "test world" },
  });

/**
 * Every place `figure` reaches the screen as a number a reader reads, minus the
 * places it reaches through a value that carries its own provenance.
 *
 * WHAT IT MATCHES IS A TOKEN INSIDE A TEXT NODE, not an element whose entire
 * text equals the figure. The equality test this replaces could not see the
 * defect it was written for: the row shipped `Healthy · 87`, an equality test
 * found nothing, and the companion asserting "the old shape would be caught"
 * passed by asserting the opposite. A figure welded to a label is still a figure
 * on the screen, and a green companion is what stops anyone looking.
 *
 * WHAT IT EXCUSES is a figure rendered inside the element that carries its
 * provenance label - `<Metric>` renders its value through `FreshValue`, which
 * puts the value in a titled span beside the source/as-of label, so "inside the
 * element holding that pair" is exactly "rendered through the sanctioned
 * component" - and a digit inside a sentence the VIEW MODEL composed ("0 of 3
 * accounts that pass by designation", "4 accounts · 3 people"), where the number
 * is part of a statement rather than a figure standing on its own.
 */
function nakedRendersOf(scope: HTMLElement, figure: number, accounted: readonly string[] = []): string[] {
  const token = new RegExp(`(?<![\\d.,])${figure}(?![\\d.,])`);
  const composed = new Set(accounted.map((text) => text.trim()));
  const labeled = (node: Node): boolean => {
    for (let element = node.parentElement; element !== null && scope.contains(element); element = element.parentElement) {
      if (element.hasAttribute("title") || element.querySelector(":scope > [title]") !== null) return true;
    }
    return false;
  };
  const found: string[] = [];
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    if (!token.test(text) || composed.has(text) || labeled(node)) continue;
    found.push(text);
  }
  return found;
}

describe("the health score is a figure, so it renders like one", () => {
  const vm = directoryOf(SAMPLE);
  /** The figure the row must NOT show, taken from the domain rather than from
   * the row: the row no longer carries a score at all, which is the point - a
   * list that renders the band word ships the band word. */
  const byKey = new Map(SAMPLE.map((household) => [household.key, household]));
  const rowScore = (row: (typeof vm.rows)[number]) => computeHouseholdHealth(byKey.get(row.key)!, AS_OF).score;

  it("the row carries what the row renders, and no breakdown it cannot show", () => {
    for (const row of vm.rows) {
      expect(Object.keys(row.evidence!.health).sort(), `${row.key}: the row ships more health than it renders`)
        .toEqual(["band", "bandLabel"]);
    }
    expect(vm.rows.length).toBeGreaterThan(3);
  });

  it("the directory row's badge carries the BAND WORD and no figure", () => {
    const { container } = render(<HouseholdDirectory directory={vm} />);
    const list = container.querySelector<HTMLElement>("[data-testid=household-list-viewport]")!;
    let checked = 0;
    for (const row of vm.rows) {
      const link = within(list).queryByRole("link", { name: new RegExp(escape(row.displayName)) });
      if (!link) continue;
      checked += 1;
      // The DETECTOR first, and on the whole row: it is what has to catch a
      // figure wherever it reaches the screen, including welded to a label. The
      // exact-text assertion below is narrower - it says the badge is the band
      // word and nothing else - and running it first would fail before the
      // detector was ever asked, which is how the check went unproven.
      expect(
        nakedRendersOf(link, rowScore(row), [row.evidence!.countsLabel]),
        `${row.key}: a bare health score reached the row`,
      ).toEqual([]);
      const badge = within(link).getByText(row.evidence!.health.bandLabel);
      expect(badge.textContent, `${row.key}: the band badge names a figure`).toBe(row.evidence!.health.bandLabel);
    }
    expect(checked, "no row was mounted - the assertion above proved nothing").toBeGreaterThan(3);
  });

  it("detects (companion): the shape this row used to ship IS caught, and the shipped one is not", () => {
    const row = vm.rows[0]!;
    const household = byKey.get(row.key)!;
    const score = rowScore(row);
    // The badge as it actually shipped, taken from this branch's own history
    // (`git show 2af33672:src/app/households/directory.tsx`): the same
    // `StatusBadge`, the same label expression. A hand-built `<span>` would be a
    // statement about a shape nobody wrote (PF-278).
    const asShipped = render(
      <StatusBadge status="proceed" label={`${row.evidence!.health.bandLabel} · ${score}`} />,
    );
    expect(
      nakedRendersOf(asShipped.container, score),
      "the detector cannot see a figure concatenated into a label - the check proves nothing",
    ).toEqual([`${row.evidence!.health.bandLabel} · ${score}`]);
    // ...and the sanctioned rendering of the SAME figure is not a finding, so
    // the assertion above is a statement about the shape rather than the number.
    const throughMetric = render(<Metric metric={buildHouseholdDetailVM(household, crmRow(household), AS_OF).health.score} />);
    expect(nakedRendersOf(throughMetric.container, score)).toEqual([]);
  });

  it("a factor card shows its band and its sentence, never a bare score", () => {
    for (const household of SAMPLE.slice(0, 4)) {
      const detail = buildHouseholdDetailVM(household, crmRow(household), AS_OF);
      const { container } = render(<HouseholdDetail household={detail} />);
      const factors = computeHouseholdHealth(household, AS_OF).factors;
      expect(factors.length, "no factor to inspect").toBeGreaterThan(3);
      for (const factor of factors) {
        const card = within(container).getByText(factor.label).closest("li") as HTMLElement;
        const shown = detail.health.factors.find((entry) => entry.id === factor.id)!;
        expect(
          nakedRendersOf(card, factor.score, [shown.statement, shown.weightLabel, shown.readRecords.join(", ")]),
          `${household.key}/${factor.id}: a bare factor score reached the panel`,
        ).toEqual([]);
        expect(card.textContent, `${household.key}/${factor.id}: the band word is missing`).toContain(shown.bandLabel);
      }
    }
  });

  it("detects (companion): the factor card's previous bare figure IS caught", () => {
    const detail = buildHouseholdDetailVM(SAMPLE[0]!, crmRow(SAMPLE[0]!), AS_OF);
    const factor = detail.health.factors[0]!;
    const score = computeHouseholdHealth(SAMPLE[0]!, AS_OF).factors[0]!.score;
    const { container } = render(<span className="text-sm">{score}</span>);
    expect(nakedRendersOf(container, score, [factor.statement])).toEqual([String(score)]);
  });

  it("the ONE score a page shows renders through <Metric>, watermarked", () => {
    const household = SAMPLE[0]!;
    const detail = buildHouseholdDetailVM(household, crmRow(household), AS_OF);
    const { container } = render(<HouseholdDetail household={detail} />);
    const panel = within(container).getByText("Health").closest("section") as HTMLElement;
    expect(metricWatermark(detail.health.score)).toBe("Demonstration - not a compliance record");
    expect(within(panel).getAllByTestId("metric-watermark").length, "the composite score carries no watermark")
      .toBe(1);
    // The bar is the factor's magnitude, and it is a width rather than a figure.
    expect(detail.health.factors.every((factor) => /^\d+%$/.test(factor.barWidth))).toBe(true);
  });
});

describe("a total across accounts is labeled by the accounts it sums", () => {
  const latestAccountAsOf = (household: WorldHousehold): string =>
    household.accounts.reduce((latest, account) => (account.provenance.asOf > latest ? account.provenance.asOf : latest), "");

  it("folds, rather than borrowing one contributing record's provenance", () => {
    const problems: string[] = [];
    for (const household of SAMPLE) {
      const provenance = buildHouseholdDetailVM(household, crmRow(household), AS_OF).totalBalance.provenance;
      if (!isDemonstration(provenance)) problems.push(`${household.key}: the total is not a derived artifact`);
      if (provenance.source !== "computed") problems.push(`${household.key}: source is ${provenance.source}`);
      if (provenance.asOf !== latestAccountAsOf(household)) {
        problems.push(`${household.key}: as-of ${provenance.asOf}, newest account ${latestAccountAsOf(household)}`);
      }
      if (canFeedComplianceDecision(provenance)) problems.push(`${household.key}: a fixture-fed total was admitted`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the directory row and the household's own page label the same sum identically", () => {
    const rows = new Map(directoryOf(SAMPLE).rows.map((row) => [row.key, row]));
    for (const household of SAMPLE) {
      const row = rows.get(household.key)!;
      const detail = buildHouseholdDetailVM(household, crmRow(household), AS_OF);
      expect(row.evidence!.totalBalance.value, household.key).toBe(detail.totalBalance.value);
      expect(row.evidence!.totalBalance.provenance, household.key).toEqual(detail.totalBalance.provenance);
    }
  });

  it("detects (companion): one account's own provenance would have carried no watermark", () => {
    const household = SAMPLE.find((candidate) => candidate.accounts.length > 1)!;
    const asShipped = household.accounts[0]!.provenance;
    expect(metricWatermark({ value: 0, format: "currency-minor", provenance: asShipped })).toBeNull();
    expect(isDemonstration(asShipped)).toBe(false);
    // ...while the fold over the same accounts does carry it.
    const folded = buildHouseholdDetailVM(household, crmRow(household), AS_OF).totalBalance;
    expect(metricWatermark(folded)).toBe("Demonstration - not a compliance record");
  });
});

describe("the totals fold is per world, and the book it stands on is per request", () => {
  it("a smaller authorized book does not inherit the whole world's folded origin", () => {
    const all = directoryOf(SAMPLE);
    // Same world digest, so the cached rows are reused; the cards must still
    // fold over THIS caller's book.
    const fewer = buildDirectoryVM({
      crmHouseholds: SAMPLE.slice(0, 2).map(crmRow),
      worldHouseholds: SAMPLE,
      identity: { version: "test", digest: `digest-${SAMPLE.length}`, asOf: AS_OF, provenanceNote: "test world" },
    });
    expect(fewer.totalHouseholds.value).toBe(2);
    expect(fewer.totalPeople.value).toBe(SAMPLE.slice(0, 2).reduce((sum, h) => sum + h.members.length, 0));
    const newestOf = (households: readonly WorldHousehold[]): string =>
      households.flatMap((household) => [
        household.provenance.asOf,
        ...household.accounts.map((account) => account.provenance.asOf),
        ...household.bankInstructions.map((instruction) => instruction.provenance.asOf),
        ...household.pendingActions.map((action) => action.provenance.asOf),
      ]).reduce((latest, asOf) => (asOf > latest ? asOf : latest), "");
    expect(fewer.totalHouseholds.provenance.asOf).toBe(newestOf(SAMPLE.slice(0, 2)));
    expect(all.totalHouseholds.provenance.asOf).toBe(newestOf(SAMPLE));
  });

  it("the cached row is the same row, so a second caller reads no different figures", () => {
    const first = directoryOf(SAMPLE);
    const second = directoryOf(SAMPLE);
    expect(second.rows).toEqual(first.rows);
    expect(second.totalHouseholds.provenance).toEqual(first.totalHouseholds.provenance);
  });
});

/**
 * The row's height is reserved before the row renders, so the window has to be
 * told which layout it is about to draw. One height cannot serve both: the
 * stacked row carries the same content in a column, including the balance's
 * provenance label and its demonstration watermark, and the two-column height
 * overlapped the next row's name.
 */
describe("the window reserves the height of the layout that is actually on screen", () => {
  const heightsOf = (twoColumn: boolean): number[] => {
    stubLayout(twoColumn);
    const { container } = render(<HouseholdDirectory directory={directoryOf(SAMPLE)} />);
    return [...container.querySelectorAll<HTMLElement>("li[aria-setsize]")]
      .map((row) => Number.parseInt(row.style.height, 10));
  };

  it("reserves a taller row when the content stacks than when it sits in two columns", () => {
    const stacked = heightsOf(false);
    const twoColumn = heightsOf(true);
    expect(stacked.length, "no row mounted").toBeGreaterThan(1);
    expect(new Set(twoColumn).size, "rows disagree about their own height").toBe(1);
    expect(new Set(stacked).size).toBe(1);
    expect(stacked[0]!, "the stacked row is not taller than the two-column one").toBeGreaterThan(twoColumn[0]!);
  });
});

/** `RegExp`-safe: household names carry `&`, and one carries a period. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
