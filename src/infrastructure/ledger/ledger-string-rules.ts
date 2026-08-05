const MACHINE_NAMESPACES = new Set([
  "actor", "blob", "bundle", "causal", "conflict", "corr", "correlation",
  "dec", "decision", "event", "evidence", "evs", "handle", "idem",
  "instruction", "intent", "ledger", "ordered", "plan", "policy",
  "projection", "res", "reservation", "sample", "scope", "seed", "source",
  "stage", "step", "subject", "target", "tpl", "trace", "trigger", "verification",
  "verify", "vr",
]);

const SYSTEM_IDENTIFIERS = new Set([
  "ledger-test",
  "seed-decision-ledger",
  "verin-decision-engine",
]);

const REGISTERED_ACTOR_IDENTIFIERS = new Set(["actor:ops:1"]);
const REGISTERED_CORRELATION_IDENTIFIERS = new Set(["corr:ledger-test"]);

const REGISTERED_MACHINE_TOKENS = new Set([
  "account-balance",
  "account-restriction",
  "client",
  "client-service",
  "crm-record",
  "custodian-submit",
  "external",
  "external-status",
  "firm-a-cash-reserve",
  "firm-a-distribution-policy",
  "firm-a-source-selection",
  "firm-b-cash-reserve",
  "fresh",
  "household-instruction",
  "operations",
  "operations-manager",
  "ops-dual-approval",
  "pending-actions",
  "planned-withdrawals",
  "recent-bank-instruction",
  "reg-distribution-holds",
  "submit-cash-distribution",
]);

const REGISTERED_MACHINE_SEGMENTS = new Set([
  ...REGISTERED_MACHINE_TOKENS,
  "additional-role", "approval", "approval-escalated", "approval-expired",
  "approval-hash", "approval-invalidated", "append", "atomic-refusal",
  "bad-replay-digest", "balance", "bank-instruction", "before-decision", "bound", "bounded",
  "bounded-evidence", "bounded-predecessor", "collision", "compensate", "computed",
  "confidence-replay", "confidence-write", "conflict-swallowed",
  "cross-decision", "cross-owner-release", "cross-tenant-replay", "delayed-release",
  "demo", "derived", "derived-provenance", "distribution", "distribution-submitted", "driver-failure",
  "dual-approval", "duplicate-decision", "escalation", "escalation-second",
  "evidence", "exception", "exception-requested", "execution", "execution-failed",
  "execution-partial", "execution-started", "execution-succeeded", "expired", "expiry",
  "expiry-first", "first", "forged", "forged-conflict", "forged-stage",
  "forward", "house-crm", "household-liquidity", "ineligible", "ineligible-trigger", "invalid",
  "invalidated", "later", "later-evidence", "later-provenance-binding",
  "ledger-test", "liquidity", "missing", "missing-cache-conflict",
  "missing-generation", "missing-plan", "missing-rule", "missing-stage",
  "missing-step", "not-in-bundle", "optional-paths", "orphan-status", "other",
  "outside-window", "outside-window-status", "pre-window", "preclaimed",
  "preflight-driver-failure", "prior", "real-input", "release-failure",
  "rerecorded-evidence", "reservation-conflict", "reservation-created", "reservation-released",
  "reservation-reused", "rerecorded", "roleless", "second", "status",
  "status-observed", "status-order", "synthetic", "synthetic-seed", "tampered",
  "tenant-scoped-binding", "test", "trigger", "verification-closed",
  "verification-stuck", "verified-evidence", "window-evidence", "wrong-generation-release",
]);

const REGISTERED_VERSION_BASES = new Set([
  "firm-a-policy", "firm-b-policy", "money-movement", "reg-distribution-holds",
]);

const FIRM_IDENTIFIER = /^(?:firm-[a-z0-9]+|org(?:-[a-z0-9]+)*)$/;
const NAMESPACED_IDENTIFIER = /^([a-z][a-z0-9-]*):([A-Za-z0-9][A-Za-z0-9._:@/+~-]*)$/;
const VERSIONED_IDENTIFIER = /^([a-z0-9]+(?:-[a-z0-9]+)+)@(?:v)?\d[0-9a-z.-]*$/;
const EVIDENCE_SCHEMA_VERSION = /^evidence\/\d+(?:\.\d+){2}$/;
const IANA_TIME_ZONE = /^[A-Za-z_+-]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/;
const TIME_ZONE_DATA_VERSION = /^iana-tzdb\/\d{4}[a-z]$/;
const ISO_DURATION = /^P(?=\d|T\d)(?:\d+[YMWD])*(?:T(?:\d+[HMS])*)?$/;
const ACTOR_IDENTIFIER = /^actor:(?:\d+|[a-f0-9]{32,})$/;
const CORRELATION_IDENTIFIER = /^(?:corr|correlation|seed):(?:\d+|[a-f0-9]{32,})$/;
const OPAQUE_SEGMENT = /^(?:\d+|GC-\d+|[a-f0-9]{32,})$/;
const REGISTERED_STAGE_IDS = new Set(["ops-dual-approval"]);

function isRegisteredMachineSegment(value: string): boolean {
  const versioned = value.match(/^([a-z0-9-]+)@(?:v)?\d[0-9a-z.-]*$/);
  return OPAQUE_SEGMENT.test(value) ||
    FIRM_IDENTIFIER.test(value) ||
    MACHINE_NAMESPACES.has(value) ||
    REGISTERED_MACHINE_SEGMENTS.has(versioned?.[1] ?? value);
}

function hasMachineNamespace(value: string): boolean {
  const match = value.match(NAMESPACED_IDENTIFIER);
  return match !== null &&
    MACHINE_NAMESPACES.has(match[1]!) &&
    match[2]!.split(":").every(isRegisteredMachineSegment);
}

export function isOpaqueLedgerIdentifier(
  path: string,
  value: string,
): boolean {
  if (path.endsWith(".firmId")) return FIRM_IDENTIFIER.test(value);
  if (path.endsWith(".actorId")) {
    return ACTOR_IDENTIFIER.test(value) || REGISTERED_ACTOR_IDENTIFIERS.has(value);
  }
  if (path.endsWith(".systemId")) return SYSTEM_IDENTIFIERS.has(value);
  if (path.endsWith(".correlationId")) {
    return CORRELATION_IDENTIFIER.test(value) ||
      REGISTERED_CORRELATION_IDENTIFIERS.has(value);
  }
  if (path.endsWith(".stageId")) {
    return REGISTERED_STAGE_IDS.has(value) || hasMachineNamespace(value);
  }
  const versioned = value.match(VERSIONED_IDENTIFIER);
  return hasMachineNamespace(value) ||
    (versioned !== null && REGISTERED_VERSION_BASES.has(versioned[1]!)) ||
    REGISTERED_MACHINE_TOKENS.has(value);
}

export function isOpaqueLedgerToken(path: string, value: string): boolean {
  if (path.endsWith(".schemaVersion")) {
    return EVIDENCE_SCHEMA_VERSION.test(value) || /^\d+(?:\.\d+){2}$/.test(value);
  }
  if (path.endsWith(".timeZone")) return IANA_TIME_ZONE.test(value);
  if (path.endsWith(".timeZoneDataVersion")) {
    return TIME_ZONE_DATA_VERSION.test(value);
  }
  if (path.endsWith(".after")) return ISO_DURATION.test(value);
  return REGISTERED_MACHINE_TOKENS.has(value);
}
