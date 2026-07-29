import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import {
  APPROVAL_CLOCKS,
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_ACTIVATION_EFFECTIVE_AT,
  DEMO_NOW,
  DEMO_RECORD_CREATED_AT,
  DEMO_REQUEST_REF,
  DEMO_TIMELINE,
  DESTINATION_RESTRICTION,
  FIRMS,
  LOW_HEADROOM_LIQUIDITY,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  decisionConfigurationFor,
  decisionIdentityFor,
  firmById,
  resolveFirmId,
  resolveScenarioId,
  scenarioById,
  demoTimestampLabel,
} from "@app/demo/data";
import { headroomMinor } from "@app/demo/build-decision";
import { RESERVE_FLOOR_INPUTS, derivedMetric, fixtureMetric } from "@app/demo/provenance";
import { getJourney } from "@app/demo/journey";
import {
  activateMoneyMovementSetup,
  buildActivatedRecord,
} from "@app/demo/setup-evaluator";
import {
  POSTURE_CONFIGURATION_LABEL,
  configurationPosture,
  type SetupActivatedSnapshotVM,
  type SetupAuthorityPosture,
  type SetupFirmId,
  type SetupSelections,
  type SetupTruthLabel,
} from "@app/demo/setup-model";
import { projectReserve } from "@domain/money-movement/reserve-projection";
import type { DisplayMetric } from "@contracts/metric";
import { isDemonstration } from "@contracts/provenance";
import type { RecordReserveVM, RecordVM } from "@app/demo/model";
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

/** file:line of the implementation a violation OWNS. A needle that no longer matches
 * means the fence went stale and would point every failure at line 1, so it throws
 * instead: a report that cannot name its owner is not a report (charter #4). */
function sourceRef(relativePath: string, needle: string, occurrence = 0): string {
  const lines = readFileSync(join(REPO_ROOT, relativePath), "utf8").split("\n");
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]!.includes(needle)) continue;
    if (seen === occurrence) return `${relativePath}:${index + 1}`;
    seen += 1;
  }
  throw new Error(
    `fence went stale: ${relativePath} no longer contains occurrence ${occurrence} of "${needle}" - update the needle so violations still name their owner`,
  );
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

/** Days between two ISO dates - the ONE place the fence computes an age, so it can
 * never agree with drifted prose by carrying the same hardcoded number. */
function ageDaysBetween(observedAt: string, now: string): number {
  return (Date.parse(now) - Date.parse(observedAt)) / 86_400_000;
}

