import type { MetricFormat } from "@contracts/metric";
import {
  EXECUTION_RECEIPT_IDS,
  OBSERVED_STATUS_IDS,
  VERIFICATION_PROJECTION_IDS,
} from "@contracts/execution-status";
import {
  MINOR_UNITS_PER_MAJOR,
  MONEY_METRIC_FORMAT,
  headroomMinor,
  isMoneyQuantity,
  minorFromMajor,
  reserveFloorMinor,
} from "@contracts/money-movement";
import { readSignedMoney, type LoadedCase, type ScenarioRefs } from "./golden-cases.lib";

/** A money value the demo holds, beside exactly what the shipped renderer printed. */
export interface RenderedMoney {
  minor: number;
  rendered: string;
}

/** One decision the demo actually puts on screen, with the liquidity arithmetic
 * standing behind its "Available after reserve" figure. */
export interface DisplayedDecision {
  scenarioId: string;
  firmId: string;
  disposition: string;
  sourceCaseId: string | null;
  liquidityAuthorityMissing: string | null;
  availableCashMinor: number | null;
  pendingActivityMinor: number | null;
  reserveFloorMinor: number;
  headroomMinor: number | null;
  revalidationAvailableCashMinor: number | null;
  revalidationPendingActivityMinor: number | null;
  /** Surface 11's simulated after-state under the drafted twelve-month floor. The
   * headroom row is displayed only where the draft actually moves the floor. */
  simulatedFloorMinor: number | null;
  simulatedHeadroomMinor: number | null;
  simulatedDisposition: string | null;
}

export interface DemoSemanticSnapshot {
  requestAmountMinor: number;
  plannedWithdrawalMonthlyMinor: number;
  /** Every distinct format the demo's money metrics actually carry. */
  moneyUnits: MetricFormat[];
  /** Every money value the demo renders, with the string the renderer produced. */
  moneyRenders: RenderedMoney[];
  currency: string;
  cadence: string;
  firms: Array<{
    id: string;
    reserveMonths: number;
    reserveFloorMinor: number;
  }>;
  decisions: DisplayedDecision[];
  draftedReserveMonths: number;
  draftedReserveFloorMinor: number | null;
  executionTimelineStatuses: string[];
  verificationTimelineStatuses: string[];
  authorityLapseEvents: Array<{
    type: string;
    timestamp: string;
  }>;
  approvalInvalidationPhases: {
    initialSurfaceMoneyMinor: number[];
    safetyBeforePendingMinor: number | null;
    safetyAfterPendingMinor: number | null;
  };
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const caseData = (cases: LoadedCase[], id: string): Record<string, unknown> | undefined => {
  const found = cases.find(({ data }) => isObj(data) && data.caseId === id);
  return found && isObj(found.data) ? found.data : undefined;
};
const sameMembers = (left: Iterable<string>, right: Iterable<string>): boolean => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

/**
 * Decompose a rendered money string into an EXACT decimal: `units` counted in
 * 10^`scale` fractions of a major unit. Integer arithmetic only - no float divide
 * to blur a cent into 99.99999999999999 - and the sign survives, so a negative
 * headroom reads as a negative amount rather than an unreadable one.
 */
export function readRenderedMajor(rendered: string): { units: number; scale: number } | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(rendered.replace(/[^\d.-]/g, ""));
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const units = Number(`${whole}${fraction}`);
  if (!Number.isSafeInteger(units)) return null;
  return { units: sign === "-" ? -units : units, scale: fraction.length };
}

/**
 * Whether the shipped renderer turned `minor` into `rendered` at exactly
 * MINOR_UNITS_PER_MAJOR minor units per major: `minor x 10^scale === major units x
 * MINOR_UNITS_PER_MAJOR`. Whole dollars, fractional cents, and negatives all pass
 * or fail on their own merits; null means the rendering could not be read back at
 * all, which is a failure the caller reports rather than a silent skip.
 */
