import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import {
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_NOW,
  DESTINATION_RESTRICTION,
  FIRMS,
  LOW_HEADROOM_LIQUIDITY,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  decisionIdentityFor,
  firmById,
  resolveFirmId,
  resolveScenarioId,
  scenarioById,
} from "@app/demo/data";
import { headroomMinor } from "@app/demo/build-decision";
import { getJourney } from "@app/demo/journey";
import {
  activateMoneyMovementSetup,
  buildActivatedRecord,
} from "@app/demo/setup-evaluator";
import type {
  SetupActivatedSnapshotVM,
  SetupFirmId,
  SetupSelections,
} from "@app/demo/setup-model";
import { projectReserve } from "@domain/money-movement/reserve-projection";
import { REPO_ROOT } from "./_fence-utils";

/**
 * DEMO SEMANTIC-TRUTH FENCE
 *
 * The setup demo must consume the captain-signed golden facts instead of carrying
 * a second reserve or outcome truth. The signed monthly schedule and firm policy
 * horizons derive the displayed floors through the domain projection. The WHOLE
 * signed liquidity basis - available balance, pending approved activity, and the
 * request being decided - is pinned on BOTH reachable surfaces (the journey stations
 * and the setup request step) so one Smiths request can never be modeled two ways,
 * and the GC-05 low-headroom basis behind the signed-impact card is pinned the same
 * way instead of restated as free-standing literals. The recent bank-change
 * comparison must preserve the signed GC-03/GC-04 dispositions and execution
 * reachability. Failures identify the implementation source with file:line so the
 * owner can remove drift instead of editing another constant.
 */

interface GoldenCase {
  readonly caseId: string;
  readonly scenarioRefNote: string;
  readonly firm: "firm-a" | "firm-b";
  readonly trigger: { readonly maskedRequestSummary: string };
  readonly firmConfiguration: {
    readonly cashReserveMonths: number;
    readonly dualApprovalThresholdUsd: number;
    readonly bankInstructionChangeHandling:
      | "specialist-review"
      | "block-until-independently-verified";
  };
  readonly householdEvidence: readonly {
    readonly evidenceKind: string;
    readonly observedAt: string;
    readonly freshness: string;
    readonly summary: string;
  }[];
  readonly expectedDisposition: "proceed" | "blocked" | "prohibited";
  readonly expectedExecutionEligibility: { readonly eligible: boolean };
  readonly signoff: { readonly status: string; readonly authority: string };
}

/** A whole liquidity basis: never a balance without its pending term and request. */
export interface LiquidityBasis {
  readonly availableMinor: number;
  readonly pendingMinor: number;
  readonly requestMinor: number;
}

export interface SemanticTruth {
  readonly monthlyMinor: number;
  readonly smithsBasis: LiquidityBasis;
  readonly lowHeadroom: LiquidityBasis & {
    readonly reserveMonths: number;
    readonly disposition: "proceed" | "blocked" | "prohibited";
  };
  readonly firms: Record<
    "firm-a" | "firm-b",
    {
      readonly reserveMonths: number;
      readonly thresholdMinor: number;
      readonly bankChangeHandling: string;
      readonly recentDisposition: "proceed" | "blocked" | "prohibited";
      readonly recentExecutionEligible: boolean;
    }
  >;
}

export interface DemoSemanticFacts {
  readonly monthlyMinor: number;
  /** The liquidity basis the journey stations render and derive headroom from. */
  readonly journeyBasis: LiquidityBasis;
  /** The basis the setup request step renders for the same request. */
  readonly setupBasis: LiquidityBasis;
  /** The GC-05 basis behind the setup's low-headroom signed-impact card. */
  readonly lowHeadroomBasis: LiquidityBasis;
  /** The prose that card displays - generated, never hand-restated. */
  readonly lowHeadroomFacts: string;
  /** Whether the low-headroom card's Firm B outcome is blocked, as GC-05 records. */
  readonly lowHeadroomFirmBStatus: string;
  readonly firms: Record<
    "firm-a" | "firm-b",
    {
      readonly reserveMonths: number;
      readonly thresholdMinor: number;
      readonly bankChangeHandling: string;
      readonly displayedReserveMinor: number;
      readonly displayedHeadroomMinor: number;
      readonly recentDisposition: string;
      readonly recentExecutionEligible: boolean;
    }
  >;
}

function sourceRef(relativePath: string, needle: string, occurrence = 0): string {
  const lines = readFileSync(join(REPO_ROOT, relativePath), "utf8").split("\n");
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]!.includes(needle)) continue;
    if (seen === occurrence) return `${relativePath}:${index + 1}`;
    seen += 1;
  }
  return `${relativePath}:1`;
}

function loadGolden(name: string): GoldenCase {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, "fixtures/golden", name), "utf8"),
  ) as GoldenCase;
}

function signed(caseFile: GoldenCase): GoldenCase {
  if (
    caseFile.signoff.status !== "signed" ||
    caseFile.signoff.authority !== "captain"
  ) {
    throw new Error(`${caseFile.caseId} is not captain signed`);
  }
  return caseFile;
}

function monthlyMinorFrom(caseFile: GoldenCase): number {
  const summary = caseFile.householdEvidence.find(
    (evidence) => evidence.evidenceKind === "planned-withdrawals",
  )?.summary;
  const match = summary?.match(/(?:Recurring )?[Pp]lanned withdrawals (\d+) USD\/month/);
  if (!match) {
    throw new Error(
      `${caseFile.caseId} does not carry a parseable planned-withdrawals schedule`,
    );
  }
  return Number(match[1]) * 100;
}

function availableBalanceMinorFrom(
  caseFile: GoldenCase,
  identicalFactsBasis?: LiquidityBasis,
): number {
  for (const evidence of caseFile.householdEvidence) {
    if (evidence.evidenceKind !== "account-balance") continue;
    const match = evidence.summary.match(/available balance (\d+) USD/);
    if (match) return Number(match[1]) * 100;
  }
  if (
    identicalFactsBasis &&
    caseFile.scenarioRefNote.includes("Identical facts to GC-03")
  ) {
    return identicalFactsBasis.availableMinor;
  }
  throw new Error(
    `${caseFile.caseId} does not carry a parseable available balance`,
  );
}

/** Pending approved activity the case records against the household. A case with NO
 * pending-actions evidence records zero - which is exactly why the journey may not
 * deduct an unsigned pending amount on a branch the signed cases say has none. */
function pendingMinorFrom(caseFile: GoldenCase): number {
  const summary = caseFile.householdEvidence.find(
    (evidence) => evidence.evidenceKind === "pending-actions",
  )?.summary;
  if (summary === undefined) return 0;
  const match = summary.match(/[Pp]ending approved distribution of (\d+) USD/);
  if (!match) {
    throw new Error(
      `${caseFile.caseId} carries pending-actions evidence this fence cannot read`,
    );
  }
  return Number(match[1]) * 100;
}

