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

export interface SignedTriggerProjection {
  description: string;
  requesterRole: string;
  requestRef: string;
  maskedRequestSummary: string;
  requestAt: string;
  requestAmountMinor: number;
}

export interface VisibleEvidenceProjection {
  evidenceKind: string;
  subjectRef: string;
  observedAt: string;
  retrievedAt: string;
  freshness: string;
  source: string;
  provenance: string;
  summary: string;
  liquidityPhase: string | null;
  observedAbsent: boolean;
  displayValueMinor: number | null;
  displayUnit: string | null;
  renderedValueMinor: number | null;
  renderedFormat: MetricFormat | null;
}

export interface ProhibitionProjection {
  kind: string;
  id: string;
  versionId: string;
  scope: string;
  reasonCode: string;
  explanation: string;
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
  requestAmountMinor: number;
  signedTrigger: SignedTriggerProjection | null;
  visibleEvidence: VisibleEvidenceProjection[];
  workspaceAccounts: Array<{
    evidence: VisibleEvidenceProjection;
    unavailableFields: string[];
  }>;
  prohibition: ProhibitionProjection | null;
  policyTraceRows: Array<{
    rule: string;
    result: string;
    version: string;
  }>;
  recordPrecedenceRows: Array<{
    rule: string;
    result: string;
    version: string;
  }>;
  policyBindings: {
    domainConfigVersion: string;
    firmPolicyVersion: string;
    householdInstructionVersions: string[];
    regulatoryVersion: string | null;
    recordPolicyVersion: string;
    recordInstructionVersion: string;
  };
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
  canonicalRequestAt: string;
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
  signedCaseVariants: unknown[];
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
    sourceCaseId: string | null;
    signedLiquidityAuthority: boolean;
    reservationVisible: boolean;
    executionReached: boolean;
    verificationReached: boolean;
    executionEligibility: {
      eligible: boolean;
      reason: string;
      idempotencyKey: string | null;
      reservations: Array<{
        reservationId: string;
        conflictKeys: string[];
        expiresAfter: string;
      }>;
      preconditions: Array<{
        code: string;
        requiredEvidence: string[];
        mustStillHoldAtExecution: boolean;
      }>;
    } | null;
    polling: {
      state: "scheduled" | "stopped";
      latestObservationAtIso: string;
      nextPollAtIso: string | null;
      reason?: "terminal-nigo-exception-opened";
    } | null;
    exceptionDecision: {
      eventType: "ExceptionDecisionRequested";
      reason: "partial-execution" | "delayed-nigo";
      triggeringLedgerEvent: "ExecutionPartiallySucceeded" | "StatusObserved";
    } | null;
    verificationProves: string[];
    verificationNotProvenYet: string[];
    executionRows: Array<{
      status: string;
      timestampIso: string;
    }>;
    verificationState: {
      observedStatus: string;
      settledClaim: string;
      observedAtIso: string;
      currentReason: string;
      custodianReason: string | null;
    } | null;
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
      executionMode: "sequential" | "parallel";
      eligibleRoleIds: string[];
      approvalsRequired: number;
      distinctActorsRequired: boolean;
      requesterMayApprove: boolean;
      expiresAfter: string;
      escalationPath: Array<{
        after: string;
        roleIds: string[];
        reasonCode: string;
      }>;
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
    initialEventTypes: string[];
    initialEventInstants: string[];
    revalidatedEventTypes: string[];
    revalidatedEventInstants: string[];
    originalApprovals: number;
    freshApprovals: number;
    freshPlanSatisfied: boolean;
    freshActorIds: string[];
    freshRoleIds: string[];
    initialReservationVisible: boolean;
    initialExecutionReached: boolean;
    initialVerificationReached: boolean;
    revalidatedReservationVisible: boolean;
    revalidatedExecutionReached: boolean;
    revalidatedVerificationReached: boolean;
    revalidatedExecutionStatuses: string[];
    revalidatedVerificationProves: string[];
    initialComparisonHeadroomMinor: number | null;
    revalidatedComparisonHeadroomMinor: number | null;
    initialRecordBindings: Array<{
      kind: "original" | "derived";
      decisionHash: string;
      bundleHash: string;
    }>;
    revalidatedRecordBindings: Array<{
      kind: "original" | "derived";
      decisionHash: string;
      bundleHash: string;
    }>;
    initialRecordEvidencePhases: Array<string | null>;
    revalidatedRecordEvidencePhases: Array<string | null>;
    initialRecordExecutionReached: boolean;
    initialRecordVerificationReached: boolean;
    initialRecordEligibilityVisible: boolean;
    revalidatedRecordExecutionReached: boolean;
    revalidatedRecordVerificationReached: boolean;
    revalidatedRecordEligibilityVisible: boolean;
    initialRecommendationSource: string | null;
    revalidatedRecommendationSource: string | null;
    initialRecommendationAlternativeCount: number;
    revalidatedRecommendationAlternativeCount: number;
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
      reason: "partial-execution" | "delayed-nigo";
      priorDecisionId: string;
      triggeringLedgerEvent: "ExecutionPartiallySucceeded" | "StatusObserved";
    } | null;
    recordExceptionDecision: {
      eventType: "ExceptionDecisionRequested";
      reason: "partial-execution" | "delayed-nigo";
      priorDecisionId: string;
      triggeringLedgerEvent: "ExecutionPartiallySucceeded" | "StatusObserved";
    } | null;
  };
  invalidationPolicySimulation: {
    initialCurrentHeadroomMinor: number | null;
    initialDraftedHeadroomMinor: number | null;
    revalidatedCurrentHeadroomMinor: number | null;
    revalidatedDraftedHeadroomMinor: number | null;
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
  requestAmountMinor: number;
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
      requestMinor === null ||
      !demoFirm ||
      signed.currency !== demo.currency ||
      signed.cadence !== demo.cadence ||
      firmConfiguration?.cashReserveMonths !== demoFirm.reserveMonths ||
      (floorMinor !== null && floorMinor !== demoFirm.reserveFloorMinor)
    ) {
      continue;
    }
    const key = sourceKey(scenarioId, firmId, disposition);
    candidates.set(key, [
      ...(candidates.get(key) ?? []),
      { id: data.caseId, requestAmountMinor: requestMinor },
    ]);
  }
  return candidates;
}

