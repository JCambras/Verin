import { describe, it, expect } from "vitest";
import { decisionLedgerVacuity } from "../../../scripts/decision-ledger-vacuity";

/**
 * Companion for the decision-ledger operator gates (charter #4). Honest-empty must
 * NOT become a blanket pass: the only emptiness this verdict forgives is the one the
 * ratified D-116 deferral produces, and only where no producer ships.
 */
describe("decisionLedgerVacuity", () => {
  it("fails an empty ledger in dev/CI, where the gate runs against a seeded store", () => {
    expect(decisionLedgerVacuity("development", 0, 0)).toBe("vacuous");
  });

  it("reports an empty ledger as the deferred design in a real deployment", () => {
    expect(decisionLedgerVacuity("staging", 0, 0)).toBe("empty-by-design");
    expect(decisionLedgerVacuity("production", 0, 0)).toBe("empty-by-design");
  });

  it("fails stored-but-uncovered entries in EVERY environment", () => {
    for (const appEnv of ["development", "staging", "production"] as const) {
      expect(decisionLedgerVacuity(appEnv, 5, 0)).toBe("vacuous");
    }
  });

  it("passes only once present entries are actually covered", () => {
    for (const appEnv of ["development", "staging", "production"] as const) {
      expect(decisionLedgerVacuity(appEnv, 5, 5)).toBe("covered");
    }
  });
});