export function rendersAtCanonicalScale(money: RenderedMoney): boolean | null {
  const major = readRenderedMajor(money.rendered);
  if (major === null || !Number.isSafeInteger(money.minor)) return null;
  const left = money.minor * 10 ** major.scale;
  const right = major.units * MINOR_UNITS_PER_MAJOR;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  return left === right;
}

/**
 * STATUS-VOCABULARY DRIFT. The canonical planes live in
 * `@contracts/execution-status`; the normative documents must state the same ones.
 * A document that drops a status, or that names `stuck` / `duplicate-suppressed`
 * without saying which plane they belong to, or that still implies a canonical
 * `settled` status, fails the build - which is how the demo contract, its
 * acceptance checklist, and the design language stay a single vocabulary instead of
 * three that quietly diverge (demo-contract.md annotation 3, captain 2026-07-28).
 */
export function validateStatusVocabularyDocs(docs: { path: string; text: string }[]): string[] {
  const problems: string[] = [];
  if (docs.length === 0) return ["no normative status document was supplied to fence (the fence went vacuous)"];
  const planes = [
    [VERIFICATION_PROJECTION_IDS, "verification projection"],
    [EXECUTION_RECEIPT_IDS, "execution receipt"],
  ] as const;
  for (const { path, text } of docs) {
    const flat = text.replace(/\s+/g, " ");
    if (flat.trim() === "") {
      problems.push(`${path}: normative status document is missing or empty`);
      continue;
    }
    for (const id of OBSERVED_STATUS_IDS) {
      if (!flat.includes(`\`${id}\``)) problems.push(`${path}: does not state the canonical observed status \`${id}\``);
    }
    for (const [ids, plane] of planes) {
      for (const id of ids) {
        if (!flat.includes(`\`${id}\``)) {
          problems.push(`${path}: does not state \`${id}\`, the ${plane}`);
        } else if (!new RegExp(`\`${id}\`[^.]*${plane}|${plane}[^.]*\`${id}\``, "i").test(flat)) {
          problems.push(`${path}: names \`${id}\` without stating that it is a ${plane}, not an observed status`);
        }
      }
    }
    if (!/no (?:separate )?canonical `settled` (?:status|state)/i.test(flat)) {
      problems.push(`${path}: must state that there is no canonical \`settled\` status (demo-contract.md annotation 3)`);
    }
  }
  return problems;
}

/**
 * EVERY decision the demo puts on screen, checked against the signed case its
 * branch names. Three things cannot pass: liquidity that does not match the signed
 * evidence, an "Available after reserve" figure that is not the shared arithmetic
 * over that evidence, and a `proceed` (or simulated `proceed`) rendered beside a
 * headroom that does not cover the canonical request. That last one is the whole
 * point - a proceed the demo's own figures contradict is the defect this catches.
 */
