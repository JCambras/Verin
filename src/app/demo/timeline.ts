import {
  DEMO_TIME_ZONE,
  liquidityAuthorityFor,
  type FirmData,
  type ScenarioData,
} from "./data";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const DEFAULT_REQUEST_AT = "2026-07-26T13:30:00.000Z";

const add = (instant: string, milliseconds: number): string =>
  new Date(new Date(instant).getTime() + milliseconds).toISOString();

export interface DemoTimeline {
  readonly requestAt: string;
  readonly decisionAt: string;
  readonly specialistReviewedAt: string;
  readonly approvalOneAt: string;
  readonly approvalTwoAt: string;
  readonly revalidatedAt: string;
  readonly executionAt: string;
  readonly retryAt: string;
  readonly completionVerifiedAt: string;
  readonly nextPollAt: string;
  readonly delayedExceptionAt: string;
  readonly escalatedAt: string;
  readonly expiredAt: string;
}

export function timelineFor(scenario: ScenarioData, firm: FirmData): DemoTimeline {
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const requestAt = authority.kind === "signed" ? authority.requestAt : DEFAULT_REQUEST_AT;
  const specialist =
    scenario.spec.bankChanged && firm.bankChangeHandling === "specialist-review";
  const invalidation = scenario.spec.invalidation && authority.kind === "signed";
  const approvalOneOffset = invalidation
    ? 6 * MINUTE
    : specialist
      ? 32 * MINUTE
      : 12 * MINUTE;
  const approvalTwoOffset = invalidation
    ? 9 * MINUTE
    : specialist
      ? 47 * MINUTE
      : 21 * MINUTE;
  const revalidationOffset = specialist ? 50 * MINUTE : 25 * MINUTE;
  const executionOffset = specialist ? 54 * MINUTE : 29 * MINUTE;
  const executionAt = add(requestAt, executionOffset);
  return {
    requestAt,
    decisionAt: add(requestAt, 10 * SECOND),
    specialistReviewedAt: add(requestAt, 15 * MINUTE),
    approvalOneAt: add(requestAt, approvalOneOffset),
    approvalTwoAt: add(requestAt, approvalTwoOffset),
    revalidatedAt:
      authority.kind === "signed" &&
      authority.preExecutionRevalidationAt
        ? authority.preExecutionRevalidationAt
        : add(requestAt, revalidationOffset),
    executionAt,
    retryAt: add(executionAt, MINUTE),
    completionVerifiedAt: add(executionAt, 98 * MINUTE),
    nextPollAt: add(executionAt, 12 * 60 * MINUTE),
    delayedExceptionAt: add(executionAt, 2 * DAY),
    escalatedAt: add(requestAt, DAY),
    expiredAt: add(requestAt, 2 * DAY),
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