function requestMinorFrom(caseFile: GoldenCase): number {
  const match = caseFile.trigger.maskedRequestSummary.match(/distribute (\d+) USD/);
  if (!match) {
    throw new Error(`${caseFile.caseId} does not carry a parseable request amount`);
  }
  return Number(match[1]) * 100;
}

function basisOf(
  caseFile: GoldenCase,
  identicalFactsBasis?: LiquidityBasis,
): LiquidityBasis {
  return {
    availableMinor: availableBalanceMinorFrom(caseFile, identicalFactsBasis),
    pendingMinor: pendingMinorFrom(caseFile),
    requestMinor: requestMinorFrom(caseFile),
  };
}

function sameBasis(left: LiquidityBasis, right: LiquidityBasis): boolean {
  return (
    left.availableMinor === right.availableMinor &&
    left.pendingMinor === right.pendingMinor &&
    left.requestMinor === right.requestMinor
  );
}

export function sharedLiquidityBasisViolations(
  reference: { readonly caseRef: string; readonly basis: LiquidityBasis },
  comparisons: readonly {
    readonly caseRef: string;
    readonly basis: LiquidityBasis;
  }[],
): string[] {
  return comparisons
    .filter((candidate) => !sameBasis(reference.basis, candidate.basis))
    .map(
      (candidate) =>
        `${candidate.caseRef} liquidity basis (${describeBasis(candidate.basis)}) differs from ${reference.caseRef} (${describeBasis(reference.basis)})`,
    );
}

interface StaleEvidenceAssignment {
  readonly availableCashAsOf: string;
  readonly plannedWithdrawalsAsOf: string;
}

export function staleEvidenceViolations(
  actual: StaleEvidenceAssignment,
  truth: StaleEvidenceAssignment,
): string[] {
  const violations: string[] = [];
  if (actual.availableCashAsOf !== truth.availableCashAsOf) {
    violations.push(
      `${sourceRef("src/app/demo/build-context.ts", "const availableCashAsOf")} :: available cash uses ${actual.availableCashAsOf}, not the signed ${truth.availableCashAsOf}`,
    );
  }
  if (actual.plannedWithdrawalsAsOf !== truth.plannedWithdrawalsAsOf) {
    violations.push(
      `${sourceRef("src/app/demo/build-context.ts", "const plannedWithdrawalsAsOf")} :: planned withdrawals use ${actual.plannedWithdrawalsAsOf}, not the signed stale timestamp ${truth.plannedWithdrawalsAsOf}`,
    );
  }
  return violations;
}

interface StaleImpactAssignment {
  readonly facts: string;
  readonly effect: string;
}

export function staleImpactViolations(
  actual: StaleImpactAssignment,
  plannedWithdrawalsAsOf: string,
  availableCashAsOf: string,
): string[] {
  const where = sourceRef(
    "src/app/demo/build-setup.ts",
    'id: "stale-withdrawals"',
  );
  const expectedFacts = `Planned-withdrawal evidence observed ${plannedWithdrawalsAsOf} · 47 days old`;
  const expectedEffect = `Available cash remains fresh as of ${availableCashAsOf}. Refresh the planned-withdrawal snapshot before reevaluation.`;
  const violations: string[] = [];
  if (actual.facts !== expectedFacts) {
    violations.push(
      `${where} :: GC-09 impact facts "${actual.facts}" do not equal "${expectedFacts}"`,
    );
  }
  if (actual.effect !== expectedEffect) {
    violations.push(
      `${where} :: GC-09 impact effect does not preserve fresh available cash as of ${availableCashAsOf} and the planned-withdrawal refresh path`,
    );
  }
  return violations;
}

interface BankInstructionDateAssignment {
  readonly sourceDate: string;
  readonly sourceAgeDays: number;
  readonly journeyEvidenceDate: string;
  readonly setupProvenanceDate: string;
  readonly setupValue: string;
  readonly impactFacts: string;
  readonly blocker: string;
  readonly inputHash: string;
}

function recentBankInputHash(bankInstructionObservedAt: string): string {
  const scenario = scenarioById("recent-bank-change-block");
  const canonicalInput = {
    scenarioId: scenario.id,
    request: {
      text: CANONICAL_REQUEST.text,
      amountMinor: CANONICAL_REQUEST.amountMinor,
      purpose: CANONICAL_REQUEST.purpose,
      deadline: CANONICAL_REQUEST.deadline,
      destination: BANK_INSTRUCTION.changed,
    },
    evidence: {
      availableCashMinor: SMITHS_LIQUIDITY.availableMinor,
      availableCashObservedAt: OBSERVED_RECENT,
      pendingApprovedMinor: SMITHS_LIQUIDITY.pendingMinor,
      plannedWithdrawalMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
      plannedWithdrawalObservedAt: OBSERVED_RECENT,
      bankInstruction: BANK_INSTRUCTION.changed,
      bankInstructionObservedAt,
      destinationRestrictionRef: DESTINATION_RESTRICTION.ref,
      destinationRestriction: DESTINATION_RESTRICTION.text,
      conflictingFundingInstructions: [],
    },
    branchFacts: {
      invalidation: false,
      competing: false,
      duplicateRetry: false,
      partial: false,
      delayedNigo: false,
      specialistExpired: false,
    },
  };
  return createHash("sha256")
    .update(JSON.stringify(["verin-demo-input-v2", canonicalInput]))
    .digest("hex");
}

export function bankInstructionDateViolations(
  actual: BankInstructionDateAssignment,
  signedDate: string,
): string[] {
  const where = sourceRef(
    "src/app/demo/data.ts",
    "export const OBSERVED_BANK_INSTRUCTION_CHANGED",
  );
  const violations: string[] = [];
  const signedAgeDays =
    (Date.parse(DEMO_NOW) - Date.parse(signedDate)) / 86_400_000;
  if (actual.sourceAgeDays !== signedAgeDays) {
    violations.push(
      `${where} :: displayed age is ${actual.sourceAgeDays} days, not the ${signedAgeDays} days derived from ${signedDate}`,
    );
  }
  for (const [label, value] of [
    ["source", actual.sourceDate],
    ["journey evidence", actual.journeyEvidenceDate],
    ["setup provenance", actual.setupProvenanceDate],
  ] as const) {
    if (value !== signedDate) {
      violations.push(
        `${where} :: ${label} uses ${value}, not signed bank-change date ${signedDate}`,
      );
    }
  }
  for (const [label, value] of [
    ["setup value", actual.setupValue],
    ["impact facts", actual.impactFacts],
    ["blocker", actual.blocker],
  ] as const) {
    if (
      !value.includes(signedDate) ||
      !value.includes(`${signedAgeDays} days`)
    ) {
      violations.push(
        `${where} :: ${label} does not render signed ${signedDate} as ${signedAgeDays} days old`,
      );
    }
  }
  const expectedHash = recentBankInputHash(signedDate);
  if (actual.inputHash !== expectedHash) {
    violations.push(
      `${where} :: canonical input hash does not bind signed bank-change date ${signedDate}`,
    );
  }
  return violations;
}

