import { appError } from "@contracts/errors";
import type {
  EvidenceSnapshotRef,
  DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";

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
/**
 * Engine and primitive-set versions are structured identifiers, not free text: a
 * bounded dotted-numeric release with an optional lower-case pre-release suffix.
 * Classifying them by LEXICAL FORM rather than by an allowlist of today's values
 * keeps the boundary fail-closed (a name, sentence, address, or contact detail
 * cannot take this shape) without turning the next engine release into a
 * PII_VIOLATION on every append.
 */
const VERSION_IDENTIFIER = /^\d{1,6}(\.\d{1,6}){0,3}(-[0-9a-z]+(\.[0-9a-z]+)*)?$/;
const VERSION_IDENTIFIER_MAX_LENGTH = 32;

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

function requireRetainedToken(value: string): void {
  if (
    !REGISTERED_RETAINED_CODES.has(value) &&
    !RETAINED_TEXT_REFERENCE.test(value)
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
  if (event.type === "ApprovalRecorded" && event.structuredReason !== undefined) {
    requireRetainedToken(event.structuredReason);
  }
  if ("sourceStatus" in event && event.sourceStatus !== undefined) {
    requireRetainedToken(event.sourceStatus);
  }
}
