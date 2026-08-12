// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { buildHouseholdDetailVM } from "@app/households/build-detail";
import { HouseholdDetail } from "@app/households/detail";
import type { WorldHousehold } from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * A STALE POSITIONS SNAPSHOT ACTUALLY RECEDES ON SCREEN (ADR-0057, charter #3).
 *
 * Freshness is the one trust affordance a reader does not have to ask for: a
 * value observed longer ago than the roster's window fades and says when it was
 * seen. An affordance that cannot fire is worse than none, because a reader
 * believes they are being warned - and every one of the world's holdings used to
 * publish `high` confidence, because the materializer compared each observation
 * against ITSELF instead of against the world's instant.
 *
 * So this asserts both halves against the real committed world: the stored
 * confidence VARIES with the age of the snapshot behind it, and the holding a
 * stale snapshot produced renders visibly receded - at the established receded
 * colour, which is what keeps the faded text above the WCAG contrast floor -
 * while a same-day holding renders at full strength.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const SPEC = loadWorldSpec();
const WORLD = generateWorld(SPEC, WORLD_SEED).households;
const AS_OF = SPEC.roster.clock.asOf;
const WINDOW_DAYS = SPEC.roster.clock.freshLiquidityWindowDays;
const MS_PER_DAY = 86_400_000;

const positionsAgeDays = (household: WorldHousehold): number =>
  Math.trunc((Date.parse(AS_OF) - Date.parse(household.evidence.positionsObservedAt)) / MS_PER_DAY);

/** A household whose positions snapshot is older than the freshness window, and
 * one observed the same day - both taken from the world rather than named, so a
 * regeneration cannot leave this suite asserting about a household that moved. */
const STALE = WORLD.filter((household) => positionsAgeDays(household) > WINDOW_DAYS);
const FRESH = WORLD.filter((household) => positionsAgeDays(household) === 0);

/** The first account's holdings panel, opened the way a reader opens it. */
function openedAccount(household: WorldHousehold): HTMLElement {
  const { container } = render(
    <HouseholdDetail household={buildHouseholdDetailVM(household, household.id, AS_OF)} />,
  );
  const card = container.querySelector<HTMLElement>(`[data-account-card="${household.accounts[0]!.key}"]`)!;
  fireEvent.click(within(card).getByRole("button", { name: /Show holdings/ }));
  return card;
}

/** The opacity the surface actually rendered for one lot's market value: the
 * receded treatment is an inline opacity on the value FreshValue wraps. */
function renderedLot(household: WorldHousehold): { opacity: number; className: string; symbol: string } {
  const card = openedAccount(household);
  const symbol = household.accounts[0]!.holdings[0]!.symbol;
  const lot = within(card).getByText(symbol).closest("li")!;
  const faded = lot.querySelector<HTMLElement>("span[style]")!;
  return { opacity: Number(faded.style.opacity), className: faded.className, symbol };
}

beforeAll(() => {
  // The fade is measured against NOW, so the world's own instant is what makes
  // "twelve days old" mean twelve days here rather than however long ago the
  // fixture was generated.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AS_OF));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("a stale positions snapshot is a real signal, not a constant", () => {
  it("the world contains both cases, or nothing below proves anything (charter #4)", () => {
    expect(STALE.length, "no household's positions are out of window - the freshness case is missing").toBeGreaterThan(40);
    expect(FRESH.length, "no household's positions are same-day - there is nothing to contrast with").toBeGreaterThan(5);
  });

  it("holding confidence degrades with the age of the snapshot behind it", () => {
    const problems: string[] = [];
    for (const household of WORLD) {
      const expected = positionsAgeDays(household) <= WINDOW_DAYS ? "high" : "medium";
      for (const account of household.accounts) {
        for (const holding of account.holdings) {
          if (holding.provenance.confidence !== expected) {
            problems.push(`${household.key}/${account.key}/${holding.symbol}: ${holding.provenance.confidence}, expected ${expected} at ${positionsAgeDays(household)} days`);
          }
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
    // And the label is not a constant in the other direction either: both values
    // are actually present across the world, in quantity.
    const labels = WORLD.flatMap((household) => household.accounts
      .flatMap((account) => account.holdings.map((holding) => holding.provenance.confidence)));
    expect(labels.filter((label) => label === "high").length, "no holding reads high").toBeGreaterThan(100);
    expect(labels.filter((label) => label === "medium").length, "no holding reads medium - the signal is a constant").toBeGreaterThan(100);
  });

  it("renders a lot from an out-of-window snapshot RECEDED, at the receded colour", () => {
    const lot = renderedLot(STALE[0]!);
    expect(lot.opacity, `${lot.symbol} was rendered at full strength on a ${positionsAgeDays(STALE[0]!)}-day-old snapshot`)
      .toBeLessThan(1);
    // Faded slate-600 meta text drops below 4.5:1; receded content owns the
    // established receded colour instead of inheriting the caller's.
    expect(lot.className).toContain("text-slate-800");
  });

  it("renders a lot from a same-day snapshot at full strength, so the signal varies", () => {
    expect(renderedLot(FRESH[0]!).opacity).toBe(1);
  });

  it("says when the lot was observed, beside the value", () => {
    const household = STALE[0]!;
    const card = openedAccount(household);
    const observedDay = household.evidence.positionsObservedAt.slice(0, 10);
    expect(within(card).getAllByText(`· Sample data · as of ${observedDay}`).length).toBeGreaterThan(0);
  });
});
