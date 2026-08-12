/**
 * HOUSEHOLD HEALTH - a multi-factor breakdown computed from the world's facts
 * (ADR-0057). The number is deliberately NOT stored in the fixture: a health
 * score that ships as a literal is a typed number, and the whole point of this
 * surface is that the figure is EARNED - every factor names the records it read
 * and states, in a sentence, why it scored what it scored.
 *
 * Pure and clock-free: the caller passes `asOf`, so the same household and the
 * same instant always produce the same breakdown. Integer arithmetic only
 * (scores are 0-100, weights are basis points), so no float ever decides a band.
 *
 * Charter #3 / ADR-0022: every input here is fixture-sourced, so the result is a
 * DEMONSTRATION artifact. Callers must publish it through
 * `deriveArtifactProvenance`, which watermarks it and bars it from feeding a
 * compliance decision - this module returns the arithmetic, never the licence.
 */
import { BENEFICIARY_BEARING_REGISTRATIONS, type WorldHousehold } from "./household-world";

export const HEALTH_FACTOR_IDS = [
  "liquidity", "evidence-freshness", "instruction-integrity",
  "beneficiary-completeness", "authority-currency", "operational-load",
] as const;
export type HealthFactorId = (typeof HEALTH_FACTOR_IDS)[number];

export interface HealthFactor {
  readonly id: HealthFactorId;
  readonly label: string;
  /** 0-100, integer. */
  readonly score: number;
  /** Basis points of the composite; the six weights sum to 10000. */
  readonly weightBps: number;
  /** One sentence a person can act on - never a bare number. */
  readonly statement: string;
  /** The records this factor actually read, for the "why" affordance. */
  readonly readRecords: readonly string[];
}

export const HEALTH_BANDS = ["needs-attention", "watch", "healthy"] as const;
export type HealthBand = (typeof HEALTH_BANDS)[number];

export interface HouseholdHealth {
  /** 0-100, integer: the weighted composite of the six factors. */
  readonly score: number;
  readonly band: HealthBand;
  readonly factors: readonly HealthFactor[];
  readonly asOf: string;
}

const WEIGHTS: Record<HealthFactorId, number> = {
  liquidity: 2500,
  "evidence-freshness": 2000,
  "instruction-integrity": 2000,
  "beneficiary-completeness": 1500,
  "authority-currency": 1000,
  "operational-load": 1000,
};

