import { describe, expect, it } from "vitest";
import { buildHouseholdDetailVM } from "@app/households/build-detail";
import { computeHouseholdHealth } from "@domain/world/health";
import {
  BENEFICIARY_BEARING_REGISTRATIONS, type WorldAccount, type WorldHousehold,
} from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * AN ABSENCE IS NOT A GAP (ADR-0057).
 *
 * A beneficiary designation is how the asset passes on an IRA, a rollover, a SEP
 * and a 529. On a joint account it passes by survivorship; on a trust or an LLC
 * account it passes by that entity's own documents. Telling a reader "no
 * beneficiary is designated" on one of those invents a deficiency that cannot
 * exist - and it did so beside a health panel that correctly scored the same
 * household complete, because the copy and the factor each carried their own
 * idea of which registrations matter.
 *
 * `BENEFICIARY_BEARING_REGISTRATIONS` is now the ONE source of truth both read,
 * so this suite asserts the two agree over the whole committed world, and its
 * companion proves the check is not vacuous: an IRA with nothing designated is
 * still stated as the gap it is.
 */

const WORLD: readonly WorldHousehold[] = generateWorld(loadWorldSpec(), WORLD_SEED).households;
const AS_OF = "2026-07-01T00:00:00.000Z";

const detail = (household: WorldHousehold) => buildHouseholdDetailVM(household, household.id, AS_OF);

const withAccounts = (household: WorldHousehold, accounts: readonly WorldAccount[]): WorldHousehold =>
  ({ ...household, accounts });

const anyAccount = WORLD[0]!.accounts[0]!;
const account = (registration: WorldAccount["registration"], beneficiaries: WorldAccount["beneficiaries"]): WorldAccount =>
  ({ ...anyAccount, registration, beneficiaries });

describe("beneficiary copy and the health factor read one materiality set", () => {
  it("states no gap on a registration that takes no designation, anywhere in the world", () => {
    let immaterial = 0;
    for (const household of WORLD) {
      const vm = detail(household);
      for (const [index, row] of vm.accounts.entries()) {
        const source = household.accounts[index]!;
        if (BENEFICIARY_BEARING_REGISTRATIONS.has(source.registration)) continue;
        immaterial += 1;
        expect(row.beneficiaryNote, `${household.key}/${source.key} (${source.registration}) must not be reported as a gap`)
          .toBeNull();
      }
    }
    // The world must actually contain the case, or the assertion above passes
    // by describing nothing (charter #4).
    expect(immaterial, "no immaterial registration in the world - this proves nothing").toBeGreaterThan(50);
  });

  it("names the registration rather than reporting an empty panel as an absence", () => {
    for (const household of WORLD) {
      const vm = detail(household);
      for (const [index, row] of vm.accounts.entries()) {
        const bearing = BENEFICIARY_BEARING_REGISTRATIONS.has(household.accounts[index]!.registration);
        expect(row.beneficiaryEmptyLabel).toBe(
          bearing ? "None designated." : "This registration does not take a beneficiary designation.",
        );
      }
    }
  });

  it("the surface and the score cannot disagree: a note appears only where health scores a shortfall", () => {
    for (const household of WORLD) {
      const flagged = detail(household).accounts.filter((row) => row.beneficiaryNote !== null);
      const factor = computeHouseholdHealth(household, AS_OF).factors
        .find((candidate) => candidate.id === "beneficiary-completeness")!;
      expect(flagged.length === 0, `${household.key}: health says ${factor.score} while ${flagged.length} account(s) are flagged`)
        .toBe(factor.score === 100);
    }
  });

  describe("detects (companion): a real beneficiary gap is still stated", () => {
    const base = WORLD[0]!;

    it("an IRA with nothing designated is the gap it is", () => {
      const vm = detail(withAccounts(base, [account("ira-traditional", [])]));
      expect(vm.accounts[0]!.beneficiaryNote).toBe("No beneficiary is designated on this account.");
      expect(vm.accounts[0]!.beneficiaryEmptyLabel).toBe("None designated.");
    });

    it("a primary designation that does not total 100% is still stated", () => {
      const partial = [{
        partyKey: base.members[0]!.key,
        displayName: base.members[0]!.displayName,
        tier: "primary" as const,
        shareBps: 6000,
        provenance: anyAccount.provenance,
      }];
      const vm = detail(withAccounts(base, [account("ira-roth", partial)]));
      expect(vm.accounts[0]!.beneficiaryNote).toContain("not 100%");
    });

    it("the same empty account on a joint registration says nothing about a gap", () => {
      const vm = detail(withAccounts(base, [account("joint-wros", [])]));
      expect(vm.accounts[0]!.beneficiaryNote).toBeNull();
    });
  });
});
