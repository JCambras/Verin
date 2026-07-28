import { appError } from "@contracts/errors";
import type {
  EvidenceSnapshotRef,
  DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";

const SAFE_CODE = /^[a-z0-9]+(?:[.:/_-][a-z0-9]+)*$/;

function refuse(): never {
  throw appError(
    "PII_VIOLATION",
    "immutable decision source contains unclassified retained text",
  );
}

function requireCode(value: string): void {
  if (
    !SAFE_CODE.test(value) ||
    !/[a-z]/.test(value) ||
    /\d{8,}/.test(value)
  ) {
    refuse();
  }
}

function requireExplanationCodes(
  nodes: DecisionRecord["explanationTrace"],
): void {
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.messageTemplate !== node.code) refuse();
    pending.push(...node.childNodes);
  }
}

function requireDecisionTextProjection(record: DecisionRecord): void {
  requireExplanationCodes(record.explanationTrace);
  if (record.result.kind === "proceed") {
    const recommendation = record.result.recommendation;
    if (recommendation.summary !== recommendation.code) refuse();
    for (const alternative of recommendation.alternatives) {
      if (alternative.summary !== alternative.code) refuse();
    }
    for (const parameter of Object.values(recommendation.parameters)) {
      if (typeof parameter === "string") requireCode(parameter);
    }
  } else if (record.result.kind === "blocked") {
    for (const blocker of record.result.blockers) {
      if (blocker.explanation !== blocker.code) refuse();
    }
  } else if (
    record.result.prohibition.explanation !==
    record.result.prohibition.reasonCode
  ) {
    refuse();
  }
}

export function assertReplaySourcePiiBoundary(
  kind: "evidence" | "bundle" | "decision",
  value: EvidenceSnapshotRef | DecisionInputBundle | DecisionRecord,
): void {
  if (kind === "evidence") {
    const snapshot = value as EvidenceSnapshotRef;
    if (snapshot.attribution !== snapshot.sourceRef.id) refuse();
  } else if (kind === "decision") {
    requireDecisionTextProjection(value as DecisionRecord);
  }
}

export function assertLedgerEventPiiBoundary(event: LedgerEntry): void {
  if (event.type === "ApprovalRecorded" && event.structuredReason !== undefined) {
    requireCode(event.structuredReason);
  }
  if ("sourceStatus" in event && event.sourceStatus !== undefined) {
    requireCode(event.sourceStatus);
  }
}
