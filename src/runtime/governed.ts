// The generation-4 governed runtime kernel (prompt 2 sections 3, 4, 5B.8; rule E16). Constructed once
// per process by a named composition root (web: src/instrumentation.ts register(); tooling: entry
// scripts under src/tools/); a second construction is refused, not cached. Product modules reach the
// database only through the frozen per-operation gateway entries from getGateway(); the pg client,
// its credential and the cookie-signing key are consumed here and never leave the kernel. The
// canonicaliser mirrors the checker's semfx.v1 bytes but imports nothing from enforcement/.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { Pool, type QueryResult } from "pg";
import { z } from "zod";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { Counter } from "@opentelemetry/api";
import { MeterProvider, PeriodicExportingMetricReader, InMemoryMetricExporter, AggregationTemporality } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { refuseAccountReferences } from "../evidence/pii";
import { GENESIS_PREV_HASH, chainHash, decisionEnvelope, entryId, genesisEnvelope, validateAppendInput, type DecisionRecordAppendInput, type DecisionRecordAppendResult } from "../record/canonical";

declare const sealed: unique symbol;
export type RequestId = { readonly [sealed]: "RequestId"; readonly value: string; readonly purpose: "requestId" };
export type RequestCorrelation = {
  readonly [sealed]: "RequestCorrelation";
  readonly kind: "RequestCorrelation";
  readonly fields: { readonly requestId: { readonly value: string; readonly purpose: "requestId" } };
};
// The second identity (prompt 5 section 5B): a DecisionId exists only AFTER evaluate returns - its
// factory takes a dov.v1 outcome digest and nothing else mints one; 64 bare hex cannot match any
// account-reference form (GD-003 unwidened).
export type DecisionId = { readonly [sealed]: "DecisionId"; readonly value: string; readonly purpose: "decisionId" };
export type DecisionCorrelation = {
  readonly [sealed]: "DecisionCorrelation";
  readonly kind: "DecisionCorrelation";
  readonly fields: {
    readonly requestId: { readonly value: string; readonly purpose: "requestId" };
    readonly decisionId: { readonly value: string; readonly purpose: "decisionId" };
  };
};
export type GovernedOperationId = { readonly [sealed]: "GovernedOperationId"; readonly id: OpKey };
// The sealed factories. 32 unbroken hex chars, so no identifier can match an account-reference form.
// Minted values are registered in a process-wide private WeakSet, so a structurally valid value forced
// past the type system from a second factory is still refused at the gateway (M-B's forced-value arm).
const MINTED: WeakSet<object> = ((globalThis as { [k: symbol]: WeakSet<object> })[Symbol.for("verin.minted")] ??= new WeakSet());
// Every id the runtime itself mints (requestId, and each span/trace id at emission) is recorded so
// the E16 PII scan can exclude exactly these values - and nothing else - from account-reference
// candidacy in correlation-key positions (GD-003).
const MINTED_IDS: string[] = ((globalThis as { [k: symbol]: string[] })[Symbol.for("verin.minted-ids")] ??= []);
export const mintRequestId = (): RequestId => {
  const r = { value: randomBytes(16).toString("hex"), purpose: "requestId" } as RequestId;
  MINTED.add(r);
  MINTED_IDS.push(r.value);
  return r;
};
export const requestCorrelation = (r: RequestId): RequestCorrelation => {
  if (!MINTED.has(r)) throw new Error("this RequestId was not minted by its sealed factory; a second factory's value is refused");
  const c = { kind: "RequestCorrelation", fields: { requestId: { value: r.value, purpose: r.purpose } } } as RequestCorrelation;
  MINTED.add(c);
  return c;
};
// Before an outcome is serialized no dov.v1 digest exists, so no decision identity can exist
// before evaluate returns - by construction. A request id is 32 bare hex under purpose requestId;
// it carries no dov.v1 domain and is refused by name, never relabelled (prompt 1 deliverable 3A).
export const decisionIdFromOutcomeDigest = (outcomeDigest: string): DecisionId => {
  const m = /^dov\.v1:([0-9a-f]{64})$/.exec(outcomeDigest);
  if (!m)
    throw new Error(
      `a DecisionId mints only from a dov.v1 outcome digest; '${outcomeDigest.slice(0, 24)}' carries no dov.v1 domain (a request identifier's purpose tag says requestId, and a value cannot pose as another identifier)`,
    );
  const d = { value: m[1], purpose: "decisionId" } as DecisionId;
  MINTED.add(d);
  return d;
};
export const decisionCorrelation = (r: RequestId, d: DecisionId): DecisionCorrelation => {
  if (!MINTED.has(r) || !MINTED.has(d)) throw new Error("this correlation's identifiers were not minted by their sealed factories; a second factory's value is refused");
  const c = { kind: "DecisionCorrelation", fields: { requestId: { value: r.value, purpose: r.purpose }, decisionId: { value: d.value, purpose: d.purpose } } } as DecisionCorrelation;
  MINTED.add(c);
  return c;
};
const opId = (id: OpKey): GovernedOperationId => ({ id }) as GovernedOperationId;

export type OpKey =
  | "route.sign-in"
  | "route.households"
  | "route.household-workspace"
  | "access.authenticate"
  | "access.authorize"
  | "access.withTenant"
  | "access.renewSession"
  | "identity.lookupForLogin"
  | "session.create"
  | "session.lookupByTokenHash"
  | "session.rotate"
  | "household.listForTenant"
  | "household.getForTenant"
  | "evidence.assemble"
  | "observation.listForHousehold"
  | "route.policy"
  | "policy.publish"
  | "policy.resolveByHash"
  | "policy.appendVersion"
  | "policy.documentByDigest"
  | "policy.resolveInForce"
  | "policy.history"
  | "policy.versionsForFirm"
  | "route.decision"
  | "decision.renderOutcome"
  | "route.decision-compare"
  | "decision.compareSide"
  | "route.conformance"
  | "conformance.runner"
  | "conformance.readSignedCase"
  | "conformance.grade"
  | "route.decision-records"
  | "decisionRecord.list"
  | "decisionRecord.listForTenant"
  | "route.decision-chain-verify"
  | "decisionRecord.resolveHead"
  | "route.decision-record"
  | "decisionRecord.record"
  | "decisionRecord.append"
  | "decisionRecord.load"
  | "decisionRecord.loadById"
  | "decisionRecord.verify"
  | "decisionRecord.readChain";
