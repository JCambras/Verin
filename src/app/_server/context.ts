/**
 * App-layer server helpers. The app layer may import anything (ADR-0001). Every
 * mutating route resolves the principal from the signed session cookie here — the
 * single identity read (charter #12; auth-enforcement fence). org_id and role come
 * from the session, never from the request body or a header.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@infra/store/db";
import { getConfig } from "@infra/config";
import { resolveSession, SESSION_COOKIE, requireRole } from "@infra/identity/session";
import { type Result, err } from "@contracts/result";
import { appError, toResponse, type AppError } from "@contracts/errors";
import type { Principal } from "@contracts/principal";
import type { Role } from "@contracts/roles";

export { getDb, requireRole };

export async function requirePrincipal(req: NextRequest): Promise<Result<Principal, AppError>> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return err(appError("AUTH_FAILED", "Not signed in."));
  const db = await getDb();
  return resolveSession(db, cookie);
}

export async function requirePrincipalWithRole(req: NextRequest, allowed: readonly Role[]): Promise<Result<Principal, AppError>> {
  const p = await requirePrincipal(req);
  if (!p.ok) return p;
  return requireRole(p.value, allowed);
}

export function errorResponse(error: AppError): NextResponse {
  const { status, body } = toResponse(error);
  return NextResponse.json(body, { status });
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Bounded JSON body reader (STRIDE T-D1 / Sable F2). App-Router handlers do NOT
 * inherit a body-size limit, so an unbounded `req.json()` is a memory-pressure DoS.
 * Rejects oversized bodies before/after buffering.
 */
export async function readJsonBody<T = Record<string, unknown>>(
  req: NextRequest,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<Result<T, AppError>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return err(appError("VALIDATION", "Request body too large."));
  const text = await req.text();
  if (text.length > maxBytes) return err(appError("VALIDATION", "Request body too large."));
  try {
    return { ok: true, value: (text ? JSON.parse(text) : {}) as T };
  } catch {
    return err(appError("VALIDATION", "Invalid JSON body."));
  }
}

export function sessionCookieOptions() {
  const cfg = getConfig();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Real production only (APP_ENV); e2e runs `next start` (NODE_ENV=production)
    // over http on localhost, where a secure cookie would never be sent.
    secure: cfg.appEnv === "production",
    path: "/",
    maxAge: cfg.session.ttlMinutes * 60,
  };
}