function describeBasis(basis: LiquidityBasis): string {
  return `available ${basis.availableMinor} · pending ${basis.pendingMinor} · request ${basis.requestMinor}`;
}

export function goldenSemanticTruth(): SemanticTruth {
  const happyA = signed(loadGolden("GC-01-firm-a-happy-path.json"));
  const happyB = signed(loadGolden("GC-02-firm-b-happy-path.json"));
  const recentA = signed(loadGolden("GC-03-recent-bank-change-firm-a.json"));
  const recentB = signed(loadGolden("GC-04-recent-bank-change-firm-b.json"));
  const lowHeadroom = signed(loadGolden("GC-05-insufficient-liquidity.json"));
  const monthlyA = monthlyMinorFrom(happyA);
  const monthlyB = monthlyMinorFrom(happyB);
  const monthlyLow = monthlyMinorFrom(lowHeadroom);
  if (monthlyA !== monthlyB || monthlyA !== monthlyLow) {
    throw new Error("signed cases disagree on the monthly schedule");
  }
  const basisA = basisOf(happyA);
  const basisB = basisOf(happyB);
  const basisRecentA = basisOf(recentA);
  const basisRecentB = basisOf(recentB, basisRecentA);
  const basisViolations = sharedLiquidityBasisViolations(
    { caseRef: happyA.caseId, basis: basisA },
    [
      { caseRef: happyB.caseId, basis: basisB },
      { caseRef: recentA.caseId, basis: basisRecentA },
      { caseRef: recentB.caseId, basis: basisRecentB },
    ],
  );
  if (basisViolations.length > 0) {
    throw new Error(`signed cases disagree on the Smiths liquidity basis: ${basisViolations.join("; ")}`);
  }

  const firm = (
    happy: GoldenCase,
    recent: GoldenCase,
  ): SemanticTruth["firms"]["firm-a"] => ({
    reserveMonths: happy.firmConfiguration.cashReserveMonths,
    thresholdMinor: happy.firmConfiguration.dualApprovalThresholdUsd * 100,
    bankChangeHandling: recent.firmConfiguration.bankInstructionChangeHandling,
    recentDisposition: recent.expectedDisposition,
    recentExecutionEligible: recent.expectedExecutionEligibility.eligible,
  });

  return {
    monthlyMinor: monthlyA,
    smithsBasis: basisA,
    lowHeadroom: {
      ...basisOf(lowHeadroom),
      reserveMonths: lowHeadroom.firmConfiguration.cashReserveMonths,
      disposition: lowHeadroom.expectedDisposition,
    },
    firms: {
      "firm-a": firm(happyA, recentA),
      "firm-b": firm(happyB, recentB),
    },
  };
}

function initialOption(
  groupId: "reserve" | "bank-change",
  firmId: "firm-a" | "firm-b",
) {
  const group = buildMoneyMovementSetup().policyGroups.find(
    (candidate) => candidate.id === groupId,
  );
  return initialOptionOf(group, firmId);
}

function initialOptionOf(
  group: ReturnType<typeof buildMoneyMovementSetup>["policyGroups"][number] | undefined,
  firmId: "firm-a" | "firm-b",
) {
  const firm = group?.firms.find((candidate) => candidate.firmId === firmId);
  const option = firm?.options.find(
    (candidate) => candidate.id === firm.initialOptionId,
  );
  if (!option) throw new Error(`missing ${group?.id ?? "unknown"} initial option for ${firmId}`);
  return option;
}

function setupSelections(): SetupSelections {
  const vm = buildMoneyMovementSetup();
  const selections = {
    "firm-a": {} as SetupSelections["firm-a"],
    "firm-b": {} as SetupSelections["firm-b"],
  };
  for (const group of vm.policyGroups) {
    for (const firm of group.firms) {
      selections[firm.firmId][group.id] = firm.initialOptionId;
    }
  }
  return selections;
}

function activatedSnapshot(
  mutate?: (selections: SetupSelections) => void,
): SetupActivatedSnapshotVM {
  const selections = setupSelections();
  mutate?.(selections);
  const result = activateMoneyMovementSetup(selections);
  if (!result.ok) throw new Error(result.error);
  return result.snapshot;
}

export function demoSemanticFacts(): DemoSemanticFacts {
  const firm = (
    firmId: "firm-a" | "firm-b",
  ): DemoSemanticFacts["firms"]["firm-a"] => {
    const data = FIRMS[firmId]!;
    const reserve = initialOption("reserve", firmId);
    const bank = initialOption("bank-change", firmId);
    const displayedReserveMinor = Number(reserve.reserveMetric?.value);
    return {
      reserveMonths: data.reserveMonths,
      thresholdMinor: data.dualApprovalThresholdMinor,
      bankChangeHandling: data.bankChangeHandling,
      displayedReserveMinor,
      displayedHeadroomMinor: headroomMinor(data),
      recentDisposition: bank.smithsEffect.status.status,
      recentExecutionEligible: bank.smithsEffect.reachesAuthority === true,
    };
  };
  const vm = buildMoneyMovementSetup();
  const renderedMinor = (label: string): number => {
    const value = vm.request.facts.find((candidate) => candidate.label === label)?.metric?.value;
    if (value === undefined) {
      throw new Error(`the setup request step no longer renders "${label}"`);
    }
    return Number(value);
  };
  const lowHeadroomImpact = vm.impacts.find((impact) => impact.id === "low-headroom");
  if (!lowHeadroomImpact) {
    throw new Error("the setup no longer shows the GC-05 low-headroom signed-impact card");
  }
  const lowHeadroomGroup = vm.policyGroups.find(
    (candidate) => candidate.id === lowHeadroomImpact.groupId,
  );
  return {
    monthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    journeyBasis: SMITHS_LIQUIDITY,
    setupBasis: {
      availableMinor: renderedMinor("Available balance"),
      pendingMinor: renderedMinor("Pending approved activity"),
      requestMinor: renderedMinor("Request amount"),
    },
    lowHeadroomBasis: LOW_HEADROOM_LIQUIDITY,
    lowHeadroomFacts: lowHeadroomImpact.facts,
    lowHeadroomFirmBStatus: initialOptionOf(lowHeadroomGroup, "firm-b").signedCaseEffect.status.status,
    firms: { "firm-a": firm("firm-a"), "firm-b": firm("firm-b") },
  };
}

