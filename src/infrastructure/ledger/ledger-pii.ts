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
/**
 * Every entry below is a REVIEWED production, seed, demo, or golden identifier with a
 * shipped producer. Test fixtures widen this boundary through the injection seam at the
 * bottom of this module, never here - a shipped allowlist that carries a fixture's
 * vocabulary accepts strings whose only justification is a test, and grows without
 * bound as the suite does.
 */
const REGISTERED_RETAINED_IDENTIFIERS = new Set([
  "firm-a-cash-reserve",
  "firm-a-source-selection",
  "firm-a-distribution-policy",
  "firm-a",
  "firm-b",
  "firm_policy",
  "household_instruction",
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
  "blob:GC-01:distribution", "conflict:smiths-liquidity", "evs:GC-01:balance",
  "evs:GC-01:bank-instruction", "evs:GC-01:household-instruction",
  "evs:GC-01:planned-withdrawals", "evs:GC-05:balance", "evs:GC-05:pending-actions",
  "evs:GC-07:account-restriction", "idem:GC-01:smiths-75000-2026-08-15",
  "res:GC-01:liquidity", "scope:account:smiths-joint-taxable",
  "seed:ledger:decision", "seed:synthetic-decision-ledger", "source:synthetic-seed",
  "subject:smiths-household", "subject:smiths-joint-taxable", "target:house-crm",
  "tpl:firm-a:dual-approval", "vr:distribution-submitted",
]);
const REGISTERED_INDEXED_IDENTIFIER_PREFIXES = new Set([
  "blob:synthetic", "bundle:GC-01", "bundle:GC-05", "bundle:GC-07", "dec:GC-01",
  "dec:GC-05", "dec:GC-07", "intent:GC-01", "intent:GC-05", "intent:GC-07",
  "plan:GC-01", "seed:ledger:evidence", "step:GC-01", "subject:synthetic",
]);
const REGISTERED_VERSIONED_IDENTIFIER_PREFIXES = new Set([
  "firm-a-policy", "firm-b-policy", "money-movement", "reg-distribution-holds",
  "smiths-destination-restriction", "smiths-liquidity-preference",
]);
/**
 * Bundle version fields are opaque machine tokens, not retained text. A literal set of
 * the versions that happen to exist today pins the whole write path to this engine
 * build: the first real version bump would refuse every append as a PII violation - an
 * error class that sends an operator hunting for personal data that was never there.
 * The SHAPE is bounded and restricted instead, the residual account-reference refusal
 * still runs over the value, and an unsupported shape reports itself as exactly that.
 */
const BUNDLE_VERSION_TOKEN =
  /^[0-9]+(?:\.[0-9]+){0,3}(?:-[a-z0-9]+(?:\.[a-z0-9]+)*)?$/;
const BUNDLE_VERSION_MAX_LENGTH = 32;
const IDENTIFIER_FIELD =
  /(?:^id$|Id$|Ids$|Ref$|Refs$|Key$|Keys$|Hash$|Hashes$|Parts$|^attribution$)/;
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

/**
 * Test-only ledger vocabulary, mirroring registerTestSpanName / registerTestSystemActor.
 * The reserved `test` namespace is enforced here, and the ledger-pii-vocabulary fence
 * proves no shipped module can reach these seams (keyed on symbol resolution, so an
 * aliased import cannot evade it) and that no shipped allowlist entry lives in the
 * reserved namespace. A registration is still a machine token: an unbounded or
 * PII-shaped value is refused exactly as a shipped one would be.
 */
const TEST_NAMESPACE = /^test(?::[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)+$/;
const TEST_IDENTIFIERS = new Set<string>();
const TEST_INDEXED_IDENTIFIER_PREFIXES = new Set<string>();

function requireTestNamespace(value: string): void {
  if (value.length > 256 || !TEST_NAMESPACE.test(value)) {
    throw appError(
      "VALIDATION",
      "A test ledger identifier must live in the reserved 'test' namespace.",
    );
  }
  if (looksLikePIIValue(value) || hasSensitiveAccountReference(value)) refuse();
}

export function registerTestLedgerIdentifier(value: string): string {
  requireTestNamespace(value);
  TEST_IDENTIFIERS.add(value);
  return value;
}

export function registerTestLedgerIdentifierPrefix(value: string): string {
  requireTestNamespace(value);
  TEST_INDEXED_IDENTIFIER_PREFIXES.add(value);
  return value;
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
  if (REGISTERED_MACHINE_IDENTIFIERS.has(value) || TEST_IDENTIFIERS.has(value)) {
    return true;
  }
  const colonSeparator = value.lastIndexOf(":");
  const prefix = value.slice(0, colonSeparator);
  if (
    colonSeparator > 0 &&
    (REGISTERED_INDEXED_IDENTIFIER_PREFIXES.has(prefix) ||
      TEST_INDEXED_IDENTIFIER_PREFIXES.has(prefix)) &&
    INDEXED_IDENTIFIER_SEGMENT.test(value.slice(colonSeparator + 1))
  ) return true;
  const versionSeparator = value.lastIndexOf("@");
  return versionSeparator > 0 && REGISTERED_VERSIONED_IDENTIFIER_PREFIXES.has(
    value.slice(0, versionSeparator),
  ) && VERSION_SUFFIX.test(value.slice(versionSeparator + 1));
}

function requireOpaqueIdentifier(value: string): void {
  const machineIdentifier =
    CANONICAL_UUID.test(value) ||
    MACHINE_HASH.test(value) ||
    RETAINED_TEXT_REFERENCE.test(value) ||
    isRegisteredMachineIdentifier(value) ||
    REGISTERED_RETAINED_IDENTIFIERS.has(value);
  if (
    value.length > 256 ||
    !machineIdentifier ||
    looksLikePIIValue(value)
  ) {
    refuse();
  }
}

function requireOpaqueIdentifiers(value: unknown): void {
  const pending: Array<{
    readonly value: unknown;
    readonly identifier: boolean;
  }> = [
    { value, identifier: false },
  ];
  const seenAsIdentifier = new WeakSet<object>();
  const seenAsPlain = new WeakSet<object>();
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (typeof item.value === "string") {
      if (item.identifier) {
        requireOpaqueIdentifier(item.value);
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
    const seen = item.identifier ? seenAsIdentifier : seenAsPlain;
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    if (Array.isArray(item.value)) {
      for (const nested of item.value) {
        pending.push({
          value: nested,
          identifier: item.identifier,
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

function requireBundleVersion(value: string, field: string): void {
  if (hasSensitiveAccountReference(value) || looksLikePIIValue(value)) refuse();
  if (
    value.length > BUNDLE_VERSION_MAX_LENGTH ||
    !BUNDLE_VERSION_TOKEN.test(value)
  ) {
    throw appError(
      "VALIDATION",
      `decision input bundle declares an unsupported ${field} version`,
    );
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
    requireBundleVersion(bundle.engineVersion, "engine");
    requireBundleVersion(bundle.primitiveSetVersion, "primitive set");
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
