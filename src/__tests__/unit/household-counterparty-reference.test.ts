import { describe, expect, it } from "vitest";
import { buildHouseholdDetailVM } from "@app/households/build-detail";
import type {
  WorldCrossHouseholdLink, WorldHousehold,
} from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * A WITHHELD COUNTERPARTY'S NUMBER COUNTS WITHHELD COUNTERPARTIES (ADR-0057).
 *
 * The reference is a reader's only handle on a counterparty this firm's book
 * does not contain, so it has to mean what the page shows. Numbering every
 * counterparty - including the ones rendered by NAME - produced a page opening
 * with "Counterparty 2" and no first anywhere on it, because the first was named
 * instead of numbered.
 *
 * The plural copy is also exercised from HERE rather than from world content:
 * the shipped world gives its two linked households exactly one link each, so
 * relying on it to produce a second withheld counterparty would ship an
 * untested branch and call it covered.
 */
const WORLD = generateWorld(loadWorldSpec(), WORLD_SEED).households;
const AS_OF = "2026-07-24T00:00:00.000Z";
const SUBJECT = WORLD.find((household) => household.crossHouseholdLinks.length > 0)!;

const link = (counterpartyHouseholdKey: string): WorldCrossHouseholdLink => ({
  kind: "shared-authorized-signer",
  counterpartyHouseholdKey,
  partyKey: SUBJECT.members[0]!.key,
  note: "An authorized signer on this account also signs for another household.",
});

const withLinks = (links: readonly WorldCrossHouseholdLink[]): WorldHousehold =>
  ({ ...SUBJECT, crossHouseholdLinks: links });

const linksOf = (
  links: readonly WorldCrossHouseholdLink[],
  named: readonly [string, string][],
) => buildHouseholdDetailVM(withLinks(links), SUBJECT.id, AS_OF, new Map(named)).crossHouseholdLinks;

describe("the page-local reference for a withheld counterparty", () => {
  it("numbers the WITHHELD ones only, so a named counterparty never takes a number", () => {
    const [named, hidden] = linksOf(
      [link("named-counterparty"), link("hidden-counterparty")],
      [["named-counterparty", "The Ashby Household"]],
    );
    expect(named!.counterpartyLabel).toBe("The Ashby Household");
    expect(named!.counterpartyKey).toBe("named-counterparty");
    expect(hidden!.reference, "the withheld counterparty was numbered behind a named one").toBe("counterparty-1");
    expect(hidden!.counterpartyKey).toBeNull();
    // ONE counterparty is withheld, so the copy needs no number to be unambiguous.
    expect(hidden!.counterpartyLabel).toBe("That household is not in this firm's book.");
  });

  it("numbers several withheld counterparties, and the copy names the number", () => {
    const [first, second] = linksOf([link("hidden-a"), link("hidden-b")], []);
    expect(first!.reference).toBe("counterparty-1");
    expect(second!.reference).toBe("counterparty-2");
    expect(first!.counterpartyLabel).toBe("Counterparty 1 is not in this firm's book.");
    expect(second!.counterpartyLabel).toBe("Counterparty 2 is not in this firm's book.");
  });

  it("gives one counterparty ONE number however many links reach it", () => {
    const twice = [link("hidden-a"), { ...link("hidden-a"), kind: "receives-distribution-from-external-trust" as const }];
    const rendered = linksOf(twice, []);
    expect(rendered.map((entry) => entry.reference)).toEqual(["counterparty-1", "counterparty-1"]);
    // Two kinds toward one counterparty are distinct rows, so their render keys
    // must still differ.
    expect(new Set(rendered.map((entry) => `${entry.reference}/${entry.kindLabel}`)).size).toBe(2);
    expect(rendered.every((entry) => entry.counterpartyLabel === "That household is not in this firm's book.")).toBe(true);
  });

  it("discloses nothing about a withheld counterparty, whatever its key looks like", () => {
    const [only] = linksOf([link("whitfield-nathaniel")], []);
    const payload = JSON.stringify(only);
    for (const fragment of ["whitfield", "nathaniel"]) {
      expect(payload.toLowerCase(), `"${fragment}" reached the client`).not.toContain(fragment);
    }
  });
});
