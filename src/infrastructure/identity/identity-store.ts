/**
 * Identity store (ADR-0008). Users, credentials, and server-side sessions in the
 * house-CRM store. Behind the identity port so a WorkOS/Auth0 swap is an adapter
 * change (D-002). org_id is always explicit; identity is never client-trusted.
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import type { Role } from "@contracts/roles";
import { hashPassword } from "./password";

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

export async function createUser(
  db: SqlDb,
  input: { orgId: string; email: string; displayName: string; role: Role; password: string },
): Promise<UserRow> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,'active',$6,'verin-crm',$6,'high')",
      [id, input.orgId, input.email, input.displayName, input.role, now],
    );
    await tx.query("INSERT INTO credentials (user_id, password_hash) VALUES ($1,$2)", [id, await hashPassword(input.password)]);
  });
  return { id, org_id: input.orgId, email: input.email, display_name: input.displayName, role: input.role, status: "active" };
}

export async function findUserByEmail(db: SqlDb, email: string): Promise<UserRow | null> {
  const res = await db.query<UserRow>("SELECT id, org_id, email, display_name, role, status FROM users WHERE email = $1 LIMIT 1", [email]);
  return res.rows[0] ?? null;
}

export async function getPasswordHash(db: SqlDb, userId: string): Promise<string | null> {
  const res = await db.query<{ password_hash: string }>("SELECT password_hash FROM credentials WHERE user_id = $1", [userId]);
  return res.rows[0]?.password_hash ?? null;
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
