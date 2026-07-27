/**
 * The authenticated principal (ADR-0008). Resolved server-side from the session
 * ONLY (never from a client-supplied header). Audit and OTel-span attribution is
 * the opaque `userId` (ADR-0006/0007: those boundaries never see raw PII), threaded
 * into every audited write — never "system". `actor` is the user's email for
 * DISPLAY surfaces only (nav, /api/me); views resolve userId → email at render.
 */
import { isRole, type Role } from "./roles";
import type { PIIBearing } from "./pii";
import { appError } from "./errors";
import {
  tenantOf,
  systemTenant,
  type SystemActorId,
  type TenantContext,
} from "./tenant";

declare const PrincipalBrand: unique symbol;

/** PIIBearing: `actor` carries the user's raw email for display surfaces. */
export interface Principal extends PIIBearing {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly actor: string;
  readonly sessionId: string;
  readonly [PrincipalBrand]: "Principal";
}

const SEAL = Symbol("verin.principal.seal");

export function principalFromIdentity(input: {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly actor: string;
  readonly sessionId: string;
}): Principal {
  if (
    !input.userId ||
    !input.orgId ||
    !input.actor ||
    !input.sessionId ||
    !isRole(input.role)
  ) {
    throw appError("AUTH_FAILED", "Identity boundary returned an invalid principal.");
  }
  const principal = Object.defineProperty({ ...input }, SEAL, {
    value: true,
    enumerable: false,
  });
  return Object.freeze(principal) as unknown as Principal;
}

export function isPrincipal(value: unknown): value is Principal {
  return typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[SEAL] === true;
}

export function assertPrincipal(value: unknown): asserts value is Principal {
  if (!isPrincipal(value)) {
    throw appError("AUTH_FAILED", "Principal was not minted by the identity boundary.");
  }
}

/**
 * The narrow identity a CRM/store WRITE is attributed to: which tenant (a sealed
 * TenantContext — every write path carries proof of a properly minted scope),
 * which actor (an opaque userId, or a reserved system-actor id like
 * "esign-webhook"/"seed"). Adapters accept this instead of a full Principal so
 * event-driven paths (webhook finalize, seeds) never fabricate a Principal with
 * an invented role/sessionId — a forged credential the day port-level role
 * checks land. RBAC stays at the route/port boundary on the full session
 * Principal; a session-derived write actor is built via writeActorOf.
 */
export interface WriteActor {
  readonly tenant: TenantContext;
  readonly actorUserId: string;
}

export function writeActorOf(p: Principal): WriteActor {
  return { tenant: tenantOf(p), actorUserId: p.userId };
}

/** Reserved system-actor writes (webhook finalize, seed) — never a fabricated Principal. */
export function systemWriteActor(systemId: SystemActorId, orgId: string): WriteActor {
  return { tenant: systemTenant(systemId, orgId), actorUserId: systemId };
}