export function semanticTruthViolations(
  actual: DemoSemanticFacts,
  truth: SemanticTruth,
): string[] {
  const violations: string[] = [];
  if (actual.monthlyMinor !== truth.monthlyMinor) {
    violations.push(
      `${sourceRef("src/app/demo/data.ts", "export const PLANNED_WITHDRAWAL_MONTHLY_MINOR")} :: monthly schedule ${actual.monthlyMinor} differs from captain-signed ${truth.monthlyMinor}`,
    );
  }
  if (!sameBasis(actual.journeyBasis, truth.smithsBasis)) {
    violations.push(
      `${sourceRef("src/app/demo/data.ts", "export const SMITHS_LIQUIDITY")} :: journey liquidity basis (${describeBasis(actual.journeyBasis)}) differs from captain-signed (${describeBasis(truth.smithsBasis)})`,
    );
  }
  if (!sameBasis(actual.setupBasis, truth.smithsBasis)) {
    violations.push(
      `${sourceRef("src/app/demo/build-setup.ts", "SMITHS_LIQUIDITY.availableMinor")} :: setup liquidity basis (${describeBasis(actual.setupBasis)}) differs from captain-signed (${describeBasis(truth.smithsBasis)})`,
    );
  }
  if (!sameBasis(actual.setupBasis, actual.journeyBasis)) {
    violations.push(
      `${sourceRef("src/app/demo/data.ts", "export const SMITHS_LIQUIDITY")} :: the setup step models this request as (${describeBasis(actual.setupBasis)}) while the journey stations model it as (${describeBasis(actual.journeyBasis)})`,
    );
  }
  if (!sameBasis(actual.lowHeadroomBasis, truth.lowHeadroom)) {
    violations.push(
      `${sourceRef("src/app/demo/data.ts", "export const LOW_HEADROOM_LIQUIDITY")} :: low-headroom basis (${describeBasis(actual.lowHeadroomBasis)}) differs from captain-signed GC-05 (${describeBasis(truth.lowHeadroom)})`,
    );
  }
  for (const minor of [
    actual.lowHeadroomBasis.availableMinor,
    actual.lowHeadroomBasis.pendingMinor,
    actual.lowHeadroomBasis.requestMinor,
  ]) {
    const dollars = (minor / 100).toLocaleString("en-US");
    if (!actual.lowHeadroomFacts.includes(`$${dollars}`)) {
      violations.push(
        `${sourceRef("src/app/demo/build-setup.ts", "function factsLine")} :: the low-headroom card reads "${actual.lowHeadroomFacts}", which does not state the signed $${dollars} - the prose must be generated from the pinned basis`,
      );
    }
  }
  const lowHeadroomSatisfied = projectReserve({
    availableMinor: truth.lowHeadroom.availableMinor,
    pendingMinor: truth.lowHeadroom.pendingMinor,
    requestMinor: truth.lowHeadroom.requestMinor,
    plannedMonthlyMinor: truth.monthlyMinor,
    reserveMonths: truth.lowHeadroom.reserveMonths,
  }).reserveSatisfied;
  const signedLowHeadroomStatus =
    truth.lowHeadroom.disposition === "blocked" && !lowHeadroomSatisfied ? "blocked" : "proceed";
  if (actual.lowHeadroomFirmBStatus !== signedLowHeadroomStatus) {
    violations.push(
      `${sourceRef("src/app/demo/build-setup.ts", "function reserveOption")} :: the low-headroom card shows firm-b "${actual.lowHeadroomFirmBStatus}" where GC-05 records "${signedLowHeadroomStatus}"`,
    );
  }
  for (const [firmIndex, firmId] of (["firm-a", "firm-b"] as const).entries()) {
    const got = actual.firms[firmId];
    const expected = truth.firms[firmId];
    const prefix = `${firmId}`;
    if (got.reserveMonths !== expected.reserveMonths) {
      violations.push(
        `${sourceRef("src/app/demo/data.ts", "    reserveMonths:", firmIndex)} :: ${prefix} reserve horizon ${got.reserveMonths} differs from signed ${expected.reserveMonths}`,
      );
    }
    if (got.thresholdMinor !== expected.thresholdMinor) {
      violations.push(
        `${sourceRef("src/app/demo/data.ts", "    dualApprovalThresholdMinor:", firmIndex)} :: ${prefix} approval threshold ${got.thresholdMinor} differs from signed ${expected.thresholdMinor}`,
      );
    }
    if (got.bankChangeHandling !== expected.bankChangeHandling) {
      violations.push(
        `${sourceRef("src/app/demo/data.ts", "    bankChangeHandling:", firmIndex)} :: ${prefix} bank-change handling "${got.bankChangeHandling}" differs from signed "${expected.bankChangeHandling}"`,
      );
    }
    const derivedFloor = projectReserve({
      availableMinor: 0,
      pendingMinor: 0,
      requestMinor: 0,
      plannedMonthlyMinor: truth.monthlyMinor,
      reserveMonths: expected.reserveMonths,
    }).requiredReserveMinor;
    if (got.displayedReserveMinor !== derivedFloor) {
      violations.push(
        `${sourceRef("src/app/demo/build-setup.ts", "function reserveOption")} :: ${prefix} displayed reserve ${got.displayedReserveMinor} differs from derived signed floor ${derivedFloor}`,
      );
    }
    // The journey's headroom figure must come off the SAME whole basis the setup
    // uses: dropping the pending term or the request term silently overstates it.
    const derivedHeadroom = projectReserve({
      availableMinor: truth.smithsBasis.availableMinor,
      pendingMinor: truth.smithsBasis.pendingMinor,
      requestMinor: truth.smithsBasis.requestMinor,
      plannedMonthlyMinor: truth.monthlyMinor,
      reserveMonths: expected.reserveMonths,
    }).headroomMinor;
    if (got.displayedHeadroomMinor !== derivedHeadroom) {
      violations.push(
        `${sourceRef("src/app/demo/build-decision.ts", "export function headroomMinor")} :: ${prefix} journey headroom ${got.displayedHeadroomMinor} differs from the signed basis ${derivedHeadroom}`,
      );
    }
    if (got.recentDisposition !== expected.recentDisposition) {
      violations.push(
        `${sourceRef("src/app/demo/build-setup.ts", "function bankOption")} :: ${prefix} recent-change disposition "${got.recentDisposition}" differs from signed "${expected.recentDisposition}"`,
      );
    }
    if (got.recentExecutionEligible !== expected.recentExecutionEligible) {
      violations.push(
        `${sourceRef("src/app/demo/build-setup.ts", "function bankOption")} :: ${prefix} execution reachability ${got.recentExecutionEligible} differs from signed ${expected.recentExecutionEligible}`,
      );
    }
  }
  return violations;
}

/** The identity a setup proof card claims, and the identity its export target
 * actually renders. They must be the same bytes, or the step that asserts hash-bound
 * identity breaks that binding the moment the operator exports. */