export function staleImpactViolations(
  actual: StaleImpactAssignment,
  plannedWithdrawalsAsOf: string,
  availableCashAsOf: string,
  now: string,
): string[] {
  const where = sourceRef(
    "src/app/demo/build-setup.ts",
    'id: "stale-withdrawals"',
  );
  const ageDays = ageDaysBetween(plannedWithdrawalsAsOf, now);
  const expectedFacts = `Planned-withdrawal evidence observed ${plannedWithdrawalsAsOf} · ${ageDays} days old`;
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

/**
 * Every place the GC-09 staleness is SPOKEN. The age and the policy allowance are
 * derived from the signed observation and the configured freshness window, so moving
 * the demo clock re-derives all of them together instead of leaving a hand-typed "47
 * days old" beside a date that is now further back.
 */
interface StaleAgeAssignment {
  readonly impactFacts: string;
  readonly blocker: string;
}

export function staleAgeViolations(
  actual: StaleAgeAssignment,
  plannedWithdrawalsAsOf: string,
  now: string,
  freshnessDays: number,
): string[] {
  const ageDays = ageDaysBetween(plannedWithdrawalsAsOf, now);
  const violations: string[] = [];
  const impactWhere = sourceRef(
    "src/app/demo/build-setup.ts",
    'id: "stale-withdrawals"',
  );
  if (!actual.impactFacts.includes(`${ageDays} days old`)) {
    violations.push(
      `${impactWhere} :: the GC-09 impact card reads "${actual.impactFacts}" instead of the ${ageDays} days derived from ${plannedWithdrawalsAsOf}`,
    );
  }
  const blockerWhere = sourceRef(
    "src/app/demo/build-decision.ts",
    "Planned-withdrawal evidence is",
  );
  if (!actual.blocker.includes(`${ageDays} days old`)) {
    violations.push(
      `${blockerWhere} :: the GC-09 blocker reads "${actual.blocker}" instead of the ${ageDays} days derived from ${plannedWithdrawalsAsOf}`,
    );
  }
  if (!actual.blocker.includes(`policy allows ${freshnessDays}`)) {
    violations.push(
      `${blockerWhere} :: the GC-09 blocker does not name the configured ${freshnessDays}-day freshness window`,
    );
  }
  return violations;
}

/**
 * ONE datum, ONE observation date. The taxable account balance IS the signed
 * available-cash figure, so if a screen renders the same dollars twice it must state
 * the same "as of" both times - two dates on one number is a visible contradiction
 * whatever the underlying wiring says.
 */
export function observationDateViolations(
  surface: string,
  displayed: readonly { readonly label: string; readonly metric: DisplayMetric }[],
): string[] {
  const where = sourceRef("src/app/demo/build-context.ts", "const availableCashAsOf");
  const byValue = new Map<string, Map<string, string[]>>();
  for (const { label, metric } of displayed) {
    const key = `${metric.format}:${String(metric.value)}`;
    const dates = byValue.get(key) ?? new Map<string, string[]>();
    dates.set(metric.provenance.asOf, [...(dates.get(metric.provenance.asOf) ?? []), label]);
    byValue.set(key, dates);
  }
  const violations: string[] = [];
  for (const [key, dates] of byValue) {
    if (dates.size < 2) continue;
    const rendered = [...dates]
      .map(([asOf, labels]) => `${labels.join(" / ")} as of ${asOf}`)
      .join("; ");
    violations.push(
      `${where} :: ${surface} renders ${key} under ${dates.size} observation dates - ${rendered}`,
    );
  }
  return violations;
}

/** The three things an exported record says about ONE activated reserve horizon: the
 * prose in the precedence trace, the reserve floor it prints, and the headroom left
 * after this movement. All three derive from the activated `reserveMonths`, so any
 * disagreement means the record contradicts itself in front of an examiner. */
interface ReserveHorizonAssignment {
  readonly reserveMonths: number;
  readonly precedenceReason: string;
  readonly reserveFloorMinor: number;
  readonly headroomMinor: number;
}

/** Spelled forms a horizon could be printed as. Listed so the fence recognises the
 * exact regression it exists to stop: a nine-month activation printing "twelve". */
const HORIZON_WORDS: Readonly<Record<number, string>> = {
  6: "six",
  9: "nine",
  12: "twelve",
};

/** Every horizon an administrator can activate (setup-evaluator RESERVE_MONTHS). */
const SUPPORTED_RESERVE_MONTHS = [6, 9, 12] as const;

export function reserveHorizonViolations(
  actual: ReserveHorizonAssignment,
  supportedMonths: readonly number[],
  basis: LiquidityBasis,
  monthlyMinor: number,
): string[] {
  const where = sourceRef(
    "src/app/demo/build-decision.ts",
    "export function reserveHorizonPhrase",
  );
  const violations: string[] = [];
  if (
    !new RegExp(`\\b${actual.reserveMonths}\\b`).test(actual.precedenceReason)
  ) {
    violations.push(
      `${where} :: the precedence reason "${actual.precedenceReason}" never states the activated ${actual.reserveMonths}-month horizon`,
    );
  }
  for (const months of supportedMonths) {
    if (months === actual.reserveMonths) continue;
    const word = HORIZON_WORDS[months];
    for (const token of [String(months), ...(word === undefined ? [] : [word])]) {
      if (new RegExp(`\\b${token}\\b`, "i").test(actual.precedenceReason)) {
        violations.push(
          `${where} :: the precedence reason states the "${token}" month horizon while the activated horizon is ${actual.reserveMonths} months`,
        );
      }
    }
  }
  const projected = projectReserve({
    availableMinor: basis.availableMinor,
    pendingMinor: basis.pendingMinor,
    requestMinor: basis.requestMinor,
    plannedMonthlyMinor: monthlyMinor,
    reserveMonths: actual.reserveMonths,
  });
  if (actual.reserveFloorMinor !== projected.requiredReserveMinor) {
    violations.push(
      `${where} :: the printed reserve floor ${actual.reserveFloorMinor} is not ${actual.reserveMonths} months of the signed ${monthlyMinor} schedule`,
    );
  }
  if (actual.headroomMinor !== projected.headroomMinor) {
    violations.push(
      `${where} :: the printed headroom ${actual.headroomMinor} does not follow the activated ${actual.reserveMonths}-month floor`,
    );
  }
  return violations;
}

/**
 * A configuration's authority claim measured against the COMPLETE truth-label set of
 * the options it selected. A configuration containing any non-signed choice may not
 * render or export a captain-signed provenance claim: the exported claim must never be
 * stronger than the screen that produced it.
 */
interface ConfigurationClaim {
  readonly firmId: string;
  readonly truthLabels: readonly SetupTruthLabel[];
  readonly posture: SetupAuthorityPosture;
  readonly provenance: string;
}

export function configurationPostureViolations(
  claims: readonly ConfigurationClaim[],
): string[] {
  const where = sourceRef(
    "src/app/demo/setup-evaluator.ts",
    "configurationProvenance: POSTURE_CONFIGURATION_LABEL",
  );
  const violations: string[] = [];
  for (const claim of claims) {
    const expected = configurationPosture(claim.truthLabels);
    if (claim.posture !== expected) {
      violations.push(
        `${where} :: ${claim.firmId} claims posture "${claim.posture}" for truth labels [${claim.truthLabels.join(", ")}], which are "${expected}"`,
      );
    }
    if (claim.provenance !== POSTURE_CONFIGURATION_LABEL[claim.posture]) {
      violations.push(
        `${where} :: ${claim.firmId} renders "${claim.provenance}" for posture "${claim.posture}"`,
      );
    }
    const unsigned = claim.truthLabels.filter((label) => label !== "Signed");
    if (unsigned.length > 0 && claim.provenance === POSTURE_CONFIGURATION_LABEL.signed) {
      violations.push(
        `${where} :: ${claim.firmId} exports a captain-signed claim while ${unsigned.length} of its choices are only [${unsigned.join(", ")}]`,
      );
    }
  }
  return violations;
}

/** A displayed figure reduced to its ADR-0022 derivation trace. */
interface MetricTrace {
  readonly value: number;
  readonly source: string;
  readonly demonstration: boolean;
  readonly derivedFrom: readonly string[];
}

export function metricTraceOf(displayed: DisplayMetric): MetricTrace {
  const provenance = displayed.provenance;
  return {
    value: Number(displayed.value),
    source: provenance.source,
    demonstration: isDemonstration(provenance),
    derivedFrom:
      "derivedFrom" in provenance ? [...provenance.derivedFrom].sort() : [],
  };
}

function evaluatedReserve(
  record: RecordVM,
): Extract<RecordReserveVM, { readonly kind: "evaluated" }> {
  expect(record.reserve.kind).toBe("evaluated");
  if (record.reserve.kind !== "evaluated") {
    throw new Error(`Expected evaluated reserve, received ${record.reserve.kind}`);
  }
  return record.reserve;
}

interface ReserveStateClaim {
  readonly kind: RecordReserveVM["kind"];
  readonly floorMinor?: number;
  readonly headroomMinor?: number;
}

export function reserveStateViolations(
  claim: ReserveStateClaim,
): string[] {
  const hasFigures =
    claim.floorMinor !== undefined || claim.headroomMinor !== undefined;
  if (claim.kind === "evaluated") {
    return claim.floorMinor === undefined || claim.headroomMinor === undefined
      ? ["evaluated reserve state is missing its floor or headroom"]
      : [];
  }
  return hasFigures
    ? [`${claim.kind} reserve state carries evaluated figures`]
    : [];
}

interface TimelineInstant {
  readonly label: string;
  readonly at: string;
}

export function timelineOrderViolations(
  instants: readonly TimelineInstant[],
): string[] {
  const violations: string[] = [];
  for (let index = 0; index < instants.length; index += 1) {
    const current = instants[index]!;
    const currentTime = Date.parse(current.at);
    if (!Number.isFinite(currentTime)) {
      violations.push(`${current.label} has an invalid timestamp`);
      continue;
    }
    const prior = instants[index - 1];
    if (prior && currentTime < Date.parse(prior.at)) {
      violations.push(`${current.label} occurs before ${prior.label}`);
    }
  }
  return violations;
}

/**
 * The SAME displayed figure, drawn on two steps, must carry one derivation trace.
 * A reserve floor whose leaf sources depend on which screen rendered it understates
 * its own inputs on one of them (charter #3 / ADR-0022).
 */
export function derivationTraceViolations(
  label: string,
  setupStep: MetricTrace,
  activated: MetricTrace,
): string[] {
  const where = sourceRef(
    "src/app/demo/provenance.ts",
    "export const RESERVE_FLOOR_INPUTS",
  );
  const violations: string[] = [];
  if (setupStep.value !== activated.value) {
    violations.push(
      `${where} :: ${label} shows ${setupStep.value} on the setup step but ${activated.value} in the activated snapshot`,
    );
  }
  if (setupStep.source !== activated.source) {
    violations.push(
      `${where} :: ${label} is sourced "${setupStep.source}" on the setup step and "${activated.source}" in the activated snapshot`,
    );
  }
  if (setupStep.demonstration !== activated.demonstration) {
    violations.push(
      `${where} :: ${label} is a demonstration artifact on only one of the two steps`,
    );
  }
  if (
    setupStep.derivedFrom.join("|") !== activated.derivedFrom.join("|")
  ) {
    violations.push(
      `${where} :: ${label} traces to [${setupStep.derivedFrom.join(", ")}] on the setup step but [${activated.derivedFrom.join(", ")}] in the activated snapshot`,
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
  /** The request headline the setup step prints. It names the age without the date, so
   * it is checked for the derived age only - but it IS checked: a hand-typed "4 days
   * ago" beside a derived one is exactly how the signed date stops being the source. */
  readonly requestSummary: string;
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
  if (!actual.requestSummary.includes(`${signedAgeDays} days ago`)) {
    violations.push(
      `${where} :: request summary does not render the ${signedAgeDays} days derived from signed ${signedDate}`,
    );
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
    lowHeadroomFirmBStatus:
      initialOptionOf(lowHeadroomGroup, "firm-b").signedCaseEffect?.status.status ??
      "(the low-headroom group carries no signed-case effect)",
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
  readonly authorityReached: string;
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
      "authorityReached",
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
    authorityReached: String(record.approvalStages !== null),
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
    authorityReached: String(firm.authorityPlan.reached),
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
    // A mutated combination never retains a captain-signed badge (F1): the 9-month
    // horizon is a supported house default, not a signed one.
    expect(second.snapshot.firms[0].configurationPosture).toBe("house-default");
    expect(second.snapshot.firms[0].configurationProvenance).toBe(
      POSTURE_CONFIGURATION_LABEL["house-default"],
    );
    expect(second.snapshot.firms[0].configurationProvenance).not.toContain("Captain-signed");
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
    expect(firmA.authorityPlan.reached).toBe(true);
    expect(firmA.authorityPlan.stages.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
      "Stage 2 - Dual operations approval",
    ]);
    const record = buildActivatedRecord(snapshot, "firm-a");
    expect(record.approvalStages).toBe(firmA.authorityPlan.stages);
    expect(record.approvalStages).toEqual(firmA.authorityPlan.stages);
    expect(Object.isFrozen(firmA.authorityPlan.stages)).toBe(true);
  });

  it("enforces: activation, decision, authority, and evidence age share the July 28 timeline", () => {
    expect(DEMO_NOW).toBe("2026-07-28");
    const setup = buildMoneyMovementSetup();
    expect(setup.activation.effectiveAt).toBe(DEMO_ACTIVATION_EFFECTIVE_AT);
    expect(setup.request.requestRef).toBe(DEMO_REQUEST_REF);

    const snapshot = activatedSnapshot();
    expect(snapshot.activatedAt).toBe(DEMO_ACTIVATION_EFFECTIVE_AT);
    const firmAStages = snapshot.firms[0].authorityPlan.stages;
    expect(firmAStages[0]?.actors[0]?.statusLabel).toBe(
      `Reviewed · ${demoTimestampLabel(DEMO_TIMELINE.specialistReviewedAt)}`,
    );
    expect(firmAStages[1]?.actors[0]?.statusLabel).toBe(
      `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval1At)}`,
    );
    expect(firmAStages[1]?.actors[1]?.statusLabel).toBe(
      `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval2At)}`,
    );

    expect(
      timelineOrderViolations([
        { label: "activation", at: DEMO_TIMELINE.activationAt },
        { label: "decision", at: DEMO_TIMELINE.decisionCreatedAt },
        {
          label: "specialist review",
          at: DEMO_TIMELINE.specialistReviewedAt,
        },
        {
          label: "operations approval 1",
          at: DEMO_TIMELINE.operationsApproval1At,
        },
        {
          label: "operations approval 2",
          at: DEMO_TIMELINE.operationsApproval2At,
        },
      ]),
    ).toEqual([]);

    const record = buildActivatedRecord(snapshot, "firm-a");
    expect(record.header.createdAt).toBe(DEMO_RECORD_CREATED_AT);
    const journeyStages = getJourney(
      "recent-bank-change-block",
      "firm-a",
    ).record.approvalStages;
    expect(journeyStages?.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
      "Stage 2 - Dual operations approval",
    ]);
    expect(journeyStages?.[0]?.actors[0]?.statusLabel).toBe(
      `Reviewed · ${demoTimestampLabel(DEMO_TIMELINE.specialistReviewedAt)}`,
    );
    expect(BANK_INSTRUCTION.changedAgeDays).toBe(6);
    expect(
      buildMoneyMovementSetup().impacts.find(
        (impact) => impact.id === "stale-withdrawals",
      )?.facts,
    ).toContain("49 days old");

    const expired = getJourney(
      "specialist-review-expiration",
      "firm-a",
    ).record.approvalStages;
    expect(expired?.[0]?.stepState).toBe("active");
    expect(expired?.[1]?.stepState).toBe("pending");
    expect(expired?.[1]?.actors.every((actor) => actor.status !== "done")).toBe(
      true,
    );
  });

  it("detects: authority events cannot occur before their prerequisite stage", () => {
    expect(
      timelineOrderViolations([
        { label: "specialist review", at: "2026-07-28T15:15:00.000Z" },
        { label: "operations approval", at: "2026-07-28T14:31:00.000Z" },
      ]),
    ).toEqual(["operations approval occurs before specialist review"]);
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

  it("enforces: an empty truth-label set cannot become a signed configuration", () => {
    expect(() => configurationPosture([])).toThrow(
      "requires at least one selected option",
    );
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
    expect(blocker?.affordanceLabel).toBe(
      "Refresh planned-withdrawal evidence",
    );
    // The spoken age and the policy allowance are DERIVED - not two hand-typed numbers
    // that keep asserting "47 days old" once the demo clock moves.
    const ageViolations = staleAgeViolations(
      {
        impactFacts: buildMoneyMovementSetup().impacts.find(
          (candidate) => candidate.id === "stale-withdrawals",
        )!.facts,
        blocker: blocker?.condition ?? "",
      },
      truth.plannedWithdrawalsAsOf,
      DEMO_NOW,
      decisionConfigurationFor(firmById("firm-a")).freshnessDays,
    );
    expect(ageViolations, ageViolations.join("\n")).toEqual([]);
  });

  it("detects: a hand-typed staleness age or policy allowance cannot pass", () => {
    const violations = staleAgeViolations(
      {
        impactFacts: "Planned-withdrawal evidence observed 2026-06-09 · 47 days old",
        blocker: "Planned-withdrawal evidence is 47 days old; policy allows 30",
      },
      "2026-06-09",
      // The same screenshot refresh the finding describes: move the demo clock and the
      // hand-typed 47 stops being true while the date beside it stays put.
      "2026-08-10",
      14,
    );
    expect(violations).toHaveLength(3);
    expect(violations[0]).toContain("build-setup.ts:");
    expect(violations[1]).toContain("build-decision.ts:");
    expect(violations[2]).toContain("14-day freshness window");
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
        DEMO_NOW,
      ),
    ).toEqual([]);
  });

  it("enforces: the exported record's reserve prose, floor, and headroom all name the ACTIVATED horizon", () => {
    for (const months of SUPPORTED_RESERVE_MONTHS) {
      const snapshot = activatedSnapshot((selections) => {
        selections["firm-a"].reserve = `${months}-months`;
      });
      const record = buildActivatedRecord(snapshot, "firm-a");
      const reserve = evaluatedReserve(record);
      const reserveRow = record.precedence.find((row) =>
        row.rule.startsWith("Cash-reserve floor"),
      );
      expect(reserveRow, "the record lost its cash-reserve precedence row").toBeDefined();
      // Floor and headroom are read off the EXPORTED artifact (record.reserve), the
      // same object src/app/demo/surfaces/record.tsx renders through <Metric>.
      const violations = reserveHorizonViolations(
        {
          reserveMonths: months,
          precedenceReason: reserveRow?.why?.reason ?? "",
          reserveFloorMinor: Number(reserve.floor.value),
          headroomMinor: Number(reserve.headroom.value),
        },
        SUPPORTED_RESERVE_MONTHS,
        SMITHS_LIQUIDITY,
        PLANNED_WITHDRAWAL_MONTHLY_MINOR,
      );
      expect(
        violations,
        `activated ${months}-month horizon drift:\n${violations.join("\n")}`,
      ).toEqual([]);
      // The horizon prose the record prints and the floor the setup step showed must
      // be the same activated number, not two independently-correct figures.
      expect(reserve.horizon).toBe(`${months} months of planned withdrawals`);
      expect(Number(reserve.floor.value)).toBe(
        Number(snapshot.firms[0].reserveMetric.value),
      );
    }
  });

  it("enforces: reserve figures exist only when precedence establishes evaluation", () => {
    const evaluated = evaluatedReserve(
      getJourney("safe-proceed", "firm-a").record,
    );
    expect(
      reserveStateViolations({
        kind: evaluated.kind,
        floorMinor: Number(evaluated.floor.value),
        headroomMinor: Number(evaluated.headroom.value),
      }),
    ).toEqual([]);

    const stale = getJourney("stale-evidence", "firm-a").record.reserve;
    expect(stale.kind).toBe("not-evaluated");
    expect(reserveStateViolations({ kind: stale.kind })).toEqual([]);
    expect("floor" in stale).toBe(false);
    expect("headroom" in stale).toBe(false);
    expect(
      getJourney("stale-evidence", "firm-a").record.precedence.find(
        (row) => row.rule.startsWith("Cash-reserve floor"),
      )?.result,
    ).toContain("Cannot evaluate");

    const prohibitedRecord = getJourney(
      "permanent-prohibition",
      "firm-a",
    ).record;
    const prohibited = prohibitedRecord.reserve;
    expect(prohibited.kind).toBe("not-applicable");
    expect(reserveStateViolations({ kind: prohibited.kind })).toEqual([]);
    expect("floor" in prohibited).toBe(false);
    expect("headroom" in prohibited).toBe(false);
    const prohibitedTrace = prohibitedRecord.precedence.find((row) =>
      row.rule.startsWith("Cash-reserve floor"),
    );
    expect(prohibitedTrace?.result).toContain("Not applicable");
    expect(prohibitedTrace?.why?.reason).not.toContain(
      "months of planned withdrawals",
    );
    expect(
      prohibitedRecord.precedence
        .slice(1)
        .every((row) => row.result.startsWith("Not applicable")),
    ).toBe(true);
  });

  it("detects: non-evaluated and non-applicable reserve states cannot carry figures", () => {
    expect(
      reserveStateViolations({
        kind: "not-evaluated",
        floorMinor: 4_800_000,
        headroomMinor: 29_700_000,
      }),
    ).toEqual(["not-evaluated reserve state carries evaluated figures"]);
    expect(
      reserveStateViolations({
        kind: "not-applicable",
        floorMinor: 4_800_000,
      }),
    ).toEqual(["not-applicable reserve state carries evaluated figures"]);
  });

  it("enforces: the record's reserve floor and headroom declare every leaf they stand on", () => {
    const snapshot = activatedSnapshot();
    const activated = buildActivatedRecord(snapshot, "firm-a");
    const journey = getJourney("recent-bank-change-block", "firm-a").record;
    for (const [label, record] of [
      ["the activated record", activated],
      ["the fixture-journey record", journey],
    ] as const) {
      const reserve = evaluatedReserve(record);
      const floor = metricTraceOf(reserve.floor);
      const headroom = metricTraceOf(reserve.headroom);
      expect(floor.demonstration, `${label} floor must be a demonstration`).toBe(true);
      expect(headroom.demonstration, `${label} headroom must be a demonstration`).toBe(true);
      // A derived figure may never claim a NARROWER lineage than one of its own
      // inputs: the headroom is computed from the floor (ADR-0022's flattening rule).
      for (const leaf of floor.derivedFrom) {
        expect(
          headroom.derivedFrom,
          `${label} headroom traces to [${headroom.derivedFrom.join(", ")}] but its reserve floor traces to [${floor.derivedFrom.join(", ")}]`,
        ).toContain(leaf);
      }
      // The request being decided is a demo entry on BOTH paths, so the headroom that
      // subtracts it always reaches the user-input leaf.
      expect(headroom.derivedFrom).toContain("user-input");
    }
    // The activated horizon is administrator-entered; the journey horizon is a FIRMS
    // fixture. Same arithmetic, honestly different leaves.
    expect(
      metricTraceOf(evaluatedReserve(activated).floor).derivedFrom,
    ).toContain("user-input");
    expect(
      metricTraceOf(evaluatedReserve(journey).floor).derivedFrom,
    ).toEqual(["fixture"]);
  });

  it("enforces: a configuration may claim only the authority its complete truth-label set carries", () => {
    const vm = buildMoneyMovementSetup();
    const labelsOf = (firmId: SetupFirmId, selections: SetupSelections) =>
      vm.policyGroups.map(
        (group) =>
          group.firms
            .find((firm) => firm.firmId === firmId)!
            .options.find((option) => option.id === selections[firmId][group.id])!
            .truthLabel,
      );
    const cases: { readonly name: string; readonly mutate?: (s: SetupSelections) => void }[] = [
      { name: "untouched defaults" },
      { name: "a supported reserve horizon", mutate: (s) => { s["firm-a"].reserve = "9-months"; } },
      { name: "a recommended expiry clock", mutate: (s) => { s["firm-a"].expiry = "1d-3d"; s["firm-b"].expiry = "1d-3d"; } },
    ];
    for (const { name, mutate } of cases) {
      const selections = setupSelections();
      mutate?.(selections);
      const snapshot = activatedSnapshot(mutate);
      const claims = snapshot.firms.map((firm) => ({
        firmId: firm.firmId,
        truthLabels: labelsOf(firm.firmId, selections),
        posture: firm.configurationPosture,
        provenance: firm.configurationProvenance,
      }));
      const violations = configurationPostureViolations(claims);
      expect(violations, `${name}:\n${violations.join("\n")}`).toEqual([]);
      // The exported record repeats the claim the screen made, never a stronger one.
      for (const firm of snapshot.firms) {
        expect(
          buildActivatedRecord(snapshot, firm.firmId).activatedConfiguration
            ?.configurationProvenance,
        ).toBe(firm.configurationProvenance);
      }
    }
    // Firm B's untouched profile keeps its FB-2.1 identity but is NOT captain-signed:
    // two of its five defaults are only recommended.
    const untouched = activatedSnapshot();
    expect(untouched.firms[1].policyVersion).toBe("FB-2.1");
    expect(untouched.firms[1].configurationPosture).toBe("recommended");
    expect(untouched.firms[1].configurationProvenance).not.toContain("Captain-signed");
    expect(untouched.firms[0].configurationPosture).toBe("signed");
  });

  it("detects: a captain-signed claim over a merely recommended choice cannot pass", () => {
    const violations = configurationPostureViolations([
      {
        firmId: "firm-b",
        truthLabels: ["Signed", "Recommended", "Signed", "Signed", "Recommended"],
        posture: "signed",
        provenance: POSTURE_CONFIGURATION_LABEL.signed,
      },
    ]);
    expect(violations.some((violation) => violation.includes('are "recommended"'))).toBe(true);
    expect(
      violations.some((violation) => violation.includes("exports a captain-signed claim")),
    ).toBe(true);
  });

  it("enforces: one datum renders one observation date on a screen", () => {
    for (const scenarioId of ["stale-evidence", "recent-bank-change-block", "safe-proceed"]) {
      const journey = getJourney(scenarioId, "firm-a");
      const workspace = [
        ...journey.workspace.accounts.map((account) => ({
          label: `account ${account.name}`,
          metric: account.balance,
        })),
        { label: "available liquidity", metric: journey.workspace.liquidity },
        {
          label: "planned monthly withdrawal",
          metric: journey.workspace.plannedMonthlyWithdrawal,
        },
      ];
      const evidence = journey.evidence.rows.flatMap((row) =>
        row.kind === "metric" ? [{ label: row.label, metric: row.metric }] : [],
      );
      const violations = [
        ...observationDateViolations(`${scenarioId} workspace`, workspace),
        ...observationDateViolations(`${scenarioId} evidence`, evidence),
      ];
      expect(violations, violations.join("\n")).toEqual([]);
    }
  });

  it("detects: one datum stamped with two observation dates cannot pass", () => {
    const violations = observationDateViolations("workspace", [
      {
        label: "Smith Family Taxable",
        metric: fixtureMetric(42_000_000, "currency-minor", "synthetic-fixture", "2026-07-24"),
      },
      {
        label: "available liquidity",
        metric: fixtureMetric(42_000_000, "currency-minor", "synthetic-fixture", "2026-07-26"),
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("2 observation dates");
    expect(violations[0]).toContain("build-context.ts:");
  });

  it("enforces: no closed choice carries a signed-case effect no impact card can reach", () => {
    const vm = buildMoneyMovementSetup();
    const compared = new Set(
      vm.impacts.flatMap((impact) => (impact.groupId ? [impact.groupId] : [])),
    );
    expect(compared.size).toBeGreaterThan(0);
    // Both owners are resolved on the GREEN path, so a renamed anchor fails loudly
    // instead of waiting for a violation to discover the fence went stale.
    const cardsWhere = sourceRef("src/app/demo/build-setup.ts", "impacts: [");
    const effectWhere = sourceRef("src/app/demo/build-setup.ts", "signedCaseEffect");
    const violations: string[] = [];
    for (const group of vm.policyGroups) {
      for (const firm of group.firms) {
        for (const option of firm.options) {
          const reachable = compared.has(group.id);
          if (reachable && !option.signedCaseEffect) {
            violations.push(
              `${cardsWhere} :: a signed-impact card compares "${group.id}" but ${firm.firmId}:${option.id} carries no signed-case effect`,
            );
          }
          if (!reachable && option.signedCaseEffect) {
            violations.push(
              `${effectWhere} :: ${firm.firmId}:${group.id}:${option.id} carries a signed-case effect no impact card renders - ship it or delete it (charter #5)`,
            );
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("enforces: the dual-approval promise is derived from the signed request amount", () => {
    const vm = buildMoneyMovementSetup();
    const threshold = vm.policyGroups.find((group) => group.id === "threshold")!;
    for (const firm of threshold.firms) {
      for (const option of firm.options) {
        const above = CANONICAL_REQUEST.amountMinor > Number(option.id) * 100;
        expect(
          option.smithsEffect.summary.includes("Two distinct operations approvers"),
          `${firm.firmId}:${option.id} promises dual approval ${option.smithsEffect.summary} for a ${CANONICAL_REQUEST.amountMinor} request`,
        ).toBe(above);
      }
    }
  });

  it("enforces: the journey approval clock is the shared catalog entry its id hashes", () => {
    const clock = APPROVAL_CLOCKS[decisionConfigurationFor(firmById("firm-a")).approvalClockId];
    expect(clock, "the hashed approval-clock id has no catalog entry").toBeDefined();
    const stage = getJourney("safe-proceed", "firm-a").approvals?.stages[0];
    expect(stage?.escalation).toBe(clock!.escalation);
    expect(stage?.expiry).toBe(clock!.expiry);
  });

  it("enforces: the reserve floor carries ONE derivation trace on the setup step and the snapshot", () => {
    const vm = buildMoneyMovementSetup();
    const reserveGroup = vm.policyGroups.find((group) => group.id === "reserve")!;
    for (const months of SUPPORTED_RESERVE_MONTHS) {
      const snapshot = activatedSnapshot((selections) => {
        selections["firm-a"].reserve = `${months}-months`;
      });
      const option = reserveGroup.firms
        .find((firm) => firm.firmId === "firm-a")!
        .options.find((candidate) => candidate.id === `${months}-months`)!;
      expect(option.reserveMetric, "the setup option lost its reserve figure").toBeDefined();
      const violations = derivationTraceViolations(
        `the ${months}-month Firm A reserve floor`,
        metricTraceOf(option.reserveMetric!),
        metricTraceOf(snapshot.firms[0].reserveMetric),
      );
      expect(
        violations,
        `reserve-floor provenance drift:\n${violations.join("\n")}`,
      ).toEqual([]);
    }
  });

  it("detects: a reserve floor missing the administrator-chosen horizon leaf cannot pass", () => {
    const complete = metricTraceOf(
      derivedMetric(4_800_000, "currency-minor", RESERVE_FLOOR_INPUTS, DEMO_NOW),
    );
    const understated = metricTraceOf(
      derivedMetric(
        4_800_000,
        "currency-minor",
        RESERVE_FLOOR_INPUTS.filter(
          (input) => input.source !== "user-input",
        ),
        DEMO_NOW,
      ),
    );
    const violations = derivationTraceViolations(
      "the six-month Firm A reserve floor",
      complete,
      understated,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("user-input");
  });

  it("detects: a nine-month activation that prints \"twelve\" cannot pass", () => {
    const violations = reserveHorizonViolations(
      {
        reserveMonths: 9,
        precedenceReason:
          "Firm A preserves twelve months of planned withdrawals in cash.",
        reserveFloorMinor: 12 * PLANNED_WITHDRAWAL_MONTHLY_MINOR,
        headroomMinor: 0,
      },
      SUPPORTED_RESERVE_MONTHS,
      SMITHS_LIQUIDITY,
      PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    );
    expect(violations.some((violation) => violation.includes('"twelve"'))).toBe(true);
    expect(
      violations.some((violation) => violation.includes("never states the activated 9-month")),
    ).toBe(true);
    expect(
      violations.some((violation) => violation.includes("printed reserve floor")),
    ).toBe(true);
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
          requestSummary: vm.request.summary,
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
      DEMO_NOW,
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
        requestSummary: "bank instruction changed 2 days ago",
        inputHash: recentBankInputHash("2026-07-24"),
      },
      "2026-07-22",
    );
    expect(violations).toHaveLength(9);
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

    it("flags drifted firm configuration and names the owning data.ts line, never line 1", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          firms: {
            ...actual.firms,
            "firm-a": {
              ...actual.firms["firm-a"],
              reserveMonths: 7,
              thresholdMinor: 1,
              bankChangeHandling: "block-until-independently-verified",
            },
          },
        },
        goldenSemanticTruth(),
      );
      for (const needle of [
        "reserve horizon 7",
        "approval threshold 1 ",
        "bank-change handling",
      ]) {
        const violation = violations.find((candidate) => candidate.includes(needle));
        expect(violation, `no violation named "${needle}"`).toBeDefined();
        expect(violation).toMatch(/src\/app\/demo\/data\.ts:\d+ ::/);
        expect(violation).not.toContain("data.ts:1 ::");
      }
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
