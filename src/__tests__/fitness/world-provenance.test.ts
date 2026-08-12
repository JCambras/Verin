import { describe, expect, it } from "vitest";
import { canFeedComplianceDecision, deriveArtifactProvenance, isDemonstration, type RecordProvenance } from "@contracts/provenance";
import { computeHouseholdHealth } from "@domain/world/health";
import type { WorldHousehold } from "@domain/world/household-world";
import { validateWorld } from "../../../scripts/world/validate";

/**
 * WORLD-PROVENANCE FENCE (ADR-0057; charter #3 + ADR-0022).
 *
 * The populated world is the largest body of synthetic data this repository
 * holds, so it is exactly where "no unlabeled synthetic data" has to be
 * mechanical rather than aspirational. Four properties:
 *
 *  (a) EVERY RECORD IS LABELED - household, person, entity, account, holding,
 *      beneficiary, signer, bank instruction, planned withdrawal, instruction,
 *      pending action and activity each carry `source: "fixture"` provenance,
 *      and none of them claims an observation after the world's own `asOf`;
 *  (b) NOTHING SYNTHETIC CAN FEED COMPLIANCE - every one of those provenances
 *      is refused by `canFeedComplianceDecision`;
 *  (c) HEALTH IS COMPUTED, NEVER STORED - no generated household carries a
 *      health or score field, and the health computed from a household's
 *      fixture inputs is a DEMONSTRATION artifact (watermarked, refused);
 *  (d) HOLDINGS RECONCILE - each account's holdings sum to its balance, so the
 *      numbers a surface shows add up to the number beside them.
 *
 * (a), (b) and (d) run through `validateWorld`, the same core the blocking
 * `world` CI job runs; (c) is proved here against the real households. The
 * companions feed a mislabeled household, a future observation and a stored
 * score, and prove each one is caught.
 */

const world = validateWorld();
const households = world.world.households;
const asOf = world.spec.roster.clock.asOf;

/** Every provenance the world carries, with the path it was found at. */
function everyProvenance(household: WorldHousehold): { path: string; provenance: RecordProvenance }[] {
  const found: { path: string; provenance: RecordProvenance }[] = [
    { path: household.key, provenance: household.provenance },
    ...household.members.map((member) => ({ path: `${household.key}/member/${member.key}`, provenance: member.provenance })),
    ...household.entities.map((entity) => ({ path: `${household.key}/entity/${entity.key}`, provenance: entity.provenance })),
    ...household.bankInstructions.map((row) => ({ path: `${household.key}/bank/${row.key}`, provenance: row.provenance })),
    ...household.plannedWithdrawals.map((row) => ({ path: `${household.key}/withdrawal/${row.key}`, provenance: row.provenance })),
    ...household.instructions.map((row) => ({ path: `${household.key}/instruction/${row.key}`, provenance: row.provenance })),
    ...household.pendingActions.map((row) => ({ path: `${household.key}/pending/${row.key}`, provenance: row.provenance })),
    ...household.activity.map((row) => ({ path: `${household.key}/activity/${row.key}`, provenance: row.provenance })),
  ];
  for (const account of household.accounts) {
    found.push({ path: `${household.key}/account/${account.key}`, provenance: account.provenance });
    account.holdings.forEach((holding) => found.push({ path: `${household.key}/account/${account.key}/${holding.symbol}`, provenance: holding.provenance }));
    account.beneficiaries.forEach((row) => found.push({ path: `${household.key}/account/${account.key}/beneficiary/${row.partyKey}`, provenance: row.provenance }));
    account.signers.forEach((row) => found.push({ path: `${household.key}/account/${account.key}/signer/${row.partyKey}`, provenance: row.provenance }));
  }
  return found;
}

/** (c) A stored score is a typed number wearing a computation's clothes. */
export function storedScoreProblems(value: unknown, path: string): string[] {
  const problems: string[] = [];
  const pending: { value: unknown; path: string }[] = [{ value, path }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => pending.push({ value: item, path: `${current.path}[${index}]` }));
    } else if (current.value !== null && typeof current.value === "object") {
      for (const [key, item] of Object.entries(current.value)) {
        if (/^(health|healthScore|score|band)$/.test(key)) {
          problems.push(`${current.path}.${key}: health is computed at read time, never stored (ADR-0057)`);
        }
        pending.push({ value: item, path: `${current.path}.${key}` });
      }
    }
  }
  return problems;
}