const MS_PER_DAY = 86_400_000;
const clamp = (value: number): number => (value < 0 ? 0 : value > 100 ? 100 : Math.trunc(value));
const daysBetween = (fromIso: string, toIso: string): number =>
  Math.trunc((Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_DAY);
const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

function liquidityFactor(household: WorldHousehold): Omit<HealthFactor, "weightBps"> {
  const cashMinor = household.accounts.reduce(
    (total, account) =>
      total + account.holdings.filter((h) => h.assetClass === "cash").reduce((sum, h) => sum + h.marketValueMinor, 0),
    0,
  );
  const monthlyDrawMinor = household.plannedWithdrawals.reduce((sum, w) => sum + w.monthlyMinor, 0);
  const committedMinor = household.pendingActions
    .filter((action) => action.kind.startsWith("outgoing") && action.state !== "cancelled" && action.state !== "rejected")
    .reduce((sum, action) => sum + action.amountMinor, 0);
  const headroomMinor = cashMinor - committedMinor;
  // Months of planned withdrawals the un-committed cash still covers, capped at
  // a year: twelve months of reserve is full marks and more is not healthier.
  // With no planned draw there is nothing to outrun, so coverage is scored on
  // whether the committed actions are covered at all.
  const monthsCovered = monthlyDrawMinor > 0 && headroomMinor > 0
    ? Math.min(12, Math.trunc(headroomMinor / monthlyDrawMinor))
    : 0;
  const score = monthlyDrawMinor > 0
    ? clamp((monthsCovered * 100) / 12)
    : headroomMinor >= 0 ? 100 : 0;
  const statement = monthlyDrawMinor > 0
    ? `Un-committed cash covers ${monthsCovered} ${plural(monthsCovered, "month", "months")} of the planned draw after ${committedMinor > 0 ? "pending outflows" : "no pending outflows"}.`
    : headroomMinor >= 0
      ? "No planned withdrawal; cash covers every pending outflow."
      : "Pending outflows exceed cash and there is no planned-draw schedule to size them against.";
  return {
    id: "liquidity",
    label: "Liquidity",
    score,
    statement,
    readRecords: [
      `${household.accounts.length} ${plural(household.accounts.length, "account", "accounts")}`,
      `${household.plannedWithdrawals.length} planned ${plural(household.plannedWithdrawals.length, "withdrawal", "withdrawals")}`,
      `${household.pendingActions.length} pending ${plural(household.pendingActions.length, "action", "actions")}`,
    ],
  };
}

function freshnessFactor(household: WorldHousehold, asOf: string): Omit<HealthFactor, "weightBps"> {
  const ages = [
    daysBetween(household.evidence.liquidityObservedAt, asOf),
    daysBetween(household.evidence.positionsObservedAt, asOf),
    daysBetween(household.evidence.instructionsObservedAt, asOf),
  ];
  const oldest = ages.reduce((worst, age) => (age > worst ? age : worst), 0);
  // Full marks inside a week; nothing after ninety days. Linear between.
  const score = oldest <= 7 ? 100 : oldest >= 90 ? 0 : clamp(100 - ((oldest - 7) * 100) / 83);
  return {
    id: "evidence-freshness",
    label: "Evidence freshness",
    score,
    statement: `The oldest material observation is ${oldest} ${plural(oldest, "day", "days")} old.`,
    readRecords: ["liquidity snapshot", "position snapshot", "instruction snapshot"],
  };
}

function instructionFactor(household: WorldHousehold): Omit<HealthFactor, "weightBps"> {
  const current = household.bankInstructions.filter((instruction) => instruction.state === "current");
  const unverified = current.filter((instruction) => instruction.verifiedAt === null);
  const forbidding = household.instructions.filter((instruction) => instruction.polarity === "forbidden" && instruction.effectiveTo === null);
  const requiring = household.instructions.filter((instruction) => instruction.polarity === "required" && instruction.effectiveTo === null);
  // A forbidding and a requiring instruction over the SAME subject is the
  // conflict a person has to resolve; the count is what drives the score down.
  const contested = requiring.filter((required) =>
    forbidding.some((forbidden) => forbidden.subjectRef === required.subjectRef),
  ).length;
  const score = clamp(100 - unverified.length * 35 - contested * 40);
  const statement = unverified.length === 0 && contested === 0
    ? `All ${current.length} current bank ${plural(current.length, "instruction is", "instructions are")} verified and no instruction contests another.`
    : `${unverified.length} unverified bank ${plural(unverified.length, "instruction", "instructions")} and ${contested} contested ${plural(contested, "subject", "subjects")}.`;
  return {
    id: "instruction-integrity",
    label: "Instruction integrity",
    score,
    statement,
    readRecords: [
      `${household.bankInstructions.length} bank ${plural(household.bankInstructions.length, "instruction", "instructions")}`,
      `${household.instructions.length} household ${plural(household.instructions.length, "instruction", "instructions")}`,
    ],
  };
}

function beneficiaryFactor(household: WorldHousehold): Omit<HealthFactor, "weightBps"> {
  const bearing = household.accounts.filter((account) => BENEFICIARY_BEARING_REGISTRATIONS.has(account.registration));
  const complete = bearing.filter((account) => {
    const primaryBps = account.beneficiaries
      .filter((beneficiary) => beneficiary.tier === "primary")
      .reduce((sum, beneficiary) => sum + beneficiary.shareBps, 0);
    return primaryBps === 10_000;
  });
  const score = bearing.length === 0 ? 100 : clamp((complete.length * 100) / bearing.length);
  const statement = bearing.length === 0
    ? "No account in this household carries a beneficiary designation."
    : `${complete.length} of ${bearing.length} beneficiary-bearing ${plural(bearing.length, "account has", "accounts have")} a primary designation totalling 100%.`;
  return {
    id: "beneficiary-completeness",
    label: "Beneficiary completeness",
    score,
    statement,
    readRecords: [`${bearing.length} beneficiary-bearing ${plural(bearing.length, "account", "accounts")}`],
  };
}

function authorityFactor(household: WorldHousehold, asOf: string): Omit<HealthFactor, "weightBps"> {
  const signers = household.accounts.flatMap((account) => account.signers);
  const lapsed = signers.filter((signer) => signer.effectiveTo !== null && Date.parse(signer.effectiveTo) <= Date.parse(asOf));
  const score = signers.length === 0 ? 100 : clamp(100 - (lapsed.length * 100) / signers.length);
  const statement = signers.length === 0
    ? "No account carries a delegated signer; every instruction needs an owner."
    : lapsed.length === 0
      ? `All ${signers.length} signing ${plural(signers.length, "authority is", "authorities are")} current.`
      : `${lapsed.length} of ${signers.length} signing ${plural(signers.length, "authority has", "authorities have")} lapsed.`;
  return {
    id: "authority-currency",
    label: "Authority currency",
    score,
    statement,
    readRecords: [`${signers.length} authorized ${plural(signers.length, "signer", "signers")}`],
  };
}

function operationalFactor(household: WorldHousehold): Omit<HealthFactor, "weightBps"> {
  const stuck = household.pendingActions.filter((action) => action.state === "blocked" || action.state === "rejected");
  const score = clamp(100 - stuck.length * 45);
  const statement = stuck.length === 0
    ? `Nothing is stuck: ${household.pendingActions.length} pending ${plural(household.pendingActions.length, "action is", "actions are")} moving.`
    : `${stuck.length} pending ${plural(stuck.length, "action is", "actions are")} blocked or rejected and needs a person.`;
  return {
    id: "operational-load",
    label: "Operational load",
    score,
    statement,
    readRecords: [`${household.pendingActions.length} pending ${plural(household.pendingActions.length, "action", "actions")}`],
  };
}

function band(score: number): HealthBand {
  return score >= 80 ? "healthy" : score >= 55 ? "watch" : "needs-attention";
}

/** The composite and its six factors, as of the instant the caller supplies. */
export function computeHouseholdHealth(household: WorldHousehold, asOf: string): HouseholdHealth {
  const factors: HealthFactor[] = [
    liquidityFactor(household),
    freshnessFactor(household, asOf),
    instructionFactor(household),
    beneficiaryFactor(household),
    authorityFactor(household, asOf),
    operationalFactor(household),
  ].map((factor) => ({ ...factor, weightBps: WEIGHTS[factor.id] }));
  const weighted = factors.reduce((sum, factor) => sum + factor.score * factor.weightBps, 0);
  const score = Math.trunc(weighted / 10_000);
  return { score, band: band(score), factors, asOf };
}
