import { type NextRequest, NextResponse } from "next/server";
import { getDb, sessionCookieOptions, errorResponse } from "@app/_server/context";
import { findUserByEmail, getPasswordHash, createSession } from "@infra/identity/identity-store";
import { verifyPassword } from "@infra/identity/password";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";
import { getConfig } from "@infra/config";
import { appError } from "@contracts/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) return errorResponse(appError("VALIDATION", "Email and password are required."));

  const db = await getDb();
  const user = await findUserByEmail(db, body.email);
  // Uniform failure message + password check even on unknown user (no user enumeration).
  const hash = user ? await getPasswordHash(db, user.id) : null;
  const okPassword = hash ? await verifyPassword(body.password, hash) : false;
  if (!user || !okPassword) return errorResponse(appError("AUTH_FAILED", "Incorrect email or password."));
  if (user.status !== "active") return errorResponse(appError("AUTH_FAILED", "Account is disabled."));

  const session = await createSession(db, { userId: user.id, orgId: user.org_id, role: user.role, ttlMinutes: getConfig().session.ttlMinutes });
  const res = NextResponse.json({ ok: true, actor: user.email, role: user.role });
  res.cookies.set(SESSION_COOKIE, signSessionCookie(session.id), sessionCookieOptions());
  return res;
}
