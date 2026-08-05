/**
 * Deterministic, event-derived decision state. This projector does not evaluate
 * policy, quorum, eligibility, or execution readiness. It only records facts that
 * the immutable ledger already states, in sequence order.
 */
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { promotedDecisionId } from "@contracts/decision-core/ledger-references";
import {
  applyApprovalStageEscalation,
  initialApprovalStageAuthority,
} from "./approval-authority";

export interface ApprovalActivity {
  readonly entryId: string;
  readonly outcome: "approved" | "rejected" | "overridden";
}

export interface ProjectedApprovalStage {
  readonly stageId: string;
  readonly status: "pending" | "invalidated" | "expired" | "escalated";
  readonly expiresAt: string;
  readonly escalationStepIndex: number | null;
  readonly escalationMode: "add" | "replace" | null;
  readonly eligibleRoleIds: readonly string[];
  readonly activity: readonly ApprovalActivity[];
}

export interface ProjectedExecutionStep {
  readonly stepId: string;
  readonly status:
    | "started"
    | "succeeded"
    | "partially_succeeded"
    | "failed"
    | "observed";
  readonly sourceStatus: string | null;
  readonly executionHandleId: string | null;
}

export interface DecisionProjection {
  readonly decisionId: string;
  readonly decisionHash: string;
  readonly disposition: DecisionRecord["result"]["kind"];
  readonly approvalMode:
    | "automatic"
    | "approval"
    | "specialist_review"
    | "none";
  readonly approvalStages: readonly ProjectedApprovalStage[];
  readonly reservations: readonly {
    reservationId: string;
    creationEntryId: string;
    status: "active" | "released";
  }[];
  readonly executionSteps: readonly ProjectedExecutionStep[];
  readonly verification: readonly {
    ruleId: string | null;
    status: "closed" | "stuck";
    observedStatus: string;
  }[];
  readonly exceptionRequested: boolean;
  readonly lastEventType: LedgerEntry["type"];
  readonly lastSequence: number;
}

export interface ProjectionFoldInput {
  readonly current?: DecisionProjection;
  readonly event: LedgerEntry;
  readonly sequence: number;
  readonly decisionRecord?: DecisionRecord;
}

function initialize(
  event: Extract<LedgerEntry, { type: "DecisionRecorded" }>,
  record: DecisionRecord,
  sequence: number,
): DecisionProjection {
  const authority = record.result.kind === "proceed"
    ? record.result.authority
    : undefined;
  return {
    decisionId: record.id,
    decisionHash: event.decisionHash,
    disposition: record.result.kind,
    approvalMode: authority?.mode ?? "none",
    approvalStages: authority && authority.mode !== "automatic"
      ? authority.stages.map((stage) => {
          const effective = initialApprovalStageAuthority(stage);
          return {
            stageId: stage.stageId,
            status: "pending" as const,
            expiresAt: effective.expiresAt,
            escalationStepIndex: null,
            escalationMode: null,
            eligibleRoleIds: effective.eligibleRoleIds,
            activity: [],
          };
        })
      : [],
    reservations: [],
    executionSteps: [],
    verification: [],
    exceptionRequested: false,
    lastEventType: event.type,
    lastSequence: sequence,
  };
}

function updateStage(
  state: DecisionProjection,
  stageId: string,
  update: (stage: ProjectedApprovalStage) => ProjectedApprovalStage,
): DecisionProjection {
  return {
    ...state,
    approvalStages: state.approvalStages.map((stage) =>
      stage.stageId === stageId ? update(stage) : stage),
  };
}

function upsertExecution(
  state: DecisionProjection,
  next: ProjectedExecutionStep,
): DecisionProjection {
  const prior = state.executionSteps.find((step) => step.stepId === next.stepId);
  const merged = {
    ...next,
    executionHandleId:
      next.executionHandleId ?? prior?.executionHandleId ?? null,
  };
  const without = state.executionSteps.filter((step) =>
    step.stepId !== merged.stepId &&
    !(
      merged.executionHandleId !== null &&
      step.executionHandleId === merged.executionHandleId &&
      step.stepId.startsWith("observed:")
    ));
  return { ...state, executionSteps: [...without, merged] };
}

