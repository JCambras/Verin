/**
 * Per-action authorization (v3 §15.3; extends ADR-0008 route-level RBAC without
 * displacing it). Every governed human action passes authorizeGovernedAction
 * BEFORE the act: it takes an ActorRef (the attributed actor + sealed tenant)
 * and mints a sealed ActionGrant, or refuses with a typed FORBIDDEN. System
 * actors are refused categorically — approval, override, policy, execution, and
 * export authority is always attributed to a human role; policy-automatic paths
 * arrive later (v3 §11) with their own typed authority, never through this hook.
 * Role allowlists are Phase 1 defaults (D-036): surfaced actions mirror the
 * existing route allowlists exactly; unsurfaced ones follow v3 §11 semantics
 * with compliance authority (policy/decision/override) kept OFF the IT-admin
 * role — separation of technical privilege from compliance authority.
 */
import { type Role, isAllowedRole } from "./roles";
import { type Result, ok, err } from "./result";
import { appError, type AppError } from "./errors";
import { tenantOf, type TenantContext } from "./tenant";
import type { Principal } from "./principal";

declare const ActorRefBrand: unique symbol;

/** The attributed human actor behind a governed action. */
export interface ActorRef {
  readonly kind: "human";
  readonly tenant: TenantContext;
  readonly actorId: string;
  readonly role: Role;
  readonly [ActorRefBrand]: "ActorRef";
}

const ACTOR_REF_SEAL = Symbol("verin.actor-ref.seal");

export function actorRefOf(p: Principal): ActorRef {
  const actor = Object.defineProperty(
    { kind: "human", tenant: tenantOf(p), actorId: p.userId, role: p.role },
    ACTOR_REF_SEAL,
    { value: true, enumerable: false },
  );
  return Object.freeze(actor) as unknown as ActorRef;
}

export function isActorRef(value: unknown): value is ActorRef {
  return typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[ACTOR_REF_SEAL] === true;
}

/**
 * The seven v3 §15.3 permission points as eight actions (policy drafting and
 * approval are distinct), each with its allowed roles.
 */
export const GOVERNED_ACTIONS = {
  "pii.view": ["advisor", "ops", "cco", "principal", "admin"],
  "evidence.supply": ["advisor", "ops", "principal", "admin"],
  "policy.draft": ["cco", "principal"],
  "policy.approve": ["cco", "principal"],
  "decision.approve": ["ops", "cco", "principal"],
  "decision.override": ["cco", "principal"],
  "execution.initiate": ["advisor", "ops", "principal", "admin"],
  "audit.export": ["ops", "cco", "principal", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type GovernedAction = keyof typeof GOVERNED_ACTIONS;

declare const ActionGrantBrand: unique symbol;

/** Proof that authorizeGovernedAction approved this actor for this action. */
export interface ActionGrant {
  readonly action: GovernedAction;
  readonly tenant: TenantContext;
  readonly actorId: string;
  readonly role: Role;
  readonly [ActionGrantBrand]: "ActionGrant";
}

const SEAL = Symbol("verin.action-grant.seal");

export function authorizeGovernedAction(actor: ActorRef, action: GovernedAction): Result<ActionGrant, AppError> {
  if (!isActorRef(actor)) {
    return err(appError("FORBIDDEN", "Governed-action authority requires an authenticated human actor.", { action }));
  }
  if (!isAllowedRole(actor.role, GOVERNED_ACTIONS[action])) {
    // Same client-facing message as requireRole, so surfaced behavior is unchanged.
    return err(appError("FORBIDDEN", "You do not have permission to perform this action.", { action }));
  }
  const grant = Object.defineProperty(
    { action, tenant: actor.tenant, actorId: actor.actorId, role: actor.role },
    SEAL,
    { value: true, enumerable: false },
  );
  // The ONE sanctioned ActionGrant cast (tokenized-factory-only fence allowlists this module).
  return ok(Object.freeze(grant) as unknown as ActionGrant);
}

export function isActionGrant(value: unknown): value is ActionGrant {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[SEAL] === true;
}
