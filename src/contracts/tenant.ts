/**
 * TenantContext (v3 §15.2; ADR-0026: FirmId ≡ org_id at the store layer). Every
 * repository read and port call requires one — the tenant-context-required fence
 * enforces the signatures; this module enforces construction. Sealed twice: a
 * unique-symbol brand (a missing tenant context does not COMPILE) and membership
 * in a module-private WeakSet only `mint` writes to (a cast or deserialized
 * impostor fails assertTenantContext inside the repository, so it does not PARSE
 * either — an attacker cannot forge WeakSet membership by copying keys off a real
 * value the way a self-describing marker property invites). Minted only from an
 * authenticated Principal (`tenantOf`), authenticated identity (`tenantFromIdentity`),
 * or named system actor (`systemTenant`). The Phase 1 identity provider sits BELOW this seam (ADR-0008).
 */
import { assertPrincipal, type Principal } from "./principal";
import { appError } from "./errors";

declare const TenantContextBrand: unique symbol;

export interface TenantContext {
  readonly orgId: string;
  readonly actor:
    | { readonly kind: "human"; readonly actorId: string }
    | { readonly kind: "system"; readonly actorId: SystemActorId };
  /** Compile-time brand: only this module's factories can produce it. */
  readonly [TenantContextBrand]: "TenantContext";
}

const TENANT_CONTEXTS = new WeakSet<object>();

/**
 * The PRODUCTION system-actor allowlist. This is load-bearing authority, not
 * vocabulary: systemTenant refuses anything unlisted and assertWriteActor
 * accepts whatever it mints, so a shipped id here can attribute audit entries in
 * a real tenant's hash chain. Every entry has a real production or script caller.
 */
export const SYSTEM_ACTOR_IDS = [
  "audit-chain-verify",
  "backup-restore-drill",
  "esign-webhook",
  "login-boundary",
  "login-constant-work",
  "load-smoke",
  "seed",
] as const;

export type SystemActorId = (typeof SYSTEM_ACTOR_IDS)[number];

/**
 * Test-only injection point, mirroring registerTestSpanName. The reserved
 * `test` namespace is enforced here, and the tokenized-factory-only fence proves
 * no shipped module calls this (keyed on symbol resolution, so an aliased import
 * cannot evade it) — so test fixtures can never widen production authority.
 */
const TEST_SYSTEM_ACTOR_IDS = new Set<string>();
export function registerTestSystemActor(id: string): SystemActorId {
  if (!/^test(?:[.-][a-z0-9]+)*$/.test(id)) {
    throw appError("VALIDATION", "A test system actor must live in the reserved 'test' namespace.");
  }
  TEST_SYSTEM_ACTOR_IDS.add(id);
  return id as SystemActorId;
}

function mint(orgId: string, actor: TenantContext["actor"]): TenantContext {
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw appError("INTERNAL", "TenantContext requires a non-empty orgId.");
  }
  const ctx = { orgId, actor: Object.freeze(actor) };
  TENANT_CONTEXTS.add(ctx);
  // The ONE sanctioned TenantContext cast (tokenized-factory-only fence allowlists this module).
  return Object.freeze(ctx) as unknown as TenantContext;
}

/** Tenant scope of an authenticated session principal (resolved server-side, ADR-0008). */
export function tenantOf(principal: Principal): TenantContext {
  assertPrincipal(principal);
  return mint(principal.orgId, { kind: "human", actorId: principal.userId });
}
/** Tenant scope minted only after the identity adapter authenticates its stored row. */
export function tenantFromIdentity(actorId: string, orgId: string): TenantContext {
  if (typeof actorId !== "string" || actorId.length === 0) {
    throw appError("INTERNAL", "An identity tenant mint must name its actor.");
  }
  return mint(orgId, { kind: "human", actorId });
}

/** Tenant scope for a named SYSTEM actor: every mint site names the system it acts as. */
export function systemTenant(systemId: SystemActorId, orgId: string): TenantContext {
  if (!SYSTEM_ACTOR_IDS.includes(systemId) && !TEST_SYSTEM_ACTOR_IDS.has(systemId)) {
    throw appError("INTERNAL", "A system tenant mint must name a registered system actor.");
  }
  return mint(orgId, { kind: "system", actorId: systemId });
}

export function isTenantContext(value: unknown): value is TenantContext {
  return typeof value === "object" && value !== null && TENANT_CONTEXTS.has(value);
}

/** Runtime backstop: repositories assert before SQL, so an impostor is refused, not queried. */
export function assertTenantContext(value: unknown): asserts value is TenantContext {
  if (!isTenantContext(value)) {
    throw appError("INTERNAL", "Not a sealed TenantContext — mint via tenantOf/systemTenant.");
  }
}

/**
 * Two sealed contexts naming the SAME scope: same org, same actor identity. Carrying
 * two authority values is only safe when they agree, so the authority-prologue rule
 * requires this wherever a callable takes BOTH a TenantContext and an ActionGrant as
 * explicit parameters - otherwise one could scope the query while the other carried
 * the authorization, and nothing would notice they named different tenants.
 */
export function assertSameTenant(a: unknown, b: unknown): void {
  assertTenantContext(a);
  assertTenantContext(b);
  if (
    a.orgId !== b.orgId ||
    a.actor.kind !== b.actor.kind ||
    a.actor.actorId !== b.actor.actorId
  ) {
    throw appError("AUTH_FAILED", "Authority values name different tenant scopes.");
  }
}
