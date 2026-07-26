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
import type { Principal } from "./principal";
import { appError } from "./errors";

declare const TenantContextBrand: unique symbol;

export interface TenantContext {
  readonly orgId: string;
  /** Compile-time brand: only this module's factories can produce it. */
  readonly [TenantContextBrand]: "TenantContext";
}

const SEAL = Symbol("verin.tenant-context.seal");

function mint(orgId: string): TenantContext {
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw appError("INTERNAL", "TenantContext requires a non-empty orgId.");
  }
  const ctx = Object.defineProperty({ orgId }, SEAL, { value: true, enumerable: false });
  // The ONE sanctioned TenantContext cast (tokenized-factory-only fence allowlists this module).
  return Object.freeze(ctx) as unknown as TenantContext;
}

/** Tenant scope of an authenticated session principal (resolved server-side, ADR-0008). */
export function tenantOf(principal: Principal): TenantContext {
  return mint(principal.orgId);
}

/**
 * Tenant scope for a named SYSTEM actor (esign-webhook finalize, seed, chain
 * verification). `systemId` forces every mint site to name the system it acts
 * as — greppable attribution even though the context itself carries only the
 * org (matching the ratified TenantContext shape).
 */
export function systemTenant(systemId: string, orgId: string): TenantContext {
  if (typeof systemId !== "string" || systemId.length === 0) {
    throw appError("INTERNAL", "A system tenant mint must name its system actor.");
  }
  return mint(orgId);
}

export function isTenantContext(value: unknown): value is TenantContext {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[SEAL] === true;
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
