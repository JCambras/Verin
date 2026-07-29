import type { MetricFormat } from "@contracts/metric";
import {
  EXECUTION_RECEIPT_IDS,
  OBSERVED_STATUS_IDS,
  VERIFICATION_PROJECTION_IDS,
} from "@contracts/execution-status";
import {
  MINOR_UNITS_PER_MAJOR,
  MONEY_METRIC_FORMAT,
  isMoneyQuantity,
  minorFromMajor,
  tryHeadroomMinor,
  tryReserveFloorMinor,
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
  decisionRole: "primary" | "competing-sibling";
  disposition: string;
  sourceCaseId: string | null;
  requestAt: string | null;
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

export interface SourceTimelineEvent {
  kind: string;
  instant: string;
  display: string;
  renderedInstant: string;
}

export interface SourceTimeline {
  sourceCaseId: string;
  scenarioId: string;
  firmId: string;
  requestAt: string;
  events: SourceTimelineEvent[];
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
  sourceTimelines: SourceTimeline[];
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
    refreshedEvidencePendingMinor: number | null;
  };
  executionGuards: Array<{
    scenarioId: string;
    firmId: string;
    signedLiquidityAuthority: boolean;
    reservationVisible: boolean;
    executionReached: boolean;
    verificationReached: boolean;
  }>;
  authorityPlans: Array<{
    scenarioId: string;
    firmId: string;
    pass: "initial" | "revalidated";
    mode: "automatic" | "staged";
    automaticAuthorityVisible: boolean;
    bindingVisible: boolean;
    satisfied: boolean;
    stages: Array<{
      stageId: string;
      order: number;
      eligibleRoleIds: string[];
      approvalsRequired: number;
      distinctActorsRequired: boolean;
      requesterMayApprove: boolean;
      satisfied: boolean;
      completedActorIds: string[];
      completedRoleIds: string[];
    }>;
  }>;
  reservationCausality: Array<{
    scenarioId: string;
    firmId: string;
    sourceCaseId: string;
    requestAt: string;
    decisionAt: string;
    reservationAt: string;
    executionAt: string;
    relatedSourceCaseId: string;
    relatedRequestAt: string;
  }>;
  approvalInvalidationLifecycle: {
    eventTypes: string[];
    eventInstants: string[];
    originalApprovals: number;
    freshApprovals: number;
    freshPlanSatisfied: boolean;
    freshActorIds: string[];
    freshRoleIds: string[];
    initialReservationVisible: boolean;
    revalidatedReservationVisible: boolean;
    revalidatedExecutionReached: boolean;
    revalidatedVerificationReached: boolean;
    revalidatedExecutionStatuses: string[];
    revalidatedVerificationProves: string[];
    revalidatedComparisonHeadroomMinor: number | null;
    recordBindings: Array<{
      kind: "original" | "derived";
      decisionHash: string;
      bundleHash: string;
    }>;
    originalApprovalBinding: {
      decisionHash: string;
      bundleHash: string;
    } | null;
    freshApprovalBinding: {
      decisionHash: string;
      bundleHash: string;
    } | null;
    unsupportedFirmEventCount: number;
  };
  partialReceipt: {
    completedParts: string[];
    incompleteParts: string[];
    observedStatuses: string[];
    statusLabels: string[];
    proves: string[];
    notProvenYet: string[];
    exceptionDecision: {
      eventType: "ExceptionDecisionRequested";
      reason: "partial-execution";
      priorDecisionId: string;
      triggeringLedgerEvent: "ExecutionPartiallySucceeded";
    } | null;
    recordExceptionDecision: {
      eventType: "ExceptionDecisionRequested";
      reason: "partial-execution";
      priorDecisionId: string;
      triggeringLedgerEvent: "ExecutionPartiallySucceeded";
    } | null;
  };
  invalidationPolicySimulation: {
    currentHeadroomMinor: number | null;
    draftedHeadroomMinor: number | null;
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
const sourceKey = (scenarioId: string, firmId: string, disposition: string): string =>
  `${scenarioId}\u0000${firmId}\u0000${disposition}`;

interface ExactSourceCandidate {
  id: string;
}

function exactSourceCandidates(
  cases: LoadedCase[],
  demo: DemoSemanticSnapshot,
): Map<string, ExactSourceCandidate[]> {
  const candidates = new Map<string, ExactSourceCandidate[]>();
  for (const { data } of cases) {
    if (!isObj(data) || !isNonEmptyString(data.caseId)) continue;
    const scenarioId = data.scenarioRef;
    const firmId = data.firm;
    const disposition = data.expectedDisposition;
    const signoff = isObj(data.signoff) ? data.signoff : null;
    const firmConfiguration = isObj(data.firmConfiguration)
      ? data.firmConfiguration
      : null;
    const signed = readSignedMoney(data);
    const demoFirm =
      typeof firmId === "string"
        ? demo.firms.find((firm) => firm.id === firmId)
        : undefined;
    const requestMinor = minorFromMajor(signed?.requestAmountUsd ?? null);
    const monthlyMinor = minorFromMajor(
      signed?.plannedWithdrawalMonthlyUsd ?? null,
    );
    const floorMinor = minorFromMajor(signed?.reserveFloorUsd ?? null);
    if (
      !isNonEmptyString(scenarioId) ||
      !isNonEmptyString(firmId) ||
      !isNonEmptyString(disposition) ||
      signoff?.status !== "signed" ||
      signoff.authority !== "captain" ||
      !isNonEmptyString(signoff.signedBy) ||
      !isNonEmptyString(signoff.signedAt) ||
      !signed ||
      !demoFirm ||
      requestMinor !== demo.requestAmountMinor ||
      signed.currency !== demo.currency ||
      signed.cadence !== demo.cadence ||
      floorMinor !== demoFirm.reserveFloorMinor ||
      firmConfiguration?.cashReserveMonths !== demoFirm.reserveMonths ||
      (monthlyMinor !== null &&
        monthlyMinor !== demo.plannedWithdrawalMonthlyMinor) ||
      minorFromMajor(signed.availableLiquidityUsd) === null ||
      minorFromMajor(signed.pendingLiquidityUsd) === null
    ) {
      continue;
    }
    const key = sourceKey(scenarioId, firmId, disposition);
    candidates.set(key, [
      ...(candidates.get(key) ?? []),
      { id: data.caseId },
    ]);
  }
  return candidates;
}

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
  const canonicalPrefix = "Canonical observed-status ids:";
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
    const canonicalLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(canonicalPrefix));
    if (canonicalLines.length !== 1) {
      problems.push(
        `${path}: must contain exactly one designated "${canonicalPrefix}" list`,
      );
    } else {
      const stated = [...canonicalLines[0]!.matchAll(/`([^`]+)`/g)].map(
        (match) => match[1]!,
      );
      if (
        stated.length !== OBSERVED_STATUS_IDS.length ||
        stated.some((id, index) => id !== OBSERVED_STATUS_IDS[index])
      ) {
        problems.push(
          `${path}: canonical observed-status list must equal ${OBSERVED_STATUS_IDS.map((id) => `\`${id}\``).join(", ")}; got ${stated.map((id) => `\`${id}\``).join(", ") || "(empty)"}`,
        );
      }
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
  const candidatesByKey = exactSourceCandidates(cases, demo);
  const boundSourceIds = new Set<string>();
  for (const d of demo.decisions) {
    const at = `${d.scenarioId}/${d.firmId}/${d.decisionRole}`;
    const candidates =
      candidatesByKey.get(
        sourceKey(d.scenarioId, d.firmId, d.disposition),
      ) ?? [];
    if (d.sourceCaseId === null) {
      if (candidates.length > 0) {
        problems.push(
          `${at}: claims missing authority although exact signed candidate(s) exist: ${candidates.map(({ id }) => id).join(", ")}`,
        );
      }
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
    boundSourceIds.add(d.sourceCaseId);
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
    if (source?.expectedDisposition !== d.disposition) {
      problems.push(
        `${at}: signed case "${d.sourceCaseId}" records disposition ${String(source?.expectedDisposition)}, not ${d.disposition}`,
      );
    }
    const trigger = isObj(source?.trigger) ? source.trigger : null;
    if (
      !isNonEmptyString(d.requestAt) ||
      !isNonEmptyString(trigger?.asOf) ||
      d.requestAt !== trigger.asOf
    ) {
      problems.push(
        `${at}: request instant drift, ${d.sourceCaseId}=${String(trigger?.asOf)}, demo=${String(d.requestAt)}`,
      );
    }
    if (!candidates.some(({ id }) => id === d.sourceCaseId)) {
      problems.push(
        `${at}: source case "${d.sourceCaseId}" is not a signed exact match for branch, firm, disposition, request, currency, cadence, and reserve policy`,
      );
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
    const expectedHeadroom = tryHeadroomMinor(
      d.availableCashMinor!,
      d.pendingActivityMinor!,
      d.reserveFloorMinor,
    );
    if (expectedHeadroom === null) {
      problems.push(`${at}: displayed headroom derivation exceeds the safe integer range`);
      continue;
    }
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
  for (const candidates of candidatesByKey.values()) {
    for (const candidate of candidates) {
      if (!boundSourceIds.has(candidate.id)) {
        problems.push(
          `${candidate.id}: exact signed branch-and-firm authority is not represented by the demo`,
        );
      }
    }
  }
  return problems;
}

const TIMELINE_TIME_ZONES = [
  "America/New_York",
  "UTC",
  "Asia/Tokyo",
] as const;

function localTimelineKey(instant: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function validateSourceTimelines(
  cases: LoadedCase[],
  demo: DemoSemanticSnapshot,
): string[] {
  const problems: string[] = [];
  const sourceIds = new Set(
    demo.decisions.flatMap(({ sourceCaseId }) =>
      sourceCaseId === null ? [] : [sourceCaseId],
    ),
  );
  const timelineIds = demo.sourceTimelines.map(
    ({ sourceCaseId }) => sourceCaseId,
  );
  for (const duplicate of new Set(
    timelineIds.filter((id, index) => timelineIds.indexOf(id) !== index),
  )) {
    problems.push(`${duplicate}: source timeline is represented more than once`);
  }
  for (const sourceId of sourceIds) {
    const timeline = demo.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === sourceId,
    );
    const source = caseData(cases, sourceId);
    const trigger = isObj(source?.trigger) ? source.trigger : null;
    if (!timeline) {
      problems.push(`${sourceId}: source-bound demo decision has no visible timeline`);
      continue;
    }
    if (!isNonEmptyString(trigger?.asOf) || timeline.requestAt !== trigger.asOf) {
      problems.push(
        `${sourceId}: visible request instant ${timeline.requestAt} does not match signed trigger ${String(trigger?.asOf)}`,
      );
    }
    if (
      timeline.scenarioId !== source?.scenarioRef ||
      timeline.firmId !== source?.firm
    ) {
      problems.push(
        `${sourceId}: visible timeline belongs to ${timeline.scenarioId}/${timeline.firmId}, not ${String(source?.scenarioRef)}/${String(source?.firm)}`,
      );
    }
    const revalidationInstants = new Set(
      (Array.isArray(source?.householdEvidence)
        ? source.householdEvidence
        : []
      ).flatMap((row) =>
        isObj(row) &&
        row.liquidityPhase === "pre-execution-revalidation" &&
        isNonEmptyString(row.retrievedAt)
          ? [row.retrievedAt]
          : [],
      ),
    );
    if (revalidationInstants.size > 0) {
      const visibleRevalidations = timeline.events
        .filter(({ kind }) => kind === "revalidation")
        .map(({ instant }) => instant);
      if (
        revalidationInstants.size !== 1 ||
        visibleRevalidations.length !== 1 ||
        !revalidationInstants.has(visibleRevalidations[0]!)
      ) {
        problems.push(
          `${sourceId}: visible revalidation instant ${visibleRevalidations.join(", ") || "(missing)"} does not match signed evidence retrieval ${[...revalidationInstants].join(", ")}`,
        );
      }
    }
    if (timeline.events.length === 0) {
      problems.push(`${sourceId}: visible timeline has no events`);
      continue;
    }
    if (
      timeline.events[0]?.kind !== "request" ||
      timeline.events[0]?.instant !== timeline.requestAt
    ) {
      problems.push(`${sourceId}: visible timeline does not begin with its signed request`);
    }
    const eligibility = isObj(source?.expectedExecutionEligibility)
      ? source.expectedExecutionEligibility.eligible
      : undefined;
    const expectedLedgerTypes = Array.isArray(source?.expectedLedgerEvents)
      ? source.expectedLedgerEvents.flatMap((entry) =>
          isObj(entry) && isNonEmptyString(entry.type) ? [entry.type] : [],
        )
      : [];
    const eventKinds = timeline.events.map(({ kind }) => kind);
    if (eligibility === true) {
      const initialDecisionIndex = eventKinds.indexOf("DecisionRecorded");
      const decisionIndex = eventKinds.lastIndexOf("DecisionRecorded");
      const finalApprovalIndex = eventKinds.lastIndexOf("ApprovalRecorded");
      const revalidationIndex = eventKinds.lastIndexOf("revalidation");
      const invalidationIndex = eventKinds.lastIndexOf("ApprovalInvalidated");
      const reservationIndex = eventKinds.indexOf("ReservationCreated");
      const executionIndex = eventKinds.indexOf("ExecutionStarted");
      const validStandardOrder =
        invalidationIndex < 0 &&
        decisionIndex >= 0 &&
        decisionIndex < revalidationIndex &&
        (finalApprovalIndex < 0 || finalApprovalIndex < revalidationIndex) &&
        revalidationIndex < reservationIndex &&
        reservationIndex < executionIndex;
      const validInvalidationOrder =
        invalidationIndex >= 0 &&
        initialDecisionIndex >= 0 &&
        initialDecisionIndex < revalidationIndex &&
        revalidationIndex < invalidationIndex &&
        invalidationIndex < decisionIndex &&
        decisionIndex < finalApprovalIndex &&
        finalApprovalIndex < reservationIndex &&
        reservationIndex < executionIndex;
      if (!validStandardOrder && !validInvalidationOrder) {
        problems.push(
          `${sourceId}: unsorted production timeline must keep the signed decision, final still-valid approval, pre-execution revalidation, reservation, and execution in governed order`,
        );
      }
    }
    if (
      expectedLedgerTypes.includes("ExecutionPartiallySucceeded") &&
      expectedLedgerTypes.includes("ExceptionDecisionRequested")
    ) {
      const partialIndex = eventKinds.indexOf("ExecutionPartiallySucceeded");
      const observedIndex = eventKinds.indexOf("StatusObserved");
      const exceptionIndex = eventKinds.indexOf("ExceptionDecisionRequested");
      if (
        partialIndex < 0 ||
        observedIndex <= partialIndex ||
        exceptionIndex <= observedIndex
      ) {
        problems.push(
          `${sourceId}: ExceptionDecisionRequested must remain visible after the partial receipt and unknown StatusObserved event`,
        );
      }
    }
    let previous = Number.NEGATIVE_INFINITY;
    for (const [index, event] of timeline.events.entries()) {
      const instant = new Date(event.instant).getTime();
      if (
        !Number.isFinite(instant) ||
        new Date(instant).toISOString() !== event.instant
      ) {
        problems.push(
          `${sourceId}: visible timeline event ${event.kind} has a non-canonical instant ${event.instant}`,
        );
        continue;
      }
      if (instant < new Date(timeline.requestAt).getTime()) {
        problems.push(
          `${sourceId}: visible timeline event ${event.kind} precedes its signed request`,
        );
      }
      if (instant < previous) {
        problems.push(
          `${sourceId}: visible timeline event ${event.kind} is out of order at position ${index}`,
        );
      }
      if (!event.display.includes(event.renderedInstant)) {
        problems.push(
          `${sourceId}: visible timeline event ${event.kind} displays "${event.display}", not its rendered instant "${event.renderedInstant}"`,
        );
      }
      previous = instant;
    }
    for (const timeZone of TIMELINE_TIME_ZONES) {
      const keys = timeline.events.map(({ instant }) =>
        localTimelineKey(instant, timeZone),
      );
      if (keys.some((key, index) => index > 0 && key < keys[index - 1]!)) {
        problems.push(
          `${sourceId}: visible timeline is not monotonic when rendered in ${timeZone}`,
        );
      }
    }
  }
  for (const timelineId of timelineIds) {
    if (!sourceIds.has(timelineId)) {
      problems.push(
        `${timelineId}: visible timeline has no source-bound demo decision`,
      );
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
  problems.push(...validateSourceTimelines(cases, demo));

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
    const derivedFloor = tryReserveFloorMinor(expectedMonthlyMinor, reserveMonths);
    if (derivedFloor === null) {
      problems.push(`${caseId}: signed reserve-floor derivation exceeds the safe integer range`);
    } else if (derivedFloor !== expectedFloorMinor) {
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
      const expectedHeadroom = tryReserveFloorMinor(expectedMonthlyMinor, reserveMonths);
      const headroom =
        expectedHeadroom === null
          ? null
          : tryHeadroomMinor(
              expectedAvailable,
              expectedPending,
              expectedHeadroom,
            );
      if (expectedHeadroom === null || headroom === null) {
        problems.push(`${caseId}: rendered liquidity derivation exceeds the safe integer range`);
      } else {
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
  } else {
    const draftedFloor = tryReserveFloorMinor(
      demo.plannedWithdrawalMonthlyMinor,
      demo.draftedReserveMonths,
    );
    if (draftedFloor === null) {
      problems.push("the policy-draft reserve-floor derivation exceeds the safe integer range");
    } else if (demo.draftedReserveFloorMinor !== draftedFloor) {
      problems.push("the policy-draft reserve floor is not the monthly withdrawal times the drafted horizon");
    }
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
    demo.approvalInvalidationPhases.safetyAfterPendingMinor !== gc15RevalidationPending ||
    demo.approvalInvalidationPhases.refreshedEvidencePendingMinor !==
      gc15RevalidationPending
  ) {
    problems.push(
      "GC-15 must keep revalidation pending activity off initial surfaces, then render initial and refreshed pending values in order",
    );
  }

  for (const guard of demo.executionGuards) {
    if (
      !guard.signedLiquidityAuthority &&
      (guard.reservationVisible ||
        guard.executionReached ||
        guard.verificationReached)
    ) {
      problems.push(
        `${guard.scenarioId}/${guard.firmId}: missing signed liquidity authority must expose no reservation, execution, or verification state`,
      );
    }
  }

  for (const { data } of cases) {
    if (
      !isObj(data) ||
      data.expectedDisposition !== "proceed" ||
      !isNonEmptyString(data.scenarioRef) ||
      !isNonEmptyString(data.firm)
    ) {
      continue;
    }
    const expectedAuthority = isObj(data.expectedAuthority)
      ? data.expectedAuthority
      : null;
    const expectedStages = Array.isArray(expectedAuthority?.stages)
      ? expectedAuthority.stages
      : [];
    const expectedMode =
      expectedAuthority?.mode === "automatic" ? "automatic" : "staged";
    const plan = demo.authorityPlans.find(
      (candidate) =>
        candidate.scenarioId === data.scenarioRef &&
        candidate.firmId === data.firm &&
        candidate.pass === "initial",
    );
    if (!plan) {
      problems.push(`${String(data.caseId)}: demo has no initial authority plan`);
      continue;
    }
    if (plan.mode !== expectedMode) {
      problems.push(
        `${String(data.caseId)}: rendered authority mode ${plan.mode} does not match signed mode ${String(expectedAuthority?.mode)}`,
      );
    }
    if (
      (expectedMode === "automatic" &&
        (!plan.automaticAuthorityVisible || plan.bindingVisible)) ||
      (expectedMode === "staged" &&
        (plan.automaticAuthorityVisible || !plan.bindingVisible))
    ) {
      problems.push(
        `${String(data.caseId)}: automatic authority must render explicitly without an approval binding, while staged authority must render its binding`,
      );
    }
    if (plan.stages.length !== expectedStages.length) {
      problems.push(
        `${String(data.caseId)}: rendered authority stage count does not match the signed ordered plan`,
      );
      continue;
    }
    expectedStages.forEach((rawStage, index) => {
      if (!isObj(rawStage)) return;
      const actual = plan.stages[index];
      const expectedRoles = Array.isArray(rawStage.eligibleRoleIds)
        ? rawStage.eligibleRoleIds.filter(isNonEmptyString)
        : [];
      if (
        !actual ||
        actual.stageId !== rawStage.stageId ||
        actual.order !== rawStage.order ||
        !sameMembers(actual.eligibleRoleIds, expectedRoles) ||
        actual.approvalsRequired !== rawStage.approvalsRequired ||
        actual.distinctActorsRequired !== rawStage.distinctActorsRequired ||
        actual.requesterMayApprove !== rawStage.requesterMayApprove
      ) {
        problems.push(
          `${String(data.caseId)}: rendered authority stage ${index + 1} drifts from its signed id, order, eligible roles, quorum, or requester constraint`,
        );
      }
      if (actual?.satisfied) {
        const eligibleActors = actual.completedActorIds.filter(
          (_, actorIndex) =>
            expectedRoles.includes(actual.completedRoleIds[actorIndex]!),
        );
        const completedCount = actual.distinctActorsRequired
          ? new Set(eligibleActors).size
          : eligibleActors.length;
        if (completedCount < actual.approvalsRequired) {
          problems.push(
            `${String(data.caseId)}: rendered authority marks a stage satisfied without its signed eligible quorum`,
          );
        }
      }
    });
    const eligibility = isObj(data.expectedExecutionEligibility)
      ? data.expectedExecutionEligibility.eligible
      : undefined;
    if (
      (eligibility === true && !plan.satisfied) ||
      (eligibility === false && plan.satisfied)
    ) {
      problems.push(
        `${String(data.caseId)}: rendered authority satisfaction contradicts signed execution eligibility`,
      );
    }
  }

  const gc10Reservation = demo.reservationCausality.filter(
    ({ sourceCaseId, relatedSourceCaseId }) =>
      sourceCaseId === "GC-10-simultaneous-distributions-first" &&
      relatedSourceCaseId === "GC-11-simultaneous-distributions-second",
  );
  if (gc10Reservation.length !== 1) {
    problems.push(
      "GC-10 reservation causality must bind exactly once to the signed GC-11 sibling",
    );
  }
  for (const causal of demo.reservationCausality) {
    const request = new Date(causal.requestAt).getTime();
    const decision = new Date(causal.decisionAt).getTime();
    const reservation = new Date(causal.reservationAt).getTime();
    const relatedRequest = new Date(causal.relatedRequestAt).getTime();
    const execution = new Date(causal.executionAt).getTime();
    const sourceTimeline = demo.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === causal.sourceCaseId,
    );
    if (
      ![request, decision, reservation, relatedRequest, execution].every(
        Number.isFinite,
      ) ||
      !(request < decision) ||
      !(decision < reservation) ||
      !(reservation < relatedRequest) ||
      !(reservation < execution) ||
      !sourceTimeline?.events.some(
        ({ kind, instant }) =>
          kind === "ReservationCreated" && instant === causal.reservationAt,
      )
    ) {
      problems.push(
        `${causal.sourceCaseId}: reservation must commit after its decision, before its signed sibling request and execution, and appear in the source-bound timeline`,
      );
    }
  }

  const expectedGc15Types = Array.isArray(gc15?.expectedLedgerEvents)
    ? gc15.expectedLedgerEvents.flatMap((entry) =>
        isObj(entry) && isNonEmptyString(entry.type) ? [entry.type] : [],
      )
    : [];
  const lifecycle = demo.approvalInvalidationLifecycle;
  const originalRecordBinding = lifecycle.recordBindings[0];
  const derivedRecordBinding = lifecycle.recordBindings[1];
  const bindingMatches = (
    left: { decisionHash: string; bundleHash: string } | null | undefined,
    right: { decisionHash: string; bundleHash: string } | null | undefined,
  ): boolean =>
    Boolean(
      left &&
        right &&
        left.decisionHash === right.decisionHash &&
        left.bundleHash === right.bundleHash,
    );
  if (
    expectedGc15Types.length === 0 ||
    lifecycle.eventTypes.length !== expectedGc15Types.length ||
    lifecycle.eventTypes.some(
      (eventType, index) => eventType !== expectedGc15Types[index],
    ) ||
    lifecycle.eventInstants.some(
      (instant, index) =>
        index > 0 && instant < lifecycle.eventInstants[index - 1]!,
    ) ||
    lifecycle.originalApprovals !== 2 ||
    lifecycle.freshApprovals !== 2 ||
    !lifecycle.freshPlanSatisfied ||
    new Set(lifecycle.freshActorIds).size !== 2 ||
    !lifecycle.freshRoleIds.every((roleId) => roleId === "operations") ||
    lifecycle.initialReservationVisible ||
    !lifecycle.revalidatedReservationVisible ||
    !lifecycle.revalidatedExecutionReached ||
    !lifecycle.revalidatedVerificationReached ||
    lifecycle.revalidatedExecutionStatuses.join(",") !== "submitted" ||
    !lifecycle.revalidatedVerificationProves.includes(
      "Submission accepted by the capability",
    ) ||
    lifecycle.recordBindings.length !== 2 ||
    originalRecordBinding?.kind !== "original" ||
    derivedRecordBinding?.kind !== "derived" ||
    !bindingMatches(
      originalRecordBinding,
      lifecycle.originalApprovalBinding,
    ) ||
    !bindingMatches(derivedRecordBinding, lifecycle.freshApprovalBinding) ||
    originalRecordBinding.decisionHash === derivedRecordBinding.decisionHash ||
    originalRecordBinding.bundleHash === derivedRecordBinding.bundleHash ||
    lifecycle.unsupportedFirmEventCount !== 0
  ) {
    problems.push(
      "GC-15 visible lifecycle must preserve exact firm authority, both decision bindings, approval passes, invalidation, reservation, execution, and submitted verification in signed order",
    );
  }

  const gc13 = caseData(cases, "GC-13-partial-salesforce-success");
  const gc13Explanation = Array.isArray(gc13?.expectedExplanationNodes)
    ? gc13.expectedExplanationNodes
        .flatMap((node) => (isObj(node) && isNonEmptyString(node.summary) ? [node.summary] : []))
        .join(" ")
    : "";
  const gc13Verification = isObj(gc13?.expectedVerificationState)
    ? gc13.expectedVerificationState
    : null;
  const gc13LedgerTypes = Array.isArray(gc13?.expectedLedgerEvents)
    ? gc13.expectedLedgerEvents.flatMap((entry) =>
        isObj(entry) && isNonEmptyString(entry.type) ? [entry.type] : [],
      )
    : [];
  const exceptionDecision = demo.partialReceipt.exceptionDecision;
  const recordExceptionDecision = demo.partialReceipt.recordExceptionDecision;
  if (
    !gc13Explanation.includes("instruction-created") ||
    !gc13Explanation.includes("disbursement-scheduled") ||
    !gc13LedgerTypes.includes("ExceptionDecisionRequested") ||
    gc13Verification?.observedStatus !== "unknown" ||
    demo.partialReceipt.completedParts.join(",") !== "instruction-created" ||
    demo.partialReceipt.incompleteParts.join(",") !==
      "disbursement-scheduled" ||
    demo.partialReceipt.observedStatuses.join(",") !== "completed,unknown" ||
    demo.partialReceipt.statusLabels.some((label) =>
      label.toLowerCase().includes("settled"),
    ) ||
    !demo.partialReceipt.proves.includes(
      "Completed part: instruction-created",
    ) ||
    !demo.partialReceipt.notProvenYet.includes(
      "Incomplete part: disbursement-scheduled",
    ) ||
    exceptionDecision?.eventType !== "ExceptionDecisionRequested" ||
    exceptionDecision.reason !== "partial-execution" ||
    exceptionDecision.triggeringLedgerEvent !==
      "ExecutionPartiallySucceeded" ||
    !isNonEmptyString(exceptionDecision.priorDecisionId) ||
    recordExceptionDecision?.eventType !==
      "ExceptionDecisionRequested" ||
    recordExceptionDecision.reason !== "partial-execution" ||
    recordExceptionDecision.triggeringLedgerEvent !==
      "ExecutionPartiallySucceeded" ||
    recordExceptionDecision.priorDecisionId !==
      exceptionDecision.priorDecisionId
  ) {
    problems.push(
      "GC-13 must render and print ExceptionDecisionRequested with the exact partial receipt while the movement remains unknown and unconfirmed",
    );
  }

  const gc15RevalidationAvailable = minorFromMajor(
    gc15Signed?.preExecutionRevalidation?.availableLiquidityUsd ?? null,
  );
  const gc15ReserveFloor = minorFromMajor(gc15Signed?.reserveFloorUsd ?? null);
  const currentGc15Headroom =
    gc15RevalidationAvailable === null ||
    gc15RevalidationPending === null ||
    gc15ReserveFloor === null
      ? null
      : tryHeadroomMinor(
          gc15RevalidationAvailable,
          gc15RevalidationPending,
          gc15ReserveFloor,
        );
  const draftedGc15Floor =
    demo.plannedWithdrawalMonthlyMinor === null
      ? null
      : tryReserveFloorMinor(
          demo.plannedWithdrawalMonthlyMinor,
          demo.draftedReserveMonths,
        );
  const draftedGc15Headroom =
    gc15RevalidationAvailable === null ||
    gc15RevalidationPending === null ||
    draftedGc15Floor === null
      ? null
      : tryHeadroomMinor(
          gc15RevalidationAvailable,
          gc15RevalidationPending,
          draftedGc15Floor,
        );
  if (
    currentGc15Headroom === null ||
    draftedGc15Headroom === null ||
    demo.invalidationPolicySimulation.currentHeadroomMinor !==
      currentGc15Headroom ||
    demo.invalidationPolicySimulation.draftedHeadroomMinor !==
      draftedGc15Headroom ||
    lifecycle.revalidatedComparisonHeadroomMinor !== currentGc15Headroom
  ) {
    problems.push(
      "GC-15 comparison and policy simulation must use the latest pre-execution liquidity snapshot",
    );
  }
  return problems;
}
