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
      expect(vm.totalOpenItems.value).toBe(vm.rows.reduce((total, row) => total + row.openItemCount, 0));
    }
  });
});
