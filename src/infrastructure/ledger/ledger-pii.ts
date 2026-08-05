import { appError } from "@contracts/errors";
import type {
  EvidenceSnapshotRef,
  DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import {
  looksLikePIIValue,
  sensitiveAccountReferences,
} from "@contracts/pii";
import { isMachineRecordId } from "@contracts/record-id";
import {
  isOpaqueLedgerIdentifier,
  isOpaqueLedgerToken,
} from "./ledger-string-rules";

const REGISTERED_RETAINED_CODES = new Set([
  "active-legal-hold",
  "additional-evidence-required",
  "approval-stage-expired",
  "approval-stage-idle",
  "approved-after-review",
  "cash-reserve-breach",
  "cash-reserve-preserved",
  "custodian-timeout",
  "decision-closed",
  "distribute-from-ira",
  "distribute-from-joint-taxable",
  "household-floor-narrows-reserve",
  "legal-hold-detected",
  "material-evidence-fresh-at-execution",
  "material-input-changed",
  "partial",
  "pending-review",
  "regulatory-precedence-applied",
  "reserve-policy-governs",
  "source-account-selected",
  "status-source-unavailable",
  "submitted",
  "taxable-event-source-rejected",
  "timeout",
  "verification-stuck",
]);
const RETAINED_TEXT_REFERENCE = /^retained-text:v1:[a-f0-9]{64}$/;
const VERSION_IDENTIFIER = /^\d{1,6}(\.\d{1,6}){0,3}(-[0-9a-z]+(\.[0-9a-z]+)*)?$/;
const VERSION_IDENTIFIER_MAX_LENGTH = 32;
const LEXICAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/;
const LEXICAL_IDENTIFIER_MAX_LENGTH = 160;
const ACCOUNT_IDENTIFIER_LABEL = /(?:account|acct|routing|iban|number)[.:@/+~-]*$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type StringClass =
  | "closed-token"
  | "hash"
  | "identifier"
  | "token"
  | "retained-reference"
  | "retained-token"
  | "timestamp"
  | "version";

const STRING_PATH_CLASSES = new Map<string, StringClass>();
const addPaths = (classification: StringClass, paths: readonly string[]) =>
  paths.forEach((path) => STRING_PATH_CLASSES.set(path, classification));
const addRefs = (paths: readonly string[]) =>
  paths.forEach((path) =>
    addPaths("identifier", [`${path}.firmId`, `${path}.id`]));

addPaths("identifier", [
  "evidence.firmId", "evidence.id", "bundle.firmId", "bundle.id",
  "decision.firmId", "decision.id",
  "decision.createdBy.firmId",
  "decision.createdBy.actorId", "decision.createdBy.systemId",
  "decision.result.authority.stages[].stageId",
  "decision.result.executionPlan.id",
  "decision.result.executionPlan.steps[].id",
  "decision.result.executionPlan.steps[].idempotencyKey",
  "decision.result.executionPlan.steps[].conflictKeys[]",
  "decision.result.executionPlan.steps[].dependsOn[]",
  "decision.result.executionPlan.steps[].compensatingAction.idempotencyKey",
  "decision.result.executionPlan.steps[].compensatingAction.conflictKeys[]",
]);
addPaths("token", [
  "evidence.kind", "evidence.schemaVersion", "evidence.freshness",
  "bundle.schemaVersion", "bundle.timeZone", "bundle.timeZoneDataVersion",
  "decision.result.authority.stages[].escalationPath[].after",
  "decision.result.executionPlan.steps[].command.commandType",
  "decision.result.executionPlan.steps[].compensatingAction.command.commandType",
  "decision.result.blockers[].resolvingEvidence[].evidenceKind",
  "decision.result.blockers[].resolvingEvidence[].suppliableBy[]",
  "decision.reevaluateWhen[].evidenceKind",
]);
addPaths("closed-token", [
  "decision.result.kind", "decision.result.authority.mode",
  "decision.result.authority.stages[].executionMode",
  "decision.result.prohibition.source.sourceType",
  "decision.precedenceTrace[].left.sourceType",
  "decision.precedenceTrace[].right.sourceType",
  "decision.precedenceTrace[].resolution",
  "decision.explanationTrace[].sourceRefs[].sourceType",
  "decision.reevaluateWhen[].kind",
  "decision.riskClass", "decision.reversibility",
]);
addPaths("retained-token", [
  "decision.result.recommendation.code",
  "decision.result.recommendation.summary",
  "decision.result.recommendation.parameters.*",
  "decision.result.recommendation.alternatives[].code",
  "decision.result.recommendation.alternatives[].summary",
  "decision.result.recommendation.alternatives[].rejectedBecause[]",
  "decision.result.authority.stages[].escalationPath[].reasonCode",
  "decision.result.executionPlan.steps[].preconditions[].code",
  "decision.result.executionPlan.steps[].compensatingAction.preconditions[].code",
  "decision.result.executionPlan.steps[].compensatingAction.reasonCode",
  "decision.result.blockers[].code", "decision.result.blockers[].explanation",
  "decision.result.prohibition.reasonCode",
  "decision.result.prohibition.explanation",
  "decision.precedenceTrace[].reasonCode",
  "decision.explanationTrace[].code",
  "decision.explanationTrace[].messageTemplate",
]);
addPaths("hash", [
  "evidence.contentHash", "bundle.bundleHash", "decision.decisionHash",
  "decision.result.executionPlan.steps[].command.payloadHash",
  "decision.result.executionPlan.steps[].compensatingAction.command.payloadHash",
]);
addPaths("timestamp", [
  "evidence.observedAt", "evidence.retrievedAt", "bundle.asOf",
  "decision.createdAt", "decision.result.authority.stages[].expiresAt",
  "decision.reevaluateWhen[].deadline",
]);
addPaths("version", [
  "bundle.canonicalSerializerVersion", "bundle.engineVersion",
  "bundle.primitiveSetVersion",
]);
addPaths("retained-reference", ["evidence.attribution"]);
addRefs([
  "evidence.sourceRef", "evidence.subjectRef", "evidence.encryptedStorageRef",
  "bundle.domainConfigVersionRef", "bundle.policyVersionRef",
  "bundle.householdInstructionVersionRefs[]", "bundle.regulatoryVersionRefs[]",
  "bundle.evidenceSnapshotRefs[]",
  "decision.intentRef", "decision.inputBundleRef", "decision.derivedFromDecisionRef",
  "decision.createdBy.roleIds[]",
  "decision.result.recommendation.parameters.*",
  "decision.result.authority.specialistRoleIds[]",
  "decision.result.authority.stages[].templateRef",
  "decision.result.authority.stages[].requirements[].eligibleRoleIds[]",
  "decision.result.authority.stages[].escalationPath[].roleIds[]",
  "decision.result.executionPlan.steps[].targetRef",
  "decision.result.executionPlan.steps[].command.payloadRef",
  "decision.result.executionPlan.steps[].reservationRefs[]",
  "decision.result.executionPlan.steps[].preconditions[].requiredEvidenceSnapshotRefs[]",
  "decision.result.executionPlan.steps[].verificationRuleRef",
  "decision.result.executionPlan.steps[].compensatingAction.targetRef",
  "decision.result.executionPlan.steps[].compensatingAction.command.payloadRef",
  "decision.result.executionPlan.steps[].compensatingAction.reservationRefs[]",
  "decision.result.executionPlan.steps[].compensatingAction.preconditions[].requiredEvidenceSnapshotRefs[]",
  "decision.result.executionPlan.steps[].compensatingAction.verificationRuleRef",
  "decision.result.blockers[].resolvingEvidence[].subjectRef",
  "decision.result.blockers[].resolvingEvidence[].suppliableBy[]",
  "decision.result.prohibition.scopeRef",
  "decision.result.prohibition.source.sourceRef",
  "decision.result.prohibition.source.versionRef",
  "decision.precedenceTrace[].left.sourceRef",
  "decision.precedenceTrace[].left.versionRef",
  "decision.precedenceTrace[].right.sourceRef",
  "decision.precedenceTrace[].right.versionRef",
  "decision.explanationTrace[].evidenceSnapshotRefs[]",
  "decision.explanationTrace[].sourceRefs[].sourceRef",
  "decision.explanationTrace[].sourceRefs[].versionRef",
  "decision.reevaluateWhen[].subjectRef",
]);

const LEDGER_EVENT_TYPES = [
  "DecisionRecorded", "EvidenceSnapshotRecorded", "ApprovalRecorded",
  "ApprovalInvalidated", "ApprovalStageExpired", "ApprovalStageEscalated",
  "ReservationCreated", "ReservationReleased", "ExecutionStarted",
  "ExecutionSucceeded", "ExecutionPartiallySucceeded", "ExecutionFailed",
  "StatusObserved", "VerificationClosed", "VerificationStuck",
  "ExceptionDecisionRequested",
] as const;
for (const type of LEDGER_EVENT_TYPES) {
  const root = `event:${type}`;
  addPaths("identifier", [
    `${root}.firmId`, `${root}.id`,
    `${root}.actor.actorId`, `${root}.actor.systemId`, `${root}.correlationId`,
  ]);
  addPaths("closed-token", [`${root}.type`]);
  addPaths("version", [`${root}.schemaVersion`, `${root}.serializerVersion`]);
  addPaths("timestamp", [`${root}.occurredAt`, `${root}.recordedAt`]);
  addRefs([`${root}.actor.roleIds[]`, `${root}.causationRef`]);
  addPaths("identifier", [`${root}.actor.firmId`]);
}
addPaths("identifier", [
  "event:ApprovalRecorded.stageId",
  "event:ApprovalRecorded.approver.firmId",
  "event:ApprovalRecorded.approver.actorId",
  "event:ApprovalStageExpired.stageId", "event:ApprovalStageEscalated.stageId",
  "event:ReservationCreated.conflictKeys[]",
  "event:ExecutionStarted.stepId", "event:ExecutionStarted.idempotencyKey",
  "event:ExecutionSucceeded.stepId", "event:ExecutionPartiallySucceeded.stepId",
  "event:ExecutionPartiallySucceeded.completedParts[]",
  "event:ExecutionPartiallySucceeded.incompleteParts[]",
  "event:ExecutionFailed.stepId",
]);
addPaths("closed-token", [
  "event:ApprovalRecorded.outcome", "event:ApprovalStageEscalated.mode",
  "event:StatusObserved.status",
  "event:VerificationClosed.provenState",
  "event:VerificationStuck.lastObservedStatus",
]);
addPaths("retained-token", [
  "event:ApprovalRecorded.reasonCode", "event:ApprovalRecorded.structuredReason",
  "event:ApprovalInvalidated.reasonCode", "event:ApprovalStageExpired.reasonCode",
  "event:ApprovalStageEscalated.reasonCode", "event:ReservationReleased.reasonCode",
  "event:ExecutionSucceeded.sourceStatus",
  "event:ExecutionPartiallySucceeded.sourceStatus",
  "event:ExecutionFailed.failureCode", "event:ExecutionFailed.sourceStatus",
  "event:StatusObserved.sourceStatus", "event:VerificationStuck.reasonCode",
  "event:ExceptionDecisionRequested.reasonCode",
]);
addPaths("hash", [
  "event:DecisionRecorded.decisionHash", "event:DecisionRecorded.bundleHash",
  "event:EvidenceSnapshotRecorded.contentHash",
  "event:EvidenceSnapshotRecorded.snapshotHash",
  "event:ApprovalRecorded.decisionHash", "event:ApprovalRecorded.inputBundleHash",
  "event:ApprovalInvalidated.priorDecisionHash",
  "event:ApprovalInvalidated.newInputBundleHash",
  "event:ApprovalStageExpired.priorDecisionHash",
  "event:ApprovalStageEscalated.priorDecisionHash",
]);
addPaths("timestamp", [
  "event:ApprovalStageExpired.effectiveAt",
  "event:ApprovalStageEscalated.newExpiresAt",
  "event:ApprovalStageEscalated.effectiveAt",
  "event:ReservationCreated.expiresAt",
]);
addRefs([
  "event:DecisionRecorded.decisionRef",
  "event:EvidenceSnapshotRecorded.evidenceSnapshotRef",
  "event:ApprovalRecorded.decisionRef", "event:ApprovalRecorded.approver",
  "event:ApprovalRecorded.approver.roleIds[]",
  "event:ApprovalInvalidated.decisionRef", "event:ApprovalStageExpired.decisionRef",
  "event:ApprovalStageEscalated.decisionRef",
  "event:ApprovalStageEscalated.roleIds[]",
  "event:ReservationCreated.reservationRef", "event:ReservationCreated.decisionRef",
  "event:ReservationReleased.reservationRef", "event:ReservationReleased.decisionRef",
  "event:ReservationReleased.reservationCreationRef",
  "event:ExecutionStarted.decisionRef", "event:ExecutionSucceeded.decisionRef",
  "event:ExecutionSucceeded.executionHandleRef",
  "event:ExecutionPartiallySucceeded.decisionRef",
  "event:ExecutionPartiallySucceeded.executionHandleRef",
  "event:ExecutionFailed.decisionRef", "event:StatusObserved.decisionRef",
  "event:StatusObserved.executionHandleRef",
  "event:StatusObserved.evidenceSnapshotRef",
  "event:VerificationClosed.decisionRef",
  "event:VerificationClosed.verificationRuleRef",
  "event:VerificationStuck.decisionRef",
  "event:VerificationStuck.executionHandleRef",
  "event:ExceptionDecisionRequested.priorDecisionRef",
  "event:ExceptionDecisionRequested.triggeringEntryRef",
]);

function refuse(): never {
  throw appError(
    "PII_VIOLATION",
    "immutable decision source contains unclassified retained text",
  );
}

export function retainedTextReference(opaqueId: string): string {
  const value = `retained-text:v1:${opaqueId}`;
  if (!RETAINED_TEXT_REFERENCE.test(value)) refuse();
  return value;
}

function requireRegisteredCode(value: string): void {
  if (!REGISTERED_RETAINED_CODES.has(value)) refuse();
}

export function isVersionIdentifier(value: string): boolean {
  return (
    value.length <= VERSION_IDENTIFIER_MAX_LENGTH &&
    VERSION_IDENTIFIER.test(value)
  );
}

function requireVersionIdentifier(value: string): void {
  if (!isVersionIdentifier(value)) refuse();
}

function requireLexicalShape(value: string): void {
  if (
    value.length > LEXICAL_IDENTIFIER_MAX_LENGTH ||
    !LEXICAL_IDENTIFIER.test(value)
  ) {
    refuse();
  }
}

function requireOpaqueIdentifier(path: string, value: string): void {
  requireLexicalShape(value);
  if (
    isMachineRecordId(value) ||
    (
      !looksLikePIIValue(value) &&
      !hasValidAccountReference(value) &&
      isOpaqueLedgerIdentifier(path, value)
    )
  ) {
    return;
  }
  refuse();
}

function requireOpaqueToken(path: string, value: string): void {
  requireLexicalShape(value);
  if (
    looksLikePIIValue(value) ||
    hasValidAccountReference(value) ||
    !isOpaqueLedgerToken(path, value)
  ) {
    refuse();
  }
}

function requireClosedToken(value: string): void {
  requireLexicalShape(value);
  if (looksLikePIIValue(value) || hasValidAccountReference(value)) {
    refuse();
  }
}

function hasValidAccountReference(value: string): boolean {
  return sensitiveAccountReferences(value).some((reference) =>
    reference.valid &&
    (
      reference.start === 0 && reference.end === value.length ||
      ACCOUNT_IDENTIFIER_LABEL.test(value.slice(0, reference.start))
    ));
}

function requireHash(value: string): void {
  if (!SHA256.test(value)) refuse();
}

function requireTimestamp(value: string): void {
  if (!TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) refuse();
}

function requireRetainedToken(value: string): void {
  if (
    !REGISTERED_RETAINED_CODES.has(value) &&
    !RETAINED_TEXT_REFERENCE.test(value)
  ) {
    refuse();
  }
}

function canonicalStringPath(path: string): string {
  return path.startsWith("decision.explanationTrace[]")
    ? path.replaceAll(".childNodes[]", "")
    : path;
}

export function unclassifiedRetainedStringPaths(
  paths: readonly string[],
): string[] {
  return paths.filter((path) =>
    !STRING_PATH_CLASSES.has(canonicalStringPath(path)));
}

function requireClassifiedStrings(root: string, value: unknown): void {
  const pending: Array<{ value: unknown; path: string }> = [{
    value,
    path: root,
  }];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (typeof current.value === "string") {
      const classification = STRING_PATH_CLASSES.get(
        canonicalStringPath(current.path),
      );
      if (classification === undefined) refuse();
      if (classification === "closed-token") {
        requireClosedToken(current.value);
      }
      if (classification === "hash") requireHash(current.value);
      if (classification === "identifier") {
        requireOpaqueIdentifier(current.path, current.value);
      }
      if (classification === "token") {
        requireOpaqueToken(current.path, current.value);
      }
      if (classification === "retained-reference" &&
          !RETAINED_TEXT_REFERENCE.test(current.value)) refuse();
      if (classification === "retained-token") {
        requireRetainedToken(current.value);
      }
      if (classification === "timestamp") requireTimestamp(current.value);
      if (classification === "version") requireVersionIdentifier(current.value);
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (seen.has(current.value)) refuse();
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      for (const nested of current.value) {
        pending.push({ value: nested, path: `${current.path}[]` });
      }
      continue;
    }
    for (const [key, nested] of Object.entries(current.value)) {
      const path = current.path === "decision.result.recommendation.parameters"
        ? `${current.path}.*`
        : `${current.path}.${key}`;
      pending.push({
        value: nested,
        path,
      });
    }
  }
}