function expectedSignedCaseVariant(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const signed = readSignedMoney(data);
  const trigger = isObj(data.trigger) ? data.trigger : null;
  const authority = isObj(data.expectedAuthority)
    ? data.expectedAuthority
    : null;
  const eligibility = isObj(data.expectedExecutionEligibility)
    ? data.expectedExecutionEligibility
    : null;
  const verification = isObj(data.expectedVerificationState)
    ? data.expectedVerificationState
    : null;
  const policyVersions = isObj(data.policyVersions)
    ? data.policyVersions
    : null;
  if (
    !signed ||
    !trigger ||
    !authority ||
    !eligibility ||
    !verification ||
    !policyVersions ||
    !Array.isArray(data.householdEvidence) ||
    !Array.isArray(data.householdInstructions) ||
    !Array.isArray(data.expectedLedgerEvents) ||
    !Array.isArray(data.expectedExplanationNodes)
  ) {
    return null;
  }
  const revalidation = signed.preExecutionRevalidation;
  return {
    caseId: data.caseId,
    scenarioId: data.scenarioRef,
    firmId: data.firm,
    disposition: data.expectedDisposition,
    trigger: {
      description: trigger.description,
      requesterRole: trigger.requesterRole,
      requestRef: trigger.requestRef,
      maskedRequestSummary: trigger.maskedRequestSummary,
      requestAt: trigger.asOf,
      requestAmountMinor: minorFromMajor(signed.requestAmountUsd),
    },
    money: {
      currency: signed.currency,
      cadence: signed.cadence,
      requestAmountMinor: minorFromMajor(signed.requestAmountUsd),
      plannedWithdrawalMonthlyMinor: minorFromMajor(
        signed.plannedWithdrawalMonthlyUsd,
      ),
      reserveFloorMinor: minorFromMajor(signed.reserveFloorUsd),
      availableLiquidityMinor: minorFromMajor(
        signed.availableLiquidityUsd,
      ),
      pendingLiquidityMinor: minorFromMajor(signed.pendingLiquidityUsd),
      preExecutionRevalidation: revalidation
        ? {
            availableLiquidityMinor: minorFromMajor(
              revalidation.availableLiquidityUsd,
            ),
            pendingLiquidityMinor: minorFromMajor(
              revalidation.pendingLiquidityUsd,
            ),
          }
        : null,
    },
    evidence: data.householdEvidence.filter(isObj).map((evidence) => ({
      evidenceKind: evidence.evidenceKind,
      subjectRef: evidence.subjectRef,
      observedAt: evidence.observedAt,
      retrievedAt: evidence.retrievedAt,
      freshness: evidence.freshness,
      source: evidence.source,
      provenance: evidence.provenance,
      summary: evidence.summary,
      liquidityPhase: evidence.liquidityPhase ?? null,
      observedAbsent: evidence.observedAbsent ?? false,
      displayValue: isObj(evidence.displayValue)
        ? {
            valueMinor: minorFromMajor(evidence.displayValue.value),
            unit: evidence.displayValue.unit,
          }
        : null,
      freshnessWindowDays: evidence.freshnessWindowDays ?? null,
    })),
    policyVersions: {
      domainConfigVersionId: policyVersions.domainConfigVersionId,
      firmPolicyVersionId: policyVersions.firmPolicyVersionId,
      householdInstructionVersionIds:
        policyVersions.householdInstructionVersionIds,
      regulatoryVersionId: policyVersions.regulatoryVersionId,
    },
    householdInstructions: data.householdInstructions
      .filter(isObj)
      .map((instruction) => ({
        instructionKind: instruction.instructionKind,
        versionId: instruction.versionId,
        summary: instruction.summary,
      })),
    prohibition: isObj(data.prohibition)
      ? {
          source: data.prohibition.source,
          scope: data.prohibition.scope,
          reasonCode: data.prohibition.reasonCode,
          explanation: data.prohibition.explanation,
        }
      : null,
    authority: {
      mode: authority.mode,
      stages: authority.stages,
      note: authority.note,
    },
    executionEligibility: {
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      idempotencyKey: eligibility.idempotencyKey,
      reservations: eligibility.reservations,
      preconditions: eligibility.preconditions,
    },
    verification: {
      reached: verification.reached,
      observedStatus: verification.observedStatus,
      settledClaim: verification.settledClaim,
      observedAt: verification.observedAt,
      currentReason: verification.currentReason,
      custodianReason: verification.custodianReason,
      proves: verification.proves,
      notProvenYet: verification.notProvenYet,
      polling: verification.polling,
      exception: verification.exception,
      note: verification.note,
    },
    ledgerEvents: data.expectedLedgerEvents.filter(isObj).map((event) => ({
      type: event.type,
      note: event.note,
    })),
    explanations: data.expectedExplanationNodes
      .filter(isObj)
      .map((explanation) => ({
        code: explanation.code,
        summary: explanation.summary,
      })),
  };
}

