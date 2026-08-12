// @vitest-environment jsdom
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildDirectoryVM } from "@app/households/build";
import { HouseholdDirectory } from "@app/households/directory";
import type { Household } from "@domain/schema/entities";
import type { WorldHousehold } from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * TWO QUESTIONS, TWO EMPTY STATES (ADR-0057).
 *
 * "Nothing is in this book" and "nothing matched this search" are different
 * facts, and one state cannot answer both. The directory passed only the
 * search-miss copy, so an empty book - a dev store before `pnpm db:seed`, a
 * tenant whose CRM book does not overlap the world, production, where the
 * fixture adapter refuses to serve - rendered "No household matches that
 * search" and offered four Smiths that are not there: two false statements in
 * one view, on the surface the app home page calls the firm's whole book.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

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

const WORLD: readonly WorldHousehold[] = generateWorld(loadWorldSpec(), WORLD_SEED).households.slice(0, 3);

const crmRow = (household: WorldHousehold): Household => ({
  id: household.id,
  orgId: "org-empty-states",
  name: household.displayName,
  primaryContactId: null,
  advisorUserId: null,
  status: "active",
  createdAt: household.provenance.asOf,
  provenance: household.provenance,
});

const directory = (authorized: readonly WorldHousehold[]) =>
  buildDirectoryVM({ crmHouseholds: authorized.map(crmRow), worldHouseholds: WORLD, identity: null });

const SEARCH_COPY = "No household matches that search";

describe("an empty book is not a search that found nothing", () => {
  it("the builder states the book's own empty state, with a next action", () => {
    const empty = directory([]).emptyBook;
    expect(empty, "an empty book must say what it is").not.toBeNull();
    expect(empty!.title).toBe("No households in this firm's book yet");
    expect(empty!.description).toContain("the firm's record store holds");
    expect(empty!.actionHref, "an empty state with no next action is a dead end").toBe("/app/console");
  });

  it("a book with households says nothing about being empty, so the state cannot become furniture", () => {
    expect(directory(WORLD).emptyBook).toBeNull();
  });

  it("renders the book's empty state and NOT the search copy when no search was made", () => {
    render(<HouseholdDirectory directory={directory([])} />);
    expect(screen.getByText("No households in this firm's book yet")).toBeDefined();
    expect(
      screen.queryByText(SEARCH_COPY),
      "no search was made, so nothing can have failed to match one",
    ).toBeNull();
    expect(screen.queryByText(/share the surname Smith/), "and there are no Smiths here to offer").toBeNull();
    expect(screen.getByRole("link", { name: "Open the house-CRM console" }).getAttribute("href")).toBe("/app/console");
  });

  it("renders the SEARCH copy when a book that has households matches nothing", () => {
    render(<HouseholdDirectory directory={directory(WORLD)} />);
    fireEvent.change(screen.getByLabelText("Search households"), { target: { value: "zzzz-no-such-household" } });
    expect(screen.getByText(SEARCH_COPY)).toBeDefined();
    expect(
      screen.queryByText("No households in this firm's book yet"),
      "the book is not empty - only this search is",
    ).toBeNull();
  });

  it("detects (companion): one empty state for both questions tells the empty book about a search", () => {
    // What the surface shipped: `VirtualList` renders its one `emptyState`
    // whenever the list is empty, whatever emptied it. With the book empty and
    // the search box untouched, that is the search copy.
    const vm = directory([]);
    render(<HouseholdDirectory directory={{ ...vm, emptyBook: null }} />);
    expect(screen.getByText(SEARCH_COPY), "this is the state the fix distinguishes").toBeDefined();
    expect(screen.getByText(/share the surname Smith/)).toBeDefined();
  });
});