function requireExplanationCodes(
  nodes: DecisionRecord["explanationTrace"],
): void {
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.pop()!;
    requireRegisteredCode(node.code);
    if (node.messageTemplate !== node.code) refuse();
    pending.push(...node.childNodes);
  }
}

function requireDecisionTextProjection(record: DecisionRecord): void {
  requireExplanationCodes(record.explanationTrace);
  record.precedenceTrace.forEach((step) =>
    requireRegisteredCode(step.reasonCode));
  if (record.result.kind === "proceed") {
    const recommendation = record.result.recommendation;
    requireRegisteredCode(recommendation.code);
    if (recommendation.summary !== recommendation.code) refuse();
    for (const alternative of recommendation.alternatives) {
      requireRegisteredCode(alternative.code);
      if (alternative.summary !== alternative.code) refuse();
      alternative.rejectedBecause.forEach(requireRegisteredCode);
    }
    for (const parameter of Object.values(recommendation.parameters)) {
      if (typeof parameter === "string") requireRetainedToken(parameter);
    }
  } else if (record.result.kind === "blocked") {
    for (const blocker of record.result.blockers) {
      requireRegisteredCode(blocker.code);
      if (blocker.explanation !== blocker.code) refuse();
    }
  } else {
    requireRegisteredCode(record.result.prohibition.reasonCode);
    if (
      record.result.prohibition.explanation !==
      record.result.prohibition.reasonCode
    ) {
      refuse();
    }
  }
}

export function assertReplaySourcePiiBoundary(
  kind: "evidence" | "bundle" | "decision",
  value: EvidenceSnapshotRef | DecisionInputBundle | DecisionRecord,
): void {
  requireClassifiedStrings(kind, value);
  if (kind === "evidence") {
    const snapshot = value as EvidenceSnapshotRef;
    if (!RETAINED_TEXT_REFERENCE.test(snapshot.attribution)) refuse();
  } else if (kind === "bundle") {
    const bundle = value as DecisionInputBundle;
    requireVersionIdentifier(bundle.engineVersion);
    requireVersionIdentifier(bundle.primitiveSetVersion);
  } else if (kind === "decision") {
    requireDecisionTextProjection(value as DecisionRecord);
  }
}

export function assertLedgerEventPiiBoundary(event: LedgerEntry): void {
  requireClassifiedStrings(`event:${event.type}`, event);
  if (event.type === "ApprovalRecorded" && event.structuredReason !== undefined) {
    requireRetainedToken(event.structuredReason);
  }
  if ("sourceStatus" in event && event.sourceStatus !== undefined) {
    requireRetainedToken(event.sourceStatus);
  }
}