function validateDisplayedDecisions(cases: LoadedCase[], demo: DemoSemanticSnapshot): string[] {
  const problems: string[] = [];
  if (demo.decisions.length === 0) return ["the demo renders no decision to fence"];
  for (const d of demo.decisions) {
    const at = `${d.scenarioId}/${d.firmId}`;
    if (d.sourceCaseId === null) {
      if (!isNonEmptyString(d.liquidityAuthorityMissing)) {
        problems.push(`${at}: has no signed liquidity case but does not surface missing authority`);
      }
      if (
        d.availableCashMinor !== null ||
        d.pendingActivityMinor !== null ||
        d.headroomMinor !== null ||
        d.revalidationAvailableCashMinor !== null ||
        d.revalidationPendingActivityMinor !== null
      ) {
        problems.push(`${at}: displays numeric liquidity despite having no branch-and-firm signed authority`);
      }
      continue;
    }
    if (d.liquidityAuthorityMissing !== null) {
      problems.push(`${at}: names a signed case and simultaneously claims liquidity authority is missing`);
    }
    const source = caseData(cases, d.sourceCaseId);
    const signed = source ? readSignedMoney(source) : null;
    if (!signed) {
      problems.push(`${at}: names signed case "${d.sourceCaseId}", which is missing or states no signedMoney`);
      continue;
    }
    if (source?.scenarioRef !== d.scenarioId) {
      problems.push(`${at}: signed case "${d.sourceCaseId}" belongs to scenario ${String(source?.scenarioRef)}, not this branch`);
    }
    if (source?.firm !== d.firmId) {
      problems.push(`${at}: signed case "${d.sourceCaseId}" belongs to firm ${String(source?.firm)}, not this firm`);
    }
    const availableMinor = minorFromMajor(signed.availableLiquidityUsd);
    const pendingMinor = minorFromMajor(signed.pendingLiquidityUsd);
    if (availableMinor === null || pendingMinor === null) {
      problems.push(`${at}: signed case "${d.sourceCaseId}" states no liquidity for the branch to render`);
      continue;
    }
    if (d.availableCashMinor !== availableMinor) {
      problems.push(`${at}: available-liquidity drift, ${d.sourceCaseId}=${availableMinor}, demo=${d.availableCashMinor}`);
    }
    if (d.pendingActivityMinor !== pendingMinor) {
      problems.push(`${at}: pending-activity drift, ${d.sourceCaseId}=${pendingMinor}, demo=${d.pendingActivityMinor}`);
    }
    const revalidationAvailableMinor = minorFromMajor(signed.preExecutionRevalidation?.availableLiquidityUsd ?? null);
    const revalidationPendingMinor = minorFromMajor(signed.preExecutionRevalidation?.pendingLiquidityUsd ?? null);
    if (
      d.revalidationAvailableCashMinor !== revalidationAvailableMinor ||
      d.revalidationPendingActivityMinor !== revalidationPendingMinor
    ) {
      problems.push(
        `${at}: pre-execution revalidation drift, ${d.sourceCaseId}=${revalidationAvailableMinor}/${revalidationPendingMinor}, demo=${d.revalidationAvailableCashMinor}/${d.revalidationPendingActivityMinor}`,
      );
    }
    const expectedFloor = demo.firms.find((firm) => firm.id === d.firmId)?.reserveFloorMinor;
    if (d.reserveFloorMinor !== expectedFloor) {
      problems.push(`${at}: reserve floor ${d.reserveFloorMinor} is not this firm's derived floor ${expectedFloor ?? "(unknown firm)"}`);
    }
    // Guard with the SAME predicate the shared arithmetic throws on, so a malformed
    // figure is reported here rather than crashing the run and discarding every
    // diagnostic already collected.
    if (![d.availableCashMinor, d.pendingActivityMinor, d.reserveFloorMinor].every(isMoneyQuantity)) {
      problems.push(`${at}: displayed liquidity, pending activity, and reserve floor must each be a whole non-negative amount`);
      continue;
    }
    const expectedHeadroom = headroomMinor(d.availableCashMinor!, d.pendingActivityMinor!, d.reserveFloorMinor);
    if (d.headroomMinor !== expectedHeadroom) {
      problems.push(`${at}: displayed headroom ${d.headroomMinor} is not available - pending - reserve (${expectedHeadroom})`);
    }
    if (d.disposition === "proceed" && (d.headroomMinor === null || d.headroomMinor < demo.requestAmountMinor)) {
      problems.push(`${at}: renders proceed beside ${d.headroomMinor} available after reserve, which does not cover the ${demo.requestAmountMinor} request`);
    }
    if (d.simulatedDisposition === "proceed") {
      // A draft that leaves this firm's floor where it is inherits the branch's own
      // headroom (surface 11 shows no delta row for a no-op); a draft that MOVES the
      // floor must display the headroom that follows, or its proceed is unbacked.
      const unchangedFloor = d.simulatedFloorMinor === d.reserveFloorMinor;
      const simulatedHeadroom = d.simulatedHeadroomMinor ?? (unchangedFloor ? d.headroomMinor : null);
      if (simulatedHeadroom === null || simulatedHeadroom < demo.requestAmountMinor) {
        problems.push(`${at}: the policy-draft simulation renders proceed beside ${simulatedHeadroom ?? "no"} available after the drafted reserve, which does not cover the ${demo.requestAmountMinor} request`);
      }
    }
  }
  return problems;
}

