import { createHash } from "node:crypto";
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
import {
  DEFAULT_GOLDEN_AUTHORITY_GAPS,
  readSignedMoney,
  type GoldenAuthorityGap,
  type LoadedCase,
  type ScenarioRefs,
} from "./golden-cases.lib";

/** A money value the demo holds, beside exactly what the shipped renderer printed. */
export interface RenderedMoney {
  minor: number;
  rendered: string;
}

export interface SignedTriggerProjection {
  kind: "human_request" | "system_event";
  description: string;
  requesterRole: string;
  requestRef: string;
  maskedRequestSummary: string;
  requestAt: string;
  requestAmountMinor: number | null;
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
  pass: "initial" | "revalidated";
  requestAt: string | null;
  requestAmountMinor: number;
  signedTrigger: SignedTriggerProjection | null;
  visibleEvidence: VisibleEvidenceProjection[];
  evidenceGaps: string[];
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
  comparisonDescription: string | null;
  comparisonDispositionReason: string | null;
  approvalGateRestatement: string | null;
  liquidityAuthorityMissing: string | null;
  availableCashMinor: number | null;
  pendingActivityMinor: number | null;
  plannedWithdrawalMonthlyMinor: number | null;
  reserveFloorMinor: number | null;
  headroomMinor: number | null;
  revalidationAvailableCashMinor: number | null;
  revalidationPendingActivityMinor: number | null;
  /** Surface 11's simulated after-state under the drafted twelve-month floor. The
   * headroom row is displayed only where the draft actually moves the floor. */
  simulatedFloorMinor: number | null;
  simulatedHeadroomMinor: number | null;
  simulatedDisposition: string | null;
  policyApprovalAvailable: boolean;
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
  canonicalRequest: {
    text: string;
    amountMinor: number;
    purpose: string;
    deadline: string;
    requestedAt: string;
  };
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
    dualApprovalThresholdMinor: number;
    approvalsRequired: number;
    distinctActorsRequired: boolean;
    eligibleRole: string | null;
    requesterConstraint: string | null;
    bankChangeHandling: string;
    policyVersion: string;
  }>;
  renderedFirmPolicies: Array<{
    firmId: string;
    reserveFloorMinor: number | null;
    dualApprovalThresholdMinor: number | null;
    quorum: string | null;
    bankChangeHandling: string | null;
  }>;
  signedCaseVariants: unknown[];
  decisions: DisplayedDecision[];
  sourceTimelines: SourceTimeline[];
  recordIdentities: Array<{
    routeScenarioId: string;
    routeFirmId: string;
    routeSourceCaseId: string | null;
    routePass: "initial" | "revalidated";
    headerScenarioId: string;
    headerFirmId: string;
    headerSourceCaseId: string | null;
    headerPass: "initial" | "revalidated";
    decisionId: string;
    auditPosition: {
      orgId: string;
      sequence: number;
    };
    headerCreatedAtIso: string;
    decisionEventInstants: string[];
    decisionBindings: Array<{
      kind: "original" | "derived";
      decisionHash: string;
      bundleHash: string;
    }>;
    approvalBinding: {
      decisionHash: string;
      bundleHash: string;
    } | null;
  }>;
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
    exactBankInstructionEvidence: boolean;
    exactBankInstructionPostReviewEvidence: boolean;
    safetyChecks: Array<{
      label: string;
      status: string;
      statusLabel: string;
      detail: string | null;
    }>;
    recordSafetyChecks: Array<{
      label: string;
      status: string;
      statusLabel: string;
      detail: string | null;
    }>;
    reservationVisible: boolean;
    reservationAtIso: string | null;
    executionAtIso: string | null;
    executionEligibilityVisible: boolean;
    executionReached: boolean;
    verificationReached: boolean;
    stopNote: string | null;
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
    verificationProves: Array<{
      display: string;
      ledgerEvent:
        | "ExecutionSucceeded"
        | "ExecutionPartiallySucceeded"
        | "StatusObserved";
      observedAtIso: string;
    }>;
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

function rawRows(source: Record<string, unknown>, field: string): Record<string, unknown>[] {
  return Array.isArray(source[field]) ? source[field].filter(isObj) : [];
}

function rawEventIndexes(source: Record<string, unknown>, type: string): number[] {
  return rawRows(source, "expectedLedgerEvents").flatMap((event, index) =>
    event.type === type ? [index] : [],
  );
}

function rawActiveDecisionIndex(
  source: Record<string, unknown>,
  pass: "initial" | "revalidated",
): number {
  const decisions = rawEventIndexes(source, "DecisionRecorded");
  return pass === "revalidated" ? (decisions.at(-1) ?? -1) : (decisions[0] ?? -1);
}

function rawActiveApprovalIndexes(
  source: Record<string, unknown>,
  pass: "initial" | "revalidated",
): number[] {
  return rawRows(source, "expectedLedgerEvents").flatMap((event, index) =>
    event.type === "ApprovalRecorded" && event.lifecyclePass === pass
      ? [index]
      : [],
  );
}

function rawReservationProof(source: Record<string, unknown>): boolean {
  const eligibility = isObj(source.expectedExecutionEligibility)
    ? source.expectedExecutionEligibility
    : null;
  const reservations = eligibility && Array.isArray(eligibility.reservations)
    ? eligibility.reservations.filter(isObj)
    : [];
  const created = rawEventIndexes(source, "ReservationCreated").at(-1) ?? -1;
  const execution = rawEventIndexes(source, "ExecutionStarted")[0] ?? Number.MAX_SAFE_INTEGER;
  const released = rawEventIndexes(source, "ReservationReleased").some(
    (index) => index > created && index < execution,
  );
  return reservations.length > 0 &&
    reservations.every((reservation) => {
      const keys = Array.isArray(reservation.conflictKeys)
        ? reservation.conflictKeys.filter(isNonEmptyString)
        : [];
      return isNonEmptyString(reservation.reservationId) &&
        keys.length > 0 &&
        typeof reservation.expiresAfter === "string" &&
        rawDurationMilliseconds(reservation.expiresAfter) !== null;
    }) &&
    created >= 0 &&
    created < execution &&
    !released;
}

function rawDurationMilliseconds(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part ?? 0));
  const total = (((parts[0]! * 24 + parts[1]!) * 60 + parts[2]!) * 60 + parts[3]!) * 1_000;
  return total > 0 ? total : null;
}

function rawApprovalProof(
  source: Record<string, unknown>,
  pass: "initial" | "revalidated",
): boolean {
  const authority = isObj(source.expectedAuthority) ? source.expectedAuthority : null;
  const stages = authority && Array.isArray(authority.stages)
    ? authority.stages.filter(isObj)
    : [];
  if (stages.length === 0) return authority?.mode === "automatic";
  const decision = rawActiveDecisionIndex(source, pass);
  const approvals = rawActiveApprovalIndexes(source, pass);
  const reservation = rawEventIndexes(source, "ReservationCreated").at(-1) ?? -1;
  const required = stages.reduce(
    (count, stage) =>
      count + (Number.isSafeInteger(stage.approvalsRequired) ? Number(stage.approvalsRequired) : 0),
    0,
  );
  return decision >= 0 &&
    required > 0 &&
    approvals.length === required &&
    approvals.every((index) => index > decision && index < reservation) &&
    stages.every((stage) => {
      const stageApprovals = rawRows(source, "expectedLedgerEvents").filter(
        (event) =>
          event.type === "ApprovalRecorded" &&
          event.lifecyclePass === pass &&
          event.stageId === stage.stageId,
      );
      return isNonEmptyString(stage.stageId) &&
        Number.isSafeInteger(stage.approvalsRequired) &&
        Number(stage.approvalsRequired) > 0 &&
        stageApprovals.length === stage.approvalsRequired &&
        stageApprovals.every((approval) =>
          rawApprovalBindingComplete(approval, stage),
        ) &&
        (stage.distinctActorsRequired !== true ||
          new Set(stageApprovals.map((approval) => approval.actorId)).size ===
            stage.approvalsRequired);
    });
}

function rawApprovalBindingComplete(
  approval: Record<string, unknown>,
  stage: Record<string, unknown>,
): boolean {
  const eligibleRoles = Array.isArray(stage.eligibleRoleIds)
    ? stage.eligibleRoleIds.filter(isNonEmptyString)
    : [];
  return isNonEmptyString(approval.actorId) &&
    isNonEmptyString(approval.roleId) &&
    isNonEmptyString(approval.requesterId) &&
    eligibleRoles.includes(approval.roleId) &&
    (stage.requesterMayApprove === true ||
      approval.actorId !== approval.requesterId);
}

