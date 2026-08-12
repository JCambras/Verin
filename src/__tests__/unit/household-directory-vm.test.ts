import { describe, expect, it } from "vitest";
import { metricWatermark, type DisplayMetric } from "@contracts/metric";
import {
  canFeedComplianceDecision, deriveArtifactProvenance, syntheticBadgeLabel,
} from "@contracts/provenance";
import { buildDirectoryVM } from "@app/households/build";
import type { Household } from "@domain/schema/entities";
import type { WorldHousehold } from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * THE DIRECTORY IS THE INTERSECTION, TOTALS INCLUDED (ADR-0057).
 *
 * The CRM decides which households a tenant may see; the evidence port only
 * describes them. Rows already honoured that, but the summary cards above them
 * counted every household the port returned - so a tenant with a smaller book
 * read "100 households" worth of people and accounts beside its own count of 2.
 * A total is a disclosure too, and it is scoped by the same authorization.
 */
const WORLD: readonly WorldHousehold[] = generateWorld(loadWorldSpec(), WORLD_SEED).households.slice(0, 3);

const crmRow = (household: WorldHousehold): Household => ({
  id: household.id,
  orgId: "org-directory",
  name: household.displayName,
  primaryContactId: null,
  advisorUserId: null,
  status: "active",
  createdAt: household.provenance.asOf,
  provenance: household.provenance,
});

const directory = (authorized: readonly WorldHousehold[]) =>
  buildDirectoryVM({
    crmHouseholds: authorized.map(crmRow),
    worldHouseholds: WORLD,
    identity: null,
  });

const sumOf = (households: readonly WorldHousehold[], of: (h: WorldHousehold) => number): number =>
  households.reduce((total, household) => total + of(household), 0);

describe("directory view model authorization scope", () => {
  it("counts people and accounts over the AUTHORIZED intersection, not the whole world", () => {
    const authorized = WORLD.slice(0, 2);
    const vm = directory(authorized);
    expect(vm.rows).toHaveLength(2);
    expect(vm.totalHouseholds.value).toBe(2);
    expect(vm.totalPeople.value).toBe(sumOf(authorized, (h) => h.members.length));
    expect(vm.totalAccounts.value).toBe(sumOf(authorized, (h) => h.accounts.length));
  });

  it("a household the CRM does not authorize contributes NOTHING to any card", () => {
    const all = directory(WORLD);
    const fewer = directory(WORLD.slice(0, 2));
    const withheld = WORLD[2]!;
    expect(all.totalPeople.value - fewer.totalPeople.value).toBe(withheld.members.length);
    expect(all.totalAccounts.value - fewer.totalAccounts.value).toBe(withheld.accounts.length);
    expect(all.rows.map((row) => row.key)).toContain(withheld.key);
    expect(fewer.rows.map((row) => row.key)).not.toContain(withheld.key);
  });

  it("an empty book shows zeroes, never the world's figures", () => {
    const vm = directory([]);
    expect(vm.rows).toEqual([]);
    for (const card of [vm.totalHouseholds, vm.totalPeople, vm.totalAccounts, vm.totalOpenItems]) {
      expect(card.value).toBe(0);
    }
  });

  /**
   * A COUNT OF NOTHING CLAIMS NOTHING (charter #3, ADR-0022). The empty book is
   * reachable on the shipped surface - a dev store before `pnpm db:seed`, a
   * tenant whose CRM book does not overlap the world, and production, where the
   * fixture adapter refuses to serve at all - so the four cards render there on
   * every one of those paths.
   */
  const cards = (vm: ReturnType<typeof directory>): DisplayMetric[] =>
    [vm.totalHouseholds, vm.totalPeople, vm.totalAccounts, vm.totalOpenItems];

  it("the zeroes of an empty book are labeled, watermarked, and refused a compliance decision", () => {
    for (const card of cards(directory([]))) {
      expect(canFeedComplianceDecision(card.provenance), "a figure with no evidence behind it is not evidence").toBe(false);
      expect(metricWatermark(card)).toBe("Demonstration - not a compliance record");
      expect(syntheticBadgeLabel(card.provenance)).toBe("synthetic fixture");
      expect(card.provenance.confidence, "nothing was read, so nothing is confident").toBe("low");
    }
  });

  it("a counted book is labeled the same way, so the cards do not change standing with their input", () => {
    for (const card of cards(directory(WORLD))) {
      expect(canFeedComplianceDecision(card.provenance)).toBe(false);
      expect(metricWatermark(card)).toBe("Demonstration - not a compliance record");
    }
  });

  it("detects (companion): folding over NOTHING would hand the zeroes the strongest standing there is", () => {
    // What the empty case used to publish. `deriveArtifactProvenance` has no
    // input to be less confident than, so it reports high confidence and no
    // demonstration - and `canFeedComplianceDecision` ADMITS it, on a surface a
    // dev store reaches before its first seed.
    const overNothing = deriveArtifactProvenance([], "2026-08-12T00:00:00.000Z");
    expect(canFeedComplianceDecision(overNothing)).toBe(true);
    expect(overNothing.confidence).toBe("high");
    expect(syntheticBadgeLabel(overNothing)).toBeNull();
  });

  it("the open-item total is the sum of the rows' own counts, so the two cannot disagree", () => {
    for (const authorized of [WORLD, WORLD.slice(0, 2), WORLD.slice(0, 1)]) {
      const vm = directory(authorized);
      expect(vm.totalOpenItems.value).toBe(vm.rows.reduce((total, row) => total + (row.evidence?.openItemCount ?? 0), 0));
    }
  });
});