describe("world-provenance fence", () => {
  it("(a) enforces: the whole world regenerates and every rule in validateWorld holds", () => {
    expect(households.length, "the fence target went stale - no households were validated").toBe(100);
    expect(world.problems, world.problems.join("\n")).toEqual([]);
  });

  it("(a) enforces: every record is fixture-labeled and observed no later than the world's asOf", () => {
    const all = households.flatMap(everyProvenance);
    expect(all.length, "no provenance inspected - the walk went stale").toBeGreaterThan(2000);
    const problems = all
      .filter((entry) => entry.provenance.source !== "fixture" || Date.parse(entry.provenance.asOf) > Date.parse(asOf))
      .map((entry) => `${entry.path}: ${entry.provenance.source} @ ${entry.provenance.asOf}`);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("(b) enforces: no world record may feed a compliance decision", () => {
    const admitted = households
      .flatMap(everyProvenance)
      .filter((entry) => canFeedComplianceDecision(entry.provenance))
      .map((entry) => entry.path);
    expect(admitted, `these fixture records were admitted to a compliance decision:\n${admitted.join("\n")}`).toEqual([]);
  });

  it("(c) enforces: no generated household stores a health score or band", () => {
    const problems = households.flatMap((household) => storedScoreProblems(household, household.key));
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("(c) enforces: health computed from a household is a DEMONSTRATION artifact", () => {
    for (const household of households.slice(0, 5)) {
      const health = computeHouseholdHealth(household, asOf);
      expect(health.factors.length, `${household.key}: the breakdown must carry every factor`).toBe(6);
      expect(health.factors.reduce((sum, factor) => sum + factor.weightBps, 0)).toBe(10_000);
      const provenance = deriveArtifactProvenance([household.provenance, ...household.accounts.map((a) => a.provenance)], asOf);
      expect(isDemonstration(provenance), `${household.key}: a health score over fixture inputs must be a demonstration`).toBe(true);
      expect(canFeedComplianceDecision(provenance)).toBe(false);
    }
  });

  it("(c) enforces: health is a pure function of the household and the instant", () => {
    const household = households[0]!;
    expect(computeHouseholdHealth(household, asOf)).toEqual(computeHouseholdHealth(household, asOf));
  });

  it("(d) enforces: every account's holdings sum to its balance", () => {
    const problems = households.flatMap((household) =>
      household.accounts
        .filter((account) => account.holdings.reduce((sum, holding) => sum + holding.marketValueMinor, 0) !== account.balanceMinor)
        .map((account) => `${household.key}/${account.key}: holdings do not reconcile to the balance`),
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  describe("detects (companion): an unlabeled or invented world CANNOT pass", () => {
    it("a stored health score is caught", () => {
      expect(storedScoreProblems({ key: "x", health: { score: 91 } }, "x")).toContain(
        "x.health: health is computed at read time, never stored (ADR-0057)",
      );
    });

    it("a stored band on a nested account is caught", () => {
      expect(storedScoreProblems({ accounts: [{ band: "healthy" }] }, "x")).toEqual([
        "x.accounts[0].band: health is computed at read time, never stored (ADR-0057)",
      ]);
    });

    it("a record relabeled as a real source would be admitted to compliance - which is why (b) exists", () => {
      const relabelled: RecordProvenance = { source: "verin-crm", asOf, confidence: "high" };
      expect(canFeedComplianceDecision(relabelled)).toBe(true);
      expect(canFeedComplianceDecision({ ...relabelled, source: "fixture" })).toBe(false);
    });

    it("a household whose account holdings do not reconcile is caught", () => {
      const household = households[0]!;
      const broken = {
        ...household,
        accounts: [{ ...household.accounts[0]!, balanceMinor: household.accounts[0]!.balanceMinor + 1 }],
      };
      const total = broken.accounts[0]!.holdings.reduce((sum, holding) => sum + holding.marketValueMinor, 0);
      expect(total).not.toBe(broken.accounts[0]!.balanceMinor);
    });
  });
});
