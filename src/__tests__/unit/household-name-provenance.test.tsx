// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { buildDirectoryVM } from "@app/households/build";
import { buildHouseholdDetailVM } from "@app/households/build-detail";
import { HouseholdDirectory } from "@app/households/directory";
import { HouseholdDetail } from "@app/households/detail";
import { crmRowFor } from "./_crm-row";
import type { RecordProvenance } from "@contracts/provenance";
import type { Household } from "@domain/schema/entities";
import type { WorldHousehold } from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * THE NAME SAYS WHERE THE NAME CAME FROM (charter #3, ADR-0057).
 *
 * Record origin and value provenance were split so a reader could see which is
 * which: a seeded household's row stays demonstration-originated forever, while
 * its NAME becomes the advisor's own words the moment they type them. That split
 * is only worth having if the surfaces show it - and both surfaces rendered the
 * name as bare text while their view models carried the provenance and no
 * component read it, so a seeded name reached two authenticated screens with no
 * label and no receded treatment, and a rename changed nothing a reader can see.
 *
 * So: the same name, rendered from two CRM rows that differ only in provenance,
 * must read differently. Asserted on the DOM both surfaces actually produce.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

/** jsdom ships no `matchMedia`, and the directory asks it which layout the row
 * is in before it reserves a height for one. */
function stubLayout(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
    }),
  });
}
beforeEach(stubLayout);

const SPEC = loadWorldSpec();
const WORLD: readonly WorldHousehold[] = generateWorld(SPEC, WORLD_SEED).households;
const AS_OF = SPEC.roster.clock.asOf;
/** Seeded long enough before the world's instant that the fade is visible: a
 * name observed today would recede by nothing, and this asserts the treatment. */
const SEEDED = WORLD.find((household) => household.provenance.asOf < AS_OF)!;
const RENAMED_TO = "The Household An Advisor Renamed";

/** What `updateHouseholdName` writes: the VALUE is user-entered as of the edit,
 * and `record_origin` is untouched (proved against the store in
 * `src/__tests__/integration/fixture-purge.test.ts`). */
const ENTERED: RecordProvenance = { source: "user-input", asOf: AS_OF, confidence: "high" };

const renamedRow = (household: WorldHousehold): Household => ({
  ...crmRowFor(household, RENAMED_TO),
  provenance: ENTERED,
});

const detailOf = (crmRow: Household) => render(
  <HouseholdDetail household={buildHouseholdDetailVM(SEEDED, crmRow, AS_OF)} />,
);

const rowOf = (crmRow: Household): HTMLElement => {
  const { container } = render(
    <HouseholdDirectory directory={buildDirectoryVM({
      crmHouseholds: [crmRow], worldHouseholds: [SEEDED], identity: null,
    })} />,
  );
  return container.querySelector<HTMLElement>("[data-testid=household-list-viewport]")!;
};

/** The value's own span is the one FreshValue titles with the provenance label
 * and fades by age; the label sits beside it. Reading both together is what
 * makes "rendered WITH its provenance" an assertion rather than a text search. */
function labelled(scope: HTMLElement, value: string): { label: string; opacity: number } {
  const shown = within(scope).getByText(value);
  const titled = shown.closest<HTMLElement>("[title]");
  expect(titled, `"${value}" is rendered with no provenance at all`).not.toBeNull();
  return {
    label: titled!.parentElement!.textContent!.slice(titled!.textContent!.length).trim(),
    opacity: Number(titled!.style.opacity || "1"),
  };
}

beforeAll(() => {
  // The fade is measured against NOW, so the world's own instant is what makes
  // the seeded name's age mean what the fixture says it means.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AS_OF));
});
afterAll(() => vi.useRealTimers());

describe("a seeded household name reads as sample data", () => {
  it("the detail heading states the source and the date, and recedes with age", () => {
    const { container } = detailOf(crmRowFor(SEEDED));
    const heading = container.querySelector<HTMLElement>("h1")!;
    const { label, opacity } = labelled(heading, SEEDED.displayName);
    expect(label).toBe(`· Sample data · as of ${SEEDED.provenance.asOf.slice(0, 10)}`);
    expect(opacity, "a name older than a day renders at full strength").toBeLessThan(1);
  });

  it("the directory row states it too - the same name on two surfaces, labelled once each", () => {
    const { label } = labelled(rowOf(crmRowFor(SEEDED)), SEEDED.displayName);
    expect(label).toBe(`· Sample data · as of ${SEEDED.provenance.asOf.slice(0, 10)}`);
  });
});

describe("renaming it makes the name the advisor's own words, on both surfaces", () => {
  it("the detail heading reads as entered, un-watermarked and un-faded", () => {
    const { container } = detailOf(renamedRow(SEEDED));
    const { label, opacity } = labelled(container.querySelector<HTMLElement>("h1")!, RENAMED_TO);
    expect(label).toBe(`· Entered · as of ${AS_OF.slice(0, 10)}`);
    expect(label).not.toContain("Sample data");
    expect(opacity, "the advisor's own words render receded").toBe(1);
  });

  it("the directory row does the same, so the two surfaces cannot disagree", () => {
    const { label, opacity } = labelled(rowOf(renamedRow(SEEDED)), RENAMED_TO);
    expect(label).toBe(`· Entered · as of ${AS_OF.slice(0, 10)}`);
    expect(opacity).toBe(1);
  });

  it("the row a rename cannot reach - no evidence on file - is labelled the same way", () => {
    // A household the console created: no world entry, so the fixture supplies
    // nothing and the CRM row IS the whole record. Its name is the firm's own.
    const firmOwn: Household = { ...crmRowFor(SEEDED, "A Household The Firm Created"), provenance: ENTERED };
    const viewport = render(
      <HouseholdDirectory directory={buildDirectoryVM({
        crmHouseholds: [firmOwn], worldHouseholds: [], identity: null,
      })} />,
    ).container.querySelector<HTMLElement>("[data-testid=household-list-viewport]")!;
    expect(labelled(viewport, "A Household The Firm Created").label).toBe(`· Entered · as of ${AS_OF.slice(0, 10)}`);
  });
});

describe("detects (companion): the shape both surfaces used to ship IS caught", () => {
  /** The heading and the row name exactly as they shipped, taken from this
   * branch's own history (`git show 26c83881:src/app/households/detail.tsx` and
   * `:src/app/households/directory.tsx`) rather than approximated: the same
   * elements, the same classes, the name as bare text. */
  it("a bare heading has no provenance for the check to read", () => {
    const { container } = render(
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">{SEEDED.displayName}</h1>,
    );
    expect(() => labelled(container, SEEDED.displayName)).toThrow(/rendered with no provenance/);
  });

  it("a bare row name has none either, and the shipped one does", () => {
    const { container } = render(
      <span className="truncate text-sm font-semibold text-slate-900">{SEEDED.displayName}</span>,
    );
    expect(() => labelled(container, SEEDED.displayName)).toThrow(/rendered with no provenance/);
    expect(labelled(rowOf(crmRowFor(SEEDED)), SEEDED.displayName).label).toContain("Sample data");
  });
});
