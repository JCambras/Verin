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
const REGISTERED_RETAINED_IDENTIFIERS = new Set([
  "crm-record",
  "custodian-submit",
  "firm-a-cash-reserve",
  "firm-a-source-selection",
  "firm-a-distribution-policy",
  "firm-a",
  "firm-b",
  "firm_policy",
  "household_instruction",
  "ledger-test",
  "missing-cause",
  "operations",
  "operations-manager",
  "ops-dual-approval",
  "org-verin-demo",
  "regulatory",
  "reg-distribution-holds",
  "seed-decision-ledger",
  "smiths-cash-floor",
  "verin-decision-engine",
]);
const REGISTERED_MACHINE_IDENTIFIERS = new Set([
  "blob:GC-01:distribution", "blob:test:status", "causal:forward", "causal:later",
  "conflict:household-liquidity", "conflict:smiths-liquidity", "corr:ledger-test",
  "evidence:atomic-refusal", "evs:GC-01:balance", "evs:GC-01:bank-instruction",
  "evs:GC-01:household-instruction", "evs:GC-01:planned-withdrawals",
  "evs:GC-05:balance", "evs:GC-05:pending-actions", "evs:GC-07:account-restriction",
  "firm-b:event", "idem:GC-01:smiths-75000-2026-08-15",
  "ledger:evidence:collision", "ordered:first", "ordered:second",
  "ledger:later-evidence:evidence:atomic-refusal",
  "projection:conflict-swallowed", "projection:cross-owner-release",
  "projection:delayed-release", "projection:escalation", "projection:escalation-second",
  "projection:expiry", "projection:expiry-first", "projection:missing-generation",
  "projection:reservation-conflict", "projection:reservation-reused",
  "projection:wrong-generation-release", "res:GC-01:liquidity", "reservation:b",
  "decision:b", "sample:approval", "sample:approval-escalated",
  "sample:approval-expired", "sample:approval-invalidated", "sample:decision",
  "sample:evidence", "sample:exception-requested", "sample:execution-failed",
  "sample:execution-partial", "sample:execution-started", "sample:execution-succeeded",
  "sample:reservation-created", "sample:reservation-released", "sample:status-observed",
  "sample:verification-closed", "sample:verification-stuck", "source:synthetic-seed",
  "scope:account:smiths-joint-taxable", "seed:ledger:decision",
  "seed:synthetic-decision-ledger", "source:test", "subject:smiths-household",
  "subject:smiths-joint-taxable",
  "subject:test:status", "target:house-crm", "tpl:firm-a:dual-approval",
  "trigger:forward", "vr:distribution-submitted",
]);
const REGISTERED_INDEXED_IDENTIFIER_PREFIXES = new Set([
  "actor:ops", "blob:synthetic", "blob:test", "bundle:GC-01", "bundle:GC-05",
  "bundle:GC-07", "dec:GC-01", "dec:GC-05", "dec:GC-07", "evidence",
  "evidence:status", "handle", "idem:ledger", "intent:GC-01", "intent:GC-05",
  "intent:GC-07", "ledger:decision", "ledger:decision:dec:GC-01",
  "ledger:evidence", "ledger:later-evidence:evidence:status", "plan:GC-01",
  "projection:bounded", "register:repeated-evidence", "reservation",
  "seed:ledger:evidence", "step:GC-01", "subject:synthetic", "subject:test", "verify",
]);
const REGISTERED_VERSIONED_IDENTIFIER_PREFIXES = new Set([
  "firm-a-policy", "firm-b-policy", "money-movement", "reg-distribution-holds",
  "smiths-destination-restriction", "smiths-liquidity-preference",
]);
const IDENTIFIER_FIELD =
  /(?:^id$|Id$|Ids$|Ref$|Refs$|Key$|Keys$|Hash$|Hashes$|Parts$|^attribution$)/;
const ACCOUNT_PATTERN_EXEMPT_FIELD =
  /(?:Hash$|Hashes$|^attribution$|^idempotencyKey$)/;
const CANONICAL_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MACHINE_HASH = /^[a-f0-9]{64}$/;
const INDEXED_IDENTIFIER_SEGMENT = /^\d+$/;
const VERSION_SUFFIX = /^(?:v?\d+|\d+(?:\.\d+)+)$/;

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

function isRegisteredMachineIdentifier(value: string): boolean {
  if (REGISTERED_MACHINE_IDENTIFIERS.has(value)) return true;
  const colonSeparator = value.lastIndexOf(":");
  if (
    colonSeparator > 0 &&
    REGISTERED_INDEXED_IDENTIFIER_PREFIXES.has(
      value.slice(0, colonSeparator),
    ) &&
    INDEXED_IDENTIFIER_SEGMENT.test(value.slice(colonSeparator + 1))
  ) return true;
  const versionSeparator = value.lastIndexOf("@");
  return versionSeparator > 0 && REGISTERED_VERSIONED_IDENTIFIER_PREFIXES.has(
    value.slice(0, versionSeparator),
  ) && VERSION_SUFFIX.test(value.slice(versionSeparator + 1));
}

function requireOpaqueIdentifier(
  value: string,
  checkAccountPattern: boolean,
): void {
  const machineIdentifier =
    CANONICAL_UUID.test(value) ||
    MACHINE_HASH.test(value) ||
    RETAINED_TEXT_REFERENCE.test(value) ||
    isRegisteredMachineIdentifier(value) ||
    REGISTERED_RETAINED_IDENTIFIERS.has(value);
  if (
    value.length > 256 ||
    !machineIdentifier ||
    looksLikePIIValue(value) ||
    (checkAccountPattern && hasSensitiveAccountReference(value))
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
    if (
      (typeof item.value === "number" || typeof item.value === "bigint") &&
      hasSensitiveAccountReference(item.value)
    ) refuse();
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
  if ("reasonCode" in event && event.reasonCode !== undefined) {
    requireRegisteredCode(event.reasonCode);
  }
  if ("failureCode" in event) {
    requireRegisteredCode(event.failureCode);
  }
  if (event.type === "ApprovalRecorded" && event.structuredReason !== undefined) {
    requireRetainedToken(event.structuredReason);
  }
  if ("sourceStatus" in event && event.sourceStatus !== undefined) {
    requireRetainedToken(event.sourceStatus);
  }
}
