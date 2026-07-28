/**
 * Per-action authorization (v3 §15.3; extends ADR-0008 route-level RBAC without
 * displacing it). Every governed human action passes authorizeGovernedAction
 * BEFORE the act: an ActorRef in, a sealed ActionGrant or typed FORBIDDEN out.
 * System actors are refused categorically — approval, override, policy,
 * execution, and export authority is always attributed to a human role;
 * policy-automatic paths arrive later (v3 §11) with their own typed authority.
 * Role allowlists are Phase 1 defaults (D-036): surfaced actions mirror the
 * existing route allowlists exactly, and compliance authority
 * (policy/decision/override) stays OFF the IT-admin role.
 */
import { type Role, isAllowedRole } from "./roles";
import { type Result, ok, err } from "./result";
import { appError, type AppError } from "./errors";
import type { TenantContext } from "./tenant";
import {
  assertWriteActor,
  writeActorOf,
  type Principal,
  type WriteActor,
} from "./principal";

declare const ActorRefBrand: unique symbol;

/** The attributed human actor behind a governed action. */
export interface ActorRef {
  readonly kind: "human";
  readonly tenant: TenantContext;
  readonly actorId: string;
  readonly role: Role;
  readonly writeActor: WriteActor;
  readonly [ActorRefBrand]: "ActorRef";
}

const ACTOR_REFS = new WeakSet<object>();

export function actorRefOf(p: Principal): ActorRef {
  const writeActor = writeActorOf(p);
  const actor = {
    kind: "human",
    tenant: writeActor.tenant,
    actorId: p.userId,
    role: p.role,
    writeActor,
  };
  ACTOR_REFS.add(actor);
  return Object.freeze(actor) as unknown as ActorRef;
}

export function isActorRef(value: unknown): value is ActorRef {
  return typeof value === "object" &&
    value !== null &&
    ACTOR_REFS.has(value);
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

declare const GovernedOutputBrand: unique symbol;

export interface GovernedOutput<A extends GovernedAction> {
  readonly [GovernedOutputBrand]?: A;
}

declare const ActionGrantBrand: unique symbol;

/** Proof that authorizeGovernedAction approved this actor for this action. */
export interface ActionGrant<A extends GovernedAction = GovernedAction> {
  readonly action: A;
  readonly tenant: TenantContext;
  readonly actorId: string;
  readonly role: Role;
  readonly writeActor: WriteActor;
  readonly [ActionGrantBrand]: "ActionGrant";
}

const ACTION_GRANTS = new WeakSet<object>();

export function authorizeGovernedAction<A extends GovernedAction>(
  actor: ActorRef,
  action: A,
): Result<ActionGrant<A>, AppError> {
  if (!isActorRef(actor)) {
    return err(appError("FORBIDDEN", "Governed-action authority requires an authenticated human actor.", { action }));
  }
  if (!isAllowedRole(actor.role, GOVERNED_ACTIONS[action])) {
    // Same client-facing message as requireRole, so surfaced behavior is unchanged.
    return err(appError("FORBIDDEN", "You do not have permission to perform this action.", { action }));
  }
  const grant = {
    action,
    tenant: actor.tenant,
    actorId: actor.actorId,
    role: actor.role,
    writeActor: actor.writeActor,
  };
  ACTION_GRANTS.add(grant);
  // The ONE sanctioned ActionGrant cast (tokenized-factory-only fence allowlists this module).
  return ok(Object.freeze(grant) as unknown as ActionGrant<A>);
}

export function isActionGrant(value: unknown): value is ActionGrant {
  if (
    typeof value !== "object" ||
    value === null ||
    !ACTION_GRANTS.has(value)
  ) {
    return false;
  }
  const grant = value as ActionGrant;
  return grant.tenant === grant.writeActor.tenant &&
    grant.actorId === grant.writeActor.actorUserId;
}

export function assertActionGrant<A extends GovernedAction>(
  value: unknown,
  action: A,
): asserts value is ActionGrant<A> {
  if (!isActionGrant(value) || value.action !== action) {
    throw appError("FORBIDDEN", "The required governed-action grant is missing.", { action });
  }
  assertWriteActor(value.writeActor);
}