function validateSignedCaseVariants(
  cases: LoadedCase[],
  demo: DemoSemanticSnapshot,
): string[] {
  const problems: string[] = [];
  const variants = demo.signedCaseVariants.filter(isObj);
  const signedCases = cases.filter(({ data }) => {
    const signoff = isObj(data) && isObj(data.signoff) ? data.signoff : null;
    return signoff?.status === "signed" && signoff.authority === "captain";
  });
  if (variants.length !== signedCases.length) {
    problems.push(
      `exact signed-case registry must project all ${signedCases.length} captain-signed cases; got ${variants.length}`,
    );
  }
  for (const { data } of signedCases) {
    if (!isObj(data) || !isNonEmptyString(data.caseId)) continue;
    const actual = variants.find((variant) => variant.caseId === data.caseId);
    const expected = expectedSignedCaseVariant(data);
    if (
      !actual ||
      !expected ||
      JSON.stringify(actual) !== JSON.stringify(expected)
    ) {
      problems.push(
        `${data.caseId}: exact typed variant drifts from its signed trigger, money, evidence, disposition, authority, execution eligibility, verification, or ledger`,
      );
    }
  }
  return problems;
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
  const canonicalInstant = Date.parse(demo.canonicalRequestAt);
  if (
    !Number.isFinite(canonicalInstant) ||
    new Date(canonicalInstant).toISOString() !== demo.canonicalRequestAt
  ) {
    problems.push(
      `canonical interactive request instant is not canonical UTC: ${demo.canonicalRequestAt}`,
    );
  }
  const candidatesByKey = exactSourceCandidates(cases, demo);
  const boundSourceIds = new Set<string>();
  for (const d of demo.decisions) {
    const at = `${d.scenarioId}/${d.firmId}/${d.decisionRole}`;
    if (
      d.decisionRole === "primary" &&
      d.requestAmountMinor !== demo.requestAmountMinor
    ) {
      problems.push(
        `${at}: canonical request drift, demo journey=${d.requestAmountMinor}, canonical=${demo.requestAmountMinor}`,
      );
    }
    if (
      d.decisionRole === "primary" &&
      d.requestAt !== demo.canonicalRequestAt
    ) {
      problems.push(
        `${at}: interactive request instant must remain firm-neutral at ${demo.canonicalRequestAt}`,
      );
    }
    const candidates =
      candidatesByKey.get(
        sourceKey(d.scenarioId, d.firmId, d.disposition),
      ) ?? [];
    if (d.sourceCaseId === null) {
      if (d.signedTrigger !== null) {
        problems.push(`${at}: projects a signed trigger without an exact source case`);
      }
      if (d.visibleEvidence.length > 0) {
        problems.push(`${at}: projects visible evidence without an exact source case`);
      }
      if (d.workspaceAccounts.length > 0) {
        problems.push(
          `${at}: projects workspace accounts without an exact source case`,
        );
      }
      if (d.prohibition !== null) {
        problems.push(`${at}: projects prohibition authority without an exact source case`);
      }
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
    const sourceRequestMinor = minorFromMajor(signed.requestAmountUsd);
    const expectedTrigger =
      trigger && sourceRequestMinor !== null
        ? {
            description: trigger.description,
            requesterRole: trigger.requesterRole,
            requestRef: trigger.requestRef,
            maskedRequestSummary: trigger.maskedRequestSummary,
            requestAt: trigger.asOf,
            requestAmountMinor: sourceRequestMinor,
          }
        : null;
    if (
      expectedTrigger === null ||
      JSON.stringify(d.signedTrigger) !== JSON.stringify(expectedTrigger)
    ) {
      problems.push(
        `${at}: signed trigger projection drifts from ${d.sourceCaseId}`,
      );
    }
    if (
      !isNonEmptyString(d.requestAt) ||
      !isNonEmptyString(trigger?.asOf) ||
      d.requestAt !==
        (d.decisionRole === "primary"
          ? demo.canonicalRequestAt
          : trigger.asOf)
    ) {
      problems.push(
        `${at}: request instant drift, canonical=${demo.canonicalRequestAt}, signed trigger=${String(trigger?.asOf)}, demo=${String(d.requestAt)}`,
      );
    }
    if (
      !candidates.some(
        ({ id, requestAmountMinor }) =>
          id === d.sourceCaseId &&
          requestAmountMinor === d.signedTrigger?.requestAmountMinor,
      )
    ) {
      problems.push(
        `${at}: source case "${d.sourceCaseId}" is not a signed exact match for branch, firm, disposition, request, currency, cadence, and reserve policy`,
      );
    }
    if (d.decisionRole === "primary") {
      const expectedEvidence = Array.isArray(source?.householdEvidence)
        ? source.householdEvidence
            .filter(
              (entry) =>
                isObj(entry) &&
                entry.liquidityPhase !== "pre-execution-revalidation",
            )
            .filter(isObj)
            .map((entry) => ({
              evidenceKind: entry.evidenceKind,
              subjectRef: entry.subjectRef,
              observedAt: entry.observedAt,
              retrievedAt: entry.retrievedAt,
              freshness: entry.freshness,
              source: entry.source,
              provenance: entry.provenance,
              summary: entry.summary,
              liquidityPhase: entry.liquidityPhase ?? null,
              observedAbsent: entry.observedAbsent ?? false,
              ...(isObj(entry.displayValue)
                ? {
                    displayValueMinor: minorFromMajor(
                      entry.displayValue.value,
                    ),
                    displayUnit: entry.displayValue.unit,
                    renderedValueMinor: minorFromMajor(
                      entry.displayValue.value,
                    ),
                    renderedFormat: MONEY_METRIC_FORMAT,
                  }
                : {
                    displayValueMinor: null,
                    displayUnit: null,
                    renderedValueMinor: null,
                    renderedFormat: null,
                  }),
            }))
        : [];
      if (JSON.stringify(d.visibleEvidence) !== JSON.stringify(expectedEvidence)) {
        problems.push(
          `${at}: visible evidence projection drifts from exact signed case ${d.sourceCaseId}`,
        );
      }
      const expectedWorkspaceAccounts = expectedEvidence
        .filter(
          (entry) =>
            entry.evidenceKind === "account-balance" &&
            entry.liquidityPhase !== "pre-execution-revalidation",
        )
        .map((evidence) => ({
          evidence,
          unavailableFields: ["account name", "account type", "custodian"],
        }));
      if (
        JSON.stringify(d.workspaceAccounts) !==
        JSON.stringify(expectedWorkspaceAccounts)
      ) {
        problems.push(
          `${at}: workspace account cards drift from exact signed case ${d.sourceCaseId}`,
        );
      }
      const rawProhibition = isObj(source?.prohibition)
        ? source.prohibition
        : null;
      const prohibitionSource =
        rawProhibition && isObj(rawProhibition.source)
          ? rawProhibition.source
          : null;
      const sourceKindByType: Record<string, string> = {
        household_instruction: "household-instruction",
        regulatory: "regulatory",
        firm_policy: "firm-policy",
      };
      const sourceKind =
        sourceKindByType[String(prohibitionSource?.sourceType)];
      const expectedProhibition =
        rawProhibition && prohibitionSource && sourceKind
          ? {
              kind: sourceKind,
              id: prohibitionSource.sourceId,
              versionId: prohibitionSource.versionId,
              scope: rawProhibition.scope,
              reasonCode: rawProhibition.reasonCode,
              explanation: rawProhibition.explanation,
            }
          : null;
      if (
        JSON.stringify(d.prohibition) !==
        JSON.stringify(expectedProhibition)
      ) {
        problems.push(
          `${at}: visible prohibition projection drifts from exact signed case ${d.sourceCaseId}`,
        );
      }
      if (
        JSON.stringify(d.policyTraceRows) !==
        JSON.stringify(d.recordPrecedenceRows)
      ) {
        problems.push(
          `${at}: policy trace and examiner record precedence projections disagree`,
        );
      }
      if (rawProhibition && prohibitionSource) {
        const controllingRuleByType: Record<string, string> = {
          household_instruction: "Household destination restriction",
          regulatory: "Regulatory legal hold",
          firm_policy: "Firm prohibition",
        };
        const controllingRule =
          controllingRuleByType[String(prohibitionSource.sourceType)];
        const controllingRow = d.policyTraceRows.find(
          (row) =>
            row.rule === controllingRule &&
            row.version === prohibitionSource.versionId,
        );
        if (
          !controllingRow ||
          controllingRow.result !== rawProhibition.explanation
        ) {
          problems.push(
            `${at}: controlling policy trace rule drifts from the signed prohibition source`,
          );
        }
        const rawInstructions = Array.isArray(source?.householdInstructions)
          ? source.householdInstructions.filter(isObj)
          : [];
        const householdSummary = rawInstructions
          .flatMap((instruction) =>
            isNonEmptyString(instruction.summary)
              ? [instruction.summary]
              : [],
          )
          .join(" ");
        const householdRow = d.policyTraceRows.find(
          (row) => row.rule === "Household destination restriction",
        );
        const expectedHouseholdResult =
          prohibitionSource.sourceType === "household_instruction"
            ? rawProhibition.explanation
            : householdSummary;
        if (
          !householdRow ||
          householdRow.result !== expectedHouseholdResult
        ) {
          problems.push(
            `${at}: household-instruction trace does not preserve its exact signed result`,
          );
        }
      }
      const policyVersions = isObj(source?.policyVersions)
        ? source.policyVersions
        : null;
      const expectedInstructionVersions = Array.isArray(
        policyVersions?.householdInstructionVersionIds,
      )
        ? policyVersions.householdInstructionVersionIds.filter(
            isNonEmptyString,
          )
        : [];
      if (
        !policyVersions ||
        d.policyBindings.domainConfigVersion !==
          policyVersions.domainConfigVersionId ||
        d.policyBindings.firmPolicyVersion !==
          policyVersions.firmPolicyVersionId ||
        JSON.stringify(
          d.policyBindings.householdInstructionVersions,
        ) !== JSON.stringify(expectedInstructionVersions) ||
        d.policyBindings.regulatoryVersion !==
          policyVersions.regulatoryVersionId ||
        d.policyBindings.recordPolicyVersion !==
          policyVersions.firmPolicyVersionId ||
        d.policyBindings.recordInstructionVersion !==
          (expectedInstructionVersions.join(", ") ||
            "Exact signed source unavailable")
      ) {
        problems.push(
          `${at}: policy trace or examiner record drifts from exact signed policy and household-instruction bindings`,
        );
      }
    }
    const availableMinor = minorFromMajor(signed.availableLiquidityUsd);
    const pendingMinor = minorFromMajor(signed.pendingLiquidityUsd);
    if (availableMinor === null || pendingMinor === null) {
      if (!isNonEmptyString(d.liquidityAuthorityMissing)) {
        problems.push(
          `${at}: ${d.sourceCaseId} has no numeric liquidity but the demo does not surface that gap`,
        );
      }
      if (
        d.availableCashMinor !== null ||
        d.pendingActivityMinor !== null ||
        d.headroomMinor !== null
      ) {
        problems.push(
          `${at}: signed case "${d.sourceCaseId}" states no liquidity for the branch to render`,
        );
      }
      continue;
    }
    if (d.liquidityAuthorityMissing !== null) {
      problems.push(`${at}: names numeric signed liquidity and simultaneously claims liquidity authority is missing`);
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
    if (d.disposition === "proceed" && (d.headroomMinor === null || d.headroomMinor < d.requestAmountMinor)) {
      problems.push(`${at}: renders proceed beside ${d.headroomMinor} available after reserve, which does not cover the ${d.requestAmountMinor} request`);
    }
    if (d.simulatedDisposition === "proceed") {
      // A draft that leaves this firm's floor where it is inherits the branch's own
      // headroom (surface 11 shows no delta row for a no-op); a draft that MOVES the
      // floor must display the headroom that follows, or its proceed is unbacked.
      const unchangedFloor = d.simulatedFloorMinor === d.reserveFloorMinor;
      const simulatedHeadroom = d.simulatedHeadroomMinor ?? (unchangedFloor ? d.headroomMinor : null);
      if (simulatedHeadroom === null || simulatedHeadroom < d.requestAmountMinor) {
        problems.push(`${at}: the policy-draft simulation renders proceed beside ${simulatedHeadroom ?? "no"} available after the drafted reserve, which does not cover the ${d.requestAmountMinor} request`);
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

function localTimelineKey(instant: string, timeZone: string): string | null {
  const parsed = new Date(instant);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== instant
  ) {
    return null;
  }
  try {
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
        .formatToParts(parsed)
        .filter(({ type }) => type !== "literal")
        .map(({ type, value }) => [type, value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return null;
  }
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
    const latestInitialRetrieval = (
      Array.isArray(source?.householdEvidence)
        ? source.householdEvidence
        : []
    )
      .flatMap((row) =>
        isObj(row) &&
        row.liquidityPhase !== "pre-execution-revalidation" &&
        isNonEmptyString(row.retrievedAt)
          ? [row.retrievedAt]
          : [],
      )
      .sort()
      .at(-1);
    const initialSnapshot = timeline.events.find(
      ({ kind }) => kind === "EvidenceSnapshotRecorded",
    );
    const initialDecision = timeline.events.find(
      ({ kind }) => kind === "DecisionRecorded",
    );
    if (
      !latestInitialRetrieval ||
      !initialSnapshot ||
      !initialDecision ||
      Date.parse(initialSnapshot.instant) < Date.parse(latestInitialRetrieval) ||
      Date.parse(initialSnapshot.instant) >= Date.parse(initialDecision.instant)
    ) {
      problems.push(
        `${sourceId}: initial EvidenceSnapshotRecorded must follow every included evidence retrieval and precede the dependent DecisionRecorded`,
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
      const firstApprovalIndex = eventKinds.indexOf("ApprovalRecorded");
      const finalApprovalIndex = eventKinds.lastIndexOf("ApprovalRecorded");
      const revalidationIndex = eventKinds.lastIndexOf("revalidation");
      const invalidationIndex = eventKinds.lastIndexOf("ApprovalInvalidated");
      const reservationIndex = eventKinds.indexOf("ReservationCreated");
      const executionIndex = eventKinds.indexOf("ExecutionStarted");
      const originalApprovalIndexes = eventKinds.flatMap((kind, index) =>
        kind === "ApprovalRecorded" && index < revalidationIndex
          ? [index]
          : [],
      );
      const freshApprovalIndexes = eventKinds.flatMap((kind, index) =>
        kind === "ApprovalRecorded" && index > decisionIndex
          ? [index]
          : [],
      );
      const validStandardOrder =
        invalidationIndex < 0 &&
        decisionIndex >= 0 &&
        (firstApprovalIndex < 0 ||
          decisionIndex < firstApprovalIndex) &&
        decisionIndex < revalidationIndex &&
        (finalApprovalIndex < 0 || finalApprovalIndex < revalidationIndex) &&
        revalidationIndex < reservationIndex &&
        reservationIndex < executionIndex;
      const validInvalidationOrder =
        invalidationIndex >= 0 &&
        initialDecisionIndex >= 0 &&
        originalApprovalIndexes.length > 0 &&
        initialDecisionIndex < originalApprovalIndexes[0]! &&
        originalApprovalIndexes.at(-1)! < revalidationIndex &&
        revalidationIndex < invalidationIndex &&
        invalidationIndex < decisionIndex &&
        freshApprovalIndexes.length > 0 &&
        decisionIndex < freshApprovalIndexes[0]! &&
        freshApprovalIndexes.at(-1) === finalApprovalIndex &&
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
      const keys = timeline.events.flatMap(({ instant }) => {
        const key = localTimelineKey(instant, timeZone);
        return key === null ? [] : [key];
      });
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
  problems.push(...validateSignedCaseVariants(cases, demo));
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
    if (guard.sourceCaseId === null) continue;
    const source = caseData(cases, guard.sourceCaseId);
    const expected = isObj(source?.expectedExecutionEligibility)
      ? source.expectedExecutionEligibility
      : null;
    const actual = guard.executionEligibility;
    const expectedReservations = Array.isArray(expected?.reservations)
      ? expected.reservations.filter(isObj)
      : [];
    const expectedPreconditions = Array.isArray(expected?.preconditions)
      ? expected.preconditions.filter(isObj)
      : [];
    const eligibilityDrift =
      !expected ||
      !actual ||
      actual.eligible !== expected.eligible ||
      actual.reason !== expected.reason ||
      actual.idempotencyKey !== expected.idempotencyKey ||
      actual.reservations.length !== expectedReservations.length ||
      expectedReservations.some((reservation, index) => {
        const rendered = actual.reservations[index];
        return (
          !rendered ||
          rendered.reservationId !== reservation.reservationId ||
          rendered.expiresAfter !== reservation.expiresAfter ||
          !sameMembers(
            rendered.conflictKeys,
            Array.isArray(reservation.conflictKeys)
              ? reservation.conflictKeys.filter(isNonEmptyString)
              : [],
          )
        );
      }) ||
      actual.preconditions.length !== expectedPreconditions.length ||
      expectedPreconditions.some((precondition, index) => {
        const rendered = actual.preconditions[index];
        return (
          !rendered ||
          rendered.code !== precondition.code ||
          rendered.mustStillHoldAtExecution !==
            precondition.mustStillHoldAtExecution ||
          !sameMembers(
            rendered.requiredEvidence,
            Array.isArray(precondition.requiredEvidence)
              ? precondition.requiredEvidence.filter(isNonEmptyString)
              : [],
          )
        );
      });
    if (eligibilityDrift) {
      problems.push(
        `${guard.sourceCaseId}: rendered execution eligibility drifts from its signed eligibility, refusal reason, idempotency key, reservations, expiry, conflict keys, or preconditions`,
      );
    }
    const expectedVerification = isObj(source?.expectedVerificationState)
      ? source.expectedVerificationState
      : null;
    if (expectedVerification?.reached === true) {
      const expectedProves = Array.isArray(expectedVerification.proves)
        ? expectedVerification.proves.filter(isNonEmptyString)
        : [];
      const expectedNotProven = Array.isArray(
        expectedVerification.notProvenYet,
      )
        ? expectedVerification.notProvenYet.filter(isNonEmptyString)
        : [];
      const expectedPolling = isObj(expectedVerification.polling)
        ? expectedVerification.polling
        : null;
      const expectedException = isObj(expectedVerification.exception)
        ? expectedVerification.exception
        : null;
      const renderedException = guard.exceptionDecision;
      if (
        !guard.verificationReached ||
        !guard.verificationState ||
        guard.verificationState.observedStatus !==
          expectedVerification.observedStatus ||
        guard.verificationState.settledClaim !==
          expectedVerification.settledClaim ||
        guard.verificationState.observedAtIso !==
          expectedVerification.observedAt ||
        guard.verificationState.currentReason !==
          expectedVerification.currentReason ||
        guard.verificationState.custodianReason !==
          expectedVerification.custodianReason ||
        JSON.stringify(guard.verificationProves) !==
          JSON.stringify(expectedProves) ||
        JSON.stringify(guard.verificationNotProvenYet) !==
          JSON.stringify(expectedNotProven) ||
        guard.polling?.state !== expectedPolling?.state ||
        (expectedPolling?.state === "stopped" &&
          guard.polling?.reason !== expectedPolling.reason) ||
        (expectedException === null) !==
          (renderedException === null) ||
        (expectedException !== null &&
          (renderedException?.reason !== expectedException.reason ||
            renderedException?.triggeringLedgerEvent !==
              expectedException.triggeringLedgerEvent))
      ) {
        problems.push(
          `${guard.sourceCaseId}: rendered verification state drifts from its closed signed status, claim, reason, observation, polling, or exception state`,
        );
      }
      const timeline = demo.sourceTimelines.find(
        ({ sourceCaseId }) => sourceCaseId === guard.sourceCaseId,
      );
      const initialStatusObserved = timeline?.events.find(
        ({ kind }) => kind === "StatusObserved",
      )?.instant;
      const partialSucceeded = timeline?.events.find(
        ({ kind }) => kind === "ExecutionPartiallySucceeded",
      )?.instant;
      for (const row of guard.executionRows) {
        if (
          (row.status === "submitted" &&
            row.timestampIso !== initialStatusObserved) ||
          (row.status === "completed" &&
            row.timestampIso !== partialSucceeded) ||
          (row.status === "unknown" &&
            row.timestampIso !== expectedVerification.observedAt)
        ) {
          problems.push(
            `${guard.sourceCaseId}: execution receipt or observed status uses the wrong event-specific instant`,
          );
        }
      }
    } else if (
      expectedVerification?.reached === false &&
      (guard.verificationReached ||
        guard.verificationState !== null ||
        guard.executionRows.length > 0)
    ) {
      problems.push(
        `${guard.sourceCaseId}: not-reached signed verification must not project execution or verification state`,
      );
    }
    if (
      guard.polling?.state === "scheduled" &&
      !(
        new Date(guard.polling.nextPollAtIso ?? "").getTime() >
        new Date(guard.polling.latestObservationAtIso).getTime()
      )
    ) {
      problems.push(
        `${guard.sourceCaseId}: scheduled next poll must follow the latest observed state`,
      );
    }
    if (
      guard.polling?.state === "stopped" &&
      (guard.polling.nextPollAtIso !== null ||
        guard.polling.reason !== "terminal-nigo-exception-opened")
    ) {
      problems.push(
        `${guard.sourceCaseId}: terminal NIGO polling must stop with a typed reason and no next poll`,
      );
    }
  }

  const delayedNigo = demo.executionGuards.find(
    (guard) => guard.sourceCaseId === "GC-14-delayed-nigo",
  );
  if (
    delayedNigo?.polling?.state !== "stopped" ||
    delayedNigo.exceptionDecision?.eventType !==
      "ExceptionDecisionRequested" ||
    delayedNigo.exceptionDecision.reason !== "delayed-nigo" ||
    delayedNigo.exceptionDecision.triggeringLedgerEvent !== "StatusObserved" ||
    !delayedNigo.verificationProves.some((proof) =>
      proof.includes("signature date predates form version"),
    ) ||
    delayedNigo.verificationNotProvenYet.some((claim) =>
      claim.includes("will not be returned"),
    )
  ) {
    problems.push(
      "GC-14 must render observed NIGO with the exact custodian reason, stop polling, and open a typed exception decision",
    );
  }

  const ambiguous = demo.decisions.find(
    (decision) => decision.sourceCaseId === "GC-08-ambiguous-household",
  );
  const directoryEvidence = ambiguous?.visibleEvidence.find(
    (evidence) => evidence.evidenceKind === "household-directory",
  );
  if (
    ambiguous?.requestAt !== demo.canonicalRequestAt ||
    ambiguous?.signedTrigger?.requestAt !==
      "2026-07-26T17:20:00.000Z" ||
    directoryEvidence?.observedAt !== "2026-07-26T17:20:00.000Z" ||
    directoryEvidence.retrievedAt !== "2026-07-26T17:20:02.000Z" ||
    !directoryEvidence.summary.includes("subject:smiths-robert-ana") ||
    !directoryEvidence.summary.includes("subject:smith-family-trust")
  ) {
    problems.push(
      "GC-08 must render both signed household candidates at the signed 17:20Z evidence and retrieval instants",
    );
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
        actual.executionMode !== rawStage.executionMode ||
        !sameMembers(actual.eligibleRoleIds, expectedRoles) ||
        actual.approvalsRequired !== rawStage.approvalsRequired ||
        actual.distinctActorsRequired !== rawStage.distinctActorsRequired ||
        actual.requesterMayApprove !== rawStage.requesterMayApprove ||
        actual.expiresAfter !== rawStage.expiresAfter
      ) {
        problems.push(
          `${String(data.caseId)}: rendered authority stage ${index + 1} drifts from its signed id, order, execution mode, eligible roles, quorum, requester constraint, or expiry`,
        );
      }
      const expectedEscalation = Array.isArray(rawStage.escalationPath)
        ? rawStage.escalationPath.filter(isObj)
        : [];
      if (
        actual?.escalationPath.length !== expectedEscalation.length ||
        expectedEscalation.some((expected, escalationIndex) => {
          const rendered = actual?.escalationPath[escalationIndex];
          return (
            !rendered ||
            rendered.after !== expected.after ||
            rendered.reasonCode !== expected.reasonCode ||
            !sameMembers(
              rendered.roleIds,
              Array.isArray(expected.roleIds)
                ? expected.roleIds.filter(isNonEmptyString)
                : [],
            )
          );
        })
      ) {
        problems.push(
          `${String(data.caseId)}: rendered authority escalation path drifts from the signed delay, destination, or reason`,
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
  const initialLifecycleEnd = expectedGc15Types.indexOf(
    "ApprovalInvalidated",
  );
  const expectedInitialGc15Types =
    initialLifecycleEnd < 0
      ? []
      : expectedGc15Types.slice(0, initialLifecycleEnd + 1);
  const gc15Evidence = Array.isArray(gc15?.householdEvidence)
    ? gc15.householdEvidence.filter(isObj)
    : [];
  const evidenceSummary = (
    phase: "initial-decision" | "pre-execution-revalidation",
  ): string | null => {
    const entry = gc15Evidence.find(
      (candidate) =>
        candidate.evidenceKind === "account-balance" &&
        candidate.liquidityPhase === phase,
    );
    return entry && isNonEmptyString(entry.summary) ? entry.summary : null;
  };
  const expectedInitialRecommendation = evidenceSummary("initial-decision");
  const expectedRevalidatedRecommendation = evidenceSummary(
    "pre-execution-revalidation",
  );
  const lifecycle = demo.approvalInvalidationLifecycle;
  const initialRecordBinding = lifecycle.initialRecordBindings[0];
  const originalRecordBinding = lifecycle.revalidatedRecordBindings[0];
  const derivedRecordBinding = lifecycle.revalidatedRecordBindings[1];
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
    expectedInitialGc15Types.length === 0 ||
    lifecycle.initialEventTypes.length !== expectedInitialGc15Types.length ||
    lifecycle.initialEventTypes.some(
      (eventType, index) => eventType !== expectedInitialGc15Types[index],
    ) ||
    lifecycle.revalidatedEventTypes.length !== expectedGc15Types.length ||
    lifecycle.revalidatedEventTypes.some(
      (eventType, index) => eventType !== expectedGc15Types[index],
    ) ||
    lifecycle.initialEventInstants.some(
      (instant, index) =>
        index > 0 && instant < lifecycle.initialEventInstants[index - 1]!,
    ) ||
    lifecycle.revalidatedEventInstants.some(
      (instant, index) =>
        index > 0 &&
        instant < lifecycle.revalidatedEventInstants[index - 1]!,
    ) ||
    lifecycle.originalApprovals !== 2 ||
    lifecycle.freshApprovals !== 2 ||
    !lifecycle.freshPlanSatisfied ||
    new Set(lifecycle.freshActorIds).size !== 2 ||
    !lifecycle.freshRoleIds.every((roleId) => roleId === "operations") ||
    lifecycle.initialReservationVisible ||
    lifecycle.initialExecutionReached ||
    lifecycle.initialVerificationReached ||
    !lifecycle.revalidatedReservationVisible ||
    !lifecycle.revalidatedExecutionReached ||
    !lifecycle.revalidatedVerificationReached ||
    lifecycle.revalidatedExecutionStatuses.join(",") !== "submitted" ||
    !lifecycle.revalidatedVerificationProves.includes(
      "Submission accepted by the capability",
    ) ||
    lifecycle.initialRecordBindings.length !== 1 ||
    initialRecordBinding?.kind !== "original" ||
    !bindingMatches(
      initialRecordBinding,
      lifecycle.originalApprovalBinding,
    ) ||
    lifecycle.revalidatedRecordBindings.length !== 2 ||
    originalRecordBinding?.kind !== "original" ||
    derivedRecordBinding?.kind !== "derived" ||
    !bindingMatches(
      originalRecordBinding,
      lifecycle.originalApprovalBinding,
    ) ||
    !bindingMatches(derivedRecordBinding, lifecycle.freshApprovalBinding) ||
    originalRecordBinding.decisionHash === derivedRecordBinding.decisionHash ||
    originalRecordBinding.bundleHash === derivedRecordBinding.bundleHash ||
    lifecycle.initialRecordEvidencePhases.length === 0 ||
    lifecycle.initialRecordEvidencePhases.includes(
      "pre-execution-revalidation",
    ) ||
    !lifecycle.initialRecordEvidencePhases.includes("initial-decision") ||
    lifecycle.revalidatedRecordEvidencePhases.length === 0 ||
    lifecycle.revalidatedRecordEvidencePhases.includes("initial-decision") ||
    !lifecycle.revalidatedRecordEvidencePhases.includes(
      "pre-execution-revalidation",
    ) ||
    lifecycle.initialRecordExecutionReached ||
    lifecycle.initialRecordVerificationReached ||
    lifecycle.initialRecordEligibilityVisible ||
    !lifecycle.revalidatedRecordExecutionReached ||
    !lifecycle.revalidatedRecordVerificationReached ||
    !lifecycle.revalidatedRecordEligibilityVisible ||
    expectedInitialRecommendation === null ||
    expectedRevalidatedRecommendation === null ||
    lifecycle.initialRecommendationSource !==
      expectedInitialRecommendation ||
    lifecycle.revalidatedRecommendationSource !==
      expectedRevalidatedRecommendation ||
    lifecycle.initialRecommendationAlternativeCount !== 0 ||
    lifecycle.revalidatedRecommendationAlternativeCount !== 0 ||
    lifecycle.unsupportedFirmEventCount !== 0
  ) {
    problems.push(
      "GC-15 visible lifecycle passes must preserve phase-selected evidence, exact firm authority, decision bindings, approval reach, invalidation, reservation, execution, and submitted verification in signed order",
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
  const gc15InitialAvailable = minorFromMajor(
    gc15Signed?.availableLiquidityUsd ?? null,
  );
  const gc15ReserveFloor = minorFromMajor(gc15Signed?.reserveFloorUsd ?? null);
  const initialGc15Headroom =
    gc15InitialAvailable === null ||
    gc15InitialPending === null ||
    gc15ReserveFloor === null
      ? null
      : tryHeadroomMinor(
          gc15InitialAvailable,
          gc15InitialPending,
          gc15ReserveFloor,
        );
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
  const initialDraftedGc15Headroom =
    gc15InitialAvailable === null ||
    gc15InitialPending === null ||
    draftedGc15Floor === null
      ? null
      : tryHeadroomMinor(
          gc15InitialAvailable,
          gc15InitialPending,
          draftedGc15Floor,
        );
  if (
    initialGc15Headroom === null ||
    currentGc15Headroom === null ||
    initialDraftedGc15Headroom === null ||
    draftedGc15Headroom === null ||
    demo.invalidationPolicySimulation.initialCurrentHeadroomMinor !==
      initialGc15Headroom ||
    demo.invalidationPolicySimulation.initialDraftedHeadroomMinor !==
      initialDraftedGc15Headroom ||
    demo.invalidationPolicySimulation.revalidatedCurrentHeadroomMinor !==
      currentGc15Headroom ||
    demo.invalidationPolicySimulation.revalidatedDraftedHeadroomMinor !==
      draftedGc15Headroom ||
    lifecycle.initialComparisonHeadroomMinor !== initialGc15Headroom ||
    lifecycle.revalidatedComparisonHeadroomMinor !== currentGc15Headroom
  ) {
    problems.push(
      "GC-15 comparison and policy simulation must use the selected initial or pre-execution liquidity snapshot",
    );
  }
  return problems;
}