function rawCompletedApprovalBindings(
  source: Record<string, unknown>,
  pass: "initial" | "revalidated",
): Record<string, unknown>[] {
  const authority = isObj(source.expectedAuthority)
    ? source.expectedAuthority
    : null;
  const stages = authority && Array.isArray(authority.stages)
    ? authority.stages.filter(isObj)
    : [];
  const events = rawRows(source, "expectedLedgerEvents");
  return stages.flatMap((stage) =>
    events.filter(
      (event) =>
        event.type === "ApprovalRecorded" &&
        event.lifecyclePass === pass &&
        event.stageId === stage.stageId &&
        rawApprovalBindingComplete(event, stage),
    ),
  );
}

function rawEvidenceProof(
  source: Record<string, unknown>,
  pass: "initial" | "revalidated",
  required: string[],
): boolean {
  if (required.length === 0) return false;
  const phase = pass === "revalidated"
    ? "pre-execution-revalidation"
    : "initial-decision";
  const evidence = rawRows(source, "householdEvidence").filter(
    (entry) =>
      entry.liquidityPhase === null ||
      entry.liquidityPhase === undefined ||
      entry.liquidityPhase === phase,
  );
  if (!required.every((ref) =>
    evidence.some((entry) => entry.subjectRef === ref && entry.freshness === "fresh"))) {
    return false;
  }
  const snapshots = rawEventIndexes(source, "EvidenceSnapshotRecorded");
  const decision = rawActiveDecisionIndex(source, pass);
  const finalAuthority = rawActiveApprovalIndexes(source, pass).at(-1) ?? decision;
  const reservation = rawEventIndexes(source, "ReservationCreated").at(-1) ?? Number.MAX_SAFE_INTEGER;
  const invalidated = rawEventIndexes(source, "ApprovalInvalidated").at(-1) ?? -1;
  const originalApproval = rawRows(source, "expectedLedgerEvents").flatMap(
    (event, index) =>
      event.type === "ApprovalRecorded" && event.lifecyclePass === "initial"
        ? [index]
        : [],
  ).at(-1) ?? -1;
  return pass === "revalidated"
    ? snapshots.some(
        (index) => index > originalApproval && index < invalidated && invalidated < decision,
      )
    : snapshots.some((index) => index > finalAuthority && index < reservation);
}

function rawVerifiedBankEvidence(entry: Record<string, unknown>): boolean {
  return entry.evidenceKind === "bank-instruction" &&
    entry.liquidityPhase === "pre-execution-revalidation" &&
    entry.freshness === "fresh" &&
    typeof entry.summary === "string" &&
    /\b(?:independently verified|verification (?:confirmed|completed)|verified unchanged)\b/i.test(entry.summary) &&
    !/\b(?:not(?: yet)? verified|unverified|unavailable|pending|failed)\b/i.test(entry.summary);
}

function rawPreconditionHolds(
  source: Record<string, unknown>,
  pass: "initial" | "revalidated",
  precondition: Record<string, unknown>,
): boolean {
  if (precondition.mustStillHoldAtExecution !== true) return true;
  const required = Array.isArray(precondition.requiredEvidence)
    ? precondition.requiredEvidence.filter(isNonEmptyString)
    : [];
  switch (precondition.code) {
    case "material-evidence-fresh-at-execution":
      return rawEvidenceProof(source, pass, required);
    case "approval-bound-to-decision-hash": {
      const events = rawRows(source, "expectedLedgerEvents");
      const decision = events[rawActiveDecisionIndex(source, pass)];
      const approvals = rawActiveApprovalIndexes(source, pass).map((index) => events[index]);
      return required.length === 0 &&
        rawApprovalProof(source, pass) &&
        typeof decision?.note === "string" &&
        /input-bundle hash/i.test(decision.note) &&
        approvals.some((event) => typeof event?.note === "string" && /decision hash/i.test(event.note));
    }
    case "reservation-still-held":
      return required.length === 0 && rawReservationProof(source);
    case "bank-instruction-independently-verified":
      return required.length > 0 && required.every((ref) =>
        rawRows(source, "householdEvidence").some(
          (entry) => entry.subjectRef === ref && rawVerifiedBankEvidence(entry),
        ));
    case "input-bundle-hash-unchanged-since-approval": {
      const events = rawRows(source, "expectedLedgerEvents");
      const invalidated = rawEventIndexes(source, "ApprovalInvalidated").at(-1) ?? -1;
      const decision = rawActiveDecisionIndex(source, pass);
      const approvals = rawActiveApprovalIndexes(source, pass);
      const reservation = rawEventIndexes(source, "ReservationCreated").at(-1) ?? -1;
      const invalidationNote = events[invalidated]?.note;
      return pass === "revalidated" &&
        rawEvidenceProof(source, pass, required) &&
        rawApprovalProof(source, pass) &&
        invalidated >= 0 &&
        decision > invalidated &&
        approvals.length > 0 &&
        approvals.every((index) => index > decision && index < reservation) &&
        typeof invalidationNote === "string" &&
        /prior decision hash/i.test(invalidationNote) &&
        /new bundle hash/i.test(invalidationNote);
    }
    default:
      return false;
  }
}

function rawExecutionEligibilityProof(
  source: Record<string, unknown>,
  pass: "initial" | "revalidated",
): boolean {
  const eligibility = isObj(source.expectedExecutionEligibility)
    ? source.expectedExecutionEligibility
    : null;
  const preconditions = eligibility && Array.isArray(eligibility.preconditions)
    ? eligibility.preconditions.filter(isObj)
    : [];
  return eligibility?.eligible === true &&
    rawReservationProof(source) &&
    rawApprovalProof(source, pass) &&
    preconditions.every((precondition) => rawPreconditionHolds(source, pass, precondition));
}

function comparisonEvidenceRows(
  source: Record<string, unknown> | undefined,
  pass: "initial" | "revalidated",
): Array<{ key: string; label: string; signature: string }> | null {
  const trigger = isObj(source?.trigger) ? source.trigger : null;
  const money = source ? readSignedMoney(source) : null;
  const evidence = Array.isArray(source?.householdEvidence)
    ? source.householdEvidence.filter(isObj)
    : [];
  if (!trigger || !money) return null;
  return evidence
    .filter(
      (entry) =>
        entry.liquidityPhase === null ||
        entry.liquidityPhase === undefined ||
        entry.liquidityPhase ===
          (pass === "revalidated"
            ? "pre-execution-revalidation"
            : "initial-decision"),
    )
    .map((entry) => {
      const key = [
        entry.evidenceKind,
        entry.subjectRef,
        entry.liquidityPhase ?? "",
      ].join("\u0000");
      return {
        key,
        label: `${String(entry.evidenceKind)} · ${String(entry.subjectRef)}`,
        signature: JSON.stringify({
          evidenceKind: entry.evidenceKind,
          subjectRef: entry.subjectRef,
          observedAt: entry.observedAt,
          retrievedAt: entry.retrievedAt,
          freshness: entry.freshness,
          source: entry.source,
          provenance: entry.provenance,
          summary: entry.summary ?? null,
          displayValue: entry.displayValue ?? null,
          observedAbsent: entry.observedAbsent ?? false,
          liquidityPhase: entry.liquidityPhase ?? null,
          freshnessWindowDays: entry.freshnessWindowDays ?? null,
        }),
      };
    })
    .sort((left, right) =>
      left.key.localeCompare(right.key) ||
      left.signature.localeCompare(right.signature),
    );
}

function comparisonInputSignature(
  source: Record<string, unknown> | undefined,
  authorityGap: GoldenAuthorityGap | undefined,
  pass: "initial" | "revalidated",
): string | null {
  const evidence = comparisonEvidenceRows(source, pass);
  const inputs = comparisonNonPolicyInputRows(source, authorityGap, pass);
  return evidence && inputs
    ? JSON.stringify({
        evidence: evidence.map(({ signature }) => signature),
        inputs: inputs.map(({ signature }) => signature),
      })
    : null;
}

