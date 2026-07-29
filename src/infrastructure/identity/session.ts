/**
 * Sessions & RBAC (ADR-0008, charter #12). resolveSession is the ONLY place
 * identity is read — from a signed, httpOnly cookie mapped to a server-side
 * session record, never from a client-supplied role/identity header. Server-side
 * expiry + revocation are enforced. Sliding renewal (resolveAndRenewSession)
 * rotates the id + extends expiry once past the half-life, so an active session
 * never hits the hard expiry mid-workday. requireRole is the port-layer RBAC gate.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import { getConfig } from "@infra/config";
import { revealSecret } from "@contracts/secret";
import { type Result, ok, err } from "@contracts/result";
import { appError, normalizeAppError, type AppError } from "@contracts/errors";
import { type Role, isAllowedRole } from "@contracts/roles";
import {
  principalFromIdentity,
  type Principal,
} from "@contracts/principal";
import type { PIIBearing } from "@contracts/pii";
import { log, safeReason } from "@infra/observability/logger";
import { renewSession, deleteDeadSessions } from "./identity-store";

export const SESSION_COOKIE = "verin_session";

// Sliding renewal (deep-review r6 #8): renew once a session passes the halfway
// mark of its TTL. Half is the classic sliding-window trigger - frequent enough
// to always stay ahead of the hard expiry for an active user, rare enough that
// the vast majority of requests do zero extra writes.
const RENEW_WHEN_REMAINING_FRACTION = 0.5;
// Opportunistic cleanup keeps a dead (expired/revoked) row for one extra TTL as a
// short forensic window before deleting it, so dead rows don't accumulate forever.
const DEAD_SESSION_RETENTION_TTLS = 1;

function sign(sessionId: string): string {
  // revealSecret is the explicit, fence-allowlisted secret read (v3 §15.4).
  return createHmac("sha256", revealSecret(getConfig().session.secret)).update(sessionId).digest("hex");
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

/** PIIBearing: carries the user email for principal display. */
interface JoinedRow extends PIIBearing {
  session_id: string;
  org_id: string;
  role: Role;
  expires_at: string;
  revoked_at: string | null;
  user_id: string;
  email: string;
  user_status: string;
}

/** The resolved principal plus the session's server-side expiry (for renewal timing). */
interface ResolvedSession {
  principal: Principal;
  expiresAt: string;
}

/**
 * A persisted identity row is untrusted INPUT, not programmer error: `users.role`
 * carries no CHECK constraint, so an out-of-taxonomy or blank column must resolve
 * to a typed AUTH_FAILED — the same shape as revoked/disabled/expired — rather
 * than throwing out of the read-only /app server-component guard as a 500.
 * authenticate() (identity-store) treats the identical condition the same way.
 */
function principalFromRow(input: {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly actor: string;
  readonly sessionId: string;
}): Result<Principal, AppError> {
  try {
    return ok(principalFromIdentity(input));
  } catch (e) {
    return err(normalizeAppError(e) ??
      appError("AUTH_FAILED", "Session identity is not usable."));
  }
}

/**
 * The single identity read: map a signed session cookie to its server-side record,
 * enforcing revocation, account status, and expiry. Returns the principal AND the
 * expiry (the renewal orchestrator needs it) or a typed AppError — never a fallback
 * role. The SELECT is unchanged (an exact-match reviewed escape in the
 * org-id-required fence): `expires_at` was already projected, so sliding renewal
 * needs no new column and the fence holds without an edit.
 */