/** Cross-artifact signed truth fence. The fixtures supply the numbers. */
export function validateGoldenDemoSemantics(
  cases: LoadedCase[],
  refs: ScenarioRefs,
  demo: DemoSemanticSnapshot,
): string[] {
  const problems: string[] = [];
  const canonicalCases = [
    ["GC-01-firm-a-happy-path", "firm-a"],
    ["GC-02-firm-b-happy-path", "firm-b"],
  ] as const;

  for (const unit of demo.moneyUnits) {
    if (unit !== MONEY_METRIC_FORMAT) {
      problems.push(`demo money metric carries format "${unit}", not "${MONEY_METRIC_FORMAT}"`);
    }
  }
  if (demo.moneyUnits.length === 0) problems.push("demo emits no money metrics to project a unit from");
  if (demo.moneyRenders.length === 0) problems.push("demo renders no money value to project its divisor from");
  for (const money of demo.moneyRenders) {
    const exact = rendersAtCanonicalScale(money);
    if (exact === null) {
      problems.push(`demo renders ${money.minor} minor units as "${money.rendered}", which is not a readable ${MINOR_UNITS_PER_MAJOR}-per-major amount`);
    } else if (!exact) {
      problems.push(`demo renders ${money.minor} minor units as "${money.rendered}", not at ${MINOR_UNITS_PER_MAJOR} minor units per major`);
    }
  }

  problems.push(...validateDisplayedDecisions(cases, demo));

  for (const [caseId, firmId] of canonicalCases) {
    const c = caseData(cases, caseId);
    if (!c) {
      problems.push(`${caseId}: signed canonical fixture missing`);
      continue;
    }
    const signed = readSignedMoney(c);
    const config = isObj(c.firmConfiguration) ? c.firmConfiguration : undefined;
    const demoFirm = demo.firms.find((firm) => firm.id === firmId);
    const reserveMonths = config?.cashReserveMonths;
    if (!signed) problems.push(`${caseId}: signedMoney is missing or malformed`);
    if (!isMoneyQuantity(reserveMonths)) problems.push(`${caseId}: firmConfiguration.cashReserveMonths is not a whole reserve horizon`);
    if (!demoFirm) problems.push(`${caseId}: demo has no firm "${firmId}"`);
    if (!signed || !isMoneyQuantity(reserveMonths) || !demoFirm) continue;

    const expectedRequestMinor = minorFromMajor(signed.requestAmountUsd);
    const expectedMonthlyMinor = minorFromMajor(signed.plannedWithdrawalMonthlyUsd);
    const expectedFloorMinor = minorFromMajor(signed.reserveFloorUsd);
    if (expectedRequestMinor === null) problems.push(`${caseId}: signedMoney.requestAmountUsd does not convert to minor units`);
    if (expectedMonthlyMinor === null) problems.push(`${caseId}: the canonical case must state signedMoney.plannedWithdrawalMonthlyUsd`);
    if (expectedFloorMinor === null) problems.push(`${caseId}: the canonical case must state signedMoney.reserveFloorUsd`);
    if (expectedRequestMinor === null || expectedMonthlyMinor === null || expectedFloorMinor === null) continue;

    if (signed.currency !== demo.currency) {
      problems.push(`${caseId}: currency drift, fixture=${signed.currency}, demo=${demo.currency}`);
    }
    if (signed.cadence !== demo.cadence) {
      problems.push(`${caseId}: reserve cadence drift, fixture=${signed.cadence}, demo=${demo.cadence}`);
    }
    if (demo.requestAmountMinor !== expectedRequestMinor) {
      problems.push(`${caseId}: request amount drift, fixture=${expectedRequestMinor}, demo=${demo.requestAmountMinor}`);
    }
    if (demo.plannedWithdrawalMonthlyMinor !== expectedMonthlyMinor) {
      problems.push(`${caseId}: planned-withdrawal drift, fixture=${expectedMonthlyMinor}, demo=${demo.plannedWithdrawalMonthlyMinor}`);
    }
    if (demoFirm.reserveMonths !== reserveMonths) {
      problems.push(`${caseId}: reserve horizon drift, fixture=${reserveMonths}, demo=${demoFirm.reserveMonths}`);
    }
    if (refs.firmReserveMonths.get(firmId) !== reserveMonths) {
      problems.push(`${caseId}: scenarios.yaml reserve horizon drift for ${firmId}`);
    }
    if (refs.canonicalRequestAmountUsd !== signed.requestAmountUsd) {
      problems.push(`${caseId}: scenarios.yaml canonical request amount drift`);
    }
    if (reserveFloorMinor(expectedMonthlyMinor, reserveMonths) !== expectedFloorMinor) {
      problems.push(`${caseId}: signed reserve floor is not monthly withdrawal times reserve horizon`);
    }
    if (demoFirm.reserveFloorMinor !== expectedFloorMinor) {
      problems.push(`${caseId}: derived reserve floor drift, fixture=${expectedFloorMinor}, demo=${demoFirm.reserveFloorMinor}`);
    }
    // The branch THIS case maps to, rendered under THIS case's firm, must show this
    // case's own arithmetic end to end: its liquidity, its floor, the headroom that
    // follows, and the disposition it signs. The fixture picks the branch (via its
    // own scenarioRef), so the check cannot be satisfied by pointing at another one.
    const branchId = isNonEmptyString(c.scenarioRef) ? c.scenarioRef : null;
    const rendered = demo.decisions.find((d) => d.scenarioId === branchId && d.firmId === firmId);
    const expectedAvailable = minorFromMajor(signed.availableLiquidityUsd);
    const expectedPending = minorFromMajor(signed.pendingLiquidityUsd);
    if (!rendered) {
      problems.push(`${caseId}: the demo renders no ${branchId ?? "(unstated)"} decision for ${firmId}`);
    } else if (expectedAvailable === null || expectedPending === null) {
      problems.push(`${caseId}: the canonical case must state signedMoney.availableLiquidityUsd and pendingLiquidityUsd`);
    } else {
      const expectedHeadroom = reserveFloorMinor(expectedMonthlyMinor, reserveMonths);
      const headroom = expectedAvailable - expectedPending - expectedHeadroom;
      if (rendered.availableCashMinor !== expectedAvailable || rendered.pendingActivityMinor !== expectedPending) {
        problems.push(`${caseId}: rendered liquidity drift, fixture=${expectedAvailable}/${expectedPending}, demo=${rendered.availableCashMinor}/${rendered.pendingActivityMinor}`);
      }
      if (rendered.headroomMinor !== headroom) {
        problems.push(`${caseId}: rendered headroom drift, fixture arithmetic=${headroom}, demo=${rendered.headroomMinor}`);
      }
      if (rendered.disposition !== c.expectedDisposition) {
        problems.push(`${caseId}: rendered disposition drift, fixture=${String(c.expectedDisposition)}, demo=${rendered.disposition}`);
      }
      if (headroom < expectedRequestMinor) {
        problems.push(`${caseId}: the signed liquidity no longer covers the signed request under a ${reserveMonths}-month reserve`);
      }
    }
    // Surface 11's simulated policy draft shows a floor too: bind it to the signed
    // horizon it simulates so the displayed figure cannot drift on its own path.
    if (demo.draftedReserveMonths === reserveMonths && demo.draftedReserveFloorMinor !== expectedFloorMinor) {
      problems.push(`${caseId}: drafted-policy reserve floor drift, fixture=${expectedFloorMinor}, demo=${demo.draftedReserveFloorMinor}`);
    }
  }

  if (demo.draftedReserveFloorMinor === null) {
    problems.push("the policy-draft simulation displays no reserve floor to fence");
  } else if (!isMoneyQuantity(demo.draftedReserveMonths) || !isMoneyQuantity(demo.plannedWithdrawalMonthlyMinor)) {
    problems.push("the policy-draft simulation has no whole reserve horizon or monthly schedule to derive from");
  } else if (
    demo.draftedReserveFloorMinor !== reserveFloorMinor(demo.plannedWithdrawalMonthlyMinor, demo.draftedReserveMonths)
  ) {
    problems.push("the policy-draft reserve floor is not the monthly withdrawal times the drafted horizon");
  }

  if (!sameMembers(refs.executionStates, OBSERVED_STATUS_IDS)) {
    problems.push(`scenarios.yaml execution statuses must equal ${OBSERVED_STATUS_IDS.join("|")}`);
  }
  const executionAllowed = new Set<string>([...OBSERVED_STATUS_IDS, ...EXECUTION_RECEIPT_IDS]);
  for (const status of demo.executionTimelineStatuses) {
    if (!executionAllowed.has(status)) {
      problems.push(`demo execution timeline status "${status}" is neither an observed outcome nor an execution receipt`);
    }
  }
  const verificationAllowed = new Set<string>([...OBSERVED_STATUS_IDS, ...VERIFICATION_PROJECTION_IDS]);
  for (const status of demo.verificationTimelineStatuses) {
    if (!verificationAllowed.has(status)) {
      problems.push(`demo verification timeline status "${status}" is neither an observed outcome nor a verification projection`);
    }
  }

  const gc16 = caseData(cases, "GC-16-specialist-review-expiration");
  const gc16Events = Array.isArray(gc16?.expectedLedgerEvents)
    ? gc16.expectedLedgerEvents.flatMap((event) =>
        isObj(event) && typeof event.type === "string" ? [event.type] : [],
      )
    : [];
  const requiredGc16 = [
    "EvidenceSnapshotRecorded",
    "DecisionRecorded",
    "ApprovalStageEscalated",
    "ApprovalStageExpired",
  ];
  if (!sameMembers(gc16Events, requiredGc16) ||
      gc16Events.some((event, index) => event !== requiredGc16[index])) {
    problems.push(`GC-16 event sequence must be ${requiredGc16.join(" -> ")}`);
  }
  const visibleAuthorityEvents = demo.authorityLapseEvents;
  const visibleTypes = visibleAuthorityEvents.map((event) => event.type);
  const visibleTimestamps = visibleAuthorityEvents.map((event) => event.timestamp);
  const requiredVisible = ["ApprovalStageEscalated", "ApprovalStageExpired"];
  if (
    visibleTypes.length !== requiredVisible.length ||
    visibleTypes.some((event, index) => event !== requiredVisible[index]) ||
    visibleTimestamps.some((timestamp, index) => index > 0 && timestamp <= visibleTimestamps[index - 1]!)
  ) {
    problems.push(`GC-16 visible authority order must be ${requiredVisible.join(" -> ")} with ascending timestamps`);
  }
  const gc15 = caseData(cases, "GC-15-approval-invalidation");
  const gc15Signed = gc15 ? readSignedMoney(gc15) : null;
  const gc15InitialPending = minorFromMajor(gc15Signed?.pendingLiquidityUsd ?? null);
  const gc15RevalidationPending = minorFromMajor(
    gc15Signed?.preExecutionRevalidation?.pendingLiquidityUsd ?? null,
  );
  if (
    gc15InitialPending === null ||
    gc15RevalidationPending === null ||
    demo.approvalInvalidationPhases.initialSurfaceMoneyMinor.includes(gc15RevalidationPending) ||
    demo.approvalInvalidationPhases.safetyBeforePendingMinor !== gc15InitialPending ||
    demo.approvalInvalidationPhases.safetyAfterPendingMinor !== gc15RevalidationPending
  ) {
    problems.push(
      "GC-15 must keep revalidation pending activity off initial surfaces, then render initial and refreshed pending values in order",
    );
  }
  return problems;
}
