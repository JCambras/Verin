import { describe, expect, it } from "vitest";
import { buildHouseholdDetailVM } from "@app/households/build-detail";
import { computeHouseholdHealth } from "@domain/world/health";
import {
  BENEFICIARY_CAPABLE_REGISTRATIONS, BENEFICIARY_SCORED_REGISTRATIONS,
  REGISTRATION_TYPES, type WorldAccount, type WorldHousehold,
} from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * TWO QUESTIONS, TWO SETS, THREE STATES (ADR-0057).
 *
 * "Can this registration carry a beneficiary designation?" and "does a missing
 * designation count against this household's health?" are different questions,
 * and one set answering both got the surface wrong in BOTH directions. Scoring
 * every registration invented a deficiency on joint and trust accounts; then
 * wording the empty panel from the health set told a reader that an individual
 * or joint account cannot take a transfer-on-death designation, which is equally
 * untrue.
 *
 * `BENEFICIARY_CAPABLE_REGISTRATIONS` answers the first and only the first;
 * `BENEFICIARY_SCORED_REGISTRATIONS` answers the second and only the second. So
 * the surface has three states, asserted here over the whole committed world:
 * a designation is listed; the registration can carry one and none is on file
 * (a neutral fact, called a gap only where health scores it); the registration
 * takes none at all. The companions prove none of the three is vacuous.
 */

const WORLD: readonly WorldHousehold[] = generateWorld(loadWorldSpec(), WORLD_SEED).households;
const AS_OF = "2026-07-01T00:00:00.000Z";
const CANNOT_CARRY = "This registration does not take a beneficiary designation.";
const NONE_ON_FILE = "None designated.";

const detail = (household: WorldHousehold) => buildHouseholdDetailVM(household, household.id, AS_OF);

const withAccounts = (household: WorldHousehold, accounts: readonly WorldAccount[]): WorldHousehold =>
  ({ ...household, accounts });

const anyAccount = WORLD[0]!.accounts[0]!;
const account = (registration: WorldAccount["registration"], beneficiaries: WorldAccount["beneficiaries"]): WorldAccount =>
  ({ ...anyAccount, registration, beneficiaries });

describe("the two beneficiary sets, and the three states they render", () => {
  it("neither set answers the other's question: scored is a strict subset of capable", () => {
    for (const registration of BENEFICIARY_SCORED_REGISTRATIONS) {
      expect(BENEFICIARY_CAPABLE_REGISTRATIONS.has(registration), `${registration} is scored but not capable`).toBe(true);
    }
    // The sets must actually DIFFER, or splitting them changed nothing.
    const capableUnscored = REGISTRATION_TYPES
      .filter((registration) => BENEFICIARY_CAPABLE_REGISTRATIONS.has(registration))
      .filter((registration) => !BENEFICIARY_SCORED_REGISTRATIONS.has(registration));
    expect(capableUnscored, "a registration that can carry a designation without health scoring it")
      .toEqual(["individual", "joint-wros"]);
  });

  it("states no gap on an account a designation does not govern, anywhere in the world", () => {
    let ungoverned = 0;
    for (const household of WORLD) {
      const vm = detail(household);
      for (const [index, row] of vm.accounts.entries()) {
        const source = household.accounts[index]!;
        if (BENEFICIARY_SCORED_REGISTRATIONS.has(source.registration)) continue;
        ungoverned += 1;
        expect(row.beneficiaryNote, `${household.key}/${source.key} (${source.registration}) must not be reported as a gap`)
          .toBeNull();
      }
    }
    // The world must actually contain the case, or the assertion above passes
    // by describing nothing (charter #4).
    expect(ungoverned, "no ungoverned registration in the world - this proves nothing").toBeGreaterThan(50);
  });

  it("never tells a reader a registration cannot carry a designation when it can", () => {
    let capable = 0;
    let incapable = 0;
    for (const household of WORLD) {
      const vm = detail(household);
      for (const [index, row] of vm.accounts.entries()) {
        const registration = household.accounts[index]!.registration;
        if (BENEFICIARY_CAPABLE_REGISTRATIONS.has(registration)) {
          capable += 1;
          expect(row.beneficiaryEmptyLabel, `${household.key} (${registration}) can carry a designation`).toBe(NONE_ON_FILE);
        } else {
          incapable += 1;
          expect(row.beneficiaryEmptyLabel, `${household.key} (${registration}) cannot carry one`).toBe(CANNOT_CARRY);
        }
      }
    }
    expect(capable, "no capable registration inspected").toBeGreaterThan(50);
    expect(incapable, "no trust or entity registration inspected").toBeGreaterThan(10);
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

  describe("detects (companion): each of the three states is reachable and distinct", () => {
    const base = WORLD[0]!;
    const primary = (shareBps: number) => [{
      partyKey: base.members[0]!.key,
      displayName: base.members[0]!.displayName,
      tier: "primary" as const,
      shareBps,
      provenance: anyAccount.provenance,
    }];

    it("state one: a designation on file is listed, and nothing is stated against it", () => {
      const vm = detail(withAccounts(base, [account("ira-roth", primary(10_000))]));
      expect(vm.accounts[0]!.beneficiaries.length).toBe(1);
      expect(vm.accounts[0]!.beneficiaryNote).toBeNull();
    });

    it("state two, scored: an IRA with nothing designated is the gap it is", () => {
      const vm = detail(withAccounts(base, [account("ira-traditional", [])]));
      expect(vm.accounts[0]!.beneficiaryNote).toBe("No beneficiary is designated on this account.");
      expect(vm.accounts[0]!.beneficiaryEmptyLabel).toBe(NONE_ON_FILE);
    });

    it("state two, unscored: a joint account with nothing designated states the fact, not a gap", () => {
      for (const registration of ["individual", "joint-wros"] as const) {
        const vm = detail(withAccounts(base, [account(registration, [])]));
        expect(vm.accounts[0]!.beneficiaryEmptyLabel, registration).toBe(NONE_ON_FILE);
        expect(vm.accounts[0]!.beneficiaryNote, registration).toBeNull();
      }
    });

    it("state three: a trust or entity account says the registration takes none", () => {
      for (const registration of ["revocable-trust", "irrevocable-trust", "llc-entity", "partnership"] as const) {
        const vm = detail(withAccounts(base, [account(registration, [])]));
        expect(vm.accounts[0]!.beneficiaryEmptyLabel, registration).toBe(CANNOT_CARRY);
        expect(vm.accounts[0]!.beneficiaryNote, registration).toBeNull();
      }
    });

    it("a primary designation that does not total 100% is still stated", () => {
      const vm = detail(withAccounts(base, [account("ira-roth", primary(6000))]));
      expect(vm.accounts[0]!.beneficiaryNote).toContain("not 100%");
    });
  });
});
