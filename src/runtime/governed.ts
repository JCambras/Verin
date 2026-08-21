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

declare const sealed: unique symbol;
export type RequestId = { readonly [sealed]: "RequestId"; readonly value: string; readonly purpose: "requestId" };
export type RequestCorrelation = {
  readonly [sealed]: "RequestCorrelation";
  readonly kind: "RequestCorrelation";
  readonly fields: { readonly requestId: { readonly value: string; readonly purpose: "requestId" } };
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
  | "observation.listForHousehold";
type Row = {
  id: GovernedOperationId;
  class: "use-case" | "module-operation" | "store";
  owner: "Access" | "Evidence";
  correlation: "RequestCorrelation";
  metric: "count";
  attributes: typeof ATTRS;
  permittedParents: readonly (OpKey | "entry")[];
  gatewayEntry: string;
  slice: 2 | 3;
};
const ATTRS = { requestId: { domain: "digest" }, outcome: { domain: "enum", values: ["ok", "refused", "error"] } } as const;
const row = (id: OpKey, cls: Row["class"], permittedParents: Row["permittedParents"], gatewayEntry: string, owner: Row["owner"] = "Access", slice: Row["slice"] = 2): Row => ({
  id: opId(id),
  class: cls,
  owner,
  correlation: "RequestCorrelation",
  metric: "count",
  attributes: ATTRS,
  permittedParents,
  gatewayEntry,
  slice,
});
const REGISTRY: readonly Row[] = [
  row("route.sign-in", "use-case", ["entry"], "enterRouteSignIn"),
  row("route.households", "use-case", ["entry"], "enterRouteHouseholds"),
  row("route.household-workspace", "use-case", ["entry"], "enterRouteHouseholdWorkspace"),
  row("access.authenticate", "module-operation", ["entry", "route.households", "route.household-workspace"], "enterAccessAuthenticate"),
  row("access.authorize", "module-operation", ["entry", "route.households", "route.household-workspace"], "enterAccessAuthorize"),
  row("access.withTenant", "module-operation", ["route.households", "route.household-workspace"], "enterAccessWithTenant"),
  row("access.renewSession", "module-operation", ["entry"], "enterAccessRenewSession"),
  row("identity.lookupForLogin", "store", ["route.sign-in"], "enterIdentityLookupForLogin"),
  row("session.create", "store", ["route.sign-in"], "enterSessionCreate"),
  row("session.lookupByTokenHash", "store", ["access.authenticate"], "enterSessionLookupByTokenHash"),
  row("session.rotate", "store", ["access.renewSession"], "enterSessionRotate"),
  row("household.listForTenant", "store", ["access.withTenant"], "enterHouseholdListForTenant"),
  row("household.getForTenant", "store", ["access.withTenant"], "enterHouseholdGetForTenant"),
  // Slice 3 (prompt 3 deliverable 7): the workspace use case gains assemble in its permitted children
  // (no new route row), and the bounded observation read is its own store row - not a seam operation.
  row("evidence.assemble", "module-operation", ["route.household-workspace"], "enterEvidenceAssemble", "Evidence", 3),
  row("observation.listForHousehold", "store", ["evidence.assemble"], "enterObservationListForHousehold", "Evidence", 3),
];
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
};

export const NAMING_PATTERN = "verin.op.{id}";
const opName = (id: string) => `verin.op.${id}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const QUERY_SHAPE = ["statementName", "canonicalSql", "parameters", "resultValidator", "cardinality", "transactionClass", "authorityClass"];
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
  if (def["kind"] !== "prepared-query") problems.push(`kind '${String(def["kind"])}' is not an admitted effect kind in this slice`);
  for (const f of QUERY_SHAPE) if (!(f in def)) problems.push(`required field '${f}' is missing`);
  for (const f of Object.keys(def)) if (f !== "kind" && !QUERY_SHAPE.includes(f)) problems.push(`unknown field '${f}'`);
  const bytes = "semfx.v1|" + canonicalize(def, "definition", problems);
  if (problems.length) throw new Error(`semantic-effect definition refused before construction: ${problems.join("; ")}`);
  return { id: "semfx.v1:" + sha256(bytes), bytes };
}

type StoreValues = Record<string, string>;
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
  sealCookieValue: (token: string) => string;
  openCookieValue: (cookieValue: string) => string | null;
  secureCookies: boolean;
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
};

// The one-per-process slot lives on globalThis, not a module-local variable: the framework bundles
// the instrumentation root and route handlers into separate module instances (the oracle's store
// sharp edge, main:CLAUDE.md), and a module-local slot would leave the page's copy unconstructed.
type Slot = { gateway: Gateway; snapshot: () => Promise<Record<string, unknown>> };
const SLOT = Symbol.for("verin.governed-runtime");
const slot = () => (globalThis as { [SLOT]?: Slot })[SLOT];

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
  const als = new AsyncLocalStorage<{ node: string; op: OpKey }>();
  let seq = 0;

  async function enter<T>(id: OpKey, c: RequestCorrelation, fn: () => Promise<T>): Promise<T> {
    const r = rows.get(id)!;
    const rid = (c as { fields?: { requestId?: { value?: unknown; purpose?: unknown } } })?.fields?.requestId;
    if ((c as { kind?: unknown })?.kind !== r.correlation) throw new Error(`operation '${id}' requires correlation kind '${r.correlation}'; refusing`);
    if (!rid?.value) throw new Error(`correlation for '${id}' is missing required field 'requestId'; the runtime fails closed`);
    if (rid.purpose !== "requestId") throw new Error(`correlation field 'requestId' carries purpose tag '${String(rid.purpose)}'; a value cannot pose as another identifier`);
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
    try {
      return await als.run({ node, op: id }, fn);
    } catch (e) {
      outcome = "error";
      throw e;
    } finally {
      // The product-side detector at the emission boundary (prompt 3, GD-003): every attribute and
      // log field is scanned with the checker's exact forms before it leaves; a refusal fails closed.
      const attrs = { requestId: String(rid.value), outcome };
      const rec = {
        name: opName(id),
        node,
        ...(fx ? { semanticEffectId: fx } : {}),
        fields: { requestId: String(rid.value), outcome, traceId: span.spanContext().traceId, spanId: span.spanContext().spanId },
      };
      const metricAttrs = { requestId: String(rid.value), ...(fx ? { semanticEffectId: fx } : {}) };
      for (const emitted of [attrs, rec.fields, metricAttrs]) refuseAccountReferences(emitted, { operation: id, boundary: "log" });
      span.setAttributes(attrs);
      span.end();
      counters.get(id)!.add(1, metricAttrs);
      logs.push(rec);
      process.stdout.write(JSON.stringify(rec) + "\n");
    }
  }
  async function runStore(id: OpKey, c: RequestCorrelation, values: StoreValues): Promise<unknown> {
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
        } else if (tc === "tenant-statement-deadline-from-p1-p4") {
          // The timeout derives from the route-minted deadline; the GUC parameter never reaches the binds.
          await client.query("SELECT set_config('verin.org_id', $1, true)", [params[0]]);
          await client.query("SELECT set_config('statement_timeout', $1, true)", [params[3]]);
          queryParams = params.slice(0, 3);
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
      correlationTable: Object.fromEntries(REGISTRY.map((r) => [r.id.id, r.correlation])),
      mintedCorrelationIds: [...MINTED_IDS],
      namingPattern: NAMING_PATTERN,
    };
  };
  (globalThis as { [SLOT]?: Slot })[SLOT] = { gateway: G, snapshot: SNAP };
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