function comparisonNonPolicyInputRows(
  source: Record<string, unknown> | undefined,
  authorityGap: GoldenAuthorityGap | undefined,
  pass: "initial" | "revalidated",
): Array<{ label: string; signature: string }> | null {
  const trigger = isObj(source?.trigger) ? source.trigger : null;
  const money = source ? readSignedMoney(source) : null;
  const policyVersions = isObj(source?.policyVersions)
    ? source.policyVersions
    : null;
  const householdInstructions = Array.isArray(
    source?.householdInstructions,
  )
    ? source.householdInstructions.filter(isObj).sort((left, right) =>
        String(left.versionId).localeCompare(String(right.versionId)) ||
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      )
    : null;
  if (!trigger || !money || !policyVersions || !householdInstructions) {
    return null;
  }
  const prohibition = isObj(source?.prohibition)
    ? source.prohibition
    : null;
  const prohibitionSource = isObj(prohibition?.source)
    ? prohibition.source
    : null;
  const nonFirmProhibition =
    prohibitionSource?.sourceType === "firm_policy" ? null : prohibition;
  const householdInstructionVersionIds = Array.isArray(
    policyVersions.householdInstructionVersionIds,
  )
    ? [...policyVersions.householdInstructionVersionIds].sort()
    : policyVersions.householdInstructionVersionIds;
  return [
    {
      label: "signed request meaning",
      signature: JSON.stringify({
        kind: trigger.kind,
        description: trigger.description,
        maskedRequestSummary: trigger.maskedRequestSummary,
      }),
    },
    {
      label: "signed requester",
      signature: JSON.stringify(trigger.requesterRole),
    },
    {
      label: "signed request identity",
      signature: JSON.stringify(trigger.requestRef),
    },
    {
      label: "signed request timing and amount",
      signature: JSON.stringify({
        requestAt: trigger.asOf,
        requestAmountUsd: money.requestAmountUsd,
      }),
    },
    {
      label: "signed money inputs",
      signature: JSON.stringify({
        currency: money.currency,
        cadence: money.cadence,
        plannedWithdrawalMonthlyUsd:
          money.plannedWithdrawalMonthlyUsd,
        availableLiquidityUsd: money.availableLiquidityUsd,
        pendingLiquidityUsd: money.pendingLiquidityUsd,
        preExecutionRevalidation:
          pass === "revalidated"
            ? money.preExecutionRevalidation
            : null,
      }),
    },
    {
      label: "domain configuration authority",
      signature: JSON.stringify(
        policyVersions.domainConfigVersionId,
      ),
    },
    {
      label: "household instruction authority",
      signature: JSON.stringify({
        versionIds: householdInstructionVersionIds,
        instructions: householdInstructions,
      }),
    },
    {
      label: "regulatory authority",
      signature: JSON.stringify(policyVersions.regulatoryVersionId),
    },
    {
      label: "non-firm prohibition authority",
      signature: JSON.stringify(nonFirmProhibition),
    },
    {
      label: "signed authority completeness",
      signature: JSON.stringify(
        authorityGap
          ? {
              signedAt: authorityGap.signedAt,
              requiredSince: authorityGap.requiredSince,
              status: authorityGap.status,
              execution: authorityGap.execution,
              reason: authorityGap.reason,
              missingAuthorities: [
                ...authorityGap.missingAuthorities,
              ].sort(),
            }
          : null,
      ),
    },
  ];
}

function changedComparisonLabels(
  rowsA: Array<{ key?: string; label: string; signature: string }>,
  rowsB: Array<{ key?: string; label: string; signature: string }>,
): string[] {
  const keys = new Set([
    ...rowsA.map((row) => row.key ?? row.label),
    ...rowsB.map((row) => row.key ?? row.label),
  ]);
  return [...keys].sort().flatMap((key) => {
    const a = rowsA.filter((row) => (row.key ?? row.label) === key);
    const b = rowsB.filter((row) => (row.key ?? row.label) === key);
    return JSON.stringify(a.map(({ signature }) => signature)) ===
      JSON.stringify(b.map(({ signature }) => signature))
      ? []
      : [a[0]?.label ?? b[0]!.label];
  });
}

function comparisonDifferenceLabels(
  sourceA: Record<string, unknown> | undefined,
  sourceB: Record<string, unknown> | undefined,
  authorityGaps: GoldenAuthorityGap[],
  pass: "initial" | "revalidated",
): string[] {
  const rowsA = comparisonEvidenceRows(sourceA, pass);
  const rowsB = comparisonEvidenceRows(sourceB, pass);
  const inputsA = comparisonNonPolicyInputRows(
    sourceA,
    authorityGaps.find((gap) => gap.caseId === sourceA?.caseId),
    pass,
  );
  const inputsB = comparisonNonPolicyInputRows(
    sourceB,
    authorityGaps.find((gap) => gap.caseId === sourceB?.caseId),
    pass,
  );
  if (!rowsA || !rowsB || !inputsA || !inputsB) return [];
  return [
    ...changedComparisonLabels(rowsA, rowsB),
    ...changedComparisonLabels(inputsA, inputsB),
  ];
}

function comparisonHasEquivalentInputs(
  cases: LoadedCase[],
  decision: DisplayedDecision,
  authorityGaps: GoldenAuthorityGap[],
): boolean {
  const own = decision.sourceCaseId
    ? caseData(cases, decision.sourceCaseId)
    : undefined;
  const otherFirmId = decision.firmId === "firm-a" ? "firm-b" : "firm-a";
  const counterpart = cases.find(
    ({ data }) =>
      isObj(data) &&
      data.scenarioRef === decision.scenarioId &&
      data.firm === otherFirmId,
  );
  const ownSignature = comparisonInputSignature(
    own,
    authorityGaps.find((gap) => gap.caseId === own?.caseId),
    decision.pass,
  );
  const counterpartSignature = comparisonInputSignature(
    counterpart && isObj(counterpart.data) ? counterpart.data : undefined,
    authorityGaps.find(
      (gap) =>
        gap.caseId ===
        (counterpart && isObj(counterpart.data)
          ? counterpart.data.caseId
          : undefined),
    ),
    decision.pass,
  );
  return (
    ownSignature !== null &&
    counterpartSignature !== null &&
    ownSignature === counterpartSignature
  );
}

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
      (floorMinor !== null &&
        floorMinor !==
          tryReserveFloorMinor(
            signedScheduleEvidenceMinor(data) ?? -1,
            demoFirm.reserveMonths,
          ))
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

function signedScheduleEvidenceMinor(
  data: Record<string, unknown> | undefined,
): number | null {
  const rows = Array.isArray(data?.householdEvidence)
    ? data.householdEvidence.filter(isObj).filter(
        (entry) =>
          entry.evidenceKind === "planned-withdrawals" &&
          isObj(entry.displayValue) &&
          entry.displayValue.unit === "USD/month",
      )
    : [];
  if (rows.length !== 1) return null;
  const display = rows[0]!.displayValue;
  return isObj(display) ? minorFromMajor(display.value) : null;
}

