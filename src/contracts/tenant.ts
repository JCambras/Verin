/**
 * TenantContext (v3 §15.2; ADR-0026: FirmId ≡ org_id at the store layer). Every
 * repository read and port call requires one — the tenant-context-required fence
 * enforces the signatures; this module enforces construction. Sealed two ways:
 * a compile-time unique-symbol brand (an object literal cannot satisfy it, so a
 * missing tenant context does not COMPILE) and a runtime module-private seal
 * (a cast or JSON-deserialized impostor fails assertTenantContext inside the
 * repository, so it does not PARSE either). Minted in exactly two places: from
 * an authenticated Principal (tenantOf) and for named system actors
 * (systemTenant). The simplified Phase 1 identity provider sits BELOW this seam
 * (ADR-0008), so swapping it later never moves the boundary.
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

const SEAL = Symbol("verin.tenant-context.seal");
const TENANT_CONTEXTS = new WeakSet<object>();

export const SYSTEM_ACTOR_IDS = [
  "audit-chain-verify",
  "backup-restore-drill",
  "esign-webhook",
  "login-boundary",
  "login-constant-work",
  "load-smoke",
  "seed",
  "test",
] as const;

export type SystemActorId = (typeof SYSTEM_ACTOR_IDS)[number];

function mint(orgId: string, actor: TenantContext["actor"]): TenantContext {
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw appError("INTERNAL", "TenantContext requires a non-empty orgId.");
  }
  const ctx = Object.defineProperty({ orgId, actor: Object.freeze(actor) }, SEAL, {
    value: true,
    enumerable: false,
  });
  TENANT_CONTEXTS.add(ctx);
  // The ONE sanctioned TenantContext cast (tokenized-factory-only fence allowlists this module).
  return Object.freeze(ctx) as unknown as TenantContext;
}

/** Tenant scope of an authenticated session principal (resolved server-side, ADR-0008). */
export function tenantOf(principal: Principal): TenantContext {
  assertPrincipal(principal);
  return mint(principal.orgId, { kind: "human", actorId: principal.userId });
}

export function tenantFromIdentity(actorId: string, orgId: string): TenantContext {
  if (typeof actorId !== "string" || actorId.length === 0) {
    throw appError("INTERNAL", "An identity tenant mint must name its actor.");
  }
  return mint(orgId, { kind: "human", actorId });
}

/**
 * Tenant scope for a named SYSTEM actor (esign-webhook finalize, seed, chain
 * verification). `systemId` forces every mint site to name the system it acts
 * as, with the same attribution retained in the sealed context.
 */
export function systemTenant(systemId: SystemActorId, orgId: string): TenantContext {
  if (!SYSTEM_ACTOR_IDS.includes(systemId)) {
    throw appError("INTERNAL", "A system tenant mint must name a registered system actor.");
  }
  return mint(orgId, { kind: "system", actorId: systemId });
}

export function isTenantContext(value: unknown): value is TenantContext {
  return typeof value === "object" && value !== null && TENANT_CONTEXTS.has(value);
}

/**
 * Runtime backstop ("missing tenant context cannot parse"): repositories assert
 * before touching SQL, so an impostor that evaded the compiler via a cast or
 * arrived deserialized is refused with a typed error instead of querying.
 */
export function assertTenantContext(value: unknown): asserts value is TenantContext {
  if (!isTenantContext(value)) {
    throw appError("INTERNAL", "Not a sealed TenantContext — mint via tenantOf/systemTenant.");
  }
}