/**
 * Fold one event. Events that are not decision-scoped return undefined and cannot
 * invent a projection. Every successful fold stamps the ledger sequence supplied
 * by storage, never event timestamps.
 */
export function foldDecisionProjection(
  input: ProjectionFoldInput,
): DecisionProjection | undefined {
  const { event, sequence } = input;
  if (event.type === "DecisionRecorded") {
    if (!input.decisionRecord) return undefined;
    return initialize(event, input.decisionRecord, sequence);
  }
  if (
    !input.current ||
    promotedDecisionId(event) !== input.current.decisionId
  ) {
    return input.current;
  }
  let state = input.current;
  switch (event.type) {
    case "ApprovalRecorded":
      state = updateStage(state, event.stageId, (stage) => ({
        ...stage,
        activity: [...stage.activity, { entryId: event.id, outcome: event.outcome }],
      }));
      break;
    case "ApprovalInvalidated":
      state = {
        ...state,
        approvalStages: state.approvalStages.map((stage) => ({
          ...stage,
          status: "invalidated",
        })),
      };
      break;
    case "ApprovalStageExpired":
      state = updateStage(state, event.stageId, (stage) => ({
        ...stage,
        status: "expired",
      }));
      break;
    case "ApprovalStageEscalated":
      state = updateStage(state, event.stageId, (stage) => {
        const effective = applyApprovalStageEscalation(stage, event);
        return {
          ...stage,
          status: "escalated",
          expiresAt: effective.expiresAt,
          escalationStepIndex: event.escalationStepIndex,
          escalationMode: event.mode,
          eligibleRoleIds: effective.eligibleRoleIds,
        };
      });
      break;
    case "ReservationCreated":
      state = {
        ...state,
        reservations: [
          ...state.reservations,
          {
            reservationId: event.reservationRef.id,
            creationEntryId: event.id,
            status: "active",
          },
        ],
      };
      break;
    case "ReservationReleased":
      state = {
        ...state,
        reservations: state.reservations.map((row) =>
          row.reservationId === event.reservationRef.id &&
          row.creationEntryId === event.reservationCreationRef.id
            ? { ...row, status: "released" }
            : row),
      };
      break;
    case "ExecutionStarted":
      state = upsertExecution(state, {
        stepId: event.stepId,
        status: "started",
        sourceStatus: null,
        executionHandleId: null,
      });
      break;
    case "ExecutionSucceeded":
      state = upsertExecution(state, {
        stepId: event.stepId,
        status: "succeeded",
        sourceStatus: event.sourceStatus,
        executionHandleId: event.executionHandleRef.id,
      });
      break;
    case "ExecutionPartiallySucceeded":
      state = upsertExecution(state, {
        stepId: event.stepId,
        status: "partially_succeeded",
        sourceStatus: event.sourceStatus,
        executionHandleId: event.executionHandleRef?.id ?? null,
      });
      break;
    case "ExecutionFailed":
      state = upsertExecution(state, {
        stepId: event.stepId,
        status: "failed",
        sourceStatus: event.sourceStatus ?? null,
        executionHandleId: null,
      });
      break;
    case "StatusObserved": {
      const prior = state.executionSteps.find(
        (step) => step.executionHandleId === event.executionHandleRef.id,
      );
      state = upsertExecution(state, {
        stepId: prior?.stepId ?? `observed:${event.executionHandleRef.id}`,
        status: "observed",
        sourceStatus: event.sourceStatus,
        executionHandleId: event.executionHandleRef.id,
      });
      break;
    }
    case "VerificationClosed":
      state = {
        ...state,
        verification: [...state.verification, {
          ruleId: event.verificationRuleRef.id,
          status: "closed",
          observedStatus: event.provenState,
        }],
      };
      break;
    case "VerificationStuck":
      state = {
        ...state,
        verification: [...state.verification, {
          ruleId: null,
          status: "stuck",
          observedStatus: event.lastObservedStatus,
        }],
      };
      break;
    case "ExceptionDecisionRequested":
      state = { ...state, exceptionRequested: true };
      break;
    case "EvidenceSnapshotRecorded":
      break;
  }
  return { ...state, lastEventType: event.type, lastSequence: sequence };
}