function expectedSignedCaseVariant(
  data: Record<string, unknown>,
  authorityGaps: GoldenAuthorityGap[] = DEFAULT_GOLDEN_AUTHORITY_GAPS,
): Record<string, unknown> | null {
  const signed = readSignedMoney(data);
  const authorityGap = authorityGaps.find(
    (gap) => gap.caseId === data.caseId,
  );
  const structuredMoneyMissing =
    authorityGap?.missingAuthorities.includes("structured-money") === true &&
    data.signedMoney === undefined;
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
    (!signed && !structuredMoneyMissing) ||
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
  const revalidation = signed?.preExecutionRevalidation ?? null;
  const stages = Array.isArray(authority.stages)
    ? authority.stages.filter(isObj)
    : [];
  const inferredApprovalBindings = stages.flatMap((stage) =>
    isMoneyQuantity(stage.approvalsRequired)
      ? Array.from({ length: stage.approvalsRequired }, () => ({
          stageId: stage.stageId,
          lifecyclePass: "initial",
        }))
      : [],
  );
  let inferredApprovalIndex = 0;
  const verificationDetailMissing =
    authorityGap?.missingAuthorities.includes("verification-detail") === true &&
    verification.observedAt === undefined;
  return {
    caseId: data.caseId,
    scenarioId: data.scenarioRef,
    firmId: data.firm,
    disposition: data.expectedDisposition,
    trigger: {
      kind: trigger.kind,
      description: trigger.description,
      requesterRole: trigger.requesterRole,
      requestRef: trigger.requestRef,
      maskedRequestSummary: trigger.maskedRequestSummary,
      requestAt: trigger.asOf,
      requestAmountMinor: minorFromMajor(signed?.requestAmountUsd ?? null),
    },
    money: {
      currency: signed?.currency ?? null,
      cadence: signed?.cadence ?? null,
      requestAmountMinor: minorFromMajor(signed?.requestAmountUsd ?? null),
      plannedWithdrawalMonthlyMinor: minorFromMajor(
        signed?.plannedWithdrawalMonthlyUsd ?? null,
      ),
      reserveFloorMinor: minorFromMajor(signed?.reserveFloorUsd ?? null),
      availableLiquidityMinor: minorFromMajor(
        signed?.availableLiquidityUsd ?? null,
      ),
      pendingLiquidityMinor: minorFromMajor(
        signed?.pendingLiquidityUsd ?? null,
      ),
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
    verification: verificationDetailMissing
      ? {
          reached: verification.reached,
          observedStatus: verification.observedStatus,
          settledClaim: verification.settledClaim,
          observedAt: null,
          currentReason: null,
          custodianReason: null,
          proves: [],
          notProvenYet: [],
          polling: {
            state: "unavailable",
            reason: "awaiting-captain-signature",
          },
          exception: null,
          note: verification.note,
        }
      : {
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
      stageId:
        event.stageId ??
        (event.type === "ApprovalRecorded" &&
        authorityGap?.missingAuthorities.includes("approval-event-bindings")
          ? inferredApprovalBindings[inferredApprovalIndex]?.stageId
          : null),
      lifecyclePass:
        event.lifecyclePass ??
        (event.type === "ApprovalRecorded" &&
        authorityGap?.missingAuthorities.includes("approval-event-bindings")
          ? inferredApprovalBindings[inferredApprovalIndex++]?.lifecyclePass
          : null),
      actorId: event.actorId ?? null,
      roleId: event.roleId ?? null,
      requesterId: event.requesterId ?? null,
    })),
    explanations: data.expectedExplanationNodes
      .filter(isObj)
      .map((explanation) => ({
        code: explanation.code,
        summary: explanation.summary,
      })),
    authorityGap: authorityGap
      ? {
          signedAt: authorityGap.signedAt,
          requiredSince: authorityGap.requiredSince,
          status: authorityGap.status,
          execution: authorityGap.execution,
          reason: authorityGap.reason,
          missingAuthorities: authorityGap.missingAuthorities,
        }
      : null,
  };
}

