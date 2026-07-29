/**
 * Identity store (ADR-0008). Users, credentials, and server-side sessions in the
 * house-CRM store. Behind the identity port so a WorkOS/Auth0 swap is an adapter
 * change (D-002). org_id is always explicit; identity is never client-trusted.
 * This module sits BELOW the TenantContext seam (v3 §15.2): session/credential
 * lookups are the tenant-MINTING boundary (the org comes FROM the authenticated
 * row), so they are reviewed escapes in the tenant-context-required fence;
 * provisioning writes (createUser) DO require the sealed context.
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import { isRole, type Role } from "@contracts/roles";
import type { PIIBearing } from "@contracts/pii";
import {
  assertSameTenant,
  assertTenantContext,
  tenantFromIdentity,
  type TenantContext,
} from "@contracts/tenant";
import { assertActionGrant, type ActionGrant } from "@contracts/authz";
import {
  principalFromIdentity,
  type Principal,
} from "@contracts/principal";
import { appError } from "@contracts/errors";
import { hashPassword, verifyPassword } from "./password";

/** PIIBearing: carries the user's raw email and display name. */
export interface UserRow extends PIIBearing {
  id: string;
  org_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: string;
}

export interface SessionRow {
  id: string;
  lineage_id: string;
  user_id: string;
  org_id: string;
  role: Role;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

declare const AuthenticatedUserBrand: unique symbol;

export interface AuthenticatedUser extends PIIBearing {
  readonly id: string;
  readonly tenant: TenantContext;
  readonly email: string;
  readonly role: Role;
  readonly [AuthenticatedUserBrand]: "AuthenticatedUser";
}

/**
 * Membership in a module-private WeakSet, the same discipline the sealed security
 * types use (contracts/tenant.ts): this is the value createSession trusts to prove
 * an identity really authenticated, so the runtime half of the seal must not be
 * COPYABLE. A marker property - even a non-enumerable own symbol - is readable off
 * any real instance via Object.getOwnPropertySymbols and can then be stamped onto an
 * arbitrary object, which would let a forged identity mint a session. WeakSet
 * membership is only writable here, by `authenticate`.
 */
const AUTHENTICATED_USERS = new WeakSet<object>();

function authenticatedUser(row: UserRow): AuthenticatedUser {
  const value = Object.freeze({
    id: row.id,
    tenant: tenantFromIdentity(row.id, row.org_id),
    email: row.email,
    role: row.role,
  });
  AUTHENTICATED_USERS.add(value);
  return value as unknown as AuthenticatedUser;
}

// `unknown`, like every sibling assertX: typing the parameter as the sealed type it
// is meant to VERIFY makes the compile-time half circular - the only callers that
// could pass the check are the ones that already satisfied it. It returns void rather
// than `asserts value is AuthenticatedUser` on purpose: an assertion signature would
// hand out a sealed TenantContext (AuthenticatedUser.tenant) from an `unknown`, which
// is a mint the tokenized-factory-only fence refuses outside a factory module, and
// rightly so. No narrowing is needed here - createSession's parameter is already
// typed, so this call is purely the runtime half.
function assertAuthenticatedUser(value: unknown): void {
  if (typeof value !== "object" || value === null || !AUTHENTICATED_USERS.has(value)) {
    throw appError("AUTH_FAILED", "Session creation requires an authenticated identity.");
  }
}

// Emails are canonicalized (trimmed, lowercased) at write AND lookup: case-variants
// of one mailbox cannot split into two identities under UNIQUE(org_id, email), and
// sign-in is not case-fragile.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(
  db: SqlDb,
  tenant: TenantContext,
  input: { email: string; displayName: string; role: Role; password: string },
): Promise<UserRow> {
  assertTenantContext(tenant);
  const id = randomUUID();
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,'active',$6,'verin-crm',$6,'high')",
      [id, tenant.orgId, email, input.displayName, input.role, now],
    );
    await tx.query("INSERT INTO credentials (user_id, password_hash) VALUES ($1,$2)", [id, await hashPassword(input.password)]);
  });
  return { id, org_id: tenant.orgId, email, display_name: input.displayName, role: input.role, status: "active" };
}

/** One org user's display identity. PIIBearing: `email` is raw contact PII. */
export interface OrgUserEmail extends PIIBearing {
  readonly id: string;
  readonly email: string;
}

/**
 * The org's user emails, keyed by opaque userId — the render-time resolution the
 * audit export needs to show WHO acted (the chain persists only the userId,
 * ADR-0006/0007). A raw-PII read, so it is a governed sink in its own right: the
 * caller's `audit.export` authority does not extend to reading contact PII, and
 * the grant's sealed tenant is the only org scope this query will accept.
 */
export async function listOrgUserEmails(
  db: SqlDb,
  grant: ActionGrant<"pii.view">,
): Promise<OrgUserEmail[]> {
  assertActionGrant(grant, "pii.view");
  const res = await db.query<OrgUserEmail>(
    "SELECT id, email FROM users WHERE org_id = $1",
    [grant.tenant.orgId],
  );
  return res.rows;
}

