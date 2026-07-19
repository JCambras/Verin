/**
 * Sessions & RBAC (ADR-0008, charter #12). resolveSession is the ONLY place
 * identity is read — from a signed, httpOnly cookie mapped to a server-side
 * session record, never from a client-supplied role/identity header. Server-side
 * expiry + revocation are enforced. requireRole is the port-layer RBAC gate.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import { getConfig } from "@infra/config";
import { type Result, ok, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import { type Role, isAllowedRole } from "@contracts/roles";
import type { Principal } from "@contracts/principal";

export const SESSION_COOKIE = "verin_session";

function sign(sessionId: string): string {
  return createHmac("sha256", getConfig().session.secret).update(sessionId).digest("hex");
}

/** Cookie value = "<sessionId>.<hmac>" so tampering is detected before a DB lookup. */
export function signSessionCookie(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function parseSignedCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = sign(id);
  // Compare BYTE lengths: a multibyte char makes string length != byte length,
  // and timingSafeEqual throws (a 500 on every request) on unequal buffers.
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (macBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;
  return id;
}

interface JoinedRow {
  session_id: string;
  org_id: string;
  role: Role;
  expires_at: string;
  revoked_at: string | null;
  user_id: string;
  email: string;
  user_status: string;
}

/**
 * Resolve the principal from the request's signed session cookie. Returns a typed
 * AppError (AUTH_FAILED / AUTH_EXPIRED) on any failure — never a fallback role.
 */
export async function resolveSession(db: SqlDb, cookieValue: string | undefined): Promise<Result<Principal, AppError>> {
  const sessionId = parseSignedCookie(cookieValue);
  if (!sessionId) return err(appError("AUTH_FAILED", "Not signed in."));

  const res = await db.query<JoinedRow>(
    // role comes from the LIVE users row (u.role), not the session snapshot, so a
    // demotion/promotion takes effect on the next request (Vale V8), not at expiry.
    `SELECT s.id AS session_id, s.org_id, u.role, s.expires_at, s.revoked_at,
            u.id AS user_id, u.email, u.status AS user_status
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) return err(appError("AUTH_FAILED", "Session not found."));
  if (row.revoked_at) return err(appError("AUTH_FAILED", "Session has been revoked."));
  if (row.user_status !== "active") return err(appError("AUTH_FAILED", "Account is disabled."));
  // Server-side expiry — independent of any cookie max-age the client controls.
  if (new Date(row.expires_at).getTime() <= Date.now()) return err(appError("AUTH_EXPIRED", "Session has expired."));

  return ok({ userId: row.user_id, orgId: row.org_id, role: row.role, actor: row.email, sessionId: row.session_id });
}

/** Port-layer RBAC: allow only the listed roles (charter #12). */
export function requireRole(principal: Principal, allowed: readonly Role[]): Result<Principal, AppError> {
  return isAllowedRole(principal.role, allowed)
    ? ok(principal)
    : err(appError("FORBIDDEN", "You do not have permission to perform this action."));
}