function validateSignedCaseVariants(
  cases: LoadedCase[],
  demo: DemoSemanticSnapshot,
  authorityGaps: GoldenAuthorityGap[],
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
    const expected = expectedSignedCaseVariant(data, authorityGaps);
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

type RecordIdentity = DemoSemanticSnapshot["recordIdentities"][number];

function independentDigest(kind: string, value: unknown): string {
  return createHash("sha256")
    .update(kind)
    .update("\u0000")
    .update(JSON.stringify(value))
    .digest("hex");
}

export function deriveIndependentDemoBinding(
  cases: LoadedCase[],
  demo: DemoSemanticSnapshot,
  record: RecordIdentity,
  pass: "initial" | "revalidated",
  authorityGaps: GoldenAuthorityGap[] = DEFAULT_GOLDEN_AUTHORITY_GAPS,
): { decisionHash: string; bundleHash: string } | null {
  const raw = record.routeSourceCaseId
    ? caseData(cases, record.routeSourceCaseId)
    : undefined;
  const sourceCase = raw
    ? expectedSignedCaseVariant(raw, authorityGaps)
    : null;
  if (raw && !sourceCase) return null;
  const firm = demo.firms.find(
    (candidate) => candidate.id === record.routeFirmId,
  );
  const decision = demo.decisions.find(
    (candidate) =>
      candidate.scenarioId === record.routeScenarioId &&
      candidate.firmId === record.routeFirmId &&
      candidate.sourceCaseId === record.routeSourceCaseId &&
      candidate.decisionRole === "primary",
  );
  const passRecord = demo.recordIdentities.find(
    (candidate) =>
      candidate.routeScenarioId === record.routeScenarioId &&
      candidate.routeFirmId === record.routeFirmId &&
      candidate.routeSourceCaseId === record.routeSourceCaseId &&
      candidate.routePass === pass,
  );
  if (!firm || !decision || !passRecord) return null;
  const identity = {
    scenarioId: record.routeScenarioId,
    firmId: record.routeFirmId,
    sourceCaseId: record.routeSourceCaseId,
    pass,
  };
  const evidence = Array.isArray(sourceCase?.evidence)
    ? sourceCase.evidence
        .filter(isObj)
        .filter(
          (entry) =>
            entry.liquidityPhase === null ||
            entry.liquidityPhase ===
              (pass === "revalidated"
                ? "pre-execution-revalidation"
                : "initial-decision"),
        )
        .map((entry) => ({
          evidenceKind: entry.evidenceKind,
          subjectRef: entry.subjectRef,
          observedAt: entry.observedAt,
          retrievedAt: entry.retrievedAt,
          freshness: entry.freshness,
          source: entry.source,
          provenance: entry.provenance,
          summary: entry.summary,
          liquidityPhase: entry.liquidityPhase,
          observedAbsent: entry.observedAbsent,
          displayValue: entry.displayValue,
          freshnessWindowDays: entry.freshnessWindowDays,
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        )
    : [];
  const policyVersions = isObj(sourceCase?.policyVersions)
    ? sourceCase.policyVersions
    : {
        domainConfigVersionId: null,
        firmPolicyVersionId: firm.policyVersion,
        householdInstructionVersionIds: [],
        regulatoryVersionId: null,
      };
  const householdInstructions = Array.isArray(
    sourceCase?.householdInstructions,
  )
    ? sourceCase.householdInstructions.filter(isObj).sort((left, right) =>
        String(left.versionId).localeCompare(String(right.versionId)),
      )
    : [];
  const bundleHash = independentDigest(
    "verin-demo-input-bundle-v1",
    {
      identity,
      request: demo.canonicalRequest,
      signedTrigger: sourceCase?.trigger ?? null,
      evidence,
      policyVersions,
      householdInstructions,
      firmConfiguration: {
        reserveMonths: firm.reserveMonths,
        dualApprovalThresholdMinor:
          firm.dualApprovalThresholdMinor,
        approvalsRequired: firm.approvalsRequired,
        distinctActorsRequired: firm.distinctActorsRequired,
        eligibleRole: firm.eligibleRole,
        requesterConstraint: firm.requesterConstraint,
        bankChangeHandling: firm.bankChangeHandling,
      },
    },
  );
  return {
    bundleHash,
    decisionHash: independentDigest("verin-demo-decision-v1", {
      identity,
      decisionId: passRecord.decisionId,
      createdAt: passRecord.headerCreatedAtIso,
      bundleHash,
      disposition: decision.disposition,
      prohibition: sourceCase?.prohibition ?? null,
      authority: sourceCase?.authority ?? null,
      executionEligibility:
        sourceCase?.executionEligibility ?? null,
      explanations: sourceCase?.explanations ?? [],
    }),
  };
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
function validateDisplayedDecisions(
  cases: LoadedCase[],
  demo: DemoSemanticSnapshot,
  authorityGaps: GoldenAuthorityGap[],
): string[] {
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
    const ownComparisonSource = d.sourceCaseId
      ? caseData(cases, d.sourceCaseId)
      : undefined;
    const comparisonFirmId =
      d.firmId === "firm-a" ? "firm-b" : "firm-a";
    const counterpart = cases.find(
      ({ data }) =>
        isObj(data) &&
        data.scenarioRef === d.scenarioId &&
        data.firm === comparisonFirmId,
    );
    const comparisonDifferences = comparisonDifferenceLabels(
      ownComparisonSource,
      counterpart && isObj(counterpart.data)
        ? counterpart.data
        : undefined,
      authorityGaps,
      d.pass,
    );
    if (
      d.decisionRole === "primary" &&
      !comparisonHasEquivalentInputs(cases, d, authorityGaps)
    ) {
      if (
        !d.comparisonDescription?.toLowerCase().includes(
          "signed evidence",
        ) ||
        comparisonDifferences.some(
          (difference) =>
            !d.comparisonDescription?.includes(difference),
        )
      ) {
        problems.push(
          `${at}: comparison does not disclose its complete signed evidence difference`,
        );
      }
      if (
        d.comparisonDispositionReason !== null &&
        !d.comparisonDispositionReason.includes(
          "not attributed solely to policy",
        )
      ) {
        problems.push(
          `${at}: comparison attributes a disposition difference solely to policy despite differing signed evidence`,
        );
      }
    }
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
    const authorityGap = authorityGaps.find(
      (gap) => gap.caseId === d.sourceCaseId,
    );
    if (
      authorityGap &&
      !d.evidenceGaps.includes(authorityGap.reason)
    ) {
      problems.push(
        `${at}: direct Evidence surface omits the signed authority gap and execution-withheld reason`,
      );
    }
    const structuredMoneyGap =
      authorityGap?.missingAuthorities.includes("structured-money") ===
      true;
    if (!source || (!signed && !structuredMoneyGap)) {
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
    const sourceRequestMinor = minorFromMajor(
      signed?.requestAmountUsd ?? null,
    );
    const expectedTrigger =
      trigger && (sourceRequestMinor !== null || structuredMoneyGap)
        ? {
            kind: trigger.kind,
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
      structuredMoneyGap
        ? d.signedTrigger?.requestAmountMinor !== null
        : !candidates.some(
            ({ id, requestAmountMinor }) =>
              id === d.sourceCaseId &&
              requestAmountMinor ===
                d.signedTrigger?.requestAmountMinor,
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
      const sourceAccountRef = expectedEvidence.find(
        (entry) => entry.evidenceKind === "account-balance",
      )?.subjectRef;
      if (d.disposition === "proceed") {
        if (
          !isNonEmptyString(d.approvalGateRestatement) ||
          (isNonEmptyString(sourceAccountRef)
            ? !d.approvalGateRestatement.includes(sourceAccountRef) ||
              !d.approvalGateRestatement.includes(
                "account name unavailable",
              )
            : !d.approvalGateRestatement.includes(
                "source account unavailable",
              )) ||
          d.approvalGateRestatement.includes("Smith Family Taxable")
        ) {
          problems.push(
            `${at}: authority restatement must use the exact signed account reference and keep unavailable account metadata explicit`,
          );
        }
      } else if (d.approvalGateRestatement !== null) {
        problems.push(
          `${at}: authority restatement is visible although the exact case never reached authority`,
        );
      }
      const recentChangeRow = d.policyTraceRows.find(
        (row) => row.rule === "Recent bank-instruction change handling",
      );
      if (
        !expectedEvidence.some(
          (entry) => entry.evidenceKind === "bank-instruction",
        ) &&
        recentChangeRow?.result !==
          "Not evaluated - exact signed bank-instruction evidence unavailable"
      ) {
        problems.push(
          `${at}: recent-change trace infers a result without exact signed bank-instruction evidence`,
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
    const expectedPlannedMonthly =
      signedScheduleEvidenceMinor(source);
    const demoFirm = demo.firms.find(
      (firm) => firm.id === d.firmId,
    );
    const expectedFloor =
      expectedPlannedMonthly !== null && demoFirm
        ? tryReserveFloorMinor(
            expectedPlannedMonthly,
            demoFirm.reserveMonths,
          )
        : null;
    if (
      d.plannedWithdrawalMonthlyMinor !== expectedPlannedMonthly ||
      d.reserveFloorMinor !== expectedFloor
    ) {
      problems.push(
        `${at}: planned-withdrawal schedule or reserve floor is not bound to the exact signed schedule evidence`,
      );
    }
    if (
      expectedPlannedMonthly === null &&
      (d.reserveFloorMinor !== null ||
        d.headroomMinor !== null ||
        d.simulatedFloorMinor !== null ||
        d.simulatedHeadroomMinor !== null ||
        d.simulatedDisposition !== null)
    ) {
      problems.push(
        `${at}: missing planned-withdrawal evidence must leave reserve and policy simulation unavailable`,
      );
    }
    const availableMinor = minorFromMajor(
      signed?.availableLiquidityUsd ?? null,
    );
    const pendingMinor = minorFromMajor(
      signed?.pendingLiquidityUsd ?? null,
    );
    if (d.decisionRole === "primary") {
      const exactSimulationAvailable =
        expectedPlannedMonthly !== null &&
        availableMinor !== null &&
        pendingMinor !== null;
      if (
        d.policyApprovalAvailable !== exactSimulationAvailable
      ) {
        problems.push(
          `${at}: policy approval and activation must remain unavailable until the exact-case simulation delta is computed`,
        );
      }
    }
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
    const revalidationAvailableMinor = minorFromMajor(
      signed?.preExecutionRevalidation?.availableLiquidityUsd ?? null,
    );
    const revalidationPendingMinor = minorFromMajor(
      signed?.preExecutionRevalidation?.pendingLiquidityUsd ?? null,
    );
    if (
      d.revalidationAvailableCashMinor !== revalidationAvailableMinor ||
      d.revalidationPendingActivityMinor !== revalidationPendingMinor
    ) {
      problems.push(
        `${at}: pre-execution revalidation drift, ${d.sourceCaseId}=${revalidationAvailableMinor}/${revalidationPendingMinor}, demo=${d.revalidationAvailableCashMinor}/${d.revalidationPendingActivityMinor}`,
      );
    }
    if (expectedFloor === null) continue;
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
      d.reserveFloorMinor!,
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
    if (d.decisionRole === "primary" && d.firmId === "firm-a") {
      const expectedSimulatedFloor = tryReserveFloorMinor(
        demo.plannedWithdrawalMonthlyMinor,
        demo.draftedReserveMonths,
      );
      const expectedSimulatedHeadroom =
        expectedSimulatedFloor === null
          ? null
          : tryHeadroomMinor(
              d.availableCashMinor,
              d.pendingActivityMinor,
              expectedSimulatedFloor,
            );
      const expectedSimulatedDisposition =
        expectedSimulatedHeadroom !== null &&
        d.disposition === "proceed" &&
        expectedSimulatedHeadroom < d.requestAmountMinor
          ? "blocked"
          : d.disposition;
      if (
        expectedSimulatedFloor === null ||
        expectedSimulatedHeadroom === null ||
        d.simulatedFloorMinor !== expectedSimulatedFloor ||
        d.simulatedHeadroomMinor !== expectedSimulatedHeadroom ||
        d.simulatedDisposition !== expectedSimulatedDisposition
      ) {
        problems.push(
          `${at}: policy-draft simulation must use the exact selected case liquidity and drafted reserve horizon`,
        );
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
  authorityGaps: GoldenAuthorityGap[],
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
    const permitsSignedOffset =
      authorityGaps
        .find((gap) => gap.caseId === sourceId)
        ?.missingAuthorities.includes("canonical-utc-instants") === true;
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
    const executionPass = expectedLedgerTypes.includes("ApprovalInvalidated")
      ? "revalidated"
      : "initial";
    const executionProofComplete = source
      ? rawExecutionEligibilityProof(source, executionPass)
      : false;
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
        (revalidationIndex < 0 || decisionIndex < revalidationIndex) &&
        (finalApprovalIndex < 0 ||
          (decisionIndex < finalApprovalIndex &&
            (revalidationIndex < 0 ||
              finalApprovalIndex < revalidationIndex))) &&
        (executionProofComplete
          ? revalidationIndex < reservationIndex &&
            reservationIndex < executionIndex
          : reservationIndex < 0 && executionIndex < 0);
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
        (executionProofComplete
          ? finalApprovalIndex < reservationIndex &&
            reservationIndex < executionIndex
          : reservationIndex < 0 && executionIndex < 0);
      if (!validStandardOrder && !validInvalidationOrder) {
        problems.push(
          `${sourceId}: unsorted production timeline must keep the signed decision, final still-valid approval, pre-execution revalidation, reservation, and execution in governed order`,
        );
      }
    }
    const visibleDownstream = eventKinds.some((kind) =>
      [
        "ReservationCreated",
        "ExecutionStarted",
        "ExecutionSucceeded",
        "ExecutionPartiallySucceeded",
        "StatusObserved",
        "ExceptionDecisionRequested",
      ].includes(kind),
    );
    if (!executionProofComplete && visibleDownstream) {
      problems.push(
        `${sourceId}: incomplete structured signed execution authority must hide every downstream timeline event`,
      );
    }
    if (
      executionProofComplete &&
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
        if (
          !permitsSignedOffset ||
          event.kind !== "request" ||
          event.instant !== timeline.requestAt
        ) {
          problems.push(
            `${sourceId}: visible timeline event ${event.kind} has a non-canonical instant ${event.instant}`,
          );
          continue;
        }
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

function validateRecordIdentities(
  cases: LoadedCase[],
  demo: DemoSemanticSnapshot,
  authorityGaps: GoldenAuthorityGap[],
): string[] {
  const problems: string[] = [];
  const decisionIds = new Set<string>();
  const auditPositions = new Set<string>();
  const decisionHashOwners = new Map<string, string>();
  const bundleHashOwners = new Map<string, string>();
  for (const record of demo.recordIdentities) {
    const at = `${record.routeScenarioId}/${record.routeFirmId}/${record.routeSourceCaseId ?? "unsigned"}/${record.routePass}`;
    if (
      record.headerScenarioId !== record.routeScenarioId ||
      record.headerFirmId !== record.routeFirmId ||
      record.headerSourceCaseId !== record.routeSourceCaseId ||
      record.headerPass !== record.routePass
    ) {
      problems.push(
        `${at}: printable record header loses exact route context`,
      );
    }
    const activeDecisionInstant =
      record.routePass === "revalidated"
        ? record.decisionEventInstants.at(-1)
        : record.decisionEventInstants[0];
    if (
      record.routeSourceCaseId !== null &&
      record.headerCreatedAtIso !== activeDecisionInstant
    ) {
      problems.push(
        `${at}: printable record created-at does not match the active DecisionRecorded event`,
      );
    }
    if (!isNonEmptyString(record.decisionId)) {
      problems.push("printable record carries no stable decision identity");
    } else if (decisionIds.has(record.decisionId)) {
      problems.push(
        `printable record decision identity is reused: ${record.decisionId}`,
      );
    }
    const auditPositionKey = `${record.auditPosition.orgId}\u0000${record.auditPosition.sequence}`;
    if (
      !isNonEmptyString(record.auditPosition.orgId) ||
      !Number.isSafeInteger(record.auditPosition.sequence) ||
      record.auditPosition.sequence <= 0
    ) {
      problems.push("printable record carries no stable audit position");
    } else if (auditPositions.has(auditPositionKey)) {
      problems.push(
        `printable record audit position is reused: ${record.auditPosition.orgId}/${record.auditPosition.sequence}`,
      );
    }
    decisionIds.add(record.decisionId);
    auditPositions.add(auditPositionKey);
    const expectedKinds =
      record.routePass === "revalidated"
        ? ["original", "derived"]
        : ["original"];
    if (
      JSON.stringify(record.decisionBindings.map(({ kind }) => kind)) !==
      JSON.stringify(expectedKinds)
    ) {
      problems.push(
        `${at}: printable record does not carry the active pass's decision bindings`,
      );
    }
    const activeBinding = record.decisionBindings.at(-1);
    if (
      record.approvalBinding !== null &&
      (record.approvalBinding.decisionHash !== activeBinding?.decisionHash ||
        record.approvalBinding.bundleHash !== activeBinding?.bundleHash)
    ) {
      problems.push(
        `${at}: approvals do not bind the active record decision and input bundle`,
      );
    }
    for (const binding of record.decisionBindings) {
      const bindingPass =
        binding.kind === "derived" ? "revalidated" : "initial";
      const owner = `${record.routeScenarioId}/${record.routeFirmId}/${record.routeSourceCaseId ?? "unsigned"}/${bindingPass}`;
      const expected = deriveIndependentDemoBinding(
        cases,
        demo,
        record,
        bindingPass,
        authorityGaps,
      );
      if (!expected) {
        problems.push(
          `${at}: binding inputs cannot be independently projected`,
        );
      } else {
        if (binding.bundleHash !== expected.bundleHash) {
          problems.push(
            `${at}: input-bundle hash does not match independently projected exact inputs`,
          );
        }
        if (binding.decisionHash !== expected.decisionHash) {
          problems.push(
            `${at}: decision hash does not match independently projected exact inputs`,
          );
        }
      }
      for (const [label, hash, owners] of [
        ["decision", binding.decisionHash, decisionHashOwners],
        ["input-bundle", binding.bundleHash, bundleHashOwners],
      ] as const) {
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          problems.push(`${at}: ${label} hash is not a full SHA-256 binding`);
          continue;
        }
        const priorOwner = owners.get(hash);
        if (priorOwner && priorOwner !== owner) {
          problems.push(
            `${at}: ${label} hash is reused across exact case or lifecycle inputs`,
          );
        } else {
          owners.set(hash, owner);
        }
      }
    }
  }
  for (const { data } of cases) {
    if (
      !isObj(data) ||
      !isNonEmptyString(data.caseId) ||
      !isNonEmptyString(data.scenarioRef) ||
      !isNonEmptyString(data.firm)
    ) {
      continue;
    }
    const initial = demo.recordIdentities.find(
      (record) =>
        record.routeScenarioId === data.scenarioRef &&
        record.routeFirmId === data.firm &&
        record.routeSourceCaseId === data.caseId &&
        record.routePass === "initial",
    );
    if (!initial) {
      problems.push(
        `${data.caseId}: exact signed case has no independently reachable printable record`,
      );
    }
    if (
      data.caseId === "GC-15-approval-invalidation" &&
      !demo.recordIdentities.some(
        (record) =>
          record.routeSourceCaseId === data.caseId &&
          record.routePass === "revalidated",
      )
    ) {
      problems.push(
        "GC-15 revalidated lifecycle has no independently identified printable record",
      );
    }
  }
  return problems;
}

function validateFirmPolicyInputs(
  cases: LoadedCase[],
  refs: ScenarioRefs,
  demo: DemoSemanticSnapshot,
): string[] {
  const problems: string[] = [];
  for (const [firmId, configured] of refs.firmPolicies) {
    const actual = demo.firms.find((firm) => firm.id === firmId);
    const rendered = demo.renderedFirmPolicies.find(
      (firm) => firm.firmId === firmId,
    );
    const thresholdMinor = minorFromMajor(
      configured.dualApprovalThresholdUsd,
    );
    if (
      !actual ||
      actual.reserveMonths !== configured.cashReserveMonths ||
      actual.dualApprovalThresholdMinor !== thresholdMinor ||
      actual.approvalsRequired !== configured.approvalsRequired ||
      actual.distinctActorsRequired !==
        configured.distinctActorsRequired ||
      actual.eligibleRole !== configured.eligibleRole ||
      actual.requesterConstraint !== configured.requesterConstraint ||
      actual.bankChangeHandling !==
        configured.bankInstructionChangeHandling
    ) {
      problems.push(
        `${firmId}: demo firm policy inputs drift from scenarios.yaml`,
      );
      continue;
    }
    const expectedFloor = tryReserveFloorMinor(
      demo.plannedWithdrawalMonthlyMinor,
      actual.reserveMonths,
    );
    const displayName =
      firmId === "firm-a"
        ? "Firm A"
        : firmId === "firm-b"
          ? "Firm B"
          : firmId;
    const expectedQuorum =
      demo.requestAmountMinor <= actual.dualApprovalThresholdMinor
        ? `No dual approval at this amount; ${displayName} states ${actual.requesterConstraint === null ? "no requester rule" : actual.requesterConstraint}`
        : `${actual.approvalsRequired} ${actual.distinctActorsRequired ? "distinct " : ""}${actual.eligibleRole ?? "eligible"} approvers - ${actual.requesterConstraint === "may-not-satisfy-both-approvals" ? "requester excluded" : "no requester constraint"}`;
    const expectedBankHandling =
      actual.bankChangeHandling === "specialist-review"
        ? "Specialist review before execution"
        : "Blocked until independently verified";
    if (
      !rendered ||
      rendered.reserveFloorMinor !== expectedFloor ||
      rendered.dualApprovalThresholdMinor !==
        actual.dualApprovalThresholdMinor ||
      rendered.quorum !== expectedQuorum ||
      rendered.bankChangeHandling !== expectedBankHandling
    ) {
      problems.push(
        `${firmId}: rendered comparison drifts from structured firm policy inputs`,
      );
    }
  }
  for (const { data } of cases) {
    if (!isObj(data) || !isObj(data.firmConfiguration)) continue;
    const firmId = data.firm;
    const actual =
      typeof firmId === "string"
        ? demo.firms.find((firm) => firm.id === firmId)
        : undefined;
    const config = data.firmConfiguration;
    if (
      !actual ||
      config.cashReserveMonths !== actual.reserveMonths ||
      minorFromMajor(config.dualApprovalThresholdUsd) !==
        actual.dualApprovalThresholdMinor ||
      config.approvalsRequired !== actual.approvalsRequired ||
      config.distinctActorsRequired !==
        actual.distinctActorsRequired ||
      config.eligibleRole !== actual.eligibleRole ||
      config.requesterConstraint !== actual.requesterConstraint ||
      config.bankInstructionChangeHandling !==
        actual.bankChangeHandling
    ) {
      problems.push(
        `${String(data.caseId)}: signed firm policy inputs drift from the demo configuration`,
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
  authorityGaps: GoldenAuthorityGap[] = DEFAULT_GOLDEN_AUTHORITY_GAPS,
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

  problems.push(
    ...validateDisplayedDecisions(cases, demo, authorityGaps),
  );
  problems.push(...validateSignedCaseVariants(cases, demo, authorityGaps));
  problems.push(...validateSourceTimelines(cases, demo, authorityGaps));
  problems.push(...validateRecordIdentities(cases, demo, authorityGaps));
  problems.push(...validateFirmPolicyInputs(cases, refs, demo));

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
      if (
        rendered.plannedWithdrawalMonthlyMinor !==
          expectedMonthlyMinor ||
        rendered.reserveFloorMinor !== expectedFloorMinor
      ) {
        problems.push(
          `${caseId}: derived reserve floor drift, fixture=${expectedFloorMinor}, demo=${rendered.reserveFloorMinor}`,
        );
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
    demo.approvalInvalidationPhases.safetyBeforePendingMinor !== null ||
    demo.approvalInvalidationPhases.safetyAfterPendingMinor !== null ||
    demo.approvalInvalidationPhases.refreshedEvidencePendingMinor !==
      gc15RevalidationPending
  ) {
    problems.push(
      "GC-15 must keep revalidation pending activity off initial surfaces, withhold authority-gated Safety, and render refreshed evidence independently",
    );
  }

  for (const guard of demo.executionGuards) {
    const guardSource =
      guard.sourceCaseId === null
        ? null
        : caseData(cases, guard.sourceCaseId);
    const signedBankRows = (
      Array.isArray(guardSource?.householdEvidence)
        ? guardSource.householdEvidence
        : []
    ).filter(
      (entry) =>
        isObj(entry) &&
        entry.evidenceKind === "bank-instruction",
    );
    const signedBankFinding = signedBankRows.find(
      (entry) =>
        isObj(entry) &&
        entry.liquidityPhase !== "pre-execution-revalidation",
    );
    const exactPostReviewEvidence = signedBankRows.some(
      (entry) =>
        isObj(entry) &&
        entry.liquidityPhase === "pre-execution-revalidation",
    );
    const expected = isObj(
      guardSource?.expectedExecutionEligibility,
    )
      ? guardSource.expectedExecutionEligibility
      : null;
    const expectedPreconditions = Array.isArray(
      expected?.preconditions,
    )
      ? expected.preconditions.filter(isObj)
      : [];
    const requiresIndependentBankVerification =
      expectedPreconditions.some(
        (precondition) =>
          precondition.mustStillHoldAtExecution === true &&
          precondition.code ===
            "bank-instruction-independently-verified",
      );
    if (
      guard.exactBankInstructionEvidence !==
        (signedBankRows.length > 0) ||
      guard.exactBankInstructionPostReviewEvidence !==
        exactPostReviewEvidence
    ) {
      problems.push(
        `${guard.scenarioId}/${guard.firmId}: bank-instruction Safety authority drifts from the exact signed initial and post-review evidence`,
      );
    }
    if (
      !guard.exactBankInstructionPostReviewEvidence &&
      guard.safetyChecks.length > 0
    ) {
      const unsupportedClaim = guard.safetyChecks.some((check) => {
        const namesBankInstruction =
          check.label.toLowerCase().includes("bank instruction") ||
          check.label.toLowerCase().includes("bank-instruction");
        return (
          namesBankInstruction &&
          (check.status === "done" ||
            check.statusLabel.toLowerCase() === "verified")
        );
      });
      const expectedLabel = guard.exactBankInstructionEvidence
        ? "Bank-instruction revalidation not evaluated"
        : "Bank-instruction check not evaluated";
      const expectedStatusLabel = guard.exactBankInstructionEvidence
        ? "Post-review evidence unavailable"
        : "Evidence unavailable";
      const unavailableCheck = guard.safetyChecks.some(
        (check) =>
          check.label === expectedLabel &&
          check.status === "pending" &&
          check.statusLabel === expectedStatusLabel &&
          (!guard.exactBankInstructionEvidence ||
            (isObj(signedBankFinding) &&
              isNonEmptyString(signedBankFinding.summary) &&
              check.detail?.includes(signedBankFinding.summary) ===
                true)) &&
          (!requiresIndependentBankVerification ||
            (check.detail?.includes(
              "Signed post-review bank-instruction evidence is absent",
            ) === true &&
              check.detail.includes(
                "Execution is withheld pending captain-signed evidence",
              ))),
      );
      if (unsupportedClaim || !unavailableCheck) {
        problems.push(
          `${guard.scenarioId}/${guard.firmId}: missing exact post-review bank-instruction evidence must remain unavailable on Safety, preserve the signed finding, and cannot support a verified unchanged claim`,
        );
      }
      if (
        JSON.stringify(guard.recordSafetyChecks) !==
        JSON.stringify(guard.safetyChecks)
      ) {
        problems.push(
          `${guard.scenarioId}/${guard.firmId}: printable Record safety checks must preserve the fail-closed Safety claims`,
        );
      }
    }
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
    if (!source) {
      problems.push(`${guard.sourceCaseId}: execution guard has no signed source case`);
      continue;
    }
    const actual = guard.executionEligibility;
    const expectedReservations = Array.isArray(expected?.reservations)
      ? expected.reservations.filter(isObj)
      : [];
    const hasDerivedPass = Array.isArray(source?.expectedLedgerEvents) &&
      source.expectedLedgerEvents.some(
        (event) => isObj(event) && event.type === "ApprovalInvalidated",
      );
    const executionPass = hasDerivedPass ? "revalidated" : "initial";
    const unmetMustHold = expectedPreconditions.find((precondition) => {
      return !rawPreconditionHolds(source, executionPass, precondition);
    });
    const executionProofComplete = rawExecutionEligibilityProof(
      source,
      executionPass,
    );
    const reservationTtls = expectedReservations.flatMap((reservation) =>
      typeof reservation.expiresAfter === "string"
        ? [rawDurationMilliseconds(reservation.expiresAfter)]
        : [],
    ).filter((value): value is number => value !== null);
    const reservationHeldFor = Date.parse(guard.executionAtIso ?? "") -
      Date.parse(guard.reservationAtIso ?? "");
    if (
      executionProofComplete &&
      (reservationTtls.length !== expectedReservations.length ||
        !Number.isFinite(reservationHeldFor) ||
        reservationHeldFor < 0 ||
        reservationTtls.some((ttl) => reservationHeldFor > ttl))
    ) {
      problems.push(
        `${guard.sourceCaseId}: reservation is not valid through the rendered execution instant`,
      );
    }
    if (
      !executionProofComplete &&
      (guard.executionEligibilityVisible ||
        guard.reservationVisible ||
        guard.executionReached ||
        guard.verificationReached)
    ) {
      problems.push(
        `${guard.sourceCaseId}: unresolved execution proof ${String(unmetMustHold?.code ?? "authority-or-reservation")} must expose no execution eligibility, reservation, execution, or verification state`,
      );
    }
    const signedAuthority = isObj(source.expectedAuthority)
      ? source.expectedAuthority
      : null;
    const signedStages = signedAuthority && Array.isArray(signedAuthority.stages)
      ? signedAuthority.stages.filter(isObj)
      : [];
    const signedAuthorityExpired = rawRows(
      source,
      "expectedLedgerEvents",
    ).some((event) => event.type === "ApprovalStageExpired");
    const strongerWithheldReason =
      signedAuthorityExpired ||
      guard.stopNote?.includes(
        "Signed post-review bank-instruction evidence is absent. Execution is withheld pending captain-signed evidence.",
      );
    if (
      signedStages.length > 0 &&
      !rawApprovalProof(source, executionPass) &&
      !strongerWithheldReason &&
      !guard.stopNote?.includes(
        "Missing signed approval actor identity, role, and requester bindings. Execution is withheld pending captain-signed approval evidence.",
      )
    ) {
      problems.push(
        `${guard.sourceCaseId}: missing structured signed approval bindings must name the actor, role, and requester gap and withhold execution pending captain-signed evidence`,
      );
    }
    if (
      unmetMustHold?.code ===
        "bank-instruction-independently-verified" &&
      !guard.stopNote?.includes(
        "Signed post-review bank-instruction evidence is absent. Execution is withheld pending captain-signed evidence.",
      )
    ) {
      problems.push(
        `${guard.sourceCaseId}: unresolved post-review bank evidence must state that execution is withheld pending captain-signed evidence`,
      );
    }
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
    if (
      expectedVerification?.reached === true &&
      executionProofComplete
    ) {
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
      const timeline = demo.sourceTimelines.find(
        ({ sourceCaseId }) => sourceCaseId === guard.sourceCaseId,
      );
      const partialSucceededAt = timeline?.events.find(
        ({ kind }) => kind === "ExecutionPartiallySucceeded",
      )?.instant;
      const executionSucceededAt = timeline?.events.find(
        ({ kind }) => kind === "ExecutionSucceeded",
      )?.instant;
      const expectedProofEvents = expectedProves.map((proof) => {
        if (expectedVerification.observedStatus === "unknown") {
          return {
            ledgerEvent: "ExecutionPartiallySucceeded",
            observedAtIso: partialSucceededAt,
          };
        }
        if (proof === "Submission accepted by the capability") {
          return {
            ledgerEvent: "ExecutionSucceeded",
            observedAtIso: executionSucceededAt,
          };
        }
        return {
          ledgerEvent: "StatusObserved",
          observedAtIso: expectedVerification.observedAt,
        };
      });
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
        JSON.stringify(
          guard.verificationProves.map(({ display }) => display),
        ) !==
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
      if (
        guard.verificationProves.length !== expectedProofEvents.length ||
        guard.verificationProves.some(
          (proof, index) =>
            proof.ledgerEvent !==
              expectedProofEvents[index]?.ledgerEvent ||
            proof.observedAtIso !==
              expectedProofEvents[index]?.observedAtIso,
        )
      ) {
        problems.push(
          `${guard.sourceCaseId}: verification proof provenance must bind each claim to its own signed ledger event instant`,
        );
      }
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
      proof.display.includes("signature date predates form version"),
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
    const signedApprovalSatisfied = rawApprovalProof(data, plan.pass);
    if (plan.satisfied !== signedApprovalSatisfied) {
      problems.push(
        `${String(data.caseId)}: rendered authority satisfaction contradicts structured signed actor, role, requester, stage, pass, and quorum bindings`,
      );
    }
  }

  const gc10Reservation = demo.reservationCausality.filter(
    ({ sourceCaseId, relatedSourceCaseId }) =>
      sourceCaseId === "GC-10-simultaneous-distributions-first" &&
      relatedSourceCaseId === "GC-11-simultaneous-distributions-second",
  );
  const gc10Source = caseData(
    cases,
    "GC-10-simultaneous-distributions-first",
  );
  const expectedGc10Reservations =
    gc10Source && rawExecutionEligibilityProof(gc10Source, "initial") ? 1 : 0;
  if (gc10Reservation.length !== expectedGc10Reservations) {
    problems.push(
      "GC-10 reservation causality must appear exactly when structured signed execution authority is complete",
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
  const gc15InitialApprovalBindings = gc15
    ? rawCompletedApprovalBindings(gc15, "initial")
    : [];
  const gc15FreshApprovalBindings = gc15
    ? rawCompletedApprovalBindings(gc15, "revalidated")
    : [];
  const gc15FreshApprovalProof = gc15
    ? rawApprovalProof(gc15, "revalidated")
    : false;
  const gc15ExecutionProof = gc15
    ? rawExecutionEligibilityProof(gc15, "revalidated")
    : false;
  const downstreamEventTypes = new Set([
    "ReservationCreated",
    "ExecutionStarted",
    "ExecutionSucceeded",
    "ExecutionPartiallySucceeded",
    "StatusObserved",
    "ExceptionDecisionRequested",
  ]);
  const expectedVisibleRevalidatedGc15Types = gc15ExecutionProof
    ? expectedGc15Types
    : expectedGc15Types.filter((type) => !downstreamEventTypes.has(type));
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
    lifecycle.revalidatedEventTypes.length !==
      expectedVisibleRevalidatedGc15Types.length ||
    lifecycle.revalidatedEventTypes.some(
      (eventType, index) =>
        eventType !== expectedVisibleRevalidatedGc15Types[index],
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
    lifecycle.originalApprovals !== gc15InitialApprovalBindings.length ||
    lifecycle.freshApprovals !== gc15FreshApprovalBindings.length ||
    lifecycle.freshPlanSatisfied !== gc15FreshApprovalProof ||
    JSON.stringify(lifecycle.freshActorIds) !==
      JSON.stringify(gc15FreshApprovalBindings.map(({ actorId }) => actorId)) ||
    JSON.stringify(lifecycle.freshRoleIds) !==
      JSON.stringify(gc15FreshApprovalBindings.map(({ roleId }) => roleId)) ||
    lifecycle.initialReservationVisible ||
    lifecycle.initialExecutionReached ||
    lifecycle.initialVerificationReached ||
    lifecycle.revalidatedReservationVisible !== gc15ExecutionProof ||
    lifecycle.revalidatedExecutionReached !== gc15ExecutionProof ||
    lifecycle.revalidatedVerificationReached !== gc15ExecutionProof ||
    (gc15ExecutionProof
      ? lifecycle.revalidatedExecutionStatuses.join(",") !== "submitted" ||
        !lifecycle.revalidatedVerificationProves.includes(
          "Submission accepted by the capability",
        )
      : lifecycle.revalidatedExecutionStatuses.length > 0 ||
        lifecycle.revalidatedVerificationProves.length > 0) ||
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
    lifecycle.revalidatedRecordExecutionReached !== gc15ExecutionProof ||
    lifecycle.revalidatedRecordVerificationReached !== gc15ExecutionProof ||
    lifecycle.revalidatedRecordEligibilityVisible !== gc15ExecutionProof ||
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
      "GC-15 visible lifecycle must preserve phase-selected evidence, decision bindings, invalidation, and structured authority-gated downstream reach in signed order",
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
  const gc13ExecutionProof = gc13
    ? rawExecutionEligibilityProof(gc13, "initial")
    : false;
  const gc13FixtureComplete =
    gc13Explanation.includes("instruction-created") &&
    gc13Explanation.includes("disbursement-scheduled") &&
    gc13LedgerTypes.includes("ExceptionDecisionRequested") &&
    gc13Verification?.observedStatus === "unknown";
  const gc13VisibleComplete =
    demo.partialReceipt.completedParts.join(",") === "instruction-created" &&
    demo.partialReceipt.incompleteParts.join(",") ===
      "disbursement-scheduled" &&
    demo.partialReceipt.observedStatuses.join(",") === "completed,unknown" &&
    !demo.partialReceipt.statusLabels.some((label) =>
      label.toLowerCase().includes("settled"),
    ) &&
    demo.partialReceipt.proves.includes(
      "Completed part: instruction-created",
    ) &&
    demo.partialReceipt.notProvenYet.includes(
      "Incomplete part: disbursement-scheduled",
    ) &&
    exceptionDecision?.eventType === "ExceptionDecisionRequested" &&
    exceptionDecision.reason === "partial-execution" &&
    exceptionDecision.triggeringLedgerEvent ===
      "ExecutionPartiallySucceeded" &&
    isNonEmptyString(exceptionDecision.priorDecisionId) &&
    recordExceptionDecision?.eventType ===
      "ExceptionDecisionRequested" &&
    recordExceptionDecision.reason === "partial-execution" &&
    recordExceptionDecision.triggeringLedgerEvent ===
      "ExecutionPartiallySucceeded" &&
    recordExceptionDecision.priorDecisionId ===
      exceptionDecision.priorDecisionId;
  const gc13Withheld =
    demo.partialReceipt.completedParts.length === 0 &&
    demo.partialReceipt.incompleteParts.length === 0 &&
    demo.partialReceipt.observedStatuses.length === 0 &&
    demo.partialReceipt.statusLabels.length === 0 &&
    demo.partialReceipt.proves.length === 0 &&
    demo.partialReceipt.notProvenYet.length === 0 &&
    exceptionDecision === null &&
    recordExceptionDecision === null;
  if (
    !gc13FixtureComplete ||
    (gc13ExecutionProof ? !gc13VisibleComplete : !gc13Withheld)
  ) {
    problems.push(
      "GC-13 must retain the signed partial outcome but expose it only after structured signed execution authority is complete",
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