type AttributeDomain = { domain: "digest" } | { domain: "boolean" } | { domain: "enum" | "bucketed"; values: readonly string[] };
type Row = {
  id: GovernedOperationId;
  class: "use-case" | "module-operation" | "store" | "flow-step";
  owner: "Access" | "Evidence" | "Configuration" | "Product" | "Record";
  correlation: "RequestCorrelation" | "DecisionCorrelation";
  metric: "count";
  attributes: Readonly<Record<string, AttributeDomain>>;
  permittedParents: readonly (OpKey | "entry")[];
  gatewayEntry: string;
  slice: 2 | 3 | 4 | 5 | 6;
};
const ATTRS: Row["attributes"] = { requestId: { domain: "digest" }, outcome: { domain: "enum", values: ["ok", "refused", "error"] } };
// Slice 4's declared domains: the BARE 64-hex digest and the NotFound reason's closed enum.
const POLICY_ATTRS: Row["attributes"] = { ...ATTRS, documentDigest: { domain: "digest" }, refusalReason: { domain: "enum", values: ["version-not-found", "no-version-in-force"] } };
// Slice 5's declared domain: the bare 64-hex decision digest under its own attribute (GD-003 unwidened).
const DECISION_ATTRS: Row["attributes"] = { ...ATTRS, decisionId: { domain: "digest" } };
const RECORD_ATTRS: Row["attributes"] = {
  ...DECISION_ATTRS,
  recordResult: { domain: "enum", values: ["found", "empty", "recorded", "already-recorded", "refused"] },
  sequenceBucket: { domain: "bucketed", values: ["genesis", "1-10", "11-100", "101-1000", "over-1000"] },
  verificationResult: {
    domain: "enum",
    values: ["verified", "not-found", "empty-chain", "truncated-read", "authorization", "sequence", "envelope", "source", "link", "tail", "time"],
  },
};
const row = (
  id: OpKey,
  cls: Row["class"],
  permittedParents: Row["permittedParents"],
  gatewayEntry: string,
  owner: Row["owner"] = "Access",
  slice: Row["slice"] = 2,
  correlation: Row["correlation"] = "RequestCorrelation",
): Row => ({
  id: opId(id),
  class: cls,
  owner,
  correlation,
  metric: "count",
  attributes: slice === 6 ? RECORD_ATTRS : correlation === "DecisionCorrelation" ? DECISION_ATTRS : cls === "module-operation" && id.startsWith("policy.") ? POLICY_ATTRS : ATTRS,
  permittedParents,
  gatewayEntry,
  slice,
});
const REGISTRY: readonly Row[] = [
  row("route.sign-in", "use-case", ["entry"], "enterRouteSignIn"),
  row("route.households", "use-case", ["entry"], "enterRouteHouseholds"),
  row("route.household-workspace", "use-case", ["entry"], "enterRouteHouseholdWorkspace"),
  row(
    "access.authenticate",
    "module-operation",
    [
      "entry",
      "route.households",
      "route.household-workspace",
      "route.policy",
      "route.decision",
      "route.decision-compare",
      "route.conformance",
      "route.decision-records",
      "route.decision-chain-verify",
    ],
    "enterAccessAuthenticate",
  ),
  row(
    "access.authorize",
    "module-operation",
    [
      "entry",
      "route.households",
      "route.household-workspace",
      "route.policy",
      "route.decision",
      "route.decision-compare",
      "route.conformance",
      "route.decision-records",
      "route.decision-chain-verify",
    ],
    "enterAccessAuthorize",
  ),
  row("access.withTenant", "module-operation", ["route.households", "route.household-workspace", "route.decision", "route.decision-compare"], "enterAccessWithTenant"),
  row("access.renewSession", "module-operation", ["entry"], "enterAccessRenewSession"),
  row("identity.lookupForLogin", "store", ["route.sign-in"], "enterIdentityLookupForLogin"),
  row("session.create", "store", ["route.sign-in"], "enterSessionCreate"),
  row("session.lookupByTokenHash", "store", ["access.authenticate"], "enterSessionLookupByTokenHash"),
  row("session.rotate", "store", ["access.renewSession"], "enterSessionRotate"),
  row("household.listForTenant", "store", ["access.withTenant"], "enterHouseholdListForTenant"),
  row("household.getForTenant", "store", ["access.withTenant"], "enterHouseholdGetForTenant"),
  // Slice 3 (prompt 3 deliverable 7): the workspace use case gains assemble in its permitted children
  // (no new route row), and the bounded observation read is its own store row - not a seam operation.
  row("evidence.assemble", "module-operation", ["route.household-workspace", "route.decision", "route.decision-compare"], "enterEvidenceAssemble", "Evidence", 3),
  row("observation.listForHousehold", "store", ["evidence.assemble"], "enterObservationListForHousehold", "Evidence", 3),
  row("route.policy", "use-case", ["entry"], "enterRoutePolicy", "Configuration", 4),
  row("policy.publish", "module-operation", ["entry", "route.policy"], "enterPolicyPublish", "Configuration", 4),
  row("policy.resolveByHash", "module-operation", ["entry", "route.policy", "route.decision"], "enterPolicyResolveByHash", "Configuration", 4),
  row("policy.appendVersion", "store", ["policy.publish"], "enterPolicyAppendVersion", "Configuration", 4),
  row("policy.documentByDigest", "store", ["policy.resolveByHash"], "enterPolicyDocumentByDigest", "Configuration", 4),
  row("policy.resolveInForce", "module-operation", ["entry", "route.policy", "route.decision"], "enterPolicyResolveInForce", "Configuration", 4),
  row("policy.history", "module-operation", ["entry", "route.policy"], "enterPolicyHistory", "Configuration", 4),
  row("policy.versionsForFirm", "store", ["policy.resolveInForce", "policy.history"], "enterPolicyVersionsForFirm", "Configuration", 4),
  // Slice 5 (prompt 5 section 5D): the route enters under REQUEST correlation (no decision exists
  // yet); the outcome-rendering flow-step under DECISION correlation, after the mint. The policy
  // and evidence calls the route makes are the EXISTING slice-3/4 rows, reused via permittedParents.
  row("route.decision", "use-case", ["entry"], "enterRouteDecision", "Product", 5),
  row("decision.renderOutcome", "flow-step", ["route.decision"], "enterDecisionRenderOutcome", "Product", 5, "DecisionCorrelation"),
  // PR-5b: the comparison route, and its paired evaluation step entered once per firm side - each
  // side under its OWN decision correlation, because each side's outcome mints its own identity.
  row("route.decision-compare", "use-case", ["entry"], "enterRouteDecisionCompare", "Product", 5),
  row("decision.compareSide", "flow-step", ["route.decision-compare"], "enterDecisionCompareSide", "Product", 5, "DecisionCorrelation"),
  // PR-5c-i: the conformance register route (renders the COMMITTED conformance file); the runner,
  // the hash-verified signed-case read (a module-operation - a git read of pinned oracle bytes is
  // not a database effect), and the per-case grade step under each case's own decision identity.
  row("route.conformance", "use-case", ["entry"], "enterRouteConformance", "Product", 5),
  row("conformance.runner", "module-operation", ["entry"], "enterConformanceRunner", "Product", 5),
  row("conformance.readSignedCase", "module-operation", ["conformance.runner"], "enterConformanceReadSignedCase", "Product", 5),
  row("conformance.grade", "flow-step", ["conformance.runner"], "enterConformanceGrade", "Product", 5, "DecisionCorrelation"),
  // Slice 6 records and examines decisions. List and head resolution happen before a real dov.v1
  // identity is known, so they remain request-correlated. Record, load and verify start only after
  // the sealed DecisionId factory has resolved that identity from exact outcome bytes.
  row("route.decision-records", "use-case", ["entry"], "enterRouteDecisionRecords", "Record", 6),
  row("decisionRecord.list", "module-operation", ["entry", "route.decision-records"], "enterDecisionRecordList", "Record", 6),
  row("decisionRecord.listForTenant", "store", ["decisionRecord.list"], "enterDecisionRecordListForTenant", "Record", 6),
  row("route.decision-chain-verify", "use-case", ["entry"], "enterRouteDecisionChainVerify", "Record", 6),
  row("decisionRecord.resolveHead", "store", ["route.decision-chain-verify"], "enterDecisionRecordResolveHead", "Record", 6),
  row("route.decision-record", "use-case", ["entry"], "enterRouteDecisionRecord", "Record", 6, "DecisionCorrelation"),
  row("decisionRecord.record", "module-operation", ["route.decision", "route.decision-record"], "enterDecisionRecordRecord", "Record", 6, "DecisionCorrelation"),
  row("decisionRecord.append", "store", ["decisionRecord.record"], "enterDecisionRecordAppend", "Record", 6, "DecisionCorrelation"),
  row("decisionRecord.load", "module-operation", ["route.decision-record"], "enterDecisionRecordLoad", "Record", 6, "DecisionCorrelation"),
  row("decisionRecord.loadById", "store", ["decisionRecord.load"], "enterDecisionRecordLoadById", "Record", 6, "DecisionCorrelation"),
  row("decisionRecord.verify", "module-operation", ["route.decision-record", "route.decision-chain-verify"], "enterDecisionRecordVerify", "Record", 6, "DecisionCorrelation"),
  row("decisionRecord.readChain", "store", ["decisionRecord.verify"], "enterDecisionRecordReadChain", "Record", 6, "DecisionCorrelation"),
];
const PROMPT6_CORRELATIONS: Readonly<Record<string, Row["correlation"]>> = {
  "route.decision-records": "RequestCorrelation",
  "decisionRecord.list": "RequestCorrelation",
  "decisionRecord.listForTenant": "RequestCorrelation",
  "route.decision-chain-verify": "RequestCorrelation",
  "decisionRecord.resolveHead": "RequestCorrelation",
  "route.decision-record": "DecisionCorrelation",
  "decisionRecord.record": "DecisionCorrelation",
  "decisionRecord.append": "DecisionCorrelation",
  "decisionRecord.load": "DecisionCorrelation",
  "decisionRecord.loadById": "DecisionCorrelation",
  "decisionRecord.verify": "DecisionCorrelation",
  "decisionRecord.readChain": "DecisionCorrelation",
};
// Registry-side semantic-effect declarations. The admission table below declares its own copies
// independently; construction refuses unless both canonicalise to the same SemanticEffectId, which is
// what makes the semantic-effect-smuggling mutation fail on the exact digest comparison.
const REGISTRY_EFFECTS: Record<string, Record<string, unknown>> = {
  "identity.lookupForLogin": {
    kind: "prepared-query",
    statementName: "identity_lookup_for_login_v1",
    canonicalSql: "SELECT id, org_id, display_name, role, credential_hash, credential_salt FROM identity WHERE login_email = $1",
    parameters: [{ name: "loginEmail", type: "text" }],
    resultValidator: "identityLoginRow.v1",
    cardinality: "at-most-one",
    transactionClass: "login-email-guc-from-p1",
    authorityClass: "credential-exchange",
  },
  "session.create": {
    kind: "prepared-query",
    statementName: "session_create_v1",
    canonicalSql: "INSERT INTO session (id, token_hash, identity_id, org_id, display_name, role, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    parameters: [
      { name: "id", type: "uuid" },
      { name: "tokenHash", type: "text" },
      { name: "identityId", type: "uuid" },
      { name: "orgId", type: "uuid" },
      { name: "displayName", type: "text" },
      { name: "role", type: "text" },
      { name: "expiresAt", type: "timestamptz" },
    ],
    resultValidator: "writeOne.v1",
    cardinality: "write-one",
    transactionClass: "session-token-guc-from-p2",
    authorityClass: "credential-exchange",
  },
  "session.lookupByTokenHash": {
    kind: "prepared-query",
    statementName: "session_lookup_by_token_hash_v1",
    canonicalSql: "SELECT identity_id, org_id, display_name, role, expires_at FROM session WHERE token_hash = $1 AND expires_at > now()",
    parameters: [{ name: "tokenHash", type: "text" }],
    resultValidator: "sessionRow.v1",
    cardinality: "at-most-one",
    transactionClass: "session-token-guc-from-p1",
    authorityClass: "pre-tenant",
  },
  "session.rotate": {
    kind: "prepared-query",
    statementName: "session_rotate_v1",
    canonicalSql:
      "UPDATE session SET token_hash = $2, created_at = now(), expires_at = now() + interval '12 hours' WHERE token_hash = $1 AND expires_at > now() AND created_at < now() - interval '6 hours'",
    parameters: [
      { name: "presentedTokenHash", type: "text" },
      { name: "nextTokenHash", type: "text" },
    ],
    resultValidator: "rowCount.v1",
    cardinality: "write-at-most-one",
    transactionClass: "session-rotate-guc-from-p1-p2",
    authorityClass: "session-renewal",
  },
  "household.listForTenant": {
    kind: "prepared-query",
    statementName: "household_list_for_tenant_v1",
    canonicalSql: "SELECT id, name, record_origin FROM household WHERE org_id = $1 ORDER BY name",
    parameters: [{ name: "orgId", type: "uuid" }],
    resultValidator: "householdRows.v1",
    cardinality: "many",
    transactionClass: "tenant-guc-from-p1",
    authorityClass: "tenant",
  },
  "household.getForTenant": {
    kind: "prepared-query",
    statementName: "household_get_for_tenant_v1",
    canonicalSql: "SELECT id, name, record_origin, recorded_at FROM household WHERE org_id = $1 AND id = $2",
    parameters: [
      { name: "orgId", type: "uuid" },
      { name: "householdId", type: "uuid" },
    ],
    resultValidator: "householdDetail.v1",
    cardinality: "at-most-one",
    transactionClass: "tenant-guc-from-p1",
    authorityClass: "tenant",
  },
  "observation.listForHousehold": {
    kind: "prepared-query",
    statementName: "observation_list_for_household_v2",
    canonicalSql:
      "SELECT id, kind, subject, body_json, source, observed_at, retrieved_at, record_origin FROM observation WHERE org_id = $1 AND household_id = $2 AND observed_at <= $3 ORDER BY kind, subject, observed_at, id LIMIT 201",
    parameters: [
      { name: "orgId", type: "uuid" },
      { name: "householdId", type: "uuid" },
      { name: "asOf", type: "timestamptz" },
      { name: "statementTimeoutMs", type: "text" },
    ],
    resultValidator: "observationRows.v1",
    cardinality: "many",
    transactionClass: "tenant-statement-deadline-from-p1-p4",
    authorityClass: "tenant",
  },
  "policy.appendVersion": {
    kind: "prepared-query",
    statementName: "policy_append_version_v1",
    canonicalSql:
      "WITH doc AS (INSERT INTO policy_document (org_id, digest, bytes, record_origin) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, digest) DO NOTHING) INSERT INTO policy_version (org_id, seq, digest, published_at, record_origin) VALUES ($1, COALESCE((SELECT max(seq) FROM policy_version WHERE org_id = $1), 0) + 1, $2, now(), $4) ON CONFLICT (org_id, digest) DO NOTHING RETURNING seq",
    parameters: [
      { name: "orgId", type: "uuid" },
      { name: "digest", type: "text" },
      { name: "bytes", type: "bytea" },
      { name: "recordOrigin", type: "text" },
      { name: "statementTimeoutMs", type: "text" },
    ],
    resultValidator: "rowCount.v1",
    cardinality: "write-at-most-one",
    transactionClass: "tenant-statement-deadline-from-p1-p5",
    authorityClass: "tenant",
  },
  "policy.documentByDigest": {
    kind: "prepared-query",
    statementName: "policy_document_by_digest_v1",
    canonicalSql:
      "SELECT v.seq, v.published_at, d.bytes, d.record_origin FROM policy_version v JOIN policy_document d ON d.org_id = v.org_id AND d.digest = v.digest WHERE v.org_id = $1 AND v.digest = $2 LIMIT 1",
    parameters: [
      { name: "orgId", type: "uuid" },
      { name: "digest", type: "text" },
      { name: "statementTimeoutMs", type: "text" },
    ],
    resultValidator: "policyVersionRow.v1",
    cardinality: "at-most-one",
    transactionClass: "tenant-statement-deadline-from-p1-p3",
    authorityClass: "tenant",
  },
  "policy.versionsForFirm": {
    kind: "prepared-query",
    statementName: "policy_versions_for_firm_v1",
    canonicalSql: "SELECT seq, digest, published_at, record_origin FROM policy_version WHERE org_id = $1 ORDER BY seq LIMIT 201",
    parameters: [
      { name: "orgId", type: "uuid" },
      { name: "statementTimeoutMs", type: "text" },
    ],
    resultValidator: "policyVersionRows.v1",
    cardinality: "many",
    transactionClass: "tenant-statement-deadline-from-p1-p2",
    authorityClass: "tenant",
  },
  "decisionRecord.listForTenant": {
    kind: "prepared-query",
    statementName: "decision_record_list_for_tenant_v1",
    canonicalSql:
      "SELECT p.decision_id, p.seq::int, p.replay_manifest_id, p.request_ref, p.household_slug, p.disposition, p.recorded_at, p.record_origin, encode(o.bytes, 'base64') AS outcome_base64 FROM decision_record_projection p JOIN decision_record_source o ON o.org_id = p.org_id AND o.source_kind = 'outcome' AND o.identity = ('dov.v1:' || substring(p.decision_id from 2)) WHERE p.org_id = $1 ORDER BY p.seq DESC LIMIT 201",
    parameters: [{ name: "orgId", type: "uuid" }],
    resultValidator: "decisionRecordListRows.v1",
    cardinality: "many",
    transactionClass: "tenant-guc-from-p1",
    authorityClass: "tenant",
  },
  "decisionRecord.resolveHead": {
    kind: "prepared-query",
    statementName: "decision_record_resolve_head_v1",
    canonicalSql:
      "SELECT a.head_decision_id, a.entry_count::int, a.max_seq::int, a.head_hash, encode(o.bytes, 'base64') AS outcome_base64 FROM decision_chain_anchor a LEFT JOIN decision_record_source o ON o.org_id = a.org_id AND o.source_kind = 'outcome' AND o.identity = ('dov.v1:' || substring(a.head_decision_id from 2)) WHERE a.org_id = $1",
    parameters: [{ name: "orgId", type: "uuid" }],
    resultValidator: "decisionRecordHead.v1",
    cardinality: "at-most-one",
    transactionClass: "tenant-guc-from-p1",
    authorityClass: "tenant",
  },
  "decisionRecord.append": {
    kind: "closed-store-command",
    command: "decision-record-append.v1",
    inputValidator: "decisionRecordAppendInput.v1",
    resultValidator: "decisionRecordAppendResult.v1",
    transactionClass: "tenant-decision-append-from-p1",
    authorityClass: "tenant",
  },
  "decisionRecord.loadById": {
    kind: "prepared-query",
    statementName: "decision_record_load_by_id_v1",
    canonicalSql:
      "SELECT p.decision_id, p.seq::int, p.replay_manifest_id, p.request_ref, p.household_slug, p.disposition, p.recorded_at, p.record_origin, l.entry_id, l.prev_hash, l.entry_hash, encode(l.envelope_bytes, 'base64') AS envelope_base64, encode(o.bytes, 'base64') AS outcome_base64, encode(m.bytes, 'base64') AS manifest_base64, o.producer_kind, o.producer_id, o.produced_at FROM decision_record_projection p JOIN decision_ledger l ON l.org_id = p.org_id AND l.seq = p.seq JOIN decision_record_source o ON o.org_id = p.org_id AND o.source_kind = 'outcome' AND o.identity = ('dov.v1:' || substring(p.decision_id from 2)) JOIN decision_record_source m ON m.org_id = p.org_id AND m.source_kind = 'replay-manifest' AND m.identity = p.replay_manifest_id WHERE p.org_id = $1 AND p.decision_id = $2 LIMIT 1",
    parameters: [
      { name: "orgId", type: "uuid" },
      { name: "decisionId", type: "text" },
    ],
    resultValidator: "decisionRecordDetail.v1",
    cardinality: "at-most-one",
    transactionClass: "tenant-guc-from-p1",
    authorityClass: "tenant",
  },
  "decisionRecord.readChain": {
    kind: "prepared-query",
    statementName: "decision_record_read_chain_v1",
    canonicalSql:
      "SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.seq), '[]'::jsonb) FROM (SELECT seq::int, entry_id, decision_id, replay_manifest_id, encode(envelope_bytes, 'base64') AS envelope_base64, prev_hash, entry_hash, recorded_at, producer_kind, producer_id, produced_at, record_origin FROM decision_ledger WHERE org_id = $1 ORDER BY seq LIMIT 1002) e) AS entries, (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind, s.identity), '[]'::jsonb) FROM (SELECT source_kind, identity, encode(bytes, 'base64') AS bytes_base64, producer_kind, producer_id, produced_at, record_origin FROM decision_record_source WHERE org_id = $1 ORDER BY source_kind, identity LIMIT 6002) s) AS sources, (SELECT to_jsonb(a) FROM (SELECT entry_count::int, max_seq::int, head_hash, head_decision_id, updated_at FROM decision_chain_anchor WHERE org_id = $1) a) AS anchor, (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.authorized_at), '[]'::jsonb) FROM (SELECT lcm_digest, encode(manifest_bytes, 'base64') AS manifest_base64, encode(signature_bytes, 'base64') AS signature_base64, authorizing_actor, authorized_at, producer_kind, producer_id, produced_at, record_origin FROM decision_continuity_authorization WHERE org_id = $1 ORDER BY authorized_at LIMIT 3) c) AS authorizations",
    parameters: [{ name: "orgId", type: "uuid" }],
    resultValidator: "decisionRecordChain.v1",
    cardinality: "exactly-one",
    transactionClass: "tenant-guc-from-p1",
    authorityClass: "tenant",
  },
};
const ADMITTED: Record<string, { gatewayEntry: string; constructedDefinition: Record<string, unknown> }> = {
  "identity.lookupForLogin": {
    gatewayEntry: "enterIdentityLookupForLogin",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "identity_lookup_for_login_v1",
      canonicalSql: "SELECT id, org_id, display_name, role, credential_hash, credential_salt FROM identity WHERE login_email = $1",
      parameters: [{ name: "loginEmail", type: "text" }],
      resultValidator: "identityLoginRow.v1",
      cardinality: "at-most-one",
      transactionClass: "login-email-guc-from-p1",
      authorityClass: "credential-exchange",
    },
  },
  "session.create": {
    gatewayEntry: "enterSessionCreate",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "session_create_v1",
      canonicalSql: "INSERT INTO session (id, token_hash, identity_id, org_id, display_name, role, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      parameters: [
        { name: "id", type: "uuid" },
        { name: "tokenHash", type: "text" },
        { name: "identityId", type: "uuid" },
        { name: "orgId", type: "uuid" },
        { name: "displayName", type: "text" },
        { name: "role", type: "text" },
        { name: "expiresAt", type: "timestamptz" },
      ],
      resultValidator: "writeOne.v1",
      cardinality: "write-one",
      transactionClass: "session-token-guc-from-p2",
      authorityClass: "credential-exchange",
    },
  },
  "session.lookupByTokenHash": {
    gatewayEntry: "enterSessionLookupByTokenHash",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "session_lookup_by_token_hash_v1",
      canonicalSql: "SELECT identity_id, org_id, display_name, role, expires_at FROM session WHERE token_hash = $1 AND expires_at > now()",
      parameters: [{ name: "tokenHash", type: "text" }],
      resultValidator: "sessionRow.v1",
      cardinality: "at-most-one",
      transactionClass: "session-token-guc-from-p1",
      authorityClass: "pre-tenant",
    },
  },
  "session.rotate": {
    gatewayEntry: "enterSessionRotate",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "session_rotate_v1",
      canonicalSql:
        "UPDATE session SET token_hash = $2, created_at = now(), expires_at = now() + interval '12 hours' WHERE token_hash = $1 AND expires_at > now() AND created_at < now() - interval '6 hours'",
      parameters: [
        { name: "presentedTokenHash", type: "text" },
        { name: "nextTokenHash", type: "text" },
      ],
      resultValidator: "rowCount.v1",
      cardinality: "write-at-most-one",
      transactionClass: "session-rotate-guc-from-p1-p2",
      authorityClass: "session-renewal",
    },
  },
  "household.listForTenant": {
    gatewayEntry: "enterHouseholdListForTenant",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "household_list_for_tenant_v1",
      canonicalSql: "SELECT id, name, record_origin FROM household WHERE org_id = $1 ORDER BY name",
      parameters: [{ name: "orgId", type: "uuid" }],
      resultValidator: "householdRows.v1",
      cardinality: "many",
      transactionClass: "tenant-guc-from-p1",
      authorityClass: "tenant",
    },
  },
  "household.getForTenant": {
    gatewayEntry: "enterHouseholdGetForTenant",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "household_get_for_tenant_v1",
      canonicalSql: "SELECT id, name, record_origin, recorded_at FROM household WHERE org_id = $1 AND id = $2",
      parameters: [
        { name: "orgId", type: "uuid" },
        { name: "householdId", type: "uuid" },
      ],
      resultValidator: "householdDetail.v1",
      cardinality: "at-most-one",
      transactionClass: "tenant-guc-from-p1",
      authorityClass: "tenant",
    },
  },
  "observation.listForHousehold": {
    gatewayEntry: "enterObservationListForHousehold",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "observation_list_for_household_v2",
      canonicalSql:
        "SELECT id, kind, subject, body_json, source, observed_at, retrieved_at, record_origin FROM observation WHERE org_id = $1 AND household_id = $2 AND observed_at <= $3 ORDER BY kind, subject, observed_at, id LIMIT 201",
      parameters: [
        { name: "orgId", type: "uuid" },
        { name: "householdId", type: "uuid" },
        { name: "asOf", type: "timestamptz" },
        { name: "statementTimeoutMs", type: "text" },
      ],
      resultValidator: "observationRows.v1",
      cardinality: "many",
      transactionClass: "tenant-statement-deadline-from-p1-p4",
      authorityClass: "tenant",
    },
  },
  "policy.appendVersion": {
    gatewayEntry: "enterPolicyAppendVersion",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "policy_append_version_v1",
      canonicalSql:
        "WITH doc AS (INSERT INTO policy_document (org_id, digest, bytes, record_origin) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, digest) DO NOTHING) INSERT INTO policy_version (org_id, seq, digest, published_at, record_origin) VALUES ($1, COALESCE((SELECT max(seq) FROM policy_version WHERE org_id = $1), 0) + 1, $2, now(), $4) ON CONFLICT (org_id, digest) DO NOTHING RETURNING seq",
      parameters: [
        { name: "orgId", type: "uuid" },
        { name: "digest", type: "text" },
        { name: "bytes", type: "bytea" },
        { name: "recordOrigin", type: "text" },
        { name: "statementTimeoutMs", type: "text" },
      ],
      resultValidator: "rowCount.v1",
      cardinality: "write-at-most-one",
      transactionClass: "tenant-statement-deadline-from-p1-p5",
      authorityClass: "tenant",
    },
  },
  "policy.documentByDigest": {
    gatewayEntry: "enterPolicyDocumentByDigest",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "policy_document_by_digest_v1",
      canonicalSql:
        "SELECT v.seq, v.published_at, d.bytes, d.record_origin FROM policy_version v JOIN policy_document d ON d.org_id = v.org_id AND d.digest = v.digest WHERE v.org_id = $1 AND v.digest = $2 LIMIT 1",
      parameters: [
        { name: "orgId", type: "uuid" },
        { name: "digest", type: "text" },
        { name: "statementTimeoutMs", type: "text" },
      ],
      resultValidator: "policyVersionRow.v1",
      cardinality: "at-most-one",
      transactionClass: "tenant-statement-deadline-from-p1-p3",
      authorityClass: "tenant",
    },
  },
  "policy.versionsForFirm": {
    gatewayEntry: "enterPolicyVersionsForFirm",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "policy_versions_for_firm_v1",
      canonicalSql: "SELECT seq, digest, published_at, record_origin FROM policy_version WHERE org_id = $1 ORDER BY seq LIMIT 201",
      parameters: [
        { name: "orgId", type: "uuid" },
        { name: "statementTimeoutMs", type: "text" },
      ],
      resultValidator: "policyVersionRows.v1",
      cardinality: "many",
      transactionClass: "tenant-statement-deadline-from-p1-p2",
      authorityClass: "tenant",
    },
  },
  "decisionRecord.listForTenant": {
    gatewayEntry: "enterDecisionRecordListForTenant",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "decision_record_list_for_tenant_v1",
      canonicalSql:
        "SELECT p.decision_id, p.seq::int, p.replay_manifest_id, p.request_ref, p.household_slug, p.disposition, p.recorded_at, p.record_origin, encode(o.bytes, 'base64') AS outcome_base64 FROM decision_record_projection p JOIN decision_record_source o ON o.org_id = p.org_id AND o.source_kind = 'outcome' AND o.identity = ('dov.v1:' || substring(p.decision_id from 2)) WHERE p.org_id = $1 ORDER BY p.seq DESC LIMIT 201",
      parameters: [{ name: "orgId", type: "uuid" }],
      resultValidator: "decisionRecordListRows.v1",
      cardinality: "many",
      transactionClass: "tenant-guc-from-p1",
      authorityClass: "tenant",
    },
  },
  "decisionRecord.resolveHead": {
    gatewayEntry: "enterDecisionRecordResolveHead",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "decision_record_resolve_head_v1",
      canonicalSql:
        "SELECT a.head_decision_id, a.entry_count::int, a.max_seq::int, a.head_hash, encode(o.bytes, 'base64') AS outcome_base64 FROM decision_chain_anchor a LEFT JOIN decision_record_source o ON o.org_id = a.org_id AND o.source_kind = 'outcome' AND o.identity = ('dov.v1:' || substring(a.head_decision_id from 2)) WHERE a.org_id = $1",
      parameters: [{ name: "orgId", type: "uuid" }],
      resultValidator: "decisionRecordHead.v1",
      cardinality: "at-most-one",
      transactionClass: "tenant-guc-from-p1",
      authorityClass: "tenant",
    },
  },
  "decisionRecord.append": {
    gatewayEntry: "enterDecisionRecordAppend",
    constructedDefinition: {
      kind: "closed-store-command",
      command: "decision-record-append.v1",
      inputValidator: "decisionRecordAppendInput.v1",
      resultValidator: "decisionRecordAppendResult.v1",
      transactionClass: "tenant-decision-append-from-p1",
      authorityClass: "tenant",
    },
  },
  "decisionRecord.loadById": {
    gatewayEntry: "enterDecisionRecordLoadById",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "decision_record_load_by_id_v1",
      canonicalSql:
        "SELECT p.decision_id, p.seq::int, p.replay_manifest_id, p.request_ref, p.household_slug, p.disposition, p.recorded_at, p.record_origin, l.entry_id, l.prev_hash, l.entry_hash, encode(l.envelope_bytes, 'base64') AS envelope_base64, encode(o.bytes, 'base64') AS outcome_base64, encode(m.bytes, 'base64') AS manifest_base64, o.producer_kind, o.producer_id, o.produced_at FROM decision_record_projection p JOIN decision_ledger l ON l.org_id = p.org_id AND l.seq = p.seq JOIN decision_record_source o ON o.org_id = p.org_id AND o.source_kind = 'outcome' AND o.identity = ('dov.v1:' || substring(p.decision_id from 2)) JOIN decision_record_source m ON m.org_id = p.org_id AND m.source_kind = 'replay-manifest' AND m.identity = p.replay_manifest_id WHERE p.org_id = $1 AND p.decision_id = $2 LIMIT 1",
      parameters: [
        { name: "orgId", type: "uuid" },
        { name: "decisionId", type: "text" },
      ],
      resultValidator: "decisionRecordDetail.v1",
      cardinality: "at-most-one",
      transactionClass: "tenant-guc-from-p1",
      authorityClass: "tenant",
    },
  },
  "decisionRecord.readChain": {
    gatewayEntry: "enterDecisionRecordReadChain",
    constructedDefinition: {
      kind: "prepared-query",
      statementName: "decision_record_read_chain_v1",
      canonicalSql:
        "SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.seq), '[]'::jsonb) FROM (SELECT seq::int, entry_id, decision_id, replay_manifest_id, encode(envelope_bytes, 'base64') AS envelope_base64, prev_hash, entry_hash, recorded_at, producer_kind, producer_id, produced_at, record_origin FROM decision_ledger WHERE org_id = $1 ORDER BY seq LIMIT 1002) e) AS entries, (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind, s.identity), '[]'::jsonb) FROM (SELECT source_kind, identity, encode(bytes, 'base64') AS bytes_base64, producer_kind, producer_id, produced_at, record_origin FROM decision_record_source WHERE org_id = $1 ORDER BY source_kind, identity LIMIT 6002) s) AS sources, (SELECT to_jsonb(a) FROM (SELECT entry_count::int, max_seq::int, head_hash, head_decision_id, updated_at FROM decision_chain_anchor WHERE org_id = $1) a) AS anchor, (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.authorized_at), '[]'::jsonb) FROM (SELECT lcm_digest, encode(manifest_bytes, 'base64') AS manifest_base64, encode(signature_bytes, 'base64') AS signature_base64, authorizing_actor, authorized_at, producer_kind, producer_id, produced_at, record_origin FROM decision_continuity_authorization WHERE org_id = $1 ORDER BY authorized_at LIMIT 3) c) AS authorizations",
      parameters: [{ name: "orgId", type: "uuid" }],
      resultValidator: "decisionRecordChain.v1",
      cardinality: "exactly-one",
      transactionClass: "tenant-guc-from-p1",
      authorityClass: "tenant",
    },
  },
};