async function resolveSessionRow(db: SqlDb, cookieValue: string | undefined): Promise<Result<ResolvedSession, AppError>> {
  const sessionId = parseSignedCookie(cookieValue);
  if (!sessionId) return err(appError("AUTH_FAILED", "Not signed in."));

  const res = await db.query<JoinedRow>(
    // role comes from the LIVE users row (u.role), not the session snapshot, so a
    // demotion/promotion takes effect on the next request (Vale V8), not at expiry.
    `SELECT s.id AS session_id, s.org_id, u.role, s.expires_at, s.revoked_at,
            u.id AS user_id, u.email, u.status AS user_status
     FROM sessions s
     JOIN users u ON u.id = s.user_id AND u.org_id = s.org_id
     WHERE s.id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) return err(appError("AUTH_FAILED", "Session not found."));
  if (row.revoked_at) return err(appError("AUTH_FAILED", "Session has been revoked."));
  if (row.user_status !== "active") return err(appError("AUTH_FAILED", "Account is disabled."));
  // Server-side expiry — independent of any cookie max-age the client controls.
  if (new Date(row.expires_at).getTime() <= Date.now()) return err(appError("AUTH_EXPIRED", "Session has expired."));

  const principal = principalFromRow({
    userId: row.user_id,
    orgId: row.org_id,
    role: row.role,
    actor: row.email,
    sessionId: row.session_id,
  });
  if (!principal.ok) return principal;

  return ok({ principal: principal.value, expiresAt: row.expires_at });
}

/**
 * Resolve the principal from the request's signed session cookie (read-only, no
 * renewal). Used by callers that cannot set a cookie — the server-component /app
 * guard and logout. Mutating routes use resolveAndRenewSession via requirePrincipal.
 */
export async function resolveSession(db: SqlDb, cookieValue: string | undefined): Promise<Result<Principal, AppError>> {
  const resolved = await resolveSessionRow(db, cookieValue);
  return resolved.ok ? ok(resolved.value.principal) : resolved;
}

/**
 * Resolve the principal AND slide the session forward when it has passed the
 * halfway point of its TTL: rotate to a NEW session id and extend `expires_at`,
 * returning the cookie the app layer must re-set (the one place that can write a
 * cookie). Rotation on renewal mitigates fixation and satisfies charter #12's
 * "rotation"; a rotation also triggers an opportunistic sweep of long-dead rows.
 * A read that succeeds but whose rotation loses a race keeps the still-valid
 * principal with no new cookie (the old id resolved fine for THIS request).
 */
export async function resolveAndRenewSession(
  db: SqlDb,
  cookieValue: string | undefined,
): Promise<Result<{ principal: Principal; renewedCookie: { value: string; maxAgeSeconds: number } | null }, AppError>> {
  const resolved = await resolveSessionRow(db, cookieValue);
  if (!resolved.ok) return resolved;

  const ttlMinutes = getConfig().session.ttlMinutes;
  const nowMs = Date.now();
  const remainingMs = new Date(resolved.value.expiresAt).getTime() - nowMs;
  if (remainingMs >= ttlMinutes * 60_000 * RENEW_WHEN_REMAINING_FRACTION) {
    return ok({ principal: resolved.value.principal, renewedCookie: null });
  }

  const renewed = await renewSession(db, resolved.value.principal.sessionId, ttlMinutes);
  if (!renewed) return ok({ principal: resolved.value.principal, renewedCookie: null });

  // Cleanup piggybacks on the (infrequent) rotation event, not every request:
  // renewals happen at most once per half-TTL per session, a natural throttle.
  const cutoffIso = new Date(nowMs - ttlMinutes * 60_000 * DEAD_SESSION_RETENTION_TTLS).toISOString();
  // Best-effort: never let a cleanup failure throw out after the rotation already
  // committed (it would orphan the rotated session); the next rotation retries.
  await deleteDeadSessions(db, cutoffIso).catch((e: unknown) =>
    log.warn({ reason: safeReason(e) }, "opportunistic session cleanup failed"),
  );

  const rotated = principalFromRow({
    userId: resolved.value.principal.userId,
    orgId: resolved.value.principal.orgId,
    role: resolved.value.principal.role,
    actor: resolved.value.principal.actor,
    sessionId: renewed.id,
  });
  if (!rotated.ok) return rotated;

  return ok({
    principal: rotated.value,
    renewedCookie: { value: signSessionCookie(renewed.id), maxAgeSeconds: ttlMinutes * 60 },
  });
}

/** Port-layer RBAC: allow only the listed roles (charter #12). */
export function requireRole(principal: Principal, allowed: readonly Role[]): Result<Principal, AppError> {
  return isAllowedRole(principal.role, allowed)
    ? ok(principal)
    : err(appError("FORBIDDEN", "You do not have permission to perform this action."));
}
