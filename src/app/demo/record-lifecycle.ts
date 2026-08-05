import type { RecordLifecycleEvent } from "./record-model";
import { executionReachFor } from "./execution-reach";
import { approvalBindingProof } from "./execution-preconditions";
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

export interface SignedLifecycleProjection {
  readonly occurred: readonly RecordLifecycleEvent[];
  readonly expected: readonly RecordLifecycleEvent[];
}

function postAuthorityBoundary(
  lifecycle: readonly RecordLifecycleEvent[],
): number {
  let evidenceSeen = false;
  for (const [index, event] of lifecycle.entries()) {
    if (event.type !== "EvidenceSnapshotRecorded") continue;
    if (evidenceSeen) return index;
    evidenceSeen = true;
  }
  const downstream = lifecycle.findIndex(
    ({ type }) =>
      type === "ReservationCreated" || type === "ExecutionStarted",
  );
  return downstream < 0 ? lifecycle.length : downstream;
}

function splitAtExpectedBoundary(
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
  lifecycle: readonly RecordLifecycleEvent[],
  reached: boolean,
  authorityReached: boolean,
): SignedLifecycleProjection {
  if (reached) return { occurred: lifecycle, expected: [] };
  if (sourceCase.executionEligibility.eligible !== true) {
    return { occurred: lifecycle, expected: [] };
  }
  if (authorityReached) {
    const boundary = postAuthorityBoundary(lifecycle);
    return {
      occurred: lifecycle.slice(0, boundary),
      expected: lifecycle.slice(boundary),
    };
  }
  const boundary = lifecycle.findIndex(({ type }) => type === "ApprovalRecorded");
  const expectedAt = boundary < 0
    ? postAuthorityBoundary(lifecycle)
    : boundary;
  return {
    occurred: lifecycle.slice(0, expectedAt),
    expected: lifecycle.slice(expectedAt),
  };
}

export function signedLifecycleProjection(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): SignedLifecycleProjection {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  if (!sourceCase) return { occurred: [], expected: [] };
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
    const invalidatedAt = lifecycle.findIndex(
      (event) => event.type === "ApprovalInvalidated",
    );
    const selected = pass === "revalidated" || invalidatedAt < 0
      ? lifecycle
      : lifecycle.slice(0, invalidatedAt + 1);
    return splitAtExpectedBoundary(
      sourceCase,
      pass,
      selected,
      executionReachFor(scenario, firm, pass).reached,
      approvalBindingProof(scenario, firm, sourceCase, pass),
    );
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
  return splitAtExpectedBoundary(
    sourceCase,
    pass,
    lifecycle,
    executionReachFor(scenario, firm, pass).reached,
    approvalBindingProof(scenario, firm, sourceCase, pass),
  );
}
