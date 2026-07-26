import { describe, it, expect } from "vitest";
import { tenantOf, systemTenant, isTenantContext, assertTenantContext, type TenantContext } from "@contracts/tenant";
import { writeActorOf, systemWriteActor, type Principal } from "@contracts/principal";

/**
 * TenantContext sealing (v3 §15.2): "missing tenant context cannot compile or
 * parse". COMPILE: the @ts-expect-error directives below are load-bearing —
 * `pnpm typecheck` fails if the brand ever weakens enough for a literal to be
 * accepted (the directive itself becomes an "unused directive" error). PARSE:
 * every impostor shape an attacker or a refactor could produce is refused by
 * the runtime seal check repositories call before touching SQL.
 */
const principal: Principal = { userId: "u1", orgId: "org-1", role: "advisor", actor: "a@firm.test", sessionId: "s1" };

describe("TenantContext cannot compile from a literal", () => {
  it("rejects literals and unbranded objects at the type level", () => {
    // @ts-expect-error an object literal cannot produce the sealed brand
    const impostor: TenantContext = { orgId: "org-1" };
    // @ts-expect-error a plain string is not a tenant context
    const stringImpostor: TenantContext = "org-1";
    expect(isTenantContext(impostor)).toBe(false);
    expect(isTenantContext(stringImpostor)).toBe(false);
  });
});

describe("TenantContext cannot parse unless factory-minted", () => {
  it("accepts factory mints", () => {
    expect(isTenantContext(tenantOf(principal))).toBe(true);
    expect(isTenantContext(systemTenant("seed", "org-1"))).toBe(true);
    expect(() => assertTenantContext(tenantOf(principal))).not.toThrow();
  });
  it("rejects a cast impostor (the compiler evasion the fence hunts)", () => {
    const impostor = { orgId: "victim-org" } as unknown as TenantContext;
    expect(isTenantContext(impostor)).toBe(false);
    expect(() => assertTenantContext(impostor)).toThrow();
  });
  it("rejects a JSON round-trip (serialization strips the seal by design)", () => {
    const laundered = JSON.parse(JSON.stringify(tenantOf(principal))) as unknown;
    expect(isTenantContext(laundered)).toBe(false);
  });
  it("rejects a SPREAD copy (the seal is non-enumerable, so {...ctx} drops it)", () => {
    const spread = { ...tenantOf(principal) };
    expect(isTenantContext(spread)).toBe(false);
  });
  it("rejects null/undefined/garbage", () => {
    for (const v of [null, undefined, 42, "org-1", {}, []]) expect(isTenantContext(v)).toBe(false);
  });
  it("mints are frozen and refuse empty identifiers", () => {
    const t = tenantOf(principal);
    expect(Object.isFrozen(t)).toBe(true);
    expect(() => systemTenant("", "org-1")).toThrow();
    expect(() => systemTenant("seed", "")).toThrow();
    expect(() => tenantOf({ ...principal, orgId: "" })).toThrow();
  });
});

describe("WriteActor carries the sealed tenant", () => {
  it("writeActorOf embeds a factory-minted context", () => {
    const a = writeActorOf(principal);
    expect(a.actorUserId).toBe("u1");
    expect(isTenantContext(a.tenant)).toBe(true);
    expect(a.tenant.orgId).toBe("org-1");
  });
  it("systemWriteActor names the system actor and scopes its tenant", () => {
    const a = systemWriteActor("esign-webhook", "org-2");
    expect(a.actorUserId).toBe("esign-webhook");
    expect(a.tenant.orgId).toBe("org-2");
    expect(isTenantContext(a.tenant)).toBe(true);
  });
});