export interface ExportIdentity {
  readonly firmId: string;
  readonly firmLabel: string;
  readonly scenarioId: string;
  readonly scenarioLabel: string;
  readonly decisionId: string;
  readonly inputHash: string;
  readonly decisionHash: string;
  readonly bundleHash: string;
  readonly policyVersion: string;
  readonly snapshotVersion: string;
  readonly snapshotHash: string;
  readonly configurationHash: string;
  readonly configurationProvenance: string;
  readonly disposition: string;
  readonly explanation: string;
  readonly authorityMode: string;
  readonly authorityStages: string;
  readonly exportHref: string;
}

export function exportIdentityViolations(
  claimed: readonly ExportIdentity[],
  rendered: (scenarioId: string, firmId: string) => ExportIdentity | null,
): string[] {
  const violations: string[] = [];
  const where = sourceRef(
    "src/app/demo/setup-evaluator.ts",
    "export function activateMoneyMovementSetup",
  );
  for (const identity of claimed) {
    const url = new URL(identity.exportHref, "http://demo.invalid");
    const scenarioId = url.searchParams.get("scenario");
    const firmId = url.searchParams.get("firm");
    if (scenarioId !== identity.scenarioId) {
      violations.push(
        `${where} :: ${identity.firmId} shows scenario "${identity.scenarioId}" but exports scenario "${scenarioId}"`,
      );
      continue;
    }
    if (firmId !== identity.firmId) {
      violations.push(
        `${where} :: ${identity.firmId} exports to firm "${firmId}" - a two-firm proof may not export one firm's record`,
      );
      continue;
    }
    const target = scenarioId === null ? null : rendered(scenarioId, firmId);
    if (target === null) {
      violations.push(`${where} :: ${identity.firmId} exports to an unresolvable record "${identity.exportHref}"`);
      continue;
    }
    for (const field of [
      "scenarioId",
      "scenarioLabel",
      "firmId",
      "firmLabel",
      "decisionId",
      "inputHash",
      "decisionHash",
      "bundleHash",
      "policyVersion",
      "snapshotVersion",
      "snapshotHash",
      "configurationHash",
      "configurationProvenance",
      "disposition",
      "explanation",
      "authorityMode",
      "authorityStages",
    ] as const) {
      if (identity[field] !== target[field]) {
        violations.push(
          `${where} :: ${identity.firmId} shows ${field} "${identity[field]}" before export but the exported record carries "${target[field]}"`,
        );
      }
    }
  }
  const ids = new Set(claimed.map((identity) => identity.decisionId));
  const inputHashes = new Set(claimed.map((identity) => identity.inputHash));
  const hashes = new Set(claimed.map((identity) => identity.decisionHash));
  const bundleHashes = new Set(claimed.map((identity) => identity.bundleHash));
  if (ids.size !== claimed.length || hashes.size !== claimed.length) {
    violations.push(`${where} :: two firm outcomes share one decision identity`);
  }
  if (claimed.length > 1 && inputHashes.size !== 1) {
    violations.push(`${where} :: the same firm-neutral request/evidence has more than one input hash`);
  }
  if (claimed.length > 1 && bundleHashes.size !== claimed.length) {
    violations.push(`${where} :: policy-bearing firm bundles share one bundle hash`);
  }
  return violations;
}

function renderedIdentity(
  snapshot: SetupActivatedSnapshotVM,
  scenarioId: string,
  firmId: string,
): ExportIdentity | null {
  if (resolveScenarioId(scenarioId) === null || resolveFirmId(firmId) === null) return null;
  const record = buildActivatedRecord(snapshot, firmId as SetupFirmId);
  if (
    record.identity.scenario.id !== scenarioId ||
    record.activatedConfiguration === null
  ) {
    return null;
  }
  return {
    firmId: record.identity.firm.id,
    firmLabel: record.identity.firm.label,
    scenarioId: record.identity.scenario.id,
    scenarioLabel: record.identity.scenario.label,
    decisionId: record.identity.decisionId,
    inputHash: record.identity.inputHash,
    decisionHash: record.identity.decisionHash,
    bundleHash: record.identity.bundleHash,
    policyVersion: record.hashes.policyVersion,
    snapshotVersion: record.activatedConfiguration.snapshotVersion,
    snapshotHash: record.activatedConfiguration.snapshotHash,
    configurationHash: record.activatedConfiguration.configurationHash,
    configurationProvenance:
      record.activatedConfiguration.configurationProvenance,
    disposition: record.disposition.kind,
    explanation: record.disposition.why.reason,
    authorityMode: record.approvalStages === null ? "none" : "specialist-review",
    authorityStages: JSON.stringify(record.approvalStages ?? []),
    exportHref: `/app/demo/record?scenario=${record.identity.scenario.id}&firm=${record.identity.firm.id}&activation=${record.activatedConfiguration.snapshotHash}`,
  };
}

function claimedIdentities(
  snapshot: SetupActivatedSnapshotVM,
): readonly [ExportIdentity, ExportIdentity] {
  const identity = (firm: SetupActivatedSnapshotVM["firms"][number]) => ({
    firmId: firm.firmId,
    firmLabel: firm.firmLabel,
    scenarioId: firm.scenarioId,
    scenarioLabel: firm.scenarioLabel,
    decisionId: firm.decisionId,
    inputHash: firm.inputHash,
    decisionHash: firm.decisionHash,
    bundleHash: firm.bundleHash,
    policyVersion: firm.policyVersion,
    snapshotVersion: snapshot.snapshotVersion,
    snapshotHash: snapshot.snapshotHash,
    configurationHash: firm.configurationHash,
    configurationProvenance: firm.configurationProvenance,
    disposition: firm.disposition.kind,
    explanation: firm.disposition.why.reason,
    authorityMode: firm.authorityPlan.mode,
    authorityStages: JSON.stringify(firm.authorityPlan.stages),
    exportHref: firm.exportHref,
  });
  return [identity(snapshot.firms[0]), identity(snapshot.firms[1])];
}

