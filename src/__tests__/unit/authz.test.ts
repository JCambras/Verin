import { describe, it, expect } from "vitest";
import {
  GOVERNED_ACTIONS,
  actorRefOf,
  authorizeGovernedAction,
  isActionGrant,
  isActorRef,
  type ActionGrant,
  type ActorRef,
  type GovernedAction,
} from "@contracts/authz";
import { systemTenant, tenantOf } from "@contracts/tenant";
import { principalFromIdentity } from "@contracts/principal";
import type { Role } from "@contracts/roles";

/**
 * Per-action authorization hooks (v3 §15.3): unauthorized actors cannot
 * approve or execute — the hook refuses BEFORE the act, and only the hook can
 * mint the sealed ActionGrant.
 */
function humanActor(role: Role) {
  const p = principalFromIdentity({ userId: `u-${role}`, orgId: "org-1", role, actor: `${role}@firm.test`, sessionId: "s1" });
  return actorRefOf(p);
}
const systemActor = {
  kind: "system",
  tenant: systemTenant("esign-webhook", "org-1"),
  actorId: "esign-webhook",
} as unknown as ActorRef;

describe("authorizeGovernedAction denies the unauthorized", () => {
  it("an advisor cannot approve decisions, approve policy, override, or export audits", () => {
    for (const action of ["decision.approve", "policy.approve", "decision.override", "audit.export", "policy.draft"] as const) {
      const r = authorizeGovernedAction(humanActor("advisor"), action);
      expect(r.ok, `advisor must be denied ${action}`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    }
  });
  it("the IT-admin role cannot hold compliance authority (D-036 separation of duties)", () => {
    for (const action of ["policy.approve", "decision.override", "decision.approve", "policy.draft"] as const) {
      expect(authorizeGovernedAction(humanActor("admin"), action).ok, `admin must be denied ${action}`).toBe(false);
    }
  });
  it("a cco cannot initiate execution or supply evidence (review separated from doing)", () => {
    expect(authorizeGovernedAction(humanActor("cco"), "execution.initiate").ok).toBe(false);
    expect(authorizeGovernedAction(humanActor("cco"), "evidence.supply").ok).toBe(false);
  });
  it("a SYSTEM actor is denied EVERY governed action (machines never hold approval authority)", () => {
    for (const action of Object.keys(GOVERNED_ACTIONS) as GovernedAction[]) {
      const r = authorizeGovernedAction(systemActor, action);
      expect(r.ok, `system actor must be denied ${action}`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    }
  });
  it("a caller cannot elevate a sealed principal by fabricating an actor role", () => {
    const principal = principalFromIdentity({
      userId: "u-advisor",
      orgId: "org-1",
      role: "advisor",
      actor: "advisor@firm.test",
      sessionId: "s1",
    });
    const forged = {
      kind: "human",
      tenant: tenantOf(principal),
      actorId: principal.userId,
      role: "principal",
    } as unknown as ActorRef;
    expect(authorizeGovernedAction(forged, "decision.override").ok).toBe(false);

    const spread = { ...actorRefOf(principal), role: "principal" } as unknown as ActorRef;
    expect(authorizeGovernedAction(spread, "decision.override").ok).toBe(false);

    const prototypeClone = Object.create(actorRefOf(principal)) as ActorRef;
    Object.defineProperty(prototypeClone, "role", { value: "principal" });
    expect(authorizeGovernedAction(prototypeClone, "decision.override").ok).toBe(false);
  });
});

describe("authorizeGovernedAction grants the authorized", () => {
  it("mints a sealed, frozen grant carrying action + tenant + actor + role", () => {
    const r = authorizeGovernedAction(humanActor("cco"), "decision.approve");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toBe("decision.approve");
    expect(r.value.tenant.orgId).toBe("org-1");
    expect(r.value.actorId).toBe("u-cco");
    expect(r.value.role).toBe("cco");
    expect(isActionGrant(r.value)).toBe(true);
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(isActorRef(humanActor("cco"))).toBe(true);
  });
  it("every registry allowlist actually authorizes each of its roles (no dead allowlist rows)", () => {
    for (const [action, allowed] of Object.entries(GOVERNED_ACTIONS) as Array<[GovernedAction, readonly Role[]]>) {
      for (const role of allowed) {
        expect(authorizeGovernedAction(humanActor(role), action).ok, `${role} should hold ${action}`).toBe(true);
      }
    }
  });
});

describe("ActionGrant is sealed", () => {
  it("cannot compile from a literal", () => {
    // @ts-expect-error an object literal cannot produce the sealed brand
    const impostor: ActionGrant = { action: "audit.export", tenant: systemTenant("test", "o"), actorId: "x", role: "admin" };
    expect(isActionGrant(impostor)).toBe(false);
  });
  it("cannot parse from a cast or a spread copy", () => {
    const real = authorizeGovernedAction(humanActor("principal"), "audit.export");
    if (!real.ok) throw new Error("expected grant");
    expect(isActionGrant({ ...real.value })).toBe(false);
    expect(isActionGrant({ action: "audit.export" } as unknown as ActionGrant)).toBe(false);
    expect(isActionGrant(Object.create(real.value))).toBe(false);
  });
});

describe("ActorRef is sealed", () => {
  it("cannot compile from a literal", () => {
    // @ts-expect-error an object literal cannot produce the sealed brand
    const impostor: ActorRef = {
      kind: "human",
      tenant: systemTenant("test", "o"),
      actorId: "x",
      role: "principal",
    };
    expect(isActorRef(impostor)).toBe(false);
  });
});
