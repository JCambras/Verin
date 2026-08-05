import { appError } from "@contracts/errors";
import {
  hasSensitiveAccountReference,
  looksLikeAmbiguousSensitiveText,
  looksLikePIIValue,
} from "@contracts/pii";
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
const BUNDLE_VERSION_CODES = new Set(["0", "0.0.0"]);
const IDENTIFIER_FIELD =
  /(?:^id$|Id$|Ids$|Ref$|Refs$|Key$|Keys$|Hash$|Hashes$|Parts$|^attribution$)/;
const ACCOUNT_PATTERN_EXEMPT_FIELD =
  /(?:Hash$|Hashes$|^attribution$|^idempotencyKey$)/;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9]+(?:[._:/@-][A-Za-z0-9]+)*$/;
const TITLE_CASE_IDENTIFIER_SEGMENT =
  /(?:^|[._:/@-])\p{Lu}\p{Ll}{1,}(?:['-][\p{Lu}]?\p{Ll}+)?(?:$|[._:/@-])/u;

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

function requireRetainedToken(value: string): void {
  if (
    !REGISTERED_RETAINED_CODES.has(value) &&
    !RETAINED_TEXT_REFERENCE.test(value)
  ) {
    refuse();
  }
}

function requireOpaqueIdentifier(
  value: string,
  checkAccountPattern: boolean,
): void {
  if (
    value.length > 256 ||
    !OPAQUE_IDENTIFIER.test(value) ||
    looksLikePIIValue(value) ||
    (checkAccountPattern && hasSensitiveAccountReference(value)) ||
    TITLE_CASE_IDENTIFIER_SEGMENT.test(value)
  ) {
    refuse();
  }
}

function requireOpaqueIdentifiers(value: unknown): void {
  const pending: Array<{
    readonly value: unknown;
    readonly identifier: boolean;
    readonly checkAccountPattern: boolean;
  }> = [
    { value, identifier: false, checkAccountPattern: false },
  ];
  const seen = new WeakMap<object, boolean>();
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (typeof item.value === "string") {
      if (item.identifier) {
        requireOpaqueIdentifier(item.value, item.checkAccountPattern);
      } else if (looksLikeAmbiguousSensitiveText(item.value)) {
        refuse();
      }
      continue;
    }
    if (item.value === null || typeof item.value !== "object") continue;
    const seenAsIdentifier = seen.get(item.value);
    if (seenAsIdentifier === true || seenAsIdentifier === item.identifier) {
      continue;
    }
    seen.set(item.value, item.identifier);
    if (Array.isArray(item.value)) {
      for (const nested of item.value) {
        pending.push({
          value: nested,
          identifier: item.identifier,
          checkAccountPattern: item.checkAccountPattern,
        });
      }
      continue;
    }
    for (const [key, nested] of Object.entries(item.value)) {
      if (looksLikeAmbiguousSensitiveText(key)) refuse();
      const identifier = item.identifier || IDENTIFIER_FIELD.test(key);
      pending.push({
        value: nested,
        identifier,
        checkAccountPattern: item.identifier
          ? item.checkAccountPattern
          : identifier && !ACCOUNT_PATTERN_EXEMPT_FIELD.test(key),
      });
    }
  }
}

function requireRetainedValueBoundary(value: unknown): void {
  requireOpaqueIdentifiers(value);
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
  requireRetainedValueBoundary(value);
  if (kind === "evidence") {
    const snapshot = value as EvidenceSnapshotRef;
    if (!RETAINED_TEXT_REFERENCE.test(snapshot.attribution)) refuse();
  } else if (kind === "bundle") {
    const bundle = value as DecisionInputBundle;
    if (
      !BUNDLE_VERSION_CODES.has(bundle.engineVersion) ||
      !BUNDLE_VERSION_CODES.has(bundle.primitiveSetVersion)
    ) {
      refuse();
    }
  } else if (kind === "decision") {
    requireDecisionTextProjection(value as DecisionRecord);
  }
}

export function assertLedgerEventPiiBoundary(event: LedgerEntry): void {
  requireRetainedValueBoundary(event);
  if (event.type === "ApprovalRecorded" && event.structuredReason !== undefined) {
    requireRetainedToken(event.structuredReason);
  }
  if ("sourceStatus" in event && event.sourceStatus !== undefined) {
    requireRetainedToken(event.sourceStatus);
  }
}
