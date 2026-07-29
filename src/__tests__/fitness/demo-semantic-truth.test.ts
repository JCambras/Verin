import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import {
  signedImpactFixtureMaterialInput,
  signedImpactMaterialInputHash,
  type SignedImpactMaterialInput,
} from "@app/demo/setup-impact-attribution";
import {
  APPROVAL_CLOCKS,
  ACCOUNTS,
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_ACTIVATION_EFFECTIVE_AT,
  DEMO_CAUSAL_SEQUENCE,
  DEMO_NOW,
  DEMO_RECORD_CREATED_AT,
  DEMO_REQUEST_REF,
  DEMO_TIMELINE,
  FIRMS,
  GC15_PENDING_DISTRIBUTION,
  LOW_HEADROOM_LIQUIDITY,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  decisionConfigurationFor,
  demoTimelineViolations,
  firmById,
  resolveFirmId,
  resolveScenarioId,
  scenarioById,
  demoTimestampLabel,
  pendingDistributionDeltaSentence,
} from "@app/demo/data";
import {
  SIGNED_SETUP_CASES,
  signedCaseEvaluationEvidence,
  signedCaseMaterialEvidence,
} from "@app/demo/setup-signed-cases";
import { evaluateSetupPolicy } from "@app/demo/setup-policy";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
} from "@app/demo/decision-evidence";
import {
  approvalReceiptHashFor,
  decisionAuthorityClaimFor,
  decisionBundlePreimageFor,
  decisionAuthorityRequirementsFor,
  decisionInputIdentitiesFor,
  decisionRecordPreimageFor,
  decisionInputHashFor,
  decisionInputPreimageFor,
  refreshedDecisionInputPreimageFor,
  hashCanonicalPreimage,
} from "@app/demo/decision-identity";
import { headroomMinor } from "@app/demo/build-decision";
import { buildEvidence } from "@app/demo/build-context";
import { buildSafety } from "@app/demo/build-outcome";
import {
  ACTIVATED_RESERVE_HORIZON,
  RESERVE_FLOOR_INPUTS,
  derivedMetric,
  fixtureMetric,
  headroomInputs,
  reserveFloorInputs,
} from "@app/demo/provenance";
import { getJourney } from "@app/demo/journey";
import {
  activateMoneyMovementSetup,
  buildActivatedRecord,
  setupActivationAuthorityClaims,
} from "@app/demo/setup-evaluator";
import {
  setupActivationPreimageFor,
  validateSetupActivationDraft,
} from "@app/demo/setup-activation-input";
import {
  POSTURE_CONFIGURATION_LABEL,
  POSTURE_OPTION_LABEL,
  POSTURE_STATUS,
  SETUP_POLICY_GROUP_IDS,
  configurationPosture,
  isCaptainSignedImpact,
  type SetupActivatedSnapshotVM,
  type SetupAuthorityPosture,
  type SetupFirmId,
  type SetupSelections,
  type SetupTruthLabel,
  setupFirmSelectionKey,
} from "@app/demo/setup-model";
import { projectReserve } from "@domain/money-movement/reserve-projection";
import type { DisplayMetric } from "@contracts/metric";
import type { JsonValue } from "@contracts/decision-core/serialization";
import { isDemonstration } from "@contracts/provenance";
import type {
  AuthorityPlanVM,
  RecordReserveVM,
  RecordVM,
} from "@app/demo/model";
import { REPO_ROOT } from "./_fence-utils";
import { setupActivationAuthority } from "../helpers/setup-activation";

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
  readonly trigger: {
    readonly maskedRequestSummary: string;
    readonly requestRef: string;
    readonly asOf: string;
  };
  readonly firmConfiguration: {
    readonly cashReserveMonths: number;
    readonly dualApprovalThresholdUsd: number;
    readonly bankInstructionChangeHandling:
      | "specialist-review"
      | "block-until-independently-verified";
  };
  readonly householdEvidence: readonly {
    readonly evidenceKind: string;
    readonly subjectRef: string;
    readonly observedAt: string;
    readonly retrievedAt: string;
    readonly source: string;
    readonly freshness: string;
    readonly summary: string;
  }[];
  readonly expectedDisposition: "proceed" | "blocked" | "prohibited";
  readonly expectedExecutionEligibility: { readonly eligible: boolean };
  readonly expectedAuthority: {
    readonly mode: string;
    readonly stages: readonly unknown[];
  };
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
  readonly automaticAuthority: {
    readonly happyFirmB: string;
    readonly delayedNigoFirmB: string;
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
  readonly automaticAuthority: {
    readonly happyFirmB: string;
    readonly delayedNigoFirmB: string;
  };
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

function loadAllGolden(): GoldenCase[] {
  return readdirSync(join(REPO_ROOT, "fixtures/golden"))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map(loadGolden);
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
      `${sourceRef("src/app/demo/decision-evidence.ts", "availableCash: evidenceValue(")} :: available cash uses ${actual.availableCashAsOf}, not the signed ${truth.availableCashAsOf}`,
    );
  }
  if (actual.plannedWithdrawalsAsOf !== truth.plannedWithdrawalsAsOf) {
    violations.push(
      `${sourceRef("src/app/demo/decision-evidence.ts", "plannedMonthlyWithdrawal: evidenceValue(")} :: planned withdrawals use ${actual.plannedWithdrawalsAsOf}, not the signed stale timestamp ${truth.plannedWithdrawalsAsOf}`,
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
  return (
    (Date.parse(now.slice(0, 10)) -
      Date.parse(observedAt.slice(0, 10))) /
    86_400_000
  );
}

export function staleImpactViolations(
  actual: StaleImpactAssignment,
  plannedWithdrawalsAsOf: string,
  availableCashAsOf: string,
  now: string,
): string[] {
  const where = sourceRef(
    "src/app/demo/build-setup-impacts.ts",
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
 * Every place the GC-09 staleness is SPOKEN. Each age derives from the signed
 * observation and the evaluation instant bound to that surface, while the blocker
 * also derives its configured freshness window.
 */
interface StaleAgeAssignment {
  readonly impactFacts: string;
  readonly blocker: string;
}

export function staleAgeViolations(
  actual: StaleAgeAssignment,
  plannedWithdrawalsAsOf: string,
  evaluationTimes: {
    readonly impact: string;
    readonly blocker: string;
  },
  freshnessDays: number,
): string[] {
  const impactAgeDays = ageDaysBetween(
    plannedWithdrawalsAsOf,
    evaluationTimes.impact,
  );
  const blockerAgeDays = ageDaysBetween(
    plannedWithdrawalsAsOf,
    evaluationTimes.blocker,
  );
  const violations: string[] = [];
  const impactWhere = sourceRef(
    "src/app/demo/build-setup-impacts.ts",
    'id: "stale-withdrawals"',
  );
  if (!actual.impactFacts.includes(`${impactAgeDays} days old`)) {
    violations.push(
      `${impactWhere} :: the GC-09 impact card reads "${actual.impactFacts}" instead of the ${impactAgeDays} days derived from ${plannedWithdrawalsAsOf}`,
    );
  }
  const blockerWhere = sourceRef(
    "src/app/demo/build-decision.ts",
    "Planned-withdrawal evidence is",
  );
  if (!actual.blocker.includes(`${blockerAgeDays} days old`)) {
    violations.push(
      `${blockerWhere} :: the GC-09 blocker reads "${actual.blocker}" instead of the ${blockerAgeDays} days derived from ${plannedWithdrawalsAsOf}`,
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
  const where = sourceRef(
    "src/app/demo/decision-evidence.ts",
    "export function decisionEvidenceSnapshotFor",
  );
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
  readonly activeProfile: boolean;
  readonly status: string;
  readonly label: string;
  readonly provenance: string;
}

export function configurationPostureViolations(
  claims: readonly ConfigurationClaim[],
): string[] {
  const where = sourceRef(
    "src/app/demo/setup-evaluator.ts",
    "configurationProvenance: activeProfile",
  );
  const violations: string[] = [];
  for (const claim of claims) {
    const expected = configurationPosture(claim.truthLabels);
    if (claim.posture !== expected) {
      violations.push(
        `${where} :: ${claim.firmId} claims posture "${claim.posture}" for truth labels [${claim.truthLabels.join(", ")}], which are "${expected}"`,
      );
    }
    if (claim.activeProfile) {
      if (
        claim.status !== POSTURE_STATUS[claim.posture] ||
        claim.label !== POSTURE_OPTION_LABEL[claim.posture] ||
        claim.provenance !==
          POSTURE_CONFIGURATION_LABEL[claim.posture]
      ) {
        violations.push(
          `${where} :: ${claim.firmId} renders "${claim.label}" / "${claim.provenance}" for active posture "${claim.posture}"`,
        );
      }
    } else if (
      claim.status !== "pending" ||
      claim.label !== "Projected configuration" ||
      !claim.provenance.includes("Projected") ||
      claim.provenance.includes("Captain-signed")
    ) {
      violations.push(
        `${where} :: ${claim.firmId} does not match its active profile but renders "${claim.label}" / "${claim.provenance}"`,
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
  readonly impactEvaluatedAt: string;
}

function recentBankInputHash(bankInstructionObservedAt: string): string {
  const scenario = scenarioById("recent-bank-change-block");
  return hashCanonicalPreimage(
    decisionInputPreimageFor(scenario, {
      bankInstructionObservedAt,
    }),
  );
}

export function bankInstructionDateViolations(
  actual: BankInstructionDateAssignment,
  signedObservedAt: string,
): string[] {
  const where = sourceRef(
    "src/app/demo/data.ts",
    "export const OBSERVED_BANK_INSTRUCTION_CHANGED",
  );
  const signedDate = signedObservedAt.slice(0, 10);
  const violations: string[] = [];
  const signedAgeDays =
    (Date.parse(DEMO_NOW) - Date.parse(signedDate)) / 86_400_000;
  const signedImpactAgeDays =
    (Date.parse(actual.impactEvaluatedAt.slice(0, 10)) -
      Date.parse(signedDate.slice(0, 10))) /
    86_400_000;
  if (actual.sourceAgeDays !== signedAgeDays) {
    violations.push(
      `${where} :: displayed age is ${actual.sourceAgeDays} days, not the ${signedAgeDays} days derived from ${signedDate}`,
    );
  }
  for (const [label, value] of [
    ["source", actual.sourceDate],
  ] as const) {
    if (value !== signedDate) {
      violations.push(
        `${where} :: ${label} uses ${value}, not signed bank-change date ${signedDate}`,
      );
    }
  }
  for (const [label, value] of [
    ["journey evidence", actual.journeyEvidenceDate],
    ["setup provenance", actual.setupProvenanceDate],
  ] as const) {
    if (value !== signedObservedAt) {
      violations.push(
        `${where} :: ${label} uses ${value}, not signed bank-change observation ${signedObservedAt}`,
      );
    }
  }
  for (const [label, value] of [
    ["setup value", actual.setupValue],
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
  if (
    !actual.impactFacts.includes(signedDate) ||
    !actual.impactFacts.includes(`${signedImpactAgeDays} days`)
  ) {
    violations.push(
      `${where} :: impact facts do not render signed ${signedDate} as ${signedImpactAgeDays} days old at the signed evaluation instant`,
    );
  }
  if (!actual.requestSummary.includes(`${signedAgeDays} days ago`)) {
    violations.push(
      `${where} :: request summary does not render the ${signedAgeDays} days derived from signed ${signedDate}`,
    );
  }
  const expectedHash = recentBankInputHash(signedObservedAt);
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
  const delayedNigo = signed(loadGolden("GC-14-delayed-nigo.json"));
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
  for (const caseFile of [happyB, delayedNigo]) {
    if (
      caseFile.expectedAuthority.mode === "automatic" &&
      caseFile.expectedAuthority.stages.length !== 0
    ) {
      throw new Error(
        `${caseFile.caseId} carries approval stages under automatic authority`,
      );
    }
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
    automaticAuthority: {
      happyFirmB: happyB.expectedAuthority.mode,
      delayedNigoFirmB: delayedNigo.expectedAuthority.mode,
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
  const result = activateMoneyMovementSetup(
    selections,
    setupActivationAuthority(selections),
  );
  if (!result.ok) throw new Error(result.error);
  return result.snapshot;
}

type MutableJsonObject = { [key: string]: JsonValue };

function jsonObject(value: JsonValue): MutableJsonObject {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("Expected a canonical JSON object");
  }
  return value;
}

function jsonField(
  object: MutableJsonObject,
  key: string,
): JsonValue {
  const value = object[key];
  if (value === undefined) throw new Error(`Missing JSON field ${key}`);
  return value;
}

function changedPreimageHash(
  preimage: JsonValue,
  mutate: (copy: MutableJsonObject) => void,
): string {
  const copy = structuredClone(preimage);
  const object = jsonObject(copy);
  mutate(object);
  return hashCanonicalPreimage(copy);
}

function requestProvenanceViolations(
  setup: ReturnType<typeof buildMoneyMovementSetup>,
  record: RecordVM,
): string[] {
  const requestAmount = setup.request.facts.find(
    (fact) => fact.label === "Request amount",
  );
  const violations: string[] = [];
  if (requestAmount?.category !== "User-entered demo input") {
    violations.push("setup request category drifted");
  }
  if (
    requestAmount?.fakeClass !== "user-entered-demo-input" ||
    requestAmount.provenance.source !== "user-input" ||
    requestAmount.metric?.provenance.source !== "user-input"
  ) {
    violations.push("setup request provenance drifted");
  }
  if (
    record.intent.requestFakeClass !== "user-entered-demo-input" ||
    record.intent.requestProvenance.source !== "user-input"
  ) {
    violations.push("record request provenance drifted");
  }
  return violations;
}

function gc15ConsistencyViolations(
  safety: ReturnType<typeof buildSafety>,
  impact: ReturnType<typeof buildMoneyMovementSetup>["impacts"][number],
): string[] {
  const expected = pendingDistributionDeltaSentence(
    GC15_PENDING_DISTRIBUTION,
  );
  const checks = safety.checks.map((check) => check.label).join(" ");
  const violations: string[] = [];
  const universalEffect =
    impact.attributionKind === "universal-rule"
      ? impact.universalEffect
      : "";
  if (
    safety.invalidation?.deltaSentence !== expected ||
    impact.facts !== expected
  ) {
    violations.push("pending-distribution sentence drifted");
  }
  if (
    !checks.includes("$0") ||
    !checks.includes("$15,000") ||
    checks.includes("Liquidity unchanged") ||
    checks.includes("No new pending actions")
  ) {
    violations.push("pending-distribution safety facts conflict");
  }
  if (
    !safety.invalidation?.before.display.includes("$0") ||
    !safety.invalidation.after.display.includes("$15,000") ||
    !universalEffect.includes("$0") ||
    !universalEffect.includes("$15,000")
  ) {
    violations.push("pending-distribution before and after facts drifted");
  }
  return violations;
}

interface ImpactAttributionAssignment {
  readonly id: string;
  readonly attributionKind: "exact-case" | "universal-rule";
  readonly groupId?: string | null;
  readonly attribution?: unknown;
  readonly selectionEffects?: unknown;
}

function impactAttributionViolations(
  impacts: readonly ImpactAttributionAssignment[],
): string[] {
  const where = sourceRef(
    "src/app/demo/surfaces/setup-choices.tsx",
    'impact.attributionKind === "exact-case"',
  );
  const violations: string[] = [];
  for (const impact of impacts) {
    if (
      impact.attributionKind === "universal-rule" &&
      (impact.groupId !== undefined ||
        impact.attribution !== undefined ||
        impact.selectionEffects !== undefined)
    ) {
      violations.push(
        `${where} :: universal impact ${impact.id} carries case attribution`,
      );
    }
    if (
      impact.attributionKind === "exact-case" &&
      (typeof impact.groupId !== "string" ||
        impact.attribution === undefined)
    ) {
      violations.push(
        `${where} :: exact-case impact ${impact.id} lacks complete attribution`,
      );
    }
  }
  return violations;
}

function accountIdentityViolations(
  accounts: readonly {
    readonly id: string;
    readonly subjectRef: string;
    readonly name: string;
    readonly balanceMinor: number;
  }[],
  cases: readonly GoldenCase[],
): string[] {
  const where = sourceRef(
    "src/app/demo/data.ts",
    'id: "acct-taxable"',
  );
  const family = accounts.find(
    (account) => account.id === "acct-taxable",
  );
  const joint = accounts.find(
    (account) => account.id === "acct-joint",
  );
  const violations: string[] = [];
  if (
    family?.subjectRef !== "subject:smiths-family-taxable" ||
    family.name !== "Smith Family Taxable" ||
    family.balanceMinor !== 42_000_000
  ) {
    violations.push(
      `${where} :: the $420,000 Smith Family Taxable identity is not canonical`,
    );
  }
  if (
    joint?.subjectRef !== "subject:smiths-joint-taxable" ||
    joint.name !== "Joint Taxable" ||
    joint.balanceMinor !== 9_500_000
  ) {
    violations.push(
      `${where} :: the distinct $95,000 Joint Taxable identity is not canonical`,
    );
  }
  for (const caseFile of cases) {
    for (const datum of caseFile.householdEvidence) {
      if (
        datum.evidenceKind === "account-balance" &&
        datum.summary.includes("420000 USD") &&
        datum.subjectRef !== "subject:smiths-family-taxable"
      ) {
        violations.push(
          `${where} :: ${caseFile.caseId} binds $420,000 to ${datum.subjectRef}`,
        );
      }
    }
  }
  return violations;
}

function requesterSummaryViolations(
  authoritySummary: string,
): string[] {
  if (
    authoritySummary.includes(
      "Requester participation remains unbound",
    ) &&
    !authoritySummary.includes("requester cannot")
  ) {
    return [];
  }
  return [
    `${sourceRef("src/app/demo/build-decision.ts", "export function buildDisposition")} :: unbound requester participation is contradicted by "${authoritySummary}"`,
  ];
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
  if (lowHeadroomImpact.attributionKind !== "exact-case") {
    throw new Error("the GC-05 low-headroom card lost exact-case attribution");
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
    automaticAuthority: {
      happyFirmB:
        getJourney("safe-proceed", "firm-b").record.authority?.mode ??
        "not-reached",
      delayedNigoFirmB:
        getJourney("delayed-nigo", "firm-b").record.authority?.mode ??
        "not-reached",
    },
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
      `${sourceRef("src/app/demo/build-setup.ts", '{ label: "Available balance"')} :: setup liquidity basis (${describeBasis(actual.setupBasis)}) differs from captain-signed (${describeBasis(truth.smithsBasis)})`,
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
        `${sourceRef("src/app/demo/build-setup-impacts.ts", "function factsLine")} :: the low-headroom card reads "${actual.lowHeadroomFacts}", which does not state the signed $${dollars} - the prose must be generated from the pinned basis`,
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
  for (const caseKey of [
    "happyFirmB",
    "delayedNigoFirmB",
  ] as const) {
    if (
      actual.automaticAuthority[caseKey] !==
      truth.automaticAuthority[caseKey]
    ) {
      violations.push(
        `${sourceRef("src/app/demo/build-decision.ts", "export function buildAuthorityPlan")} :: ${caseKey} authority mode "${actual.automaticAuthority[caseKey]}" differs from captain-signed "${truth.automaticAuthority[caseKey]}"`,
      );
    }
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
  readonly authorityPlan: string;
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
      "authorityPlan",
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
    authorityMode: record.authority?.mode ?? "not-reached",
    authorityPlan: JSON.stringify(record.authority),
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
    authorityPlan: JSON.stringify(
      firm.authorityPlan.mode === "not-reached"
        ? null
        : firm.authorityPlan,
    ),
    exportHref: firm.exportHref,
  });
  return [identity(snapshot.firms[0]), identity(snapshot.firms[1])];
}

describe("demo semantic-truth fence", () => {
  it("enforces: activation, evidence, recommendation, decision, and authority are causal", () => {
    expect(demoTimelineViolations(DEMO_TIMELINE)).toEqual([]);
    expect(DEMO_CAUSAL_SEQUENCE).toEqual([
      "activationAt",
      "pendingActivityObservedAt",
      "evidenceRetrievedAt",
      "recommendationRetrievedAt",
      "decisionCreatedAt",
      "specialistReviewedAt",
      "operationsApproval1At",
      "operationsApproval2At",
      "revalidatedAt",
      "executionSubmittedAt",
      "executionVerifiedAt",
    ]);
  });

  it("detects: a chronology inversion cannot pass", () => {
    expect(
      demoTimelineViolations({
        ...DEMO_TIMELINE,
        evidenceRetrievedAt: "2026-07-28T13:59:00.000Z",
      }),
    ).toContain(
      "pendingActivityObservedAt must precede evidenceRetrievedAt",
    );
  });

  it("enforces: every material activation field changes the snapshot hash", () => {
    const selections = setupSelections();
    const draft = validateSetupActivationDraft(7, selections);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const authority = setupActivationAuthority(
      selections,
      draft.generation,
      "principal-a",
    );
    const setupVm = buildMoneyMovementSetup();
    const preimage = setupActivationPreimageFor(
      setupVm,
      draft,
      authority,
      setupActivationAuthorityClaims(
        setupVm,
        draft.selections,
        authority,
      ),
    );
    const unchanged = hashCanonicalPreimage(preimage);
    const changed = [
      changedPreimageHash(preimage, (copy) => {
        jsonObject(jsonField(copy, "payload")).evaluatorVersion =
          "changed-engine";
      }),
      changedPreimageHash(preimage, (copy) => {
        jsonObject(jsonField(copy, "payload")).requestRef =
          "changed-request";
      }),
      changedPreimageHash(preimage, (copy) => {
        const payload = jsonObject(jsonField(copy, "payload"));
        const requestAndEvidence = jsonObject(
          jsonField(payload, "requestAndEvidence"),
        );
        const inputPayload = jsonObject(
          jsonField(requestAndEvidence, "payload"),
        );
        jsonObject(jsonField(inputPayload, "evidence")).retrievedAt =
          "2026-07-28T14:02:00.000Z";
      }),
      changedPreimageHash(preimage, (copy) => {
        const payload = jsonObject(jsonField(copy, "payload"));
        const fixed = jsonObject(
          jsonField(payload, "fixedConfiguration"),
        );
        const controls = fixed.controls;
        if (!Array.isArray(controls)) throw new Error("controls missing");
        jsonObject(controls[0]!).proof = "changed proof rule";
      }),
      changedPreimageHash(preimage, (copy) => {
        const payload = jsonObject(jsonField(copy, "payload"));
        const fixed = jsonObject(
          jsonField(payload, "fixedConfiguration"),
        );
        jsonObject(
          jsonField(fixed, "activation"),
        ).attestationStatement = "changed attestation statement";
      }),
      changedPreimageHash(preimage, (copy) => {
        const authorityValue = jsonObject(
          jsonField(
            jsonObject(jsonField(copy, "payload")),
            "authority",
          ),
        );
        jsonObject(jsonField(authorityValue, "actor")).opaqueId =
          "principal-b";
      }),
      changedPreimageHash(preimage, (copy) => {
        const plans = jsonField(
          jsonObject(jsonField(copy, "payload")),
          "decisionAuthority",
        );
        if (!Array.isArray(plans)) {
          throw new Error("decisionAuthority missing");
        }
        jsonObject(jsonField(jsonObject(plans[0]!), "authority")).mode =
          "automatic";
      }),
    ];
    expect(changed).not.toContain(unchanged);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it("enforces: versioned input and decision claims are identity-bearing", () => {
    const scenario = scenarioById("safe-proceed");
    const baseInput = decisionInputHashFor(scenario);
    const materialInputs = [
      { evidenceRef: "changed-evidence" },
      { evidenceRetrievedAt: "2026-07-28T14:02:00.000Z" },
      { evaluationAsOf: "2026-07-28T14:06:00.000Z" },
      { timeZone: "UTC" },
      { engineVersion: "changed-engine" },
      { canonicalSerializerVersion: "changed-serializer" },
    ].map((overrides) =>
      hashCanonicalPreimage(decisionInputPreimageFor(scenario, overrides)),
    );
    expect(materialInputs).not.toContain(baseInput);
    expect(new Set(materialInputs).size).toBe(materialInputs.length);

    const journey = getJourney("safe-proceed", "firm-a");
    expect(journey.approvals?.mode).toBe("staged");
    if (journey.approvals?.mode !== "staged") return;
    expect(journey.record.authority?.mode).toBe("staged");
    if (journey.record.authority?.mode !== "staged") return;
    const authorityClaim = decisionAuthorityClaimFor(
      journey.record.authority,
    );
    if (authorityClaim.mode !== "staged") return;
    const claims = {
      disposition: journey.recommendation.disposition,
      precedence: journey.policyTrace.rows,
      authority: authorityClaim,
    };
    const firm = firmById("firm-a");
    const configuration = decisionConfigurationFor(firm);
    const baseRecord = hashCanonicalPreimage(
      decisionRecordPreimageFor(
        scenario,
        firm,
        configuration,
        claims,
      ),
    );
    const changedClaims = [
      {
        ...claims,
        authority: {
          ...claims.authority,
          requirements: claims.authority.requirements.map(
            (requirement, index) =>
              index === 0
                ? {
                    ...requirement,
                    requirement: "Changed authority requirement",
                  }
                : requirement,
          ),
        },
      },
      {
        ...claims,
        precedence: claims.precedence.map((row, index) =>
          index === 0 ? { ...row, result: "Changed precedence" } : row,
        ),
      },
      {
        ...claims,
        disposition: {
          ...claims.disposition,
          blockers: [
            {
              condition: "Changed blocker",
              affordanceLabel: "Resolve changed blocker",
            },
          ],
        },
      },
    ].map((changedClaimsValue) =>
      hashCanonicalPreimage(
        decisionRecordPreimageFor(
          scenario,
          firm,
          configuration,
          changedClaimsValue,
        ),
      ),
    );
    expect(changedClaims).not.toContain(baseRecord);
  });

  it("enforces: one typed evidence snapshot feeds identity, UI, activation, and export", () => {
    const scenario = scenarioById("recent-bank-change-block");
    const evidence = decisionEvidenceSnapshotFor(scenario);
    const preimage = jsonObject(
      jsonField(
        jsonObject(decisionInputPreimageFor(scenario, {}, evidence)),
        "payload",
      ),
    );
    expect(jsonField(preimage, "evidence")).toEqual(evidence);

    const journey = getJourney(
      "recent-bank-change-block",
      "firm-a",
    );
    const bankRow = journey.evidence.rows.find(
      (row) =>
        row.kind === "fact" &&
        row.label === "Bank instruction on file",
    );
    const pendingRow = journey.evidence.rows.find(
      (row) =>
        row.kind === "fact" &&
        row.label === "Pending approved activity",
    );
    expect(bankRow?.kind).toBe("fact");
    expect(pendingRow?.kind).toBe("fact");
    if (bankRow?.kind !== "fact" || pendingRow?.kind !== "fact") {
      return;
    }
    expect(bankRow.fact.provenance).toEqual(
      evidence.bankInstruction.provenance,
    );
    expect(pendingRow.fact.provenance).toEqual(
      evidence.pendingApprovedActivity.provenance,
    );
    expect(bankRow.fact.retrievedAt).toBe(
      demoTimestampLabel(evidence.retrievedAt),
    );
    expect(journey.record.evidence).toEqual(
      journey.evidence.rows,
    );
    expect(journey.record.identity.inputHash).toBe(
      decisionInputHashFor(scenario, evidence),
    );

    const activated = activatedSnapshot();
    expect(activated.evidence).toEqual(evidence);
    expect(Object.isFrozen(activated.evidence)).toBe(true);
    const record = buildActivatedRecord(activated, "firm-a");
    const exportedBank = record.evidence.find(
      (row) =>
        row.kind === "fact" &&
        row.label === "Bank instruction on file",
    );
    expect(exportedBank?.kind).toBe("fact");
    if (exportedBank?.kind !== "fact") return;
    expect(exportedBank.fact.provenance).toEqual(
      activated.evidence.bankInstruction.provenance,
    );
    expect(record.identity.inputHash).toBe(
      decisionInputHashFor(scenario, activated.evidence),
    );

    const changedScenario = scenarioById(
      "approval-invalidation",
    );
    const refreshed = decisionEvidenceSnapshotFor(
      changedScenario,
      "revalidation",
    );
    const refreshedPending = buildEvidence(
      changedScenario,
      refreshed,
    ).rows.find(
      (row) =>
        row.kind === "fact" &&
        row.label === "Pending approved activity",
    );
    expect(refreshedPending?.kind).toBe("fact");
    if (refreshedPending?.kind !== "fact") return;
    expect(refreshedPending.fact.display).toContain("$15,000");
    expect(refreshedPending.fact.provenance).toEqual(
      refreshed.pendingApprovedActivity.provenance,
    );
    expect(
      jsonField(
        jsonObject(
          refreshedDecisionInputPreimageFor(
            changedScenario,
            {},
            refreshed,
          ),
        ),
        "payload",
      ),
    ).toMatchObject({ evidence: refreshed });
  });

  it("detects: any evidence source, observation, or provenance drift changes identity", () => {
    const scenario = scenarioById("ambiguous-instruction");
    const evidence = decisionEvidenceSnapshotFor(scenario);
    const changed: DecisionEvidenceSnapshot[] = [
      {
        ...evidence,
        availableCash: {
          ...evidence.availableCash,
          sourceRef: "changed:account-source",
        },
      },
      {
        ...evidence,
        destinationRestriction: {
          ...evidence.destinationRestriction,
          provenance: {
            ...evidence.destinationRestriction.provenance,
            asOf: "2026-05-11T10:00:00-04:00",
          },
        },
      },
      {
        ...evidence,
        conflictingFundingInstructions: [
          {
            ...evidence.conflictingFundingInstructions[0]!,
            provenance: {
              ...evidence.conflictingFundingInstructions[0]!
                .provenance,
              confidence: "low",
            },
          },
          evidence.conflictingFundingInstructions[1]!,
        ],
      },
    ];
    const base = decisionInputHashFor(scenario, evidence);
    const changedHashes = changed.map((candidate) =>
      decisionInputHashFor(scenario, candidate),
    );
    expect(changedHashes).not.toContain(base);
    expect(new Set(changedHashes).size).toBe(changedHashes.length);
  });

  it("enforces: approval receipts never alter the earlier decision identity", () => {
    const journey = getJourney("safe-proceed", "firm-a");
    expect(journey.approvals).not.toBeNull();
    expect(journey.record.authority?.mode).toBe("staged");
    if (journey.record.authority?.mode !== "staged") return;
    expect(journey.approvals?.binding.decisionHash).toBe(
      journey.record.identity.decisionHash,
    );

    const requirements = decisionAuthorityRequirementsFor(
      journey.record.authority.stages,
    );
    const changedReceipts = journey.record.authority.stages.map(
      (stage) => ({
        ...stage,
        stepState: "active" as const,
        actors: stage.actors.map((actor) => ({
          ...actor,
          name: "Different receipt actor",
          status: "pending",
          statusLabel: "Awaiting approval",
        })),
      }),
    );
    expect(
      decisionAuthorityRequirementsFor(changedReceipts),
    ).toEqual(requirements);
    expect(
      approvalReceiptHashFor(
        journey.record.identity.decisionHash,
        {
          ...journey.record.authority,
          stages: [
            changedReceipts[0]!,
            ...changedReceipts.slice(1),
          ],
        },
      ),
    ).not.toBe(journey.record.hashes.approvalReceiptHash);
    expect(journey.record.hashes.approvalReceiptHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("detects: changing an immutable authority requirement changes identity", () => {
    const journey = getJourney("safe-proceed", "firm-a");
    const scenario = scenarioById("safe-proceed");
    const firm = firmById("firm-a");
    expect(journey.record.authority?.mode).toBe("staged");
    if (journey.record.authority?.mode !== "staged") return;
    const authority = decisionAuthorityClaimFor(journey.record.authority);
    expect(authority.mode).toBe("staged");
    if (authority.mode !== "staged") return;
    const requirements = authority.requirements;
    const claims = {
      disposition: journey.recommendation.disposition,
      precedence: journey.policyTrace.rows,
      authority,
    };
    const base = hashCanonicalPreimage(
      decisionRecordPreimageFor(
        scenario,
        firm,
        decisionConfigurationFor(firm),
        claims,
      ),
    );
    const changed = hashCanonicalPreimage(
      decisionRecordPreimageFor(
        scenario,
        firm,
        decisionConfigurationFor(firm),
        {
          ...claims,
          authority: {
            ...authority,
            requirements: requirements.map((requirement, index) =>
              index === 0
                ? { ...requirement, expiry: "Expires after 4 days" }
                : requirement,
            ),
          },
        },
      ),
    );
    expect(changed).not.toBe(base);
  });

  it("enforces: automatic authority binds exact fields without approval receipts", () => {
    for (const scenarioId of ["safe-proceed", "delayed-nigo"] as const) {
      const journey = getJourney(scenarioId, "firm-b");
      const authority = journey.record.authority;
      expect(authority?.mode).toBe("automatic");
      if (authority?.mode !== "automatic") return;
      expect(Number(authority.threshold.value)).toBe(10_000_000);
      expect(authority.policySource).toBe("FB-2.1 §4");
      expect(authority.rule).toBe(
        "$75,000 is below Firm B's $100,000 dual-approval threshold, so no approval stage applies.",
      );
      expect(authority.executionMode).toBe(
        "Automatic - no human approval action",
      );
      expect(authority.state).toBe("Authority resolved automatically");
      expect("stages" in authority).toBe(false);
      expect(journey.approvals?.mode).toBe("automatic");
      expect(journey.record.hashes.approvalReceiptHash).toBeNull();
      expect(
        approvalReceiptHashFor(
          journey.record.identity.decisionHash,
          authority,
        ),
      ).toBeNull();
    }
  });

  it("detects: changing an automatic authority field changes bundle identity", () => {
    const scenario = scenarioById("safe-proceed");
    const firm = firmById("firm-b");
    const configuration = decisionConfigurationFor(firm);
    const recordAuthority =
      getJourney("safe-proceed", "firm-b").record.authority;
    expect(recordAuthority?.mode).toBe("automatic");
    if (recordAuthority?.mode !== "automatic") return;
    const authority = decisionAuthorityClaimFor(recordAuthority);
    expect(authority.mode).toBe("automatic");
    if (authority.mode !== "automatic") return;
    const base = hashCanonicalPreimage(
      decisionBundlePreimageFor(
        scenario,
        firm,
        configuration,
        authority,
      ),
    );
    const changed = hashCanonicalPreimage(
      decisionBundlePreimageFor(
        scenario,
        firm,
        configuration,
        {
          ...authority,
          thresholdMinor: authority.thresholdMinor + 1,
        },
      ),
    );
    expect(changed).not.toBe(base);
  });

  it("enforces: automatic authority has no role while every setup stage binds Operations", () => {
    const automaticJourney = getJourney(
      "safe-proceed",
      "firm-b",
    );
    expect(automaticJourney.record.authority?.mode).toBe(
      "automatic",
    );
    expect(decisionConfigurationFor(firmById("firm-b")).eligibleRole)
      .toBeNull();
    expect(
      JSON.stringify(automaticJourney.record.authority),
    ).not.toContain("Operations");

    const stagedSnapshot = activatedSnapshot((selections) => {
      selections["firm-b"]["bank-change"] = "specialist";
    });
    const staged = stagedSnapshot.firms[1];
    expect(staged.authorityPlan.mode).toBe("staged");
    expect(staged.eligibleRole).toBe("operations");
    expect(staged.requesterParticipation).toEqual({
      mode: "unbound",
    });
    if (staged.authorityPlan.mode !== "staged") return;
    expect(staged.authorityPlan.eligibleRole).toBe("operations");
    expect(staged.authorityPlan.requesterParticipation).toEqual({
      mode: "unbound",
    });
    const record = buildActivatedRecord(
      stagedSnapshot,
      "firm-b",
    );
    expect(record.activatedConfiguration?.eligibleRole).toBe(
      "operations",
    );
    expect(
      record.activatedConfiguration?.requesterParticipation,
    ).toBe("unbound");
  });

  it("detects: automatic-role and staged-role mixtures fail closed", () => {
    const automaticScenario = scenarioById("safe-proceed");
    const automaticFirm = firmById("firm-b");
    const automaticAuthority =
      getJourney("safe-proceed", "firm-b").record.authority;
    expect(automaticAuthority?.mode).toBe("automatic");
    if (automaticAuthority?.mode !== "automatic") return;
    expect(() =>
      decisionBundlePreimageFor(
        automaticScenario,
        automaticFirm,
        {
          ...decisionConfigurationFor(automaticFirm),
          eligibleRole: "operations",
        },
        decisionAuthorityClaimFor(automaticAuthority),
      ),
    ).toThrow("conflicts with eligible role");

    const stagedJourney = getJourney("safe-proceed", "firm-a");
    const stagedAuthority = stagedJourney.record.authority;
    expect(stagedAuthority?.mode).toBe("staged");
    if (stagedAuthority?.mode !== "staged") return;
    expect(() =>
      decisionBundlePreimageFor(
        automaticScenario,
        firmById("firm-a"),
        {
          ...decisionConfigurationFor(firmById("firm-a")),
          eligibleRole: null,
        },
        decisionAuthorityClaimFor(stagedAuthority),
      ),
    ).toThrow("conflicts with eligible role");

    expect(() =>
      decisionAuthorityClaimFor({
        ...stagedAuthority,
        eligibleRole: null,
      } as unknown as AuthorityPlanVM),
    ).toThrow("Operations eligible role");
  });

  it("enforces: setup requester participation stays unbound through hashes and receipts", () => {
    const snapshot = activatedSnapshot((selections) => {
      selections["firm-b"]["bank-change"] = "specialist";
      selections["firm-b"].threshold = "25000";
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("requesterConstraint");
    expect(serialized).not.toContain(
      "may-not-satisfy-both-approvals",
    );
    for (const firm of snapshot.firms) {
      expect(firm.requesterParticipation).toEqual({
        mode: "unbound",
      });
      const authoritySummary =
        firm.disposition.kind === "proceed"
          ? firm.disposition.authoritySummary
          : undefined;
      if (
        authoritySummary?.includes(
          "two distinct operations approvers",
        )
      ) {
        expect(
          requesterSummaryViolations(authoritySummary),
        ).toEqual([]);
      }
      if (firm.authorityPlan.mode !== "staged") continue;
      expect(
        firm.authorityPlan.stages
          .flatMap((stage) => stage.actors)
          .some((actor) => actor.requesterExcluded === true),
      ).toBe(false);
      const record = buildActivatedRecord(
        snapshot,
        firm.firmId,
      );
      expect(
        record.activatedConfiguration?.requesterParticipation,
      ).toBe("unbound");
      expect(record.hashes.approvalReceiptHash).toMatch(
        /^[a-f0-9]{64}$/,
      );
    }
  });

  it("detects: an unbound requester cannot acquire an exclusion summary", () => {
    const violations = requesterSummaryViolations(
      "Requires two distinct operations approvers. The requester cannot satisfy both approvals.",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("build-decision.ts:");
  });

  it("enforces: GC-15 derives every visible fact from one pending delta", () => {
    const safety = buildSafety(scenarioById("approval-invalidation"));
    const impact = buildMoneyMovementSetup().impacts.find(
      (candidate) => candidate.id === "material-change",
    )!;
    expect(gc15ConsistencyViolations(safety, impact)).toEqual([]);
    expect(safety.invalidation?.before.provenance.asOf).toBe(
      GC15_PENDING_DISTRIBUTION.before.observedAt,
    );
    expect(safety.invalidation?.before.retrievedAt).toBe(
      demoTimestampLabel(
        GC15_PENDING_DISTRIBUTION.before.retrievedAt,
      ),
    );
    expect(safety.invalidation?.after.provenance.asOf).toBe(
      GC15_PENDING_DISTRIBUTION.after.observedAt,
    );
    expect(safety.invalidation?.after.retrievedAt).toBe(
      demoTimestampLabel(
        GC15_PENDING_DISTRIBUTION.after.retrievedAt,
      ),
    );
    expect(
      timelineOrderViolations([
        {
          label: "original observation",
          at: GC15_PENDING_DISTRIBUTION.before.observedAt,
        },
        {
          label: "original retrieval",
          at: GC15_PENDING_DISTRIBUTION.before.retrievedAt,
        },
        {
          label: "refreshed observation",
          at: GC15_PENDING_DISTRIBUTION.after.observedAt,
        },
        {
          label: "refreshed retrieval",
          at: GC15_PENDING_DISTRIBUTION.after.retrievedAt,
        },
      ]),
    ).toEqual([]);
  });

  it("enforces: universal impacts never carry captain-signed case attribution", () => {
    const universal = buildMoneyMovementSetup().impacts.filter(
      (impact) => impact.attributionKind === "universal-rule",
    );
    expect(universal.map((impact) => impact.id)).toEqual([
      "stale-withdrawals",
      "material-change",
    ]);
    expect(impactAttributionViolations(universal)).toEqual([]);
  });

  it("detects: universal rules cannot inherit case attribution from a null group", () => {
    const violations = impactAttributionViolations([
      {
        id: "stale-withdrawals",
        attributionKind: "universal-rule",
        groupId: null,
        attribution: { "firm-a": "signed" },
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("setup-choices.tsx:");
  });

  it("detects: retrieval before its observation cannot pass", () => {
    expect(
      timelineOrderViolations([
        {
          label: "original observation",
          at: "2026-07-28T14:01:00.000Z",
        },
        {
          label: "original retrieval",
          at: "2026-07-28T14:00:30.000Z",
        },
      ]),
    ).toEqual([
      "original retrieval occurs before original observation",
    ]);
  });

  it("detects: contradictory GC-15 safety copy cannot pass", () => {
    const safety = buildSafety(scenarioById("approval-invalidation"));
    const impact = buildMoneyMovementSetup().impacts.find(
      (candidate) => candidate.id === "material-change",
    )!;
    expect(
      gc15ConsistencyViolations(
        {
          ...safety,
          checks: [
            ...safety.checks,
            {
              label: "Liquidity unchanged since the decision",
              status: "done",
              statusLabel: "Verified",
            },
          ],
        },
        impact,
      ),
    ).toContain("pending-distribution safety facts conflict");
  });

  it("enforces: request provenance agrees across setup and export", () => {
    const setup = buildMoneyMovementSetup();
    const record = buildActivatedRecord(activatedSnapshot(), "firm-a");
    expect(requestProvenanceViolations(setup, record)).toEqual([]);
  });

  it("detects: a request provenance label drift cannot pass", () => {
    const setup = buildMoneyMovementSetup();
    const requestAmountIndex = setup.request.facts.findIndex(
      (fact) => fact.label === "Request amount",
    );
    const drifted = {
      ...setup,
      request: {
        ...setup.request,
        facts: setup.request.facts.map((fact, index) =>
          index === requestAmountIndex
            ? { ...fact, category: "Synthetic fixture" as const }
            : fact,
        ),
      },
    };
    expect(
      requestProvenanceViolations(
        drifted,
        buildActivatedRecord(activatedSnapshot(), "firm-a"),
      ),
    ).toContain("setup request category drifted");
  });

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

  it("enforces: canonical identity is stable and changes with firm or material input", () => {
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
    for (const scenarioId of [
      "dual-approval",
      "approval-invalidation",
      "competing-liquidity",
      "duplicate-retry",
      "partial-salesforce-success",
      "delayed-nigo",
    ]) {
      expect(decisionInputHashFor(scenarioById(scenarioId))).toBe(
        decisionInputHashFor(safeScenario),
      );
      const laterBranch =
        getJourney(scenarioId, "firm-a").record.identity;
      expect({
        decisionId: laterBranch.decisionId,
        inputHash: laterBranch.inputHash,
        decisionHash: laterBranch.decisionHash,
        bundleHash: laterBranch.bundleHash,
      }).toEqual({
        decisionId: stable.decisionId,
        inputHash: stable.inputHash,
        decisionHash: stable.decisionHash,
        bundleHash: stable.bundleHash,
      });
    }
    const recentExpired = getJourney(
      "specialist-review-expiration",
      "firm-a",
    ).record.identity;
    expect({
      decisionId: recentExpired.decisionId,
      inputHash: recentExpired.inputHash,
      decisionHash: recentExpired.decisionHash,
      bundleHash: recentExpired.bundleHash,
    }).toEqual({
      decisionId: recentA.decisionId,
      inputHash: recentA.inputHash,
      decisionHash: recentA.decisionHash,
      bundleHash: recentA.bundleHash,
    });
    const relabeledScenario = {
      ...safeScenario,
      title: "Changed display title",
      description: "Changed display description",
      outcomeClass: "Changed display outcome",
    };
    expect(decisionInputHashFor(relabeledScenario)).toBe(
      decisionInputHashFor(safeScenario),
    );

    const materialInputChange = {
      ...safeScenario,
      spec: { ...safeScenario.spec, thirdPartyDestination: true },
    };
    expect(decisionInputHashFor(materialInputChange)).not.toBe(
      decisionInputHashFor(safeScenario),
    );

    const invalidation = scenarioById("approval-invalidation");
    const invalidationIdentities =
      decisionInputIdentitiesFor(invalidation);
    expect(invalidationIdentities.original).toBe(
      decisionInputHashFor(safeScenario),
    );
    expect(invalidationIdentities.refreshed).toBe(
      hashCanonicalPreimage(
        refreshedDecisionInputPreimageFor(invalidation),
      ),
    );
    expect(invalidationIdentities.refreshed).not.toBe(
      invalidationIdentities.original,
    );
    const safety = buildSafety(invalidation);
    expect(safety.invalidation?.inputIdentity).toEqual({
      originalHash: invalidationIdentities.original,
      refreshedHash: invalidationIdentities.refreshed,
    });

    const initial = activatedSnapshot();
    const changed = activatedSnapshot((selections) => {
      selections["firm-a"].reserve = "9-months";
    });
    expect(changed.firms[0].inputHash).toBe(initial.firms[0].inputHash);
    expect(changed.firms[0].bundleHash).not.toBe(initial.firms[0].bundleHash);
    expect(changed.firms[0].decisionId).not.toBe(initial.firms[0].decisionId);
    expect(changed.firms[0].decisionHash).not.toBe(initial.firms[0].decisionHash);
  });

  it("detects: later branch outcomes cannot alter the original input identity", () => {
    const scenario = scenarioById("safe-proceed");
    const original = decisionInputHashFor(scenario);
    const futureOnly = {
      ...scenario,
      title: "Later retry branch",
      outcomeClass: "duplicate suppressed",
      spec: {
        ...scenario.spec,
        duplicateRetry: true,
        partial: true,
        delayedNigo: true,
        invalidation: true,
      },
    };
    expect(decisionInputHashFor(futureOnly)).toBe(original);
    expect(
      hashCanonicalPreimage(
        refreshedDecisionInputPreimageFor(futureOnly),
      ),
    ).not.toBe(original);
  });

  it("enforces: activation freezes one immutable configuration and forward-fixes mutations", () => {
    const selections = setupSelections();
    const first = activateMoneyMovementSetup(
      selections,
      setupActivationAuthority(selections),
    );
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

    const second = activateMoneyMovementSetup(
      selections,
      setupActivationAuthority(selections),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.snapshot.snapshotVersion).not.toBe(
      first.snapshot.snapshotVersion,
    );
    expect(second.snapshot.snapshotHash).not.toBe(first.snapshot.snapshotHash);
    expect(second.snapshot.firms[0].policyVersion).not.toBe(priorPolicyVersion);
    expect(second.snapshot.firms[0].policyVersion).not.toBe("FA-4.2");
    expect(
      configurationPosture(
        second.snapshot.firms[0].selectedOptions.map(
          (option) =>
            option.posture === "signed"
              ? "Signed"
              : option.posture === "recommended"
                ? "Recommended"
                : "Supported",
        ),
      ),
    ).toBe("house-default");
    expect(second.snapshot.firms[0].configurationProvenance).toBe(
      "Projected demonstration configuration · differs from FA-4.2",
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

  it("enforces: configuration identity excludes activation actor and draft generation", () => {
    const selections = setupSelections();
    const first = activateMoneyMovementSetup(
      selections,
      setupActivationAuthority(selections, 3, "principal-a"),
    );
    const second = activateMoneyMovementSetup(
      selections,
      setupActivationAuthority(selections, 4, "principal-b"),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.snapshot.snapshotHash).not.toBe(
      first.snapshot.snapshotHash,
    );
    for (const firmIndex of [0, 1] as const) {
      expect(
        second.snapshot.firms[firmIndex].configurationHash,
      ).toBe(first.snapshot.firms[firmIndex].configurationHash);
      expect(second.snapshot.firms[firmIndex].policyVersion).toBe(
        first.snapshot.firms[firmIndex].policyVersion,
      );
      expect(second.snapshot.firms[firmIndex].decisionHash).not.toBe(
        first.snapshot.firms[firmIndex].decisionHash,
      );
    }
  });

  it("detects: a resolved configuration change alters configuration identity", () => {
    const original = activatedSnapshot();
    const changed = activatedSnapshot((selections) => {
      selections["firm-a"].reserve = "9-months";
    });
    expect(changed.firms[0].configurationHash).not.toBe(
      original.firms[0].configurationHash,
    );
    expect(changed.firms[1].configurationHash).toBe(
      original.firms[1].configurationHash,
    );
  });

  it("enforces: the evaluator freezes ordered authority stages and export consumes them unchanged", () => {
    const snapshot = activatedSnapshot();
    const firmA = snapshot.firms[0];
    expect(firmA.authorityPlan.mode).toBe("staged");
    if (firmA.authorityPlan.mode !== "staged") return;
    expect(firmA.authorityPlan.stages.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
      "Stage 2 - Dual operations approval",
    ]);
    const record = buildActivatedRecord(snapshot, "firm-a");
    expect(record.authority).toBe(firmA.authorityPlan);
    expect(record.authority).toEqual(firmA.authorityPlan);
    expect(Object.isFrozen(firmA.authorityPlan.stages)).toBe(true);
  });

  it("enforces: records preserve a typed not-reached authority state", () => {
    for (const [scenarioId, firmId] of [
      ["permanent-prohibition", "firm-a"],
      ["stale-evidence", "firm-a"],
      ["recent-bank-change-block", "firm-b"],
    ] as const) {
      const journey = getJourney(scenarioId, firmId);
      expect(journey.approvals).toBeNull();
      expect(journey.record.authority).toBeNull();
      expect(journey.record.hashes.approvalReceiptHash).toBeNull();
      expect(journey.record.stopNote).toContain(
        "stopped at Decision",
      );
    }
  });

  it("detects: empty staged authority and mixed automatic fields fail closed", () => {
    const emptyStages = {
      mode: "staged",
      summary: "Staged",
      detail: "No stages",
      eligibleRole: "operations",
      requesterParticipation: { mode: "unbound" },
      stages: [],
    } as unknown as AuthorityPlanVM;
    expect(() => decisionAuthorityClaimFor(emptyStages)).toThrow(
      "requires at least one stage",
    );

    const automatic = getJourney(
      "safe-proceed",
      "firm-b",
    ).record.authority;
    expect(automatic?.mode).toBe("automatic");
    if (automatic?.mode !== "automatic") return;
    const mixed = {
      ...automatic,
      stages: [],
    } as unknown as AuthorityPlanVM;
    expect(() => decisionAuthorityClaimFor(mixed)).toThrow(
      "Unsupported authority field mixture",
    );

    expect(() =>
      decisionAuthorityClaimFor({
        mode: "delegated",
        summary: "Invented mode",
        detail: "Unsupported",
      } as unknown as AuthorityPlanVM),
    ).toThrow("Unsupported authority mode");
  });

  it("enforces: activation, decision, authority, and evidence age share the July 28 timeline", () => {
    expect(DEMO_NOW).toBe("2026-07-28");
    const setup = buildMoneyMovementSetup();
    expect(setup.activation.effectiveAt).toBe(DEMO_ACTIVATION_EFFECTIVE_AT);
    expect(setup.request.requestRef).toBe(DEMO_REQUEST_REF);

    const snapshot = activatedSnapshot();
    expect(snapshot.activatedAt).toBe(DEMO_ACTIVATION_EFFECTIVE_AT);
    const firmAAuthority = snapshot.firms[0].authorityPlan;
    expect(firmAAuthority.mode).toBe("staged");
    if (firmAAuthority.mode !== "staged") return;
    const firmAStages = firmAAuthority.stages;
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
    const journeyAuthority = getJourney(
      "recent-bank-change-block",
      "firm-a",
    ).record.authority;
    expect(journeyAuthority?.mode).toBe("staged");
    if (journeyAuthority?.mode !== "staged") return;
    expect(journeyAuthority.stages.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
      "Stage 2 - Dual operations approval",
    ]);
    expect(journeyAuthority.stages[0]?.actors[0]?.statusLabel).toBe(
      `Reviewed · ${demoTimestampLabel(DEMO_TIMELINE.specialistReviewedAt)}`,
    );
    expect(BANK_INSTRUCTION.changedAgeDays).toBe(6);
    expect(
      buildMoneyMovementSetup().impacts.find(
        (impact) => impact.id === "stale-withdrawals",
      )?.facts,
    ).toContain("47 days old");

    const expiredAuthority = getJourney(
      "specialist-review-expiration",
      "firm-a",
    ).record.authority;
    expect(expiredAuthority?.mode).toBe("staged");
    if (expiredAuthority?.mode !== "staged") return;
    expect(expiredAuthority.stages[0]?.stepState).toBe("active");
    expect(expiredAuthority.stages[1]?.stepState).toBe("pending");
    expect(expiredAuthority.stages[1]?.actors.every((actor) => actor.status !== "done")).toBe(
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
    expect(belowThresholdPlan.mode).toBe("staged");
    if (belowThresholdPlan.mode !== "staged") return;
    expect(belowThresholdPlan.stages.map((stage) => stage.title)).toEqual([
      "Stage 1 - Bank-instruction specialist review",
    ]);
    expect(
      belowThresholdPlan.stages.flatMap((stage) => stage.actors),
    ).not.toContainEqual(
      expect.objectContaining({ requesterExcluded: true }),
    );
    expect(buildActivatedRecord(belowThreshold, "firm-b").authority).toBe(
      belowThresholdPlan,
    );

    const dualApproval = activatedSnapshot((selections) => {
      selections["firm-b"]["bank-change"] = "specialist";
      selections["firm-b"].threshold = "25000";
    });
    const dualPlan = dualApproval.firms[1].authorityPlan;
    expect(dualPlan.mode).toBe("staged");
    if (dualPlan.mode !== "staged") return;
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
    const authority = setupActivationAuthority(selections);
    selections["firm-a"].reserve = "18-months";
    const result = activateMoneyMovementSetup(
      selections,
      authority,
    );
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
      availableCashAsOf: available.observedAt,
      plannedWithdrawalsAsOf: planned.observedAt,
    };
    const journey = getJourney("stale-evidence", "firm-a");
    const availableRow = journey.evidence.rows.find(
      (row) =>
        row.kind === "metric" &&
        row.label === "Available cash in Smith Family Taxable",
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
      truth.plannedWithdrawalsAsOf.slice(0, 10),
      {
        impact: gc09.trigger.asOf,
        blocker: DEMO_NOW,
      },
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
      {
        impact: "2026-08-10",
        blocker: "2026-08-10",
      },
      14,
    );
    expect(violations).toHaveLength(3);
    expect(violations[0]).toContain("build-setup-impacts.ts:");
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
    expect(impact.attributionKind).toBe("universal-rule");
    if (impact.attributionKind !== "universal-rule") return;
    const actual = {
      facts: impact.facts,
      effect: impact.universalEffect,
    };
    expect(
      staleImpactViolations(
        actual,
        planned.observedAt.slice(0, 10),
        available.observedAt.slice(0, 10),
        gc09.trigger.asOf,
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
        posture: configurationPosture(labelsOf(firm.firmId, selections)),
        activeProfile:
          firm.policyVersion ===
          vm.profiles.find(
            (profile) => profile.firmId === firm.firmId,
          )!.activeVersion,
        status: firm.configurationPostureStatus,
        label: firm.configurationPostureLabel,
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
    const untouched = activatedSnapshot();
    expect(untouched.firms[1].policyVersion).toBe("FB-2.1");
    expect(
      configurationPosture(
        labelsOf("firm-b", setupSelections()),
      ),
    ).toBe("recommended");
    expect(untouched.firms[1].configurationProvenance).not.toContain("Captain-signed");
    expect(
      configurationPosture(
        labelsOf("firm-a", setupSelections()),
      ),
    ).toBe("signed");
    expect(untouched.firms[0].policyVersion).not.toBe("FA-4.2");
    expect(untouched.firms[0].configurationProvenance).toContain(
      "Projected",
    );
    expect(untouched.firms[0].configurationProvenance).not.toContain(
      "Captain-signed",
    );
  });

  it("detects: a captain-signed claim over a merely recommended choice cannot pass", () => {
    const violations = configurationPostureViolations([
      {
        firmId: "firm-b",
        truthLabels: ["Signed", "Recommended", "Signed", "Signed", "Recommended"],
        posture: "signed",
        activeProfile: true,
        status: POSTURE_STATUS.signed,
        label: POSTURE_OPTION_LABEL.signed,
        provenance: POSTURE_CONFIGURATION_LABEL.signed,
      },
    ]);
    expect(violations.some((violation) => violation.includes('are "recommended"'))).toBe(true);
    expect(
      violations.some((violation) => violation.includes("exports a captain-signed claim")),
    ).toBe(true);
  });

  it("detects: an active-profile mismatch cannot retain a captain-signed claim", () => {
    const violations = configurationPostureViolations([
      {
        firmId: "firm-a",
        truthLabels: ["Signed", "Signed", "Signed", "Signed", "Signed"],
        posture: "signed",
        activeProfile: false,
        status: POSTURE_STATUS.signed,
        label: POSTURE_OPTION_LABEL.signed,
        provenance: POSTURE_CONFIGURATION_LABEL.signed,
      },
    ]);
    expect(
      violations.some((violation) =>
        violation.includes("does not match its active profile"),
      ),
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
    expect(violations[0]).toContain("decision-evidence.ts:");
  });

  it("enforces: signed evidence preserves only canonical fixture rows and instants", () => {
    const fixture = signed(
      loadGolden("GC-01-firm-a-happy-path.json"),
    );
    expect(SIGNED_SETUP_CASES.happyA).toEqual(fixture);
    const evaluationEvidence = signedCaseEvaluationEvidence(
      SIGNED_SETUP_CASES.happyA,
    );
    const material = signedCaseMaterialEvidence(
      SIGNED_SETUP_CASES.happyA,
    );
    const planned = fixture.householdEvidence.find(
      (datum) => datum.evidenceKind === "planned-withdrawals",
    )!;
    const bank = fixture.householdEvidence.find(
      (datum) => datum.evidenceKind === "bank-instruction",
    )!;
    expect(evaluationEvidence).not.toBeNull();
    expect(material.canonicalEvidence).toEqual(
      fixture.householdEvidence,
    );
    expect(
      evaluationEvidence?.plannedMonthlyWithdrawal.canonical,
    ).toEqual(planned);
    expect(
      evaluationEvidence?.bankInstruction.canonical,
    ).toEqual(bank);
    expect(
      evaluationEvidence?.bankInstruction.provenance.asOf,
    ).toBe(
      bank.observedAt,
    );
    expect(
      evaluationEvidence?.bankInstruction.canonical.retrievedAt,
    ).toBe(
      bank.retrievedAt,
    );
    const recentB = SIGNED_SETUP_CASES.recentB;
    expect(
      recentB.householdEvidence.map(
        (datum) => datum.evidenceKind,
      ),
    ).toEqual(["bank-instruction", "account-balance"]);
    expect(
      signedCaseEvaluationEvidence(recentB),
    ).toBeNull();
    expect(
      signedCaseMaterialEvidence(recentB).canonicalEvidence,
    ).toEqual(recentB.householdEvidence);
    expect(
      signedCaseMaterialEvidence(recentB).canonicalEvidence,
    ).not.toContainEqual(
      expect.objectContaining({
        evidenceKind: "planned-withdrawals",
      }),
    );
    expect(
      signedCaseMaterialEvidence(recentB).canonicalEvidence,
    ).not.toContainEqual(
      expect.objectContaining({
        evidenceKind: "household-instruction",
      }),
    );
    expect(
      buildMoneyMovementSetup().impacts.find(
        (impact) => impact.id === "recent-bank",
      )?.facts,
    ).toContain("4 days ago");
  });

  it("enforces: setup reserve evaluation consumes the bound planned-withdrawal value", () => {
    const evidence = decisionEvidenceSnapshotFor(
      scenarioById("safe-proceed"),
    );
    const baseline = evaluateSetupPolicy(
      setupSelections(),
      "firm-a",
      evidence,
      SMITHS_LIQUIDITY,
      DEMO_TIMELINE.decisionCreatedAt,
    );
    const increased = evaluateSetupPolicy(
      setupSelections(),
      "firm-a",
      {
        ...evidence,
        plannedMonthlyWithdrawal: {
          ...evidence.plannedMonthlyWithdrawal,
          value: 10_000_000,
        },
      },
      SMITHS_LIQUIDITY,
      DEMO_TIMELINE.decisionCreatedAt,
    );
    expect(baseline.reserveSatisfied).toBe(true);
    expect(increased.reserveSatisfied).toBe(false);
  });

  it("enforces: the signed liquidity account and Joint Taxable stay distinct", () => {
    expect(
      accountIdentityViolations(ACCOUNTS, loadAllGolden()),
    ).toEqual([]);
    const evidence = decisionEvidenceSnapshotFor(
      scenarioById("recent-bank-change-block"),
    );
    expect(evidence.availableCash.subjectRef).toBe(
      "subject:smiths-family-taxable",
    );
    const aliased = {
      ...evidence,
      availableCash: {
        ...evidence.availableCash,
        subjectRef: "subject:smiths-joint-taxable",
      },
    };
    expect(
      decisionInputHashFor(
        scenarioById("recent-bank-change-block"),
        aliased,
      ),
    ).not.toBe(
      decisionInputHashFor(
        scenarioById("recent-bank-change-block"),
        evidence,
      ),
    );
  });

  it("detects: the $420,000 source cannot alias Joint Taxable", () => {
    const accounts = ACCOUNTS.map((account) =>
      account.id === "acct-taxable"
        ? {
            ...account,
            subjectRef: "subject:smiths-joint-taxable",
          }
        : account,
    );
    const violations = accountIdentityViolations(
      accounts,
      loadAllGolden(),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("data.ts:");
  });

  it("enforces: no closed choice carries a signed-case effect no impact card can reach", () => {
    const vm = buildMoneyMovementSetup();
    const compared = new Map(
      vm.impacts.flatMap((impact) =>
        impact.attributionKind === "exact-case"
          ? [[impact.groupId, impact] as const]
          : [],
      ),
    );
    expect(compared.size).toBeGreaterThan(0);
    // Both owners are resolved on the GREEN path, so a renamed anchor fails loudly
    // instead of waiting for a violation to discover the fence went stale.
    const cardsWhere = sourceRef(
      "src/app/demo/build-setup-impacts.ts",
      "export function buildSetupImpacts",
    );
    const effectWhere = sourceRef("src/app/demo/build-setup.ts", "signedCaseEffect");
    const violations: string[] = [];
    for (const group of vm.policyGroups) {
      for (const firm of group.firms) {
        for (const option of firm.options) {
          const impact = compared.get(group.id);
          const reachable = impact !== undefined;
          if (
            reachable &&
            !option.signedCaseEffect &&
            !impact.selectionEffects
          ) {
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

  it("enforces: bank-change impact uses the complete threshold-sensitive evaluator result", () => {
    const vm = buildMoneyMovementSetup();
    const impact = vm.impacts.find(
      (candidate) => candidate.id === "recent-bank",
    );
    expect(impact?.attributionKind).toBe("exact-case");
    if (impact?.attributionKind !== "exact-case") return;
    expect(impact?.selectionEffects).toBeDefined();
    if (!impact?.selectionEffects) return;
    for (const firmId of ["firm-a", "firm-b"] as const) {
      expect(impact.selectionEffects[firmId]).toHaveLength(162);
      expect(
        new Set(
          impact.selectionEffects[firmId].map(
            (candidate) => candidate.selectionKey,
          ),
        ).size,
      ).toBe(162);
      expect(
        impact.selectionEffects[firmId].every((candidate) =>
          SETUP_POLICY_GROUP_IDS.every((groupId) =>
            candidate.selectionKey.includes(`${groupId}=`),
          ),
        ),
      ).toBe(true);
    }

    const effectFor = (selections: SetupSelections) =>
      impact.selectionEffects!["firm-b"].find(
        (candidate) =>
          candidate.selectionKey ===
          setupFirmSelectionKey(selections["firm-b"]),
      )?.effect;
    const belowThreshold = setupSelections();
    belowThreshold["firm-b"]["bank-change"] = "specialist";
    belowThreshold["firm-b"].threshold = "100000";
    const dualApproval = setupSelections();
    dualApproval["firm-b"]["bank-change"] = "specialist";
    dualApproval["firm-b"].threshold = "25000";

    expect(effectFor(belowThreshold)?.summary).toBe(
      "Specialist review; no dual approval at this amount",
    );
    expect(effectFor(belowThreshold)?.detail).toContain(
      "$100,000 threshold",
    );
    expect(effectFor(dualApproval)?.summary).toBe(
      "Specialist review, then two distinct operations approvers",
    );
    expect(effectFor(dualApproval)?.detail).toContain(
      "$25,000 threshold",
    );
  });

  it("enforces: signed-impact attribution matches every material preview input exactly", () => {
    const vm = buildMoneyMovementSetup();
    const compared = vm.impacts.filter(
      (impact) => impact.attributionKind === "exact-case",
    );
    const defaults = setupSelections();
    const expectedDefaultSigned = {
      "recent-bank": { "firm-a": false, "firm-b": false },
      "verified-bank": { "firm-a": false, "firm-b": false },
      "low-headroom": { "firm-a": false, "firm-b": false },
    } as const;
    expect(compared.length).toBeGreaterThan(0);

    for (const impact of compared) {
      expect(impact.attribution).toBeDefined();
      for (const firmId of ["firm-a", "firm-b"] as const) {
        expect(
          isCaptainSignedImpact(impact.attribution, firmId, defaults),
          `${impact.id}:${firmId} signed attribution does not match its complete input`,
        ).toBe(
          expectedDefaultSigned[
            impact.id as keyof typeof expectedDefaultSigned
          ][firmId],
        );
        for (const groupId of SETUP_POLICY_GROUP_IDS) {
          const varied = structuredClone(defaults);
          const group = vm.policyGroups.find(
            (candidate) => candidate.id === groupId,
          )!;
          const firm = group.firms.find(
            (candidate) => candidate.firmId === firmId,
          )!;
          const alternative = firm.options.find(
            (option) =>
              option.id !== varied[firmId][groupId],
          )!;
          varied[firmId][groupId] = alternative.id;
          expect(
            isCaptainSignedImpact(impact.attribution, firmId, varied),
            `${impact.id}:${firmId} retained signed attribution after ${groupId} changed`,
          ).toBe(false);
        }
      }

      expect(
        isCaptainSignedImpact(
          {
            ...impact.attribution!,
            "firm-a": {
              ...impact.attribution!["firm-a"],
              previewMaterialInputHash: "0".repeat(64),
            },
          },
          "firm-a",
          defaults,
        ),
      ).toBe(false);
    }

    const exactHash = "a".repeat(64);
    expect(
      isCaptainSignedImpact(
        {
          "firm-a": {
            previewMaterialInputHash: exactHash,
            signedMaterialInputHash: exactHash,
            signedSelectionKey: setupFirmSelectionKey(
              defaults["firm-a"],
            ),
          },
          "firm-b": {
            previewMaterialInputHash: "b".repeat(64),
            signedMaterialInputHash: null,
            signedSelectionKey: null,
          },
        },
        "firm-a",
        defaults,
      ),
    ).toBe(true);
  });

  it("enforces: the signed baseline is projected directly from the fixture", () => {
    const descriptor = {
      id: "recent-bank",
      caseRef: "GC-03 / GC-04",
      scenarioId: "recent-bank-change-block",
    };
    const fixture = SIGNED_SETUP_CASES.recentB;
    const baseline = signedImpactFixtureMaterialInput(
      descriptor,
      fixture,
    );
    expect(baseline.phase).toBeNull();
    expect(baseline.authority).toEqual(
      fixture.expectedAuthority,
    );
    expect(
      (
        baseline.resolvedConfiguration as {
          policyVersions: unknown;
        }
      ).policyVersions,
    ).toEqual(fixture.policyVersions);
    expect(baseline.evidence).toEqual(
      signedCaseMaterialEvidence(fixture),
    );
    expect(baseline.missingMaterialInputs).toEqual(
      expect.arrayContaining([
        "phase",
        "firmConfiguration.freshnessDays",
        "firmConfiguration.approvalClock",
        "selectionKey",
        "evidence.plannedMonthlyMinor",
      ]),
    );

    const mutations = [
      (candidate: typeof fixture) => {
        (
          candidate.trigger as {
            maskedRequestSummary: string;
          }
        ).maskedRequestSummary =
          "distribute 100000 USD to a recently changed destination";
      },
      (candidate: typeof fixture) => {
        (
          candidate.firmConfiguration as {
            dualApprovalThresholdUsd: number;
          }
        ).dualApprovalThresholdUsd = 25_000;
      },
      (candidate: typeof fixture) => {
        (
          candidate.policyVersions as {
            domainConfigVersionId: string;
          }
        ).domainConfigVersionId =
          "money-movement@2026.08.0";
      },
      (candidate: typeof fixture) => {
        (
          candidate.householdEvidence[0] as {
            observedAt: string;
          }
        ).observedAt =
          "2026-07-24T14:12:00-04:00";
      },
      (candidate: typeof fixture) => {
        (
          candidate.expectedAuthority as {
            note: string;
          }
        ).note = "A different authority outcome";
      },
    ];
    const baselineHash =
      signedImpactMaterialInputHash(baseline);
    for (const mutate of mutations) {
      const candidate = structuredClone(fixture);
      mutate(candidate);
      expect(
        signedImpactMaterialInputHash(
          signedImpactFixtureMaterialInput(
            descriptor,
            candidate,
          ),
        ),
      ).not.toBe(baselineHash);
    }
  });

  it("enforces: signed-impact identity binds every declared material input", () => {
    const input = {
      phase: "signed-impact-preview",
      impactId: "recent-bank",
      caseRef: "GC-03 / GC-04",
      scenarioId: "recent-bank-change-block",
      firmId: "firm-a" as const,
      request: { amountMinor: 7_500_000 },
      evidence: {
        subjectRef: "subject:smiths-family-taxable",
        observedAt: "2026-07-22T14:12:00-04:00",
        retrievedAt: "2026-07-26T09:30:05-04:00",
      },
      resolvedConfiguration: {
        reserveMonths: 6,
        freshnessDays: 30,
        bankChangeHandling: "specialist-review",
        dualApprovalThresholdMinor: 2_500_000,
        approvalsRequired: 2,
        distinctActorsRequired: true,
        authorityMode: "staged",
        eligibleRole: "operations",
        requesterParticipation: {
          mode: "excluded",
          constraint: "may-not-satisfy-both-approvals",
        },
        approvalClock: APPROVAL_CLOCKS["1d-3d"]!,
      },
      authority: {
        claim: {
          mode: "staged",
          eligibleRole: "operations",
          requesterParticipation: {
            mode: "excluded",
            constraint: "may-not-satisfy-both-approvals",
          },
          requirements: [
            {
              order: 1,
              title: "Dual operations approval",
              requirement:
                "Two distinct operations approvers. The requester cannot approve.",
              expiry: "Expires after 3 days",
              escalation: "Escalates after 1 day",
            },
          ],
        },
        requesterMayApprove: false,
      },
      dispositionKind: "proceed",
      selectionKey:
        "reserve=6-months|freshness=30-days|bank-change=specialist|threshold=25000|expiry=1d-3d",
      missingMaterialInputs: [],
    } satisfies SignedImpactMaterialInput;
    const signedHash = signedImpactMaterialInputHash(input);
    const mutations: SignedImpactMaterialInput[] = [
      { ...input, phase: "activated-impact" },
      { ...input, impactId: "verified-bank" },
      { ...input, caseRef: "GC-01 / GC-02" },
      { ...input, scenarioId: "safe-proceed" },
      { ...input, firmId: "firm-b" as const },
      { ...input, request: { amountMinor: 10_000_000 } },
      {
        ...input,
        evidence: {
          ...input.evidence,
          subjectRef: "subject:smiths-joint-taxable",
        },
      },
      {
        ...input,
        evidence: {
          ...input.evidence,
          observedAt: "2026-07-24T14:12:00-04:00",
        },
      },
      {
        ...input,
        evidence: {
          ...input.evidence,
          retrievedAt: "2026-07-28T14:30:00-04:00",
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          reserveMonths: 12,
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          freshnessDays: 14,
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          bankChangeHandling:
            "block-until-independently-verified" as const,
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          dualApprovalThresholdMinor: 10_000_000,
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          approvalsRequired: 1,
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          distinctActorsRequired: false,
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          authorityMode: "automatic" as const,
          eligibleRole: null,
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          requesterParticipation: { mode: "unbound" },
        },
      },
      {
        ...input,
        resolvedConfiguration: {
          ...input.resolvedConfiguration,
          approvalClock: APPROVAL_CLOCKS["4h-2d"]!,
        },
      },
      {
        ...input,
        authority: {
          ...input.authority,
          claim: {
            ...input.authority.claim,
            requirements: [
              {
                ...input.authority.claim.requirements[0]!,
                expiry: "Expires after 2 days",
              },
            ],
          },
        },
      },
      {
        ...input,
        authority: {
          ...input.authority,
          requesterMayApprove: null,
        },
      },
      { ...input, dispositionKind: "blocked" },
      { ...input, selectionKey: null },
      {
        ...input,
        missingMaterialInputs: ["phase"],
      },
    ];
    expect(
      new Set(mutations.map(signedImpactMaterialInputHash)).size,
    ).toBe(mutations.length);
    for (const mutation of mutations) {
      expect(signedImpactMaterialInputHash(mutation)).not.toBe(
        signedHash,
      );
    }
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
    const approvals = getJourney("safe-proceed", "firm-a").approvals;
    expect(approvals?.mode).toBe("staged");
    if (approvals?.mode !== "staged") return;
    const stage = approvals.stages[0];
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

  it("enforces: reserve floor lineage excludes headroom-only balance inputs", () => {
    const floor = reserveFloorInputs(ACTIVATED_RESERVE_HORIZON);
    const headroom = headroomInputs(ACTIVATED_RESERVE_HORIZON);
    expect(floor).toEqual(RESERVE_FLOOR_INPUTS);
    expect(floor).toHaveLength(2);
    expect(headroom).toHaveLength(5);
    expect(floor).not.toContain(headroom[0]);
    expect(floor).toContain(headroom[2]);
    expect(floor).toContain(headroom[4]);
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
    const signedObservedAt = gc03.householdEvidence
      .find((evidence) => evidence.evidenceKind === "bank-instruction")!
      .observedAt;
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
          inputHash: decisionInputHashFor(
            scenarioById("recent-bank-change-block"),
          ),
          impactEvaluatedAt: gc03.trigger.asOf,
        },
        signedObservedAt,
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
    expect(violations[0]).toContain("decision-evidence.ts:");
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
        impactEvaluatedAt: "2026-07-26",
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
    const compared = vm.impacts.filter(
      (impact) => impact.attributionKind === "exact-case",
    );
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
        violation.includes("build-setup-impacts.ts:") &&
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

    it("flags invented Firm B approval authority in signed automatic cases", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          automaticAuthority: {
            happyFirmB: "staged",
            delayedNigoFirmB: "staged",
          },
        },
        goldenSemanticTruth(),
      );
      expect(violations).toHaveLength(2);
      expect(
        violations.every(
          (violation) =>
            violation.includes("src/app/demo/build-decision.ts:") &&
            violation.includes('captain-signed "automatic"'),
        ),
      ).toBe(true);
    });
  });
});
