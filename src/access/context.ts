// The AccessContext seam (prompt 2 section 4) - slice 2's one named contract seam and the home of its
// sealed authority types: Principal, ActionGrant and TenantIdentity are constructible only by the
// factories here (the sealed-factory rule in src/tools/e16.test.ts fails the build on a cast, a type
// predicate, an extending interface, or a value filled from any/unknown anywhere else). This PR ships
// authenticate (read-only over the request's session cookie; renewal and rotation belong to the
// cookie-writing path, PR-2c) and authorize; withTenant lands with the tenant tables in PR-2a'. The
// sign-in credential exchange lives here as the governed route.sign-in use case: scrypt over a
// per-row salt, constant-time compare, and a burned compare when the identity is unknown.
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getGateway, type RequestCorrelation } from "../runtime/governed";

declare const sealed: unique symbol;
type TenantIdentity = { readonly [sealed]: "TenantIdentity"; readonly orgId: string };
type Principal = { readonly [sealed]: "Principal"; readonly identityId: string; readonly displayName: string; readonly role: string; readonly tenant: TenantIdentity };
type ActionGrant = { readonly [sealed]: "ActionGrant"; readonly action: Action; readonly principal: Principal };
export type { Principal, ActionGrant, TenantIdentity };

type Action = "household.read";
const ROLE_ACTIONS: Record<string, readonly Action[]> = { advisor: ["household.read"] };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sessionRow = z.strictObject({ identity_id: z.string(), org_id: z.string(), display_name: z.string(), role: z.string(), expires_at: z.date() });
const loginRow = z.strictObject({ id: z.string(), org_id: z.string(), display_name: z.string(), role: z.string(), credential_hash: z.string(), credential_salt: z.string() });

export interface AccessContext {
  authenticate(c: RequestCorrelation, sessionCookie: string | undefined): Promise<Principal | null>;
  authorize(c: RequestCorrelation, principal: Principal, action: Action): Promise<ActionGrant | null>;
  // The tenant-scoped surface fn receives closes over the GRANT's sealed tenant identity, so a caller
  // can neither choose an org nor reach a bare connection; every store operation inside runs in its
  // own transaction with the tenant GUC set, and the database's RLS is the isolation guarantee.
  withTenant<T>(c: RequestCorrelation, grant: ActionGrant, fn: (tx: TenantTransaction) => Promise<T>): Promise<T>;
}
interface TenantTransaction {
  listHouseholds(): Promise<{ id: string; name: string; record_origin: string }[]>;
  getHousehold(householdId: string): Promise<{ id: string; name: string; record_origin: string; recorded_at: Date | null } | null>;
}
const householdRow = z.strictObject({ id: z.string(), name: z.string(), record_origin: z.string() });
const householdDetail = z.strictObject({ id: z.string(), name: z.string(), record_origin: z.string(), recorded_at: z.date().nullable() });

export function createAccessContext(): AccessContext {
  const gw = getGateway();
  return {
    async authenticate(c, sessionCookie) {
      return gw.enterAccessAuthenticate(c, async () => {
        const token = sessionCookie ? gw.openCookieValue(sessionCookie) : null;
        if (!token) return null;
        const raw = await gw.enterSessionLookupByTokenHash(c, { tokenHash: sha256(token) });
        if (raw === null) return null;
        const s = sessionRow.parse(raw);
        const tenant = { orgId: s.org_id } as TenantIdentity;
        return { identityId: s.identity_id, displayName: s.display_name, role: s.role, tenant } as Principal;
      });
    },
    async authorize(c, principal, action) {
      return gw.enterAccessAuthorize(c, async () => ((ROLE_ACTIONS[principal.role] ?? []).includes(action) ? ({ action, principal } as ActionGrant) : null));
    },
    async withTenant(c, grant, fn) {
      return gw.enterAccessWithTenant(c, async () =>
        fn({
          listHouseholds: async () => z.array(householdRow).parse(await gw.enterHouseholdListForTenant(c, { orgId: grant.principal.tenant.orgId })),
          getHousehold: async (householdId) => {
            if (!z.uuid().safeParse(householdId).success) return null; // a client-supplied id parses before any store work
            const raw = await gw.enterHouseholdGetForTenant(c, { orgId: grant.principal.tenant.orgId, householdId });
            return raw === null ? null : householdDetail.parse(raw);
          },
        }),
      );
    },
  };
}

// The sign-in credential exchange (governed use case route.sign-in). Returns the sealed cookie value
// to set, or null on refusal - one null for every failure shape, timing-flattened.
export async function signIn(c: RequestCorrelation, loginEmail: string, secretText: string): Promise<{ cookieValue: string; expiresAt: Date } | null> {
  const gw = getGateway();
  return gw.enterRouteSignIn(c, async () => {
    const parsed = z.strictObject({ loginEmail: z.email().max(200), secretText: z.string().min(1).max(200) }).safeParse({ loginEmail, secretText });
    if (!parsed.success) return null;
    const raw = await gw.enterIdentityLookupForLogin(c, { loginEmail: parsed.data.loginEmail });
    const id = raw === null ? null : loginRow.parse(raw);
    const derivedKey = scryptSync(parsed.data.secretText, id ? id.credential_salt : "burn-equal-time", 32);
    const stored = id ? Buffer.from(id.credential_hash, "hex") : derivedKey;
    if (id === null || stored.length !== derivedKey.length || !timingSafeEqual(derivedKey, stored)) return null;
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await gw.enterSessionCreate(c, {
      id: randomUUID(),
      tokenHash: sha256(token),
      identityId: id.id,
      orgId: id.org_id,
      displayName: id.display_name,
      role: id.role,
      expiresAt: expiresAt.toISOString(),
    });
    return { cookieValue: gw.sealCookieValue(token), expiresAt };
  });
}