/**
 * IDENTITY IS THE RECORD STORE'S, DEPTH IS THE EVIDENCE'S (ADR-0057 amendment).
 *
 * The house CRM owns a household's name and renames it through a governed
 * audited write. The directory used to render the fixture's name, so a rename
 * showed in the console and never here - two shipped surfaces disagreeing about
 * one record, indefinitely, with nothing on either to say so. And a household
 * created in the console had no world entry at all, so it never appeared on the
 * surface the app home page calls "the firm's whole book".
 */
describe("the record store owns identity, and a household with no evidence still appears", () => {
  const renamed = (household: WorldHousehold, name: string): Household => ({ ...crmRow(household), name });

  it("renders the CRM's name, not the fixture's", () => {
    const subject = WORLD[0]!;
    const vm = buildDirectoryVM({
      crmHouseholds: [renamed(subject, "The Name An Advisor Typed")],
      worldHouseholds: WORLD,
      identity: null,
    });
    expect(vm.rows.map((row) => row.displayName)).toEqual(["The Name An Advisor Typed"]);
    expect(vm.rows[0]!.evidence, "the evidence still supplies the depth").not.toBeNull();
    expect(vm.rows[0]!.searchText, "the typed name is searchable").toContain("the name an advisor typed");
    expect(vm.rows[0]!.searchText, "so is everything the evidence knows").toContain(subject.surname.toLowerCase());
  });

  it("a household the record store holds and no evidence describes is LISTED, and says so", () => {
    const created: Household = {
      id: "11111111-2222-3333-4444-555555555555",
      orgId: "org-directory",
      name: "A Household Created A Minute Ago",
      primaryContactId: null,
      advisorUserId: null,
      status: "prospect",
      createdAt: "2026-08-12T00:00:00.000Z",
      provenance: { source: "verin-crm", asOf: "2026-08-12T00:00:00.000Z", confidence: "high" },
    };
    const vm = buildDirectoryVM({
      crmHouseholds: [...WORLD.map(crmRow), created],
      worldHouseholds: WORLD,
      identity: null,
    });
    const row = vm.rows.find((entry) => entry.id === created.id)!;
    expect(row, "a household somebody just created must not vanish from the firm's book").toBeDefined();
    expect(row.evidence).toBeNull();
    expect(row.href, "its own page would have nothing on it, so there is no link to it").toBeNull();
    expect(row.noEvidence?.note).toContain("Nothing has arrived");
    expect(row.noEvidence?.actionHref, "an empty state with no next action is a dead end").toBe("/app/console");
    expect(vm.totalHouseholds.value, "it is one of the firm's households").toBe(WORLD.length + 1);
    expect(vm.totalPeople.value, "and it contributes no people, because none are on file")
      .toBe(sumOf(WORLD, (h) => h.members.length));
    expect(vm.evidenceCoverageNote, "a card reading part of the list has to say which part")
      .toBe("1 household has no evidence on file yet, so the people, account, and open-item counts read the 3 that do.");
  });

  it("a book where every household has evidence says nothing about coverage", () => {
    expect(directory(WORLD).evidenceCoverageNote).toBeNull();
  });

  it("a book NO evidence describes still lists its households, and says why the counts are zero", () => {
    // Production: the fixture adapter refuses to serve, so the port returns
    // nothing for a book that is genuinely there. Three cards of zeroes with no
    // explanation beside a list of real households is the silently-empty surface
    // this world exists to end.
    const vm = buildDirectoryVM({ crmHouseholds: WORLD.map(crmRow), worldHouseholds: [], identity: null });
    expect(vm.rows).toHaveLength(WORLD.length);
    expect(vm.rows.every((row) => row.evidence === null)).toBe(true);
    expect(vm.totalHouseholds.value).toBe(WORLD.length);
    expect(vm.totalPeople.value).toBe(0);
    expect(vm.evidenceCoverageNote).toBe(
      "No evidence is on file for any household in this book yet, so the people, account, and open-item counts are zero.",
    );
  });
});
