/**
 * Identity store (ADR-0008). Users, credentials, and server-side sessions in the
 * house-CRM store. Behind the identity port so a WorkOS/Auth0 swap is an adapter
 * change (D-002). org_id is always explicit; identity is never client-trusted.
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import type { Role } from "@contracts/roles";
import { hashPassword, verifyPassword } from "./password";

export interface UserRow {
  id: string;
  org_id: string;
  email: string;
  display_name: string;
  role: Role;
  status: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  org_id: string;
  role: Role;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

// Emails are canonicalized (trimmed, lowercased) at write AND lookup: case-variants
// of one mailbox cannot split into two identities under UNIQUE(org_id, email), and
// sign-in is not case-fragile.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(
  db: SqlDb,
  input: { orgId: string; email: string; displayName: string; role: Role; password: string },
): Promise<UserRow> {
  const id = randomUUID();
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,'active',$6,'verin-crm',$6,'high')",
      [id, input.orgId, email, input.displayName, input.role, now],
    );
    await tx.query("INSERT INTO credentials (user_id, password_hash) VALUES ($1,$2)", [id, await hashPassword(input.password)]);
  });
  return { id, org_id: input.orgId, email, display_name: input.displayName, role: input.role, status: "active" };
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
export async function authenticate(db: SqlDb, email: string, password: string): Promise<UserRow | null> {
  const user = await findUserByEmail(db, email);
  const hash = (user ? await getPasswordHash(db, user.id) : null) ?? (await dummyHash());
  const ok = await verifyPassword(password, hash);
  if (!user || !ok || user.status !== "active") return null;
  return user;
}

export async function createSession(
  db: SqlDb,
  input: { userId: string; orgId: string; role: Role; ttlMinutes: number },
): Promise<SessionRow> {
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + input.ttlMinutes * 60_000);
  const row: SessionRow = {
    id,
    user_id: input.userId,
    org_id: input.orgId,
    role: input.role,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    revoked_at: null,
  };
  await db.query(
    "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ($1,$2,$3,$4,$5,$6,NULL)",
    [row.id, row.user_id, row.org_id, row.role, row.created_at, row.expires_at],
  );
  return row;
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