export async function findUserByEmail(db: SqlDb, email: string): Promise<UserRow | null> {
  // Org-qualified login is a recorded deferral (Sable F3): the same email may exist
  // in several orgs (UNIQUE(org_id,email)). Until then, resolution is DETERMINISTIC —
  // the oldest account wins, so org B registering an existing email later cannot
  // displace (lock out) org A's user.
  const res = await db.query<UserRow>(
    "SELECT id, org_id, email, display_name, role, status FROM users WHERE email = $1 ORDER BY created_at ASC, id ASC LIMIT 1",
    [normalizeEmail(email)],
  );
  return res.rows[0] ?? null;
}

export async function getPasswordHash(db: SqlDb, userId: string): Promise<string | null> {
  const res = await db.query<{ password_hash: string }>("SELECT password_hash FROM credentials WHERE user_id = $1", [userId]);
  return res.rows[0]?.password_hash ?? null;
}

// Cached dummy hash so the unknown-user path does the SAME scrypt work as a real
// user (Vale V6: no user-enumeration timing oracle).
let dummyHashCache: string | null = null;
async function dummyHash(): Promise<string> {
  if (!dummyHashCache) dummyHashCache = await hashPassword("verin-constant-work-not-a-real-password");
  return dummyHashCache;
}

/**
 * Verify credentials in constant work (scrypt runs whether or not the user exists),
 * returning the active user on success or null otherwise. Removes the timing oracle.
 */
export async function authenticate(
  db: SqlDb,
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const user = await findUserByEmail(db, email);
  const hash = (user ? await getPasswordHash(db, user.id) : null) ?? (await dummyHash());
  const ok = await verifyPassword(password, hash);
  if (!user || !ok || user.status !== "active" || !isRole(user.role)) return null;
  return authenticatedUser(user);
}

export async function createSession(
  db: SqlDb,
  tenant: TenantContext,
  user: AuthenticatedUser,
  ttlMinutes: number,
): Promise<Principal> {
  const authenticatedTenant = user.tenant;
  assertTenantContext(tenant);
  assertTenantContext(authenticatedTenant);
  assertSameTenant(tenant, authenticatedTenant);
  assertAuthenticatedUser(user);
  // user.tenant is minted from the authenticated ROW (tenantFromIdentity(row.id,
  // row.org_id)), so "same org, same human actor" is exactly the ownership check this
  // used to spell out by hand.
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMinutes * 60_000);
  const inserted = await db.query<SessionRow>(
    `INSERT INTO sessions (id,lineage_id,user_id,org_id,role,created_at,expires_at,revoked_at)
     SELECT $1, $1, u.id, u.org_id, u.role, $2, $3, NULL
     FROM users u
     WHERE u.id = $4 AND u.org_id = $5 AND u.role = $6 AND u.status = 'active'
     RETURNING id,lineage_id,user_id,org_id,role,created_at,expires_at,revoked_at`,
    [id, now.toISOString(), expires.toISOString(), user.id, tenant.orgId, user.role],
  );
  const row = inserted.rows[0];
  if (!row) {
    throw appError("AUTH_FAILED", "Authenticated identity does not belong to the requested tenant.");
  }
  return principalFromIdentity({
    userId: row.user_id,
    orgId: row.org_id,
    role: row.role,
    actor: user.email,
    sessionId: row.id,
    sessionLineageId: row.lineage_id,
  });
}

export async function revokeSession(db: SqlDb, sessionId: string): Promise<void> {
  await db.query("UPDATE sessions SET revoked_at = $2 WHERE id = $1", [sessionId, new Date().toISOString()]);
}

/**
 * Sliding-renewal rotation (deep-review r6 #8, charter #12 "rotation"): in ONE
 * atomic UPDATE, issue a NEW session id and extend `expires_at`, so an active
 * session slides forward past its half-life without a mid-workday logout AND the
 * presented id rotates (anti-fixation). Nothing references `sessions.id`, so
 * rotating the primary key is safe. The WHERE guard (still live: not revoked, not
 * expired) makes a lost race a no-op instead of resurrecting a dead row; RETURNING
 * tells the caller whether the rotation applied. `created_at` is untouched so the
 * original login instant survives a rotation (a future absolute-lifetime cap).
 */
export async function renewSession(
  db: SqlDb,
  sessionId: string,
  ttlMinutes: number,
): Promise<{ id: string; expiresAt: string } | null> {
  const newId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const res = await db.query<{ id: string }>(
    `UPDATE sessions SET id = $2, expires_at = $3
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > $4
     RETURNING id`,
    [sessionId, newId, expiresAt, now.toISOString()],
  );
  return res.rows[0] ? { id: newId, expiresAt } : null;
}

/**
 * Opportunistic cleanup (deep-review r6 #8): delete sessions that expired OR were
 * revoked before `cutoffIso`, so dead rows don't accumulate forever. Time-scoped,
 * not org-scoped: sessions are capability-keyed (the org-id-required fence
 * classifies them NON_TENANT). Backed by the `sessions_expires` index (migration
 * v2). Returns the number of rows deleted.
 */
export async function deleteDeadSessions(db: SqlDb, cutoffIso: string): Promise<number> {
  const res = await db.query<{ id: string }>(
    `DELETE FROM sessions
     WHERE expires_at < $1 OR (revoked_at IS NOT NULL AND revoked_at < $1)
     RETURNING id`,
    [cutoffIso],
  );
  return res.rows.length;
}
