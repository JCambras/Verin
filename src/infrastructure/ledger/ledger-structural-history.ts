import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { promotedDecisionRef } from "@contracts/decision-core/ledger-references";
import { appError } from "@contracts/errors";
import {
  effectiveApprovalStageAuthority,
  type ApprovalEscalationEvent,
  type EffectiveApprovalStageAuthority,
} from "@domain/ledger/approval-authority";
import type {
  LedgerStructureLookup,
  StructuralLedgerEntry,
} from "./ledger-structural-validator";

function approvalStage(record: DecisionRecord, stageId: string) {
  return record.result.kind === "proceed" &&
    record.result.authority.mode !== "automatic"
    ? record.result.authority.stages.find((stage) => stage.stageId === stageId)
    : undefined;
}

function isApprovalAuthorityEvent(
  event: LedgerEntry,
): event is Extract<
  LedgerEntry,
  {
    type:
      | "ApprovalRecorded"
      | "ApprovalStageExpired"
      | "ApprovalStageEscalated";
  }
> {
  return event.type === "ApprovalRecorded" ||
    event.type === "ApprovalStageExpired" ||
    event.type === "ApprovalStageEscalated";
}

export async function effectiveApprovalAuthority(
  event: LedgerEntry,
  record: DecisionRecord,
  sequence: number,
  lookup: LedgerStructureLookup,
): Promise<EffectiveApprovalStageAuthority | undefined> {
  if (!isApprovalAuthorityEvent(event)) return undefined;
  const stage = approvalStage(record, event.stageId);
  if (!stage) return undefined;
  const prior = await lookup.approvalEscalations(
    record.id,
    event.stageId,
    sequence,
    stage.escalationPath.length + 1,
  );
  const escalations: ApprovalEscalationEvent[] = [];
  const usedSteps = new Set<number>();
  for (const item of prior) {
    if (item.event.type !== "ApprovalStageEscalated") continue;
    if (usedSteps.has(item.event.escalationStepIndex)) {
      throw appError("STORE_CONSTRAINT", "approval escalation step is already recorded");
    }
    usedSteps.add(item.event.escalationStepIndex);
    escalations.push(item.event);
  }
  if (prior.length > stage.escalationPath.length) {
    throw appError("STORE_CONSTRAINT", "approval escalation exceeds its recorded path");
  }
  if (
    event.type === "ApprovalStageEscalated" &&
    usedSteps.has(event.escalationStepIndex)
  ) {
    throw appError("STORE_CONSTRAINT", "approval escalation step is already recorded");
  }
  return effectiveApprovalStageAuthority(stage, escalations);
}

export function structuralExecutionHandleId(event: LedgerEntry): string | null {
  return event.type === "ExecutionSucceeded" ||
      event.type === "ExecutionPartiallySucceeded" ||
      event.type === "StatusObserved" ||
      event.type === "VerificationStuck"
    ? event.executionHandleRef?.id ?? null
    : null;
}

function executionStepId(event: LedgerEntry): string | null {
  return event.type === "ExecutionSucceeded" ||
      event.type === "ExecutionPartiallySucceeded"
    ? event.stepId
    : null;
}

export function executionHandleOwnerEntries(
  entries: readonly StructuralLedgerEntry[],
  beforeSequence = Number.POSITIVE_INFINITY,
): StructuralLedgerEntry[] {
  const ordered = entries
    .filter((item) => item.sequence < beforeSequence)
    .sort((left, right) => left.sequence - right.sequence);
  const owners = [ordered[0], ordered.find((item) =>
    executionStepId(item.event) !== null)].filter(
      (item): item is StructuralLedgerEntry => item !== undefined,
    );
  return [...new Map(owners.map((item) => [item.event.id, item])).values()];
}

export async function assertExecutionHandleOwnership(
  event: LedgerEntry,
  sequence: number,
  lookup: LedgerStructureLookup,
): Promise<void> {
  const handleId = structuralExecutionHandleId(event);
  if (!handleId) return;
  const currentDecisionId = promotedDecisionRef(event)?.id ?? null;
  const currentStepId = executionStepId(event);
  const prior = await lookup.executionHandleEvents(handleId, sequence);
  for (const item of prior) {
    if ((promotedDecisionRef(item.event)?.id ?? null) !== currentDecisionId) {
      throw appError(
        "STORE_CONSTRAINT",
        "execution handle is already assigned to another decision",
      );
    }
    const priorStepId = executionStepId(item.event);
    if (
      currentStepId !== null &&
      priorStepId !== null &&
      currentStepId !== priorStepId
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        "execution handle is already assigned to another execution step",
      );
    }
  }
}

export function mergePriorEntries(
  stored: readonly StructuralLedgerEntry[],
  seen: readonly StructuralLedgerEntry[],
  beforeSequence: number,
): StructuralLedgerEntry[] {
  const merged = new Map<string, StructuralLedgerEntry>();
  for (const item of [...stored, ...seen]) {
    if (item.sequence < beforeSequence) merged.set(item.event.id, item);
  }
  return [...merged.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

export const approvalStageKey = (decisionId: string, stageId: string): string =>
  JSON.stringify([decisionId, stageId]);
