import { type NextRequest, NextResponse } from "next/server";
import { getDb, sessionCookieOptions, readJsonBody, errorResponse } from "@app/_server/context";
import { authenticate, createSession } from "@infra/identity/identity-store";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";
import { getConfig } from "@infra/config";
import { appError } from "@contracts/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = await readJsonBody<{ email?: string; password?: string }>(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const body = parsed.value;
  if (!body.email || !body.password) return errorResponse(appError("VALIDATION", "Email and password are required."));

  const db = await getDb();
  // Constant-work credential check (no user-enumeration timing oracle, Vale V6).
  const user = await authenticate(db, body.email, body.password);
  if (!user) return errorResponse(appError("AUTH_FAILED", "Incorrect email or password."));

  const session = await createSession(db, { userId: user.id, orgId: user.org_id, role: user.role, ttlMinutes: getConfig().session.ttlMinutes });
  const res = NextResponse.json({ ok: true, actor: user.email, role: user.role });
  res.cookies.set(SESSION_COOKIE, signSessionCookie(session.id), sessionCookieOptions());
  return res;
}
