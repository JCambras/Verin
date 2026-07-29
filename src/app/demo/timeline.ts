import {
  CANONICAL_REQUEST,
  DEMO_TIME_ZONE,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  sourceCaseFor,
  type FirmData,
  type ScenarioData,
} from "./data";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

const add = (instant: string, milliseconds: number): string =>
  new Date(new Date(instant).getTime() + milliseconds).toISOString();

export interface DemoTimeline {
  readonly requestAt: string;
  readonly sourceRequestAt: string;
  readonly initialEvidenceSnapshotAt: string;
  readonly decisionAt: string;
  readonly specialistReviewedAt: string;
  readonly approvalOneAt: string;
  readonly approvalTwoAt: string;
  readonly revalidatedAt: string;
  readonly approvalInvalidatedAt: string;
  readonly derivedDecisionAt: string;
  readonly freshApprovalOneAt: string;
  readonly freshApprovalTwoAt: string;
  readonly reservationAt: string;
  readonly executionAt: string;
  readonly executionSucceededAt: string;
  readonly statusObservedAt: string;
  readonly retryAt: string;
  readonly completionVerifiedAt: string;
  readonly nextPollAt: string | null;
  readonly exceptionDecisionRequestedAt: string;
  readonly delayedExceptionAt: string;
  readonly escalatedAt: string;
  readonly expiredAt: string;
}

export function timelineFor(scenario: ScenarioData, firm: FirmData): DemoTimeline {
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const sourceRequestAt =
    sourceCase?.trigger.requestAt ??
    (authority.kind === "signed"
      ? authority.requestAt
      : CANONICAL_REQUEST.requestedAt);
  const requestAt = CANONICAL_REQUEST.requestedAt;
  const latestInitialEvidenceAt = sourceCase?.evidence
    .filter(
      (entry) => entry.liquidityPhase !== "pre-execution-revalidation",
    )
    .map((entry) => entry.retrievedAt)
    .sort()
    .at(-1);
  const initialEvidenceSnapshotAt = new Date(
    Math.max(
      new Date(sourceRequestAt).getTime(),
      latestInitialEvidenceAt
        ? new Date(latestInitialEvidenceAt).getTime()
        : Number.NEGATIVE_INFINITY,
    ),
  ).toISOString();
  const decisionAt = new Date(
    Math.max(
      new Date(add(sourceRequestAt, 10 * SECOND)).getTime(),
      new Date(initialEvidenceSnapshotAt).getTime() + SECOND,
    ),
  ).toISOString();
  const specialist =
    sourceCase?.authority.stages.some(
      (stage) => stage.stageId === "bank-change-specialist-review",
    ) ?? false;
  const invalidation = hasSignedInvalidationAuthority(scenario, firm.id);
  const competing =
    authority.kind === "signed" &&
    (authority.relatedDecisions?.length ?? 0) > 0;
  const verificationStatus =
    sourceCase?.verification.reached === true
      ? sourceCase.verification.observedStatus
      : null;
  const approvalOneOffset = invalidation
    ? 6 * MINUTE
    : specialist
      ? 32 * MINUTE
      : competing
        ? 12 * SECOND
        : 12 * MINUTE;
  const approvalTwoOffset = invalidation
    ? 9 * MINUTE
    : specialist
      ? 47 * MINUTE
      : competing
        ? 18 * SECOND
        : 21 * MINUTE;
  const revalidationOffset = specialist
    ? 50 * MINUTE
    : competing
      ? 20 * SECOND
      : 25 * MINUTE;
  const executionOffset = specialist ? 54 * MINUTE : 29 * MINUTE;
  const executionAt = add(sourceRequestAt, executionOffset);
  const approvalOneAt = add(sourceRequestAt, approvalOneOffset);
  const approvalTwoAt = add(sourceRequestAt, approvalTwoOffset);
  const revalidatedAt =
    authority.kind === "signed" &&
    authority.preExecutionRevalidationAt
      ? authority.preExecutionRevalidationAt
      : add(sourceRequestAt, revalidationOffset);
  const freshApprovalOneAt = add(revalidatedAt, 6 * MINUTE);
  const freshApprovalTwoAt = add(revalidatedAt, 9 * MINUTE);
  const finalApprovalAt = invalidation ? freshApprovalTwoAt : approvalTwoAt;
  const reservationBasis = Math.max(
    new Date(revalidatedAt).getTime(),
    new Date(finalApprovalAt).getTime(),
  );
  const reservationAt = new Date(
    reservationBasis + (competing ? 5 * SECOND : MINUTE),
  ).toISOString();
  const delayedExceptionAt = add(executionAt, 2 * DAY);
  const latestObservationAt =
    verificationStatus === "unknown" || verificationStatus === "nigo"
      ? delayedExceptionAt
      : add(executionAt, 20 * SECOND);
  return {
    requestAt,
    sourceRequestAt,
    initialEvidenceSnapshotAt,
    decisionAt,
    specialistReviewedAt: add(sourceRequestAt, 15 * MINUTE),
    approvalOneAt,
    approvalTwoAt,
    revalidatedAt,
    approvalInvalidatedAt: add(revalidatedAt, SECOND),
    derivedDecisionAt: add(revalidatedAt, 10 * SECOND),
    freshApprovalOneAt,
    freshApprovalTwoAt,
    reservationAt,
    executionAt,
    executionSucceededAt: add(executionAt, 10 * SECOND),
    statusObservedAt: add(executionAt, 20 * SECOND),
    retryAt: add(executionAt, MINUTE),
    completionVerifiedAt: add(executionAt, 98 * MINUTE),
    nextPollAt: verificationStatus === "nigo"
      ? null
      : add(latestObservationAt, 12 * 60 * MINUTE),
    exceptionDecisionRequestedAt: add(
      verificationStatus === "unknown" || verificationStatus === "nigo"
        ? delayedExceptionAt
        : executionAt,
      SECOND,
    ),
    delayedExceptionAt,
    escalatedAt: add(sourceRequestAt, DAY),
    expiredAt: add(sourceRequestAt, 2 * DAY),
  };
}

export function relatedDecisionAt(requestAt: string): string {
  return add(requestAt, 10 * SECOND);
}

export function formatDemoInstant(
  instant: string,
  timeZone = DEMO_TIME_ZONE,
  includeSeconds = false,
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.month} ${Number(parts.day)}, ${parts.hour}:${parts.minute}${includeSeconds ? `:${parts.second}` : ""}`;
}
