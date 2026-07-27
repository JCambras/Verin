/**
 * App-layer server helpers. The app layer may import anything (ADR-0001). Every
 * mutating route resolves the principal from the signed session cookie here — the
 * single identity read (charter #12; auth-enforcement fence). org_id and role come
 * from the session, never from the request body or a header.
 */
import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@infra/store/db";
import { getConfig } from "@infra/config";
import { resolveAndRenewSession, SESSION_COOKIE, requireRole } from "@infra/identity/session";
import { type Result, ok, err } from "@contracts/result";
import { appError, toResponse, type AppError } from "@contracts/errors";
import type { Principal } from "@contracts/principal";
import type { Role } from "@contracts/roles";
import { actorRefOf, authorizeGovernedAction, type ActionGrant, type GovernedAction } from "@contracts/authz";

export { getDb, requireRole };

/**
 * ONE identity resolution per request. Sliding renewal ROTATES the session id and
 * writes the new cookie to the RESPONSE store, while `req.cookies` keeps the id the
 * client presented — so a second resolution on the same request would look up an id
 * that renewal has already deleted and fail AUTH_FAILED. A route that binds two
 * grants (`/api/audit` holds audit.export AND pii.view) does exactly that, and it
 * only breaks once the session passes its half-life. Memoizing the in-flight promise
 * keeps the fence-required prologue shape (one `requireActionGrant` per action) while
 * leaving rotation exactly where ADR-0008/D-030 put it: inside requirePrincipal.
 */
const REQUEST_PRINCIPAL = new WeakMap<NextRequest, Promise<Result<Principal, AppError>>>();

export function requirePrincipal(req: NextRequest): Promise<Result<Principal, AppError>> {
  const inFlight = REQUEST_PRINCIPAL.get(req);
  if (inFlight) return inFlight;
  const resolving = resolvePrincipalOnce(req);
  REQUEST_PRINCIPAL.set(req, resolving);
  return resolving;
}

async function resolvePrincipalOnce(req: NextRequest): Promise<Result<Principal, AppError>> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return err(appError("AUTH_FAILED", "Not signed in."));
  const db = await getDb();
  const resolved = await resolveAndRenewSession(db, cookie);
  if (!resolved.ok) return resolved;
  const { principal, renewedCookie } = resolved.value;
  if (renewedCookie) {
    // Sliding renewal rotated the session id; persist the new signed cookie on
    // THIS response so the client presents the rotated id next request. Valid
    // because requirePrincipal is only ever called from a Route Handler / Server
    // Action (never a Server Component, which cannot mutate cookies) — the
    // read-only /app guard and logout use resolveSession instead.
    (await cookies()).set(SESSION_COOKIE, renewedCookie.value, { ...sessionCookieOptions(), maxAge: renewedCookie.maxAgeSeconds });
  }
  return ok(principal);
}

export async function requirePrincipalWithRole(req: NextRequest, allowed: readonly Role[]): Promise<Result<Principal, AppError>> {
  const p = await requirePrincipal(req);
  if (!p.ok) return p;
  return requireRole(p.value, allowed);
}

/**
 * The per-action authorization hook for GOVERNED actions (v3 §15.3): resolves
 * the principal server-side, then authorizes the specific action, returning the
 * sealed ActionGrant whose tenant scopes every downstream repository call. Route
 * handlers for governed surfaces call THIS (governed-actions fence) — plain
 * requirePrincipalWithRole stays for non-governed CRUD gates.
 */
export async function requireActionGrant<A extends GovernedAction>(
  req: NextRequest,
  action: A,
): Promise<Result<ActionGrant<A>, AppError>> {
  const p = await requirePrincipal(req);
  if (!p.ok) return p;
  const grant = authorizeGovernedAction(actorRefOf(p.value), action);
  if (!grant.ok) return grant;
  return ok(grant.value);
}

export function errorResponse(error: AppError): NextResponse {
  const { status, body } = toResponse(error);
  return NextResponse.json(body, { status });
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Bounded JSON body reader (STRIDE T-D1 / Sable F2). App-Router handlers do NOT
 * inherit a body-size limit, so an unbounded `req.json()` is a memory-pressure DoS.
 * Reads the body stream incrementally with a byte cap — content-length is absent
 * under chunked transfer encoding, so the cap must be enforced while reading,
 * never after buffering.
 */
export async function readJsonBody<T = Record<string, unknown>>(
  req: NextRequest,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<Result<T, AppError>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return err(appError("VALIDATION", "Request body too large."));
  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return err(appError("VALIDATION", "Request body too large."));
      }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    // Callers destructure an object: a body of literal null / "x" / 3 / [] would
    // otherwise pass the cast and throw an unhandled 500 at the property access.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return err(appError("VALIDATION", "Request body must be a JSON object."));
    }
    return ok(parsed as T);
  } catch {
    return err(appError("VALIDATION", "Invalid JSON body."));
  }
}

export function sessionCookieOptions() {
  const cfg = getConfig();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Secure everywhere except local dev/e2e: staging and production are real
    // HTTPS environments. Keyed on APP_ENV because e2e runs `next start`
    // (NODE_ENV=production) over http on localhost, where a secure cookie would
    // never be sent.
    secure: cfg.appEnv !== "development",
    path: "/",
    maxAge: cfg.session.ttlMinutes * 60,
  };
}
