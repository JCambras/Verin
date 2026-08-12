// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { buildHouseholdDetailVM } from "@app/households/build-detail";
import type { HouseholdDetailVM } from "@app/households/model";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * A HOUSEHOLD PAGE ANSWERS FOR THE KEY IN ITS URL, AND FOR NO OTHER (ADR-0057).
 *
 * The route is one component serving every household, so the key can change
 * under a mounted page. Anything the previous key produced - a loaded household
 * or a refusal - has to go with it: a refusal nobody cleared renders a household
 * that loads perfectly well as "Household unavailable", and a household nobody
 * cleared puts one family's balances and health under another family's URL.
 *
 * Asserted HERE rather than only in the browser because it is the COMPONENT's
 * contract, not the framework's: today Next remounts this page across a
 * dynamic-param change, so the browser specs beside this file pass either way.
 * Re-rendering the same instance with a new key is what proves the page holds
 * the guarantee itself.
 */

const nav = vi.hoisted(() => ({ key: "" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ key: nav.key }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { default: HouseholdPage } = await import("@app/app/households/[key]/page");

const WORLD = generateWorld(loadWorldSpec(), WORLD_SEED).households;
const AS_OF = "2026-07-01T00:00:00.000Z";
const IN_BOOK = WORLD[0]!;
const WITHHELD = WORLD[1]!;

/** The household's own name, as the page's H1 - a display name also appears as
 * a person inside the household, so the heading is what identifies the page. */
const heading = (name: string) => screen.findByRole("heading", { level: 1, name });

const vmOf = (key: string): HouseholdDetailVM => {
  const household = WORLD.find((candidate) => candidate.key === key)!;
  return buildHouseholdDetailVM(household, household.id, AS_OF);
};

/** The counterparty this firm's book does not contain resolves to the same 404
 * an unknown key does - the route refuses both identically on purpose. */
const respond = (url: string): Promise<unknown> => {
  const key = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
  if (key === WITHHELD.key) return Promise.resolve({ status: 404, ok: false, json: () => Promise.resolve({}) });
  return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ household: vmOf(key) }) });
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => respond(url)));
});

describe("the household page across a key change", () => {
  it("drops a refusal when the key changes, instead of failing a household that loads", async () => {
    nav.key = IN_BOOK.key;
    const { rerender } = render(<HouseholdPage />);
    await heading(IN_BOOK.displayName);

    nav.key = WITHHELD.key;
    rerender(<HouseholdPage />);
    await screen.findByText("Household unavailable");

    // Back to the household that works: the refusal belonged to the other key.
    nav.key = IN_BOOK.key;
    rerender(<HouseholdPage />);
    await heading(IN_BOOK.displayName);
    expect(screen.queryByText("Household unavailable")).toBeNull();
  });

  it("never renders the previous household under the new key", async () => {
    nav.key = IN_BOOK.key;
    const { rerender } = render(<HouseholdPage />);
    await heading(IN_BOOK.displayName);

    const second = WORLD[2]!;
    nav.key = second.key;
    rerender(<HouseholdPage />);
    // Synchronously after the key changes, before the fetch resolves.
    expect(screen.queryByRole("heading", { level: 1, name: IN_BOOK.displayName })).toBeNull();
    await heading(second.displayName);
  });

  it("shows the refusal as a sentence with a way back, not a bare failure", async () => {
    nav.key = WITHHELD.key;
    render(<HouseholdPage />);
    await screen.findByText(/not in this firm's book/);
    await waitFor(() => expect(screen.getByRole("link", { name: "Back to all households" })).toBeTruthy());
  });
});
