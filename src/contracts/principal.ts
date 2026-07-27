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
const PRINCIPALS = new WeakSet<object>();

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
  PRINCIPALS.add(principal);
  return Object.freeze(principal) as unknown as Principal;
}

export function isPrincipal(value: unknown): value is Principal {
  return typeof value === "object" &&
    value !== null &&
    PRINCIPALS.has(value);
}

export function assertPrincipal(value: unknown): asserts value is Principal {
  if (!isPrincipal(value)) {
    throw appError("AUTH_FAILED", "Principal was not minted by the identity boundary.");
  }
}

/**
 * The narrow identity a CRM/store WRITE is attributed to: a sealed TenantContext
 * plus an opaque actor (a userId, or a reserved system-actor id). Adapters take
 * this instead of a full Principal so event-driven paths (webhook finalize,
 * seeds) never fabricate one with an invented role/sessionId — a forged
 * credential the day port-level role checks land. RBAC stays at the route/port
 * boundary on the session Principal; writeActorOf derives this from it.
 */
export interface WriteActor {
  readonly tenant: TenantContext;
  readonly actorUserId: string;
  readonly delegatedBy: SystemActorId | null;
  readonly [WriteActorBrand]: "WriteActor";
}

declare const WriteActorBrand: unique symbol;
const WRITE_ACTOR_SEAL = Symbol("verin.write-actor.seal");
const WRITE_ACTORS = new WeakSet<object>();

function mintWriteActor(
  tenant: TenantContext,
  actorUserId: string,
  delegatedBy: SystemActorId | null,
): WriteActor {
  if (!actorUserId) {
    throw appError("INTERNAL", "WriteActor requires an attributed actor.");
  }
  const value = Object.defineProperty(
    { tenant, actorUserId, delegatedBy },
    WRITE_ACTOR_SEAL,
    { value: true, enumerable: false },
  );
  WRITE_ACTORS.add(value);
  return Object.freeze(value) as unknown as WriteActor;
}

export function writeActorOf(p: Principal): WriteActor {
  return mintWriteActor(tenantOf(p), p.userId, null);
}

/** Reserved system-actor writes (webhook finalize, seed) — never a fabricated Principal. */
export function systemWriteActor(systemId: SystemActorId, orgId: string): WriteActor {
  return mintWriteActor(systemTenant(systemId, orgId), systemId, null);
}

export function delegatedWriteActor(systemActor: WriteActor, actorUserId: string): WriteActor {
  assertWriteActor(systemActor);
  const tenantActor = systemActor.tenant.actor;
  if (
    tenantActor.kind !== "system" ||
    !["esign-webhook", "login-boundary"].includes(tenantActor.actorId)
  ) {
    throw appError("INTERNAL", "This system actor cannot delegate write attribution.");
  }
  return mintWriteActor(systemActor.tenant, actorUserId, tenantActor.actorId);
}

export function isWriteActor(value: unknown): value is WriteActor {
  return typeof value === "object" &&
    value !== null &&
    WRITE_ACTORS.has(value);
}

export function assertWriteActor(value: unknown): asserts value is WriteActor {
  if (!isWriteActor(value)) {
    throw appError("INTERNAL", "Write attribution requires a sealed WriteActor.");
  }
  const tenantActor = value.tenant.actor;
  const direct = value.delegatedBy === null &&
    value.actorUserId === tenantActor.actorId;
  const delegated = tenantActor.kind === "system" &&
    value.delegatedBy === tenantActor.actorId;
  if (!direct && !delegated) {
    throw appError("INTERNAL", "Write actor attribution does not match its tenant authority.");
  }
}
