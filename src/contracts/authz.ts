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

/** The attributed actor behind an action (maps to the ratified ActorRef/SystemActorRef pair). */
export type ActorRef =
  | { readonly kind: "human"; readonly tenant: TenantContext; readonly actorId: string; readonly role: Role }
  | { readonly kind: "system"; readonly tenant: TenantContext; readonly actorId: string };

export function actorRefOf(p: Principal): ActorRef {
  return { kind: "human", tenant: tenantOf(p), actorId: p.userId, role: p.role };
}

/** The seven governed actions of v3 §15.3, each with its allowed roles. */
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
  if (actor.kind === "system") {
    return err(appError("FORBIDDEN", "System actors can never hold governed-action authority.", { action }));
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
