import type { RecordVM } from "./record-model";
import { executionReachFor } from "./execution-reach";
import {
  formatDemoInstant,
  timelineFor,
  type DemoTimeline,
} from "./timeline";
import {
  hasSignedInvalidationAuthority,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import type { SignedCaseVariant } from "./signed-case-types";

function approvalInstantsFor(
  sourceCase: SignedCaseVariant,
  timeline: DemoTimeline,
  pass: JourneyPass,
): readonly string[] {
  const ordinary = pass === "revalidated"
    ? [timeline.freshApprovalOneAt, timeline.freshApprovalTwoAt]
    : [timeline.approvalOneAt, timeline.approvalTwoAt];
  let ordinaryIndex = 0;
  return [...sourceCase.authority.stages]
    .sort((left, right) => left.order - right.order)
    .flatMap((stage) =>
      Array.from({ length: stage.approvalsRequired }, () => {
        if (stage.stageId === "bank-change-specialist-review") {
          if (stage.approvalsRequired !== 1) {
            throw new TypeError("Specialist approval chronology requires one approval.");
          }
          return timeline.specialistReviewedAt;
        }
        const instant = ordinary[ordinaryIndex];
        ordinaryIndex += 1;
        if (!instant) {
          throw new TypeError("Approval chronology exceeds the demo timeline contract.");
        }
        return instant;
      }),
    );
}

function withoutDownstreamExecution(
  lifecycle: RecordVM["lifecycle"],
): RecordVM["lifecycle"] {
  return lifecycle.filter(
    ({ type }) =>
      type !== "ReservationCreated" &&
      type !== "ExecutionStarted" &&
      type !== "ExecutionSucceeded" &&
      type !== "ExecutionPartiallySucceeded" &&
      type !== "StatusObserved" &&
      type !== "ExceptionDecisionRequested",
  );
}

export function signedLifecycle(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): RecordVM["lifecycle"] {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  if (!sourceCase) return [];
  const timeline = timelineFor(scenario, firm);
  if (hasSignedInvalidationAuthority(scenario, firm.id)) {
    const instants = [
      timeline.initialEvidenceSnapshotAt,
      timeline.decisionAt,
      timeline.approvalOneAt,
      timeline.approvalTwoAt,
      timeline.revalidatedAt,
      timeline.approvalInvalidatedAt,
      timeline.derivedDecisionAt,
      timeline.freshApprovalOneAt,
      timeline.freshApprovalTwoAt,
      timeline.reservationAt,
      timeline.executionAt,
      timeline.executionSucceededAt,
      timeline.statusObservedAt,
    ];
    const lifecycle = sourceCase.ledgerEvents.map((event, index) => ({
      type: event.type,
      timestampIso: instants[index]!,
      display: formatDemoInstant(instants[index]!, undefined, true),
      note: event.note,
    }));
    if (pass === "revalidated") {
      return executionReachFor(scenario, firm, pass).reached
        ? lifecycle
        : withoutDownstreamExecution(lifecycle);
    }
    const invalidatedAt = lifecycle.findIndex(
      (event) => event.type === "ApprovalInvalidated",
    );
    return invalidatedAt < 0
      ? lifecycle
      : lifecycle.slice(0, invalidatedAt + 1);
  }
  const approvalInstants = approvalInstantsFor(sourceCase, timeline, pass);
  let evidenceIndex = 0;
  let approvalIndex = 0;
  let statusIndex = 0;
  const instantFor = (type: string): string => {
    if (type === "EvidenceSnapshotRecorded") {
      const instant =
        evidenceIndex === 0
          ? timeline.initialEvidenceSnapshotAt
          : timeline.revalidatedAt;
      evidenceIndex += 1;
      return instant;
    }
    if (type === "DecisionRecorded") return timeline.decisionAt;
    if (type === "ApprovalRecorded") {
      const instant = approvalInstants[approvalIndex];
      approvalIndex += 1;
      if (!instant) {
        throw new TypeError("Signed approval event exceeds the authority plan.");
      }
      return instant;
    }
    if (type === "ApprovalStageEscalated") return timeline.escalatedAt;
    if (type === "ApprovalStageExpired") return timeline.expiredAt;
    if (type === "ReservationCreated") return timeline.reservationAt;
    if (type === "ExecutionStarted") return timeline.executionAt;
    if (
      type === "ExecutionSucceeded" ||
      type === "ExecutionPartiallySucceeded"
    ) {
      return timeline.executionSucceededAt;
    }
    if (type === "StatusObserved") {
      const instant =
        sourceCase.verification.observedStatus === "unknown" ||
        statusIndex > 0
          ? timeline.delayedExceptionAt
          : timeline.statusObservedAt;
      statusIndex += 1;
      return instant;
    }
    if (type === "ExceptionDecisionRequested") {
      return timeline.exceptionDecisionRequestedAt;
    }
    return timeline.decisionAt;
  };
  const lifecycle = sourceCase.ledgerEvents.map((event) => {
    const timestampIso = instantFor(event.type);
    return {
      type: event.type,
      timestampIso,
      display: formatDemoInstant(timestampIso, undefined, true),
      note: event.note,
    };
  });
  return executionReachFor(scenario, firm, pass).reached
    ? lifecycle
    : withoutDownstreamExecution(lifecycle);
}