export const NAMING_PATTERN = "verin.op.{id}";
const opName = (id: string) => `verin.op.${id}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const EFFECT_SHAPES: Record<string, readonly string[]> = {
  "prepared-query": ["statementName", "canonicalSql", "parameters", "resultValidator", "cardinality", "transactionClass", "authorityClass"],
  "closed-store-command": ["command", "inputValidator", "resultValidator", "transactionClass", "authorityClass"],
};
function canonicalize(x: unknown, path: string, problems: string[]): string {
  if (typeof x === "string") {
    if (x === "") problems.push(`${path} is empty`);
    return JSON.stringify(x);
  }
  if (typeof x === "number" || typeof x === "boolean") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map((e, i) => canonicalize(e, `${path}[${i}]`, problems)).join(",") + "]";
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    for (const bad of ["$function", "$callerControlled", "$unresolved"]) if (o[bad]) problems.push(`${path} is ${bad.slice(1)}`);
    const keys = Object.keys(o).sort();
    if (keys.length === 0) problems.push(`${path} is empty`);
    return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonicalize(o[k], `${path}.${k}`, problems)}`).join(",") + "}";
  }
  problems.push(`${path} is not closed data (${typeof x})`);
  return "null";
}
function deriveEffect(def: Record<string, unknown>): { id: string; bytes: string } {
  const problems: string[] = [];
  const shape = EFFECT_SHAPES[String(def["kind"])] ?? null;
  if (!shape) problems.push(`kind '${String(def["kind"])}' is not an admitted effect kind`);
  for (const f of shape ?? []) if (!(f in def)) problems.push(`required field '${f}' is missing`);
  for (const f of Object.keys(def)) if (f !== "kind" && !(shape ?? []).includes(f)) problems.push(`unknown field '${f}'`);
  const bytes = "semfx.v1|" + canonicalize(def, "definition", problems);
  if (problems.length) throw new Error(`semantic-effect definition refused before construction: ${problems.join("; ")}`);
  return { id: "semfx.v1:" + sha256(bytes), bytes };
}