describe("demo semantic-truth fence", () => {
  it("enforces: each firm's export identity equals the record its export target renders", () => {
    const snapshot = activatedSnapshot();
    const violations = exportIdentityViolations(
      claimedIdentities(snapshot),
      (scenarioId, firmId) => renderedIdentity(snapshot, scenarioId, firmId),
    );
    expect(violations, `setup/export identity drift:\n${violations.join("\n")}`).toEqual([]);
  });

  it("enforces: firms share one neutral input hash but carry distinct bundles and decisions", () => {
    const [firmA, firmB] = activatedSnapshot().firms;
    expect(firmA.inputHash).toBe(firmB.inputHash);
    expect(firmA.bundleHash).not.toBe(firmB.bundleHash);
    expect(firmA.decisionId).not.toBe(firmB.decisionId);
    expect(firmA.decisionHash).not.toBe(firmB.decisionHash);
  });

  it("enforces: canonical identity is stable and changes with scenario, firm, or material input", () => {
    const stable = getJourney("safe-proceed", "firm-a").record.identity;
    expect(getJourney("safe-proceed", "firm-a").record.identity).toEqual(stable);

    const prohibited = getJourney(
      "permanent-prohibition",
      "firm-a",
    ).record.identity;
    expect(prohibited.bundleHash).not.toBe(stable.bundleHash);
    expect(prohibited.decisionId).not.toBe(stable.decisionId);
    expect(prohibited.decisionHash).not.toBe(stable.decisionHash);

    const recentA = getJourney(
      "recent-bank-change-block",
      "firm-a",
    ).record.identity;
    const recentB = getJourney(
      "recent-bank-change-block",
      "firm-b",
    ).record.identity;
    expect(recentA.inputHash).toBe(recentB.inputHash);
    expect(recentA.bundleHash).not.toBe(recentB.bundleHash);

    const safeScenario = scenarioById("safe-proceed");
    const materialInputChange = {
      ...safeScenario,
      spec: { ...safeScenario.spec, thirdPartyDestination: true },
    };
    const safeInput = decisionIdentityFor(
      safeScenario,
      firmById("firm-a"),
    );
    const changedInput = decisionIdentityFor(
      materialInputChange,
      firmById("firm-a"),
    );
    expect(changedInput.inputHash).not.toBe(safeInput.inputHash);
    expect(changedInput.bundleHash).not.toBe(safeInput.bundleHash);
    expect(changedInput.decisionId).not.toBe(safeInput.decisionId);

    const initial = activatedSnapshot();
    const changed = activatedSnapshot((selections) => {
      selections["firm-a"].reserve = "9-months";
    });
    expect(changed.firms[0].inputHash).toBe(initial.firms[0].inputHash);
    expect(changed.firms[0].bundleHash).not.toBe(initial.firms[0].bundleHash);
    expect(changed.firms[0].decisionId).not.toBe(initial.firms[0].decisionId);
    expect(changed.firms[0].decisionHash).not.toBe(initial.firms[0].decisionHash);
  });

  it("enforces: activation freezes one immutable configuration and forward-fixes mutations", () => {
    const selections = setupSelections();
    const first = activateMoneyMovementSetup(selections);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const frozenBytes = JSON.stringify(first.snapshot);
    const priorPolicyVersion = first.snapshot.firms[0].policyVersion;
    const priorDisposition = first.snapshot.firms[0].disposition;
    const priorIdentity = {
      decisionId: first.snapshot.firms[0].decisionId,
      inputHash: first.snapshot.firms[0].inputHash,
      bundleHash: first.snapshot.firms[0].bundleHash,
      decisionHash: first.snapshot.firms[0].decisionHash,
    };

    selections["firm-a"].reserve = "9-months";
    expect(JSON.stringify(first.snapshot)).toBe(frozenBytes);
    expect(Object.isFrozen(first.snapshot)).toBe(true);
    expect(Object.isFrozen(first.snapshot.selections["firm-a"])).toBe(true);

    const second = activateMoneyMovementSetup(selections);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.snapshot.snapshotVersion).not.toBe(
      first.snapshot.snapshotVersion,
    );
    expect(second.snapshot.snapshotHash).not.toBe(first.snapshot.snapshotHash);
    expect(second.snapshot.firms[0].policyVersion).not.toBe(priorPolicyVersion);
    expect(second.snapshot.firms[0].policyVersion).not.toBe("FA-4.2");
    expect(second.snapshot.firms[0].configurationProvenance).toBe(
      "Demonstration-only configuration",
    );
    expect(first.snapshot.firms[0].disposition).toEqual(priorDisposition);
    expect({
      decisionId: first.snapshot.firms[0].decisionId,
      inputHash: first.snapshot.firms[0].inputHash,
      bundleHash: first.snapshot.firms[0].bundleHash,
      decisionHash: first.snapshot.firms[0].decisionHash,
    }).toEqual(priorIdentity);
  });

  it("enforces: the evaluator freezes ordered authority stages and export consumes them unchanged", () => {
    const snapshot = activatedSnapshot();
    const firmA = snapshot.firms[0];
    expect(firmA.authorityPlan.mode).toBe("specialist-review");
    expect(firmA.authorityPlan.stages.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
      "Stage 2 - Dual operations approval",
    ]);
    const record = buildActivatedRecord(snapshot, "firm-a");
    expect(record.approvalStages).toBe(firmA.authorityPlan.stages);
    expect(record.approvalStages).toEqual(firmA.authorityPlan.stages);
    expect(Object.isFrozen(firmA.authorityPlan.stages)).toBe(true);
  });

  it("enforces: Firm B mutations add neither a standard approval nor a requester rule", () => {
    const belowThreshold = activatedSnapshot((selections) => {
      selections["firm-b"]["bank-change"] = "specialist";
    });
    const belowThresholdPlan = belowThreshold.firms[1].authorityPlan;
    expect(belowThresholdPlan.stages.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
    ]);
    expect(
      belowThresholdPlan.stages.flatMap((stage) => stage.actors),
    ).not.toContainEqual(
      expect.objectContaining({ requesterExcluded: true }),
    );
    expect(buildActivatedRecord(belowThreshold, "firm-b").approvalStages).toBe(
      belowThresholdPlan.stages,
    );

    const dualApproval = activatedSnapshot((selections) => {
      selections["firm-b"]["bank-change"] = "specialist";
      selections["firm-b"].threshold = "25000";
    });
    const dualPlan = dualApproval.firms[1].authorityPlan;
    expect(dualPlan.stages.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
      "Stage 2 - Dual operations approval",
    ]);
    expect(dualPlan.stages[1]?.requirement).toContain(
      "Requester participation remains unbound",
    );
    expect(
      dualPlan.stages.flatMap((stage) => stage.actors),
    ).not.toContainEqual(
      expect.objectContaining({ requesterExcluded: true }),
    );
  });

  it("enforces: unsupported setup combinations fail closed and name the combination", () => {
    const selections = setupSelections();
    selections["firm-a"].reserve = "18-months";
    const result = activateMoneyMovementSetup(selections);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unsupported setup combination");
    expect(result.error).toContain("firm-a:reserve=18-months");
    expect(result.error).toContain("firm-b[");
  });

  it("enforces: GC-09 freshness stays attached to the signed evidence rows", () => {
    const gc09 = signed(loadGolden("GC-09-stale-evidence.json"));
    const available = gc09.householdEvidence.find(
      (evidence) => evidence.evidenceKind === "account-balance",
    )!;
    const planned = gc09.householdEvidence.find(
      (evidence) => evidence.evidenceKind === "planned-withdrawals",
    )!;
    expect(available.freshness).toBe("fresh");
    expect(planned.freshness).toBe("stale");
    const truth = {
      availableCashAsOf: available.observedAt.slice(0, 10),
      plannedWithdrawalsAsOf: planned.observedAt.slice(0, 10),
    };
    const journey = getJourney("stale-evidence", "firm-a");
    const availableRow = journey.evidence.rows.find(
      (row) =>
        row.kind === "metric" &&
        row.label === "Available cash in the taxable brokerage account",
    );
    const plannedRow = journey.evidence.rows.find(
      (row) =>
        row.kind === "metric" && row.label === "Planned monthly withdrawal",
    );
    expect(availableRow?.kind).toBe("metric");
    expect(plannedRow?.kind).toBe("metric");
    if (availableRow?.kind !== "metric" || plannedRow?.kind !== "metric") return;
    const evidenceViolations = staleEvidenceViolations(
      {
        availableCashAsOf: availableRow.metric.provenance.asOf,
        plannedWithdrawalsAsOf: plannedRow.metric.provenance.asOf,
      },
      truth,
    );
    const workspaceViolations = staleEvidenceViolations(
      {
        availableCashAsOf: journey.workspace.liquidity.provenance.asOf,
        plannedWithdrawalsAsOf:
          journey.workspace.plannedMonthlyWithdrawal.provenance.asOf,
      },
      truth,
    );
    expect(
      [...evidenceViolations, ...workspaceViolations],
      "GC-09 rendered timestamp assignment drift",
    ).toEqual([]);
    const blocker = journey.recommendation.disposition.blockers?.find(
      (candidate) => candidate.condition.includes("Planned-withdrawal"),
    );
    expect(blocker?.condition).toContain("47 days");
    expect(blocker?.affordanceLabel).toBe(
      "Refresh planned-withdrawal evidence",
    );
  });

  it("enforces: GC-09 impact renders the exact signed planned-withdrawal fact", () => {
    const gc09 = signed(loadGolden("GC-09-stale-evidence.json"));
    const available = gc09.householdEvidence.find(
      (evidence) => evidence.evidenceKind === "account-balance",
    )!;
    const planned = gc09.householdEvidence.find(
      (evidence) => evidence.evidenceKind === "planned-withdrawals",
    )!;
    const vm = buildMoneyMovementSetup();
    const impact = vm.impacts.find(
      (candidate) => candidate.id === "stale-withdrawals",
    )!;
    const actual = {
      facts: impact.facts,
      effect: impact.universalEffect ?? "",
    };
    expect(
      staleImpactViolations(
        actual,
        planned.observedAt.slice(0, 10),
        available.observedAt.slice(0, 10),
      ),
    ).toEqual([]);
  });

  it("enforces: the signed bank-change date drives evidence, display, and input identity", () => {
    const gc03 = signed(
      loadGolden("GC-03-recent-bank-change-firm-a.json"),
    );
    const signedDate = gc03.householdEvidence
      .find((evidence) => evidence.evidenceKind === "bank-instruction")!
      .observedAt.slice(0, 10);
    const journey = getJourney("recent-bank-change-block", "firm-a");
    const evidence = journey.evidence.rows.find(
      (row) => row.kind === "fact" && row.label === "Bank instruction on file",
    );
    const vm = buildMoneyMovementSetup();
    const setupFact = vm.request.facts.find(
      (fact) => fact.label === "Bank instruction",
    )!;
    const impact = vm.impacts.find(
      (candidate) => candidate.id === "recent-bank",
    )!;
    const blocker = getJourney(
      "recent-bank-change-block",
      "firm-b",
    ).recommendation.disposition.blockers?.[0];
    expect(evidence?.kind).toBe("fact");
    if (evidence?.kind !== "fact") return;
    expect(
      bankInstructionDateViolations(
        {
          sourceDate: BANK_INSTRUCTION.changedOn,
          sourceAgeDays: BANK_INSTRUCTION.changedAgeDays,
          journeyEvidenceDate: evidence.fact.provenance.asOf,
          setupProvenanceDate: setupFact.provenance.asOf,
          setupValue: setupFact.value ?? "",
          impactFacts: impact.facts,
          blocker: blocker?.condition ?? "",
          inputHash: decisionIdentityFor(
            scenarioById("recent-bank-change-block"),
            firmById("firm-a"),
          ).inputHash,
        },
        signedDate,
      ),
    ).toEqual([]);
  });

  it("detects: swapped GC-09 evidence timestamps cannot pass", () => {
    const truth = {
      availableCashAsOf: "2026-07-26",
      plannedWithdrawalsAsOf: "2026-06-09",
    };
    const violations = staleEvidenceViolations(
      {
        availableCashAsOf: truth.plannedWithdrawalsAsOf,
        plannedWithdrawalsAsOf: truth.availableCashAsOf,
      },
      truth,
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("build-context.ts:");
    expect(violations[1]).toContain("planned withdrawals");
  });

  it("detects: generic GC-09 copy or a timestamp swap cannot pass", () => {
    const violations = staleImpactViolations(
      {
        facts: "Reserve evidence is stale",
        effect: "Refresh the reserve evidence",
      },
      "2026-06-09",
      "2026-07-26",
    );
    expect(violations).toHaveLength(2);
    expect(violations.join("\n")).toContain("planned-withdrawal");
  });

  it("detects: a bank-change timestamp not bound through hashing cannot pass", () => {
    const violations = bankInstructionDateViolations(
      {
        sourceDate: "2026-07-24",
        sourceAgeDays: 2,
        journeyEvidenceDate: "2026-07-24",
        setupProvenanceDate: "2026-07-24",
        setupValue: "Changed 2 days ago",
        impactFacts: "Change 2 days ago",
        blocker: "Changed recently",
        inputHash: recentBankInputHash("2026-07-24"),
      },
      "2026-07-22",
    );
    expect(violations).toHaveLength(8);
    expect(violations.at(-1)).toContain("canonical input hash");
  });

  it("detects: GC-04 liquidity drift cannot hide behind the first three signed cases", () => {
    const basis = {
      availableMinor: 42_000_000,
      pendingMinor: 0,
      requestMinor: 7_500_000,
    };
    const violations = sharedLiquidityBasisViolations(
      { caseRef: "GC-01", basis },
      [
        { caseRef: "GC-02", basis },
        { caseRef: "GC-03", basis },
        {
          caseRef: "GC-04",
          basis: { ...basis, requestMinor: basis.requestMinor + 100 },
        },
      ],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("GC-04");
  });

  describe("detects (companion): a proof that cannot survive its own export", () => {
    it("flags a hardcoded firm-a export behind a Firm B proof card", () => {
      const snapshot = activatedSnapshot();
      const [firmA, firmB] = claimedIdentities(snapshot);
      const violations = exportIdentityViolations(
        [firmA, { ...firmB, exportHref: firmA.exportHref }],
        (scenarioId, firmId) => renderedIdentity(snapshot, scenarioId, firmId),
      );
      expect(violations.some((violation) => violation.includes("may not export one firm's record"))).toBe(true);
    });

    it("flags an invented input hash that the exported record does not carry", () => {
      const snapshot = activatedSnapshot();
      const [firmA, firmB] = claimedIdentities(snapshot);
      const violations = exportIdentityViolations(
        [{ ...firmA, inputHash: "sha256:demo-7b15c2b2e2a7f0c9" }, firmB],
        (scenarioId, firmId) => renderedIdentity(snapshot, scenarioId, firmId),
      );
      expect(violations.some((violation) =>
        violation.includes("inputHash") && violation.includes("but the exported record carries"),
      )).toBe(true);
    });

    it("flags two policy-bearing firm bundles sharing one bundle hash", () => {
      const snapshot = activatedSnapshot();
      const [firmA, firmB] = claimedIdentities(snapshot);
      const violations = exportIdentityViolations(
        [firmA, { ...firmB, bundleHash: firmA.bundleHash }],
        (scenarioId, firmId) => renderedIdentity(snapshot, scenarioId, firmId),
      );
      expect(violations.some((violation) => violation.includes("share one bundle hash"))).toBe(true);
    });

    it("flags two firm outcomes sharing one decision identity", () => {
      const snapshot = activatedSnapshot();
      const [firmA] = claimedIdentities(snapshot);
      const violations = exportIdentityViolations(
        [firmA, firmA],
        (scenarioId, firmId) => renderedIdentity(snapshot, scenarioId, firmId),
      );
      expect(violations.some((violation) => violation.includes("share one decision identity"))).toBe(true);
    });
  });

  it("enforces: setup reserve and comparison facts derive from captain-signed cases", () => {
    const violations = semanticTruthViolations(
      demoSemanticFacts(),
      goldenSemanticTruth(),
    );
    expect(
      violations,
      `setup/golden semantic drift:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("enforces: every signed-impact card opens on the captain-signed option", () => {
    const vm = buildMoneyMovementSetup();
    const compared = vm.impacts.filter((impact) => impact.groupId !== null);
    expect(compared.length).toBeGreaterThan(0);
    for (const impact of compared) {
      const group = vm.policyGroups.find((candidate) => candidate.id === impact.groupId);
      expect(group, `impact "${impact.id}" references unknown group "${impact.groupId}"`).toBeDefined();
      for (const firm of group!.firms) {
        const option = firm.options.find((candidate) => candidate.id === firm.initialOptionId);
        expect(
          option?.truthLabel,
          `"${impact.id}" opens on a non-signed ${firm.firmId} option, so its captain-signed card would show an unsigned outcome`,
        ).toBe("Signed");
      }
    }
  });

  it("enforces: the bounded setup leaves requester participation unresolved", () => {
    const vm = buildMoneyMovementSetup();
    expect(vm.policyGroups).toHaveLength(5);
    expect(vm.policyGroups.map((group) => group.id)).not.toContain("requester");
    expect(vm.baseline.find((row) => row.label === "Requester participation")?.value)
      .toBe("Awaiting captain decision");
    expect(vm.activation.requesterDecisionNotice).toContain("unbound");
  });

  describe("detects (companion): drifted setup truth cannot pass", () => {
    it("flags a second monthly schedule with file:line", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, monthlyMinor: actual.monthlyMinor - 100 },
        goldenSemanticTruth(),
      );
      expect(violations[0]).toContain("src/app/demo/data.ts:");
      expect(violations[0]).toContain("monthly schedule");
    });

    it("flags a journey liquidity input the signed cases do not state", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, journeyBasis: { ...actual.journeyBasis, availableMinor: 20_000_000 } },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("src/app/demo/data.ts:") &&
        violation.includes("journey liquidity basis"),
      )).toBe(true);
    });

    it("flags an unsigned pending amount deducted on a branch that records none", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, journeyBasis: { ...actual.journeyBasis, pendingMinor: 4_000_000 } },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("journey liquidity basis") && violation.includes("pending 4000000"),
      )).toBe(true);
    });

    it("flags a projection that drops the request being decided", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, setupBasis: { ...actual.setupBasis, requestMinor: 0 } },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("build-setup.ts:") && violation.includes("setup liquidity basis"),
      )).toBe(true);
    });

    it("flags two liquidity models for one request", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          setupBasis: { ...actual.setupBasis, availableMinor: actual.journeyBasis.availableMinor - 100 },
        },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("build-setup.ts:") &&
        violation.includes("setup liquidity basis"),
      )).toBe(true);
      expect(violations.some((violation) =>
        violation.includes("while the journey stations model it as"),
      )).toBe(true);
    });

    it("flags a GC-05 low-headroom basis the signed fixture does not state", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, lowHeadroomBasis: { ...actual.lowHeadroomBasis, pendingMinor: 0 } },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("src/app/demo/data.ts:") &&
        violation.includes("low-headroom basis") &&
        violation.includes("GC-05"),
      )).toBe(true);
    });

    it("flags low-headroom prose that restates numbers the pinned basis does not carry", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, lowHeadroomFacts: "$180,000 available · $20,000 pending · same $75,000 request" },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("build-setup.ts:") &&
        violation.includes("must be generated from the pinned basis"),
      )).toBe(true);
    });

    it("flags a low-headroom card that mislabels the signed GC-05 block", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, lowHeadroomFirmBStatus: "proceed" },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("build-setup.ts:") && violation.includes("GC-05 records"),
      )).toBe(true);
    });

    it("flags a journey headroom computed from a partial basis", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          firms: {
            ...actual.firms,
            "firm-a": {
              ...actual.firms["firm-a"],
              displayedHeadroomMinor: actual.firms["firm-a"].displayedHeadroomMinor + 7_500_000,
            },
          },
        },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("build-decision.ts:") && violation.includes("journey headroom"),
      )).toBe(true);
    });

    it("flags a duplicated or drifted displayed reserve floor", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          firms: {
            ...actual.firms,
            "firm-b": {
              ...actual.firms["firm-b"],
              displayedReserveMinor:
                actual.firms["firm-b"].displayedReserveMinor + 1,
            },
          },
        },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("build-setup.ts:") &&
        violation.includes("displayed reserve"),
      )).toBe(true);
    });

    it("flags a winning-firm rewrite of the signed Firm B block", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          firms: {
            ...actual.firms,
            "firm-b": {
              ...actual.firms["firm-b"],
              recentDisposition: "proceed",
              recentExecutionEligible: true,
            },
          },
        },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("firm-b") &&
        violation.includes("recent-change disposition"),
      )).toBe(true);
      expect(violations.some((violation) =>
        violation.includes("firm-b") &&
        violation.includes("execution reachability"),
      )).toBe(true);
    });
  });
});