type StoreValues = Record<string, string | Uint8Array>;
export type Gateway = {
  enterRouteSignIn: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterRouteHouseholds: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterRouteHouseholdWorkspace: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterAccessAuthenticate: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterAccessAuthorize: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterAccessWithTenant: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterAccessRenewSession: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterIdentityLookupForLogin: (c: RequestCorrelation, v: { loginEmail: string }) => Promise<unknown>;
  enterSessionCreate: (c: RequestCorrelation, v: { id: string; tokenHash: string; identityId: string; orgId: string; displayName: string; role: string; expiresAt: string }) => Promise<unknown>;
  enterSessionLookupByTokenHash: (c: RequestCorrelation, v: { tokenHash: string }) => Promise<unknown>;
  enterSessionRotate: (c: RequestCorrelation, v: { presentedTokenHash: string; nextTokenHash: string }) => Promise<unknown>;
  enterHouseholdListForTenant: (c: RequestCorrelation, v: { orgId: string }) => Promise<unknown>;
  enterHouseholdGetForTenant: (c: RequestCorrelation, v: { orgId: string; householdId: string }) => Promise<unknown>;
  enterEvidenceAssemble: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterObservationListForHousehold: (c: RequestCorrelation, v: { orgId: string; householdId: string; asOf: string; statementTimeoutMs: string }) => Promise<unknown>;
  enterRoutePolicy: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterPolicyPublish: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterPolicyResolveByHash: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterPolicyAppendVersion: (c: RequestCorrelation, v: { orgId: string; digest: string; bytes: Uint8Array; recordOrigin: string; statementTimeoutMs: string }) => Promise<unknown>;
  enterPolicyDocumentByDigest: (c: RequestCorrelation, v: { orgId: string; digest: string; statementTimeoutMs: string }) => Promise<unknown>;
  enterPolicyResolveInForce: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterPolicyHistory: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterPolicyVersionsForFirm: (c: RequestCorrelation, v: { orgId: string; statementTimeoutMs: string }) => Promise<unknown>;
  enterRouteDecision: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRenderOutcome: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterRouteDecisionCompare: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionCompareSide: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterRouteConformance: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterConformanceRunner: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterConformanceReadSignedCase: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterConformanceGrade: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterRouteDecisionRecords: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRecordList: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRecordListForTenant: (c: RequestCorrelation, v: { orgId: string }) => Promise<unknown>;
  enterRouteDecisionChainVerify: <T>(c: RequestCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRecordResolveHead: (c: RequestCorrelation, v: { orgId: string }) => Promise<unknown>;
  enterRouteDecisionRecord: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRecordRecord: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRecordAppend: (c: DecisionCorrelation, input: DecisionRecordAppendInput) => Promise<DecisionRecordAppendResult>;
  enterDecisionRecordLoad: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRecordLoadById: (c: DecisionCorrelation, v: { orgId: string; decisionId: string }) => Promise<unknown>;
  enterDecisionRecordVerify: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => Promise<T>;
  enterDecisionRecordReadChain: (c: DecisionCorrelation, v: { orgId: string }) => Promise<unknown>;
  sealCookieValue: (token: string) => string;
  openCookieValue: (cookieValue: string) => string | null;
  secureCookies: boolean;
  runtimeRole: "web" | "tooling";
};
const atMostOne = (r: QueryResult, schema: z.ZodType) => {
  if (r.rows.length > 1) throw new Error("cardinality at-most-one violated");
  return r.rows.length ? schema.parse(r.rows[0]) : null;
};
const VALIDATORS: Record<string, (r: QueryResult) => unknown> = {
  "identityLoginRow.v1": (r) =>
    atMostOne(r, z.strictObject({ id: z.string(), org_id: z.string(), display_name: z.string(), role: z.string(), credential_hash: z.string(), credential_salt: z.string() })),
  "sessionRow.v1": (r) => atMostOne(r, z.strictObject({ identity_id: z.string(), org_id: z.string(), display_name: z.string(), role: z.string(), expires_at: z.date() })),
  "rowCount.v1": (r) => r.rowCount ?? 0,
  "writeOne.v1": (r) => {
    if (r.rowCount !== 1) throw new Error("cardinality write-one violated");
    return null;
  },
  "householdRows.v1": (r) => r.rows.map((x) => z.strictObject({ id: z.string(), name: z.string(), record_origin: z.string() }).parse(x)),
  "householdDetail.v1": (r) => atMostOne(r, z.strictObject({ id: z.string(), name: z.string(), record_origin: z.string(), recorded_at: z.date().nullable() })),
  "observationRows.v1": (r) =>
    r.rows.map((x) =>
      z
        .strictObject({
          id: z.string(),
          kind: z.string(),
          subject: z.string(),
          body_json: z.record(z.string(), z.string()),
          source: z.string(),
          observed_at: z.date(),
          retrieved_at: z.date(),
          record_origin: z.string(),
        })
        .parse(x),
    ),
  "policyVersionRow.v1": (r) => atMostOne(r, z.strictObject({ seq: z.number().int(), published_at: z.date(), bytes: z.instanceof(Uint8Array), record_origin: z.string() })),
  "policyVersionRows.v1": (r) => r.rows.map((x) => z.strictObject({ seq: z.number().int(), digest: z.string(), published_at: z.date(), record_origin: z.string() }).parse(x)),
  "decisionRecordListRows.v1": (r) =>
    r.rows.map((x) =>
      z
        .strictObject({
          decision_id: z.string(),
          seq: z.number().int(),
          replay_manifest_id: z.string(),
          request_ref: z.string(),
          household_slug: z.string(),
          disposition: z.enum(["proceed", "blocked", "prohibited"]),
          recorded_at: z.date(),
          record_origin: z.string(),
          outcome_base64: z.string(),
        })
        .parse(x),
    ),
  "decisionRecordHead.v1": (r) =>
    atMostOne(r, z.strictObject({ head_decision_id: z.string().nullable(), entry_count: z.number().int(), max_seq: z.number().int(), head_hash: z.string(), outcome_base64: z.string().nullable() })),
  "decisionRecordDetail.v1": (r) =>
    atMostOne(
      r,
      z.strictObject({
        decision_id: z.string(),
        seq: z.number().int(),
        replay_manifest_id: z.string(),
        request_ref: z.string(),
        household_slug: z.string(),
        disposition: z.enum(["proceed", "blocked", "prohibited"]),
        recorded_at: z.date(),
        record_origin: z.string(),
        entry_id: z.string(),
        prev_hash: z.string(),
        entry_hash: z.string(),
        envelope_base64: z.string(),
        outcome_base64: z.string(),
        manifest_base64: z.string(),
        producer_kind: z.string(),
        producer_id: z.string(),
        produced_at: z.date(),
      }),
    ),
  "decisionRecordChain.v1": (r) => {
    if (r.rows.length !== 1) throw new Error("cardinality exactly-one violated");
    return z
      .strictObject({
        entries: z.array(z.record(z.string(), z.unknown())),
        sources: z.array(z.record(z.string(), z.unknown())),
        anchor: z.record(z.string(), z.unknown()).nullable(),
        authorizations: z.array(z.record(z.string(), z.unknown())),
      })
      .parse(r.rows[0]);
  },
};

// The one-per-process slot lives on globalThis, not a module-local variable: the framework bundles
// the instrumentation root and route handlers into separate module instances (the oracle's store
// sharp edge, main:CLAUDE.md), and a module-local slot would leave the page's copy unconstructed.
type Slot = { gateway: Gateway; snapshot: () => Promise<Record<string, unknown>>; annotate: (attrs: Record<string, string | boolean>) => void };
const SLOT = Symbol.for("verin.governed-runtime");
const slot = () => (globalThis as { [SLOT]?: Slot })[SLOT];

// Declared-domain annotation (prompt 4): only declared attributes, validated BEFORE emission.
export function annotateOperation(attrs: Record<string, string | boolean>): void {
  const s = slot();
  if (!s) throw new Error("annotateOperation requires a constructed governed runtime");
  s.annotate(attrs);
}

export function createGovernedRuntime(role: "web" | "tooling"): Gateway {
  if (slot()) throw new Error("the governed runtime is already constructed in this process; a second construction is refused, not cached");

  // Consume credentials: read once, delete from the environment, never hand out.
  const dbUrl = process.env["VERIN_APP_DATABASE_URL"] ?? "postgresql://verin_app:verin-app-local@localhost:5432/verin";
  const cookieKey = process.env["VERIN_COOKIE_KEY"] ?? "verin-local-dev-cookie-signing";
  delete process.env["VERIN_APP_DATABASE_URL"];
  delete process.env["VERIN_COOKIE_KEY"];
  const secureCookies = (process.env["APP_ENV"] ?? "development") === "production";
  const pool = new Pool({ connectionString: dbUrl, max: 5 });
  // Construction-time comparison of the independently declared definitions, in both directions.
  const derived = new Map<string, { id: string; bytes: string }>();
  for (const r of REGISTRY) {
    const reg = REGISTRY_EFFECTS[r.id.id],
      adm = ADMITTED[r.id.id];
    if (r.class === "store") {
      if (!reg || !adm) throw new Error(`store operation '${r.id.id}' is missing its registry or admitted definition`);
      if (adm.gatewayEntry !== r.gatewayEntry) throw new Error(`admitted gateway symbol '${adm.gatewayEntry}' differs from the registry's '${r.gatewayEntry}'`);
      const a = deriveEffect(reg),
        b = deriveEffect(adm.constructedDefinition);
      if (a.id !== b.id) throw new Error(`refusing construction: registry digest ${a.id} != constructed digest ${b.id} for '${r.id.id}'`);
      derived.set(r.id.id, a);
    } else if (reg || adm) throw new Error(`non-effect operation '${r.id.id}' may not carry a semantic-effect definition`);
    if (r.slice === 6 && PROMPT6_CORRELATIONS[r.id.id] !== r.correlation)
      throw new Error(`prompt 6 correlation table declares '${PROMPT6_CORRELATIONS[r.id.id]}' but registry row '${r.id.id}' declares '${r.correlation}'`);
  }
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: "verin", "verin.runtime.role": role });
  const spanExporter = new InMemorySpanExporter();
  const tracer = new NodeTracerProvider({ resource, spanProcessors: [new SimpleSpanProcessor(spanExporter)] }).getTracer("verin");
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 2 ** 30 });
  const meter = new MeterProvider({ resource, readers: [metricReader] }).getMeter("verin");
  const counters = new Map<string, Counter>(REGISTRY.map((r) => [r.id.id, meter.createCounter(`${opName(r.id.id)}.${r.metric}`)]));
  const rows = new Map(REGISTRY.map((r) => [r.id.id, r]));
  const graph: Record<string, unknown>[] = [],
    invocations: Record<string, unknown>[] = [],
    rawExecutions: Record<string, unknown>[] = [],
    logs: Record<string, unknown>[] = [];
  const spanToNode = new Map<string, string>();
  const als = new AsyncLocalStorage<{ node: string; op: OpKey; pending: Record<string, string | boolean> }>();
  let seq = 0;
  const annotate = (attrs: Record<string, string | boolean>): void => {
    const store = als.getStore();
    if (!store) throw new Error("annotateOperation requires an ambient governed operation");
    const r = rows.get(store.op)!;
    for (const [key, value] of Object.entries(attrs)) {
      const dom = r.attributes[key];
      if (!dom) throw new Error(`operation '${store.op}' declares no attribute '${key}'; an undeclared attribute is unbounded cardinality and is refused`);
      const ok =
        dom.domain === "boolean"
          ? typeof value === "boolean"
          : dom.domain === "enum" || dom.domain === "bucketed"
            ? typeof value === "string" && dom.values.includes(value)
            : typeof value === "string" && /^[0-9a-f]{16,64}$/.test(value);
      if (!ok) throw new Error(`attribute '${key}' on '${store.op}' is outside its declared ${dom.domain} domain; refusing on cardinality`);
      store.pending[key] = value;
    }
  };

  // The sealed correlation contract, validated per the row's DECLARED kind: every required field
  // must carry the exact purpose tag it was minted under - a value cannot pose as another identifier.
  const KIND_FIELDS: Record<Row["correlation"], readonly ("requestId" | "decisionId")[]> = { RequestCorrelation: ["requestId"], DecisionCorrelation: ["requestId", "decisionId"] };
  async function enter<T>(id: OpKey, c: RequestCorrelation | DecisionCorrelation, fn: () => Promise<T>): Promise<T> {
    const r = rows.get(id)!;
    const fields = (c as { fields?: Record<string, { value?: unknown; purpose?: unknown } | undefined> })?.fields ?? {};
    if ((c as { kind?: unknown })?.kind !== r.correlation) throw new Error(`operation '${id}' requires correlation kind '${r.correlation}'; refusing`);
    for (const f of KIND_FIELDS[r.correlation]) {
      if (!fields[f]?.value) throw new Error(`correlation for '${id}' is missing required field '${f}'; the runtime fails closed`);
      if (fields[f]!.purpose !== f) throw new Error(`correlation field '${f}' carries purpose tag '${String(fields[f]!.purpose)}'; a value cannot pose as another identifier`);
    }
    if (!MINTED.has(c as object)) throw new Error(`correlation for '${id}' was not minted by the sealed factory; a forged value is refused at the gateway`);
    const parent = als.getStore();
    if (!r.permittedParents.includes(parent ? parent.op : "entry"))
      throw new Error(`operation '${id}' entered under parent '${parent ? parent.op : "entry"}', which is not in its declared permittedParents`);
    const fx = derived.get(id)?.id;
    const node = `n${++seq}`;
    graph.push({ node, op: id, gatewayEntry: r.gatewayEntry, parent: parent ? parent.node : "entry", ...(fx ? { semanticEffectId: fx } : {}), correlation: { kind: c.kind, fields: c.fields } });
    const span = tracer.startSpan(opName(id));
    spanToNode.set(span.spanContext().spanId, node);
    MINTED_IDS.push(span.spanContext().spanId, span.spanContext().traceId);
    let outcome = "ok";
    const ctx = { node, op: id, pending: {} as Record<string, string | boolean> };
    try {
      return await als.run(ctx, fn);
    } catch (e) {
      outcome = "error";
      throw e;
    } finally {
      // The product-side detector at the emission boundary (prompt 3, GD-003): every attribute and
      // log field is scanned with the checker's exact forms before it leaves; a refusal fails closed.
      // Annotated attributes were already validated against their declared domains; an annotated
      // outcome (a typed refusal) overrides the computed one.
      const finalOutcome = typeof ctx.pending["outcome"] === "string" ? (ctx.pending["outcome"] as string) : outcome;
      const idAttrs = Object.fromEntries(KIND_FIELDS[r.correlation].map((f) => [f, String(fields[f]!.value)]));
      const attrs = { ...idAttrs, ...ctx.pending, outcome: finalOutcome };
      const rec = {
        name: opName(id),
        node,
        ...(fx ? { semanticEffectId: fx } : {}),
        fields: {
          ...Object.fromEntries(Object.entries(ctx.pending).map(([k, x]) => [k, String(x)])),
          ...idAttrs,
          outcome: finalOutcome,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
        },
      };
      const metricAttrs = { ...idAttrs, ...(fx ? { semanticEffectId: fx } : {}) };
      for (const emitted of [attrs, rec.fields, metricAttrs]) refuseAccountReferences(emitted, { operation: id, boundary: "log" });
      span.setAttributes(attrs);
      span.end();
      counters.get(id)!.add(1, metricAttrs);
      logs.push(rec);
      process.stdout.write(JSON.stringify(rec) + "\n");
    }
  }
  async function runStore(id: OpKey, c: RequestCorrelation | DecisionCorrelation, values: StoreValues): Promise<unknown> {
    invocations.push({ op: id, gatewayEntry: rows.get(id)!.gatewayEntry, semanticEffectId: derived.get(id)!.id });
    return enter(id, c, async () => {
      // The admitted definition is canonicalised AGAIN at raw execution; the captured id is recomputed.
      const def = ADMITTED[id].constructedDefinition,
        fx = deriveEffect(def);
      const params = (def["parameters"] as { name: string }[]).map((p) => values[p.name]);
      let queryParams = params;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tc = def["transactionClass"];
        if (tc === "login-email-guc-from-p1") await client.query("SELECT set_config('verin.login_email', $1, true)", [params[0]]);
        else if (tc === "session-token-guc-from-p1") await client.query("SELECT set_config('verin.session_token_hash', $1, true)", [params[0]]);
        else if (tc === "session-token-guc-from-p2") await client.query("SELECT set_config('verin.session_token_hash', $1, true)", [params[1]]);
        else if (tc === "tenant-guc-from-p1") await client.query("SELECT set_config('verin.org_id', $1, true)", [params[0]]);
        else if (tc === "session-rotate-guc-from-p1-p2") {
          await client.query("SELECT set_config('verin.session_token_hash', $1, true)", [params[0]]);
          await client.query("SELECT set_config('verin.session_token_next', $1, true)", [params[1]]);
        } else if (typeof tc === "string" && /^tenant-statement-deadline-from-p1-p[2-9]$/.test(tc)) {
          // The timeout derives from the route-minted deadline, the class's LAST parameter, which
          // never reaches the binds (slice 3's p4 form; slice 4 adds p3 and p5).
          const last = Number(tc.slice(-1));
          await client.query("SELECT set_config('verin.org_id', $1, true)", [params[0]]);
          await client.query("SELECT set_config('statement_timeout', $1, true)", [params[last - 1]]);
          queryParams = params.slice(0, last - 1);
        } else throw new Error(`transaction class '${String(tc)}' is not admitted`);
        const res = await client.query({ name: String(def["statementName"]), text: String(def["canonicalSql"]), values: queryParams });
        rawExecutions.push({ op: id, gatewayEntry: rows.get(id)!.gatewayEntry, semanticEffectId: fx.id, canonicalBytes: fx.bytes });
        const out = VALIDATORS[String(def["resultValidator"])](res);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    });
  }
  async function runDecisionRecordAppend(c: DecisionCorrelation, raw: DecisionRecordAppendInput): Promise<DecisionRecordAppendResult> {
    const id: OpKey = "decisionRecord.append";
    invocations.push({ op: id, gatewayEntry: rows.get(id)!.gatewayEntry, semanticEffectId: derived.get(id)!.id });
    return enter(id, c, async () => {
      const input = validateAppendInput(raw);
      if (c.fields.decisionId.value !== input.decisionId.slice(1)) throw new Error("decisionRecord.append refuses a correlation whose real dov.v1 identity differs from the record input");
      const def = ADMITTED[id].constructedDefinition;
      const fx = deriveEffect(def);
      if (def["command"] !== "decision-record-append.v1" || def["transactionClass"] !== "tenant-decision-append-from-p1")
        throw new Error("the closed decisionRecord.append command shape is not the ratified one");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('verin.org_id', $1, true)", [input.orgId]);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.orgId]);
        const existing = await client.query("SELECT l.seq::int, l.entry_id, l.entry_hash, l.replay_manifest_id FROM decision_ledger l WHERE l.org_id = $1 AND l.decision_id = $2", [
          input.orgId,
          input.decisionId,
        ]);
        if (existing.rows.length > 1) throw new Error("decisionRecord.append refuses a fork: one DecisionId has multiple ledger entries");
        if (existing.rows.length === 1) {
          const found = z.strictObject({ seq: z.number().int(), entry_id: z.string(), entry_hash: z.string(), replay_manifest_id: z.string() }).parse(existing.rows[0]);
          if (found.replay_manifest_id !== input.manifest.identity)
            throw new Error(`decisionRecord.append refuses idempotency conflict: ${input.decisionId} already cites ${found.replay_manifest_id}, not ${input.manifest.identity}`);
          const result = { entryId: found.entry_id, sequence: found.seq, chainHash: found.entry_hash, replayManifestId: found.replay_manifest_id, alreadyRecorded: true };
          await client.query("COMMIT");
          rawExecutions.push({ op: id, gatewayEntry: rows.get(id)!.gatewayEntry, semanticEffectId: fx.id, canonicalBytes: fx.bytes });
          return result;
        }

        const anchorResult = await client.query("SELECT entry_count::int, max_seq::int, head_hash, head_decision_id FROM decision_chain_anchor WHERE org_id = $1 FOR UPDATE", [input.orgId]);
        if (anchorResult.rows.length > 1) throw new Error("decisionRecord.append refuses multiple chain anchors for one tenant");
        let anchor = anchorResult.rows.length
          ? z.strictObject({ entry_count: z.number().int(), max_seq: z.number().int(), head_hash: z.string(), head_decision_id: z.string().nullable() }).parse(anchorResult.rows[0])
          : null;
        if (anchor && anchor.entry_count !== anchor.max_seq + 1) throw new Error("decisionRecord.append refuses an anchor whose count and maximum sequence disagree");
        if (!anchor) {
          const anyLedger = await client.query("SELECT seq FROM decision_ledger WHERE org_id = $1 LIMIT 1", [input.orgId]);
          if (anyLedger.rows.length) throw new Error("decisionRecord.append refuses a chain with ledger rows but no anchor");
          const authorization = await client.query("SELECT lcm_digest FROM decision_continuity_authorization WHERE org_id = $1 ORDER BY authorized_at LIMIT 2", [input.orgId]);
          if (authorization.rows.length === 0) throw new Error("continuity-boundary-not-authorized: no lcm.v1 authorization exists for this tenant");
          if (authorization.rows.length !== 1) throw new Error("continuity-boundary-ambiguous: more than one lcm.v1 authorization exists for this tenant");
          const lcmDigest = z.strictObject({ lcm_digest: z.string().regex(/^lcm\.v1:[0-9a-f]{64}$/) }).parse(authorization.rows[0]).lcm_digest;
          const envelope = genesisEnvelope(input.orgId, lcmDigest, input.recordedAt, input.producer);
          const genesisEntryId = entryId(envelope);
          const genesisHash = chainHash(envelope, GENESIS_PREV_HASH);
          await client.query(
            "INSERT INTO decision_ledger (org_id, seq, entry_id, decision_id, replay_manifest_id, envelope_bytes, prev_hash, entry_hash, recorded_at, producer_kind, producer_id, produced_at, record_origin) VALUES ($1, 0, $2, NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10)",
            [
              input.orgId,
              genesisEntryId,
              Buffer.from(envelope),
              GENESIS_PREV_HASH,
              genesisHash,
              input.recordedAt,
              input.producer.kind,
              input.producer.id,
              input.producer.producedAt,
              input.recordOrigin,
            ],
          );
          await client.query("INSERT INTO decision_chain_anchor (org_id, entry_count, max_seq, head_hash, head_decision_id, updated_at) VALUES ($1, 1, 0, $2, NULL, $3)", [
            input.orgId,
            genesisHash,
            input.recordedAt,
          ]);
          anchor = { entry_count: 1, max_seq: 0, head_hash: genesisHash, head_decision_id: null };
        }

        const sourceRows = [
          input.sources.request,
          input.sources.evidence,
          input.sources.policy,
          input.sources.engine,
          input.sources.outcome,
          { kind: "replay-manifest" as const, identity: input.manifest.identity, bytes: input.manifest.bytes },
        ];
        for (const source of sourceRows) {
          await client.query(
            "INSERT INTO decision_record_source (org_id, source_kind, identity, bytes, producer_kind, producer_id, produced_at, record_origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (org_id, source_kind, identity) DO NOTHING",
            [input.orgId, source.kind, source.identity, Buffer.from(source.bytes), input.producer.kind, input.producer.id, input.producer.producedAt, input.recordOrigin],
          );
          const stored = await client.query("SELECT bytes FROM decision_record_source WHERE org_id = $1 AND source_kind = $2 AND identity = $3", [input.orgId, source.kind, source.identity]);
          if (stored.rows.length !== 1 || !Buffer.from(z.strictObject({ bytes: z.instanceof(Uint8Array) }).parse(stored.rows[0]).bytes).equals(Buffer.from(source.bytes)))
            throw new Error(`decisionRecord.append refuses source collision for '${source.kind}' identity ${source.identity}: stored bytes differ`);
        }

        const sequence = anchor.max_seq + 1;
        const envelope = decisionEnvelope(input, sequence);
        const nextEntryId = entryId(envelope);
        const nextHash = chainHash(envelope, anchor.head_hash);
        await client.query(
          "INSERT INTO decision_ledger (org_id, seq, entry_id, decision_id, replay_manifest_id, envelope_bytes, prev_hash, entry_hash, recorded_at, producer_kind, producer_id, produced_at, record_origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
          [
            input.orgId,
            sequence,
            nextEntryId,
            input.decisionId,
            input.manifest.identity,
            Buffer.from(envelope),
            anchor.head_hash,
            nextHash,
            input.recordedAt,
            input.producer.kind,
            input.producer.id,
            input.producer.producedAt,
            input.recordOrigin,
          ],
        );
        await client.query(
          "INSERT INTO decision_record_projection (org_id, decision_id, seq, replay_manifest_id, request_ref, household_slug, disposition, recorded_at, record_origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [
            input.orgId,
            input.decisionId,
            sequence,
            input.manifest.identity,
            input.projection.requestRef,
            input.projection.householdSlug,
            input.projection.disposition,
            input.recordedAt,
            input.recordOrigin,
          ],
        );
        const moved = await client.query(
          "UPDATE decision_chain_anchor SET entry_count = $2, max_seq = $3, head_hash = $4, head_decision_id = $5, updated_at = $6 WHERE org_id = $1 AND entry_count = $7 AND max_seq = $8 AND head_hash = $9",
          [input.orgId, anchor.entry_count + 1, sequence, nextHash, input.decisionId, input.recordedAt, anchor.entry_count, anchor.max_seq, anchor.head_hash],
        );
        if (moved.rowCount !== 1) throw new Error("decisionRecord.append refuses an anchor that moved outside the tenant append lock");
        await client.query("COMMIT");
        rawExecutions.push({ op: id, gatewayEntry: rows.get(id)!.gatewayEntry, semanticEffectId: fx.id, canonicalBytes: fx.bytes });
        return { entryId: nextEntryId, sequence, chainHash: nextHash, replayManifestId: input.manifest.identity, alreadyRecorded: false };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    });
  }
  const hmac = (t: string) => createHmac("sha256", cookieKey).update(t).digest("hex");
  const G: Gateway = Object.freeze({
    enterRouteSignIn: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.sign-in", c, fn),
    enterRouteHouseholds: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.households", c, fn),
    enterRouteHouseholdWorkspace: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.household-workspace", c, fn),
    enterAccessAuthenticate: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("access.authenticate", c, fn),
    enterAccessAuthorize: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("access.authorize", c, fn),
    enterAccessWithTenant: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("access.withTenant", c, fn),
    enterAccessRenewSession: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("access.renewSession", c, fn),
    enterIdentityLookupForLogin: (c: RequestCorrelation, v: { loginEmail: string }) => runStore("identity.lookupForLogin", c, v),
    enterSessionCreate: (c: RequestCorrelation, v: Parameters<Gateway["enterSessionCreate"]>[1]) => runStore("session.create", c, v),
    enterSessionLookupByTokenHash: (c: RequestCorrelation, v: { tokenHash: string }) => runStore("session.lookupByTokenHash", c, v),
    enterSessionRotate: (c: RequestCorrelation, v: { presentedTokenHash: string; nextTokenHash: string }) => runStore("session.rotate", c, v),
    enterHouseholdListForTenant: (c: RequestCorrelation, v: { orgId: string }) => runStore("household.listForTenant", c, v),
    enterHouseholdGetForTenant: (c: RequestCorrelation, v: { orgId: string; householdId: string }) => runStore("household.getForTenant", c, v),
    enterEvidenceAssemble: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("evidence.assemble", c, fn),
    enterObservationListForHousehold: (c: RequestCorrelation, v: { orgId: string; householdId: string; asOf: string; statementTimeoutMs: string }) => runStore("observation.listForHousehold", c, v),
    enterRoutePolicy: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.policy", c, fn),
    enterPolicyPublish: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("policy.publish", c, fn),
    enterPolicyResolveByHash: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("policy.resolveByHash", c, fn),
    enterPolicyAppendVersion: (c: RequestCorrelation, v: Parameters<Gateway["enterPolicyAppendVersion"]>[1]) => runStore("policy.appendVersion", c, v),
    enterPolicyDocumentByDigest: (c: RequestCorrelation, v: { orgId: string; digest: string; statementTimeoutMs: string }) => runStore("policy.documentByDigest", c, v),
    enterPolicyResolveInForce: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("policy.resolveInForce", c, fn),
    enterPolicyHistory: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("policy.history", c, fn),
    enterPolicyVersionsForFirm: (c: RequestCorrelation, v: { orgId: string; statementTimeoutMs: string }) => runStore("policy.versionsForFirm", c, v),
    enterRouteDecision: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.decision", c, fn),
    enterDecisionRenderOutcome: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => enter("decision.renderOutcome", c, fn),
    enterRouteDecisionCompare: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.decision-compare", c, fn),
    enterDecisionCompareSide: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => enter("decision.compareSide", c, fn),
    enterRouteConformance: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.conformance", c, fn),
    enterConformanceRunner: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("conformance.runner", c, fn),
    enterConformanceReadSignedCase: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("conformance.readSignedCase", c, fn),
    enterConformanceGrade: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => enter("conformance.grade", c, fn),
    enterRouteDecisionRecords: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.decision-records", c, fn),
    enterDecisionRecordList: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("decisionRecord.list", c, fn),
    enterDecisionRecordListForTenant: (c: RequestCorrelation, v: { orgId: string }) => runStore("decisionRecord.listForTenant", c, v),
    enterRouteDecisionChainVerify: <T>(c: RequestCorrelation, fn: () => Promise<T>) => enter("route.decision-chain-verify", c, fn),
    enterDecisionRecordResolveHead: (c: RequestCorrelation, v: { orgId: string }) => runStore("decisionRecord.resolveHead", c, v),
    enterRouteDecisionRecord: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => enter("route.decision-record", c, fn),
    enterDecisionRecordRecord: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => enter("decisionRecord.record", c, fn),
    enterDecisionRecordAppend: (c: DecisionCorrelation, input: DecisionRecordAppendInput) => runDecisionRecordAppend(c, input),
    enterDecisionRecordLoad: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => enter("decisionRecord.load", c, fn),
    enterDecisionRecordLoadById: (c: DecisionCorrelation, v: { orgId: string; decisionId: string }) => runStore("decisionRecord.loadById", c, v),
    enterDecisionRecordVerify: <T>(c: DecisionCorrelation, fn: () => Promise<T>) => enter("decisionRecord.verify", c, fn),
    enterDecisionRecordReadChain: (c: DecisionCorrelation, v: { orgId: string }) => runStore("decisionRecord.readChain", c, v),
    sealCookieValue: (token: string) => `${token}.${hmac(token)}`,
    openCookieValue: (v: string) => {
      const dot = v.lastIndexOf(".");
      if (dot < 1) return null;
      const token = v.slice(0, dot),
        sig = Buffer.from(v.slice(dot + 1)),
        want = Buffer.from(hmac(token));
      return sig.length === want.length && timingSafeEqual(sig, want) ? token : null;
    },
    secureCookies,
    runtimeRole: role,
  });
  const SNAP: Slot["snapshot"] = async () => {
    await metricReader.forceFlush();
    const fxOf = (node: string) => (graph.find((g) => g["node"] === node) as { semanticEffectId?: string } | undefined)?.semanticEffectId;
    const spans = spanExporter.getFinishedSpans().map((s) => {
      const node = spanToNode.get(s.spanContext().spanId) ?? "unmapped";
      const fx = fxOf(node);
      return { node, name: s.name, completed: true, ...(fx ? { semanticEffectId: fx } : {}), attributes: s.attributes };
    });
    const metricsOut = metricExporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics.flatMap((m) => m.dataPoints.map((dp) => ({ name: m.descriptor.name, value: dp.value as number, attributes: dp.attributes })))));
    return {
      registry: REGISTRY.map((r) => ({
        id: r.id.id,
        class: r.class,
        owner: r.owner,
        correlation: r.correlation,
        metric: r.metric,
        attributes: r.attributes,
        permittedParents: r.permittedParents,
        gatewayEntry: r.gatewayEntry,
        slice: r.slice,
        ...(r.class === "store" ? { semanticEffect: REGISTRY_EFFECTS[r.id.id], semanticEffectId: derived.get(r.id.id)!.id } : {}),
      })),
      admission: REGISTRY.map((r) => ({ id: r.id.id, gatewayEntry: r.gatewayEntry, ...(r.class === "store" ? { constructedDefinition: ADMITTED[r.id.id].constructedDefinition } : {}) })),
      graph,
      invocations,
      rawExecutions,
      emissions: { spans, metrics: metricsOut, logs },
      correlationTable: Object.fromEntries(REGISTRY.map((r) => [r.id.id, PROMPT6_CORRELATIONS[r.id.id] ?? r.correlation])),
      mintedCorrelationIds: [...MINTED_IDS],
      namingPattern: NAMING_PATTERN,
    };
  };
  (globalThis as { [SLOT]?: Slot })[SLOT] = { gateway: G, snapshot: SNAP, annotate };
  return G;
}
export function getGateway(): Gateway {
  const s = slot();
  if (!s) throw new Error("the governed runtime is not constructed; only a composition root may construct it");
  return s.gateway;
}
export function snapshotEvidence(): Promise<Record<string, unknown>> {
  const s = slot();
  if (!s) throw new Error("no runtime to snapshot");
  return s.snapshot();
}
