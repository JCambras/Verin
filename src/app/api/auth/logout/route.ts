import { type NextRequest, NextResponse } from "next/server";
import { getDb, sessionCookieOptions } from "@app/_server/context";
import { resolveSession, SESSION_COOKIE } from "@infra/identity/session";
import { revokeSession } from "@infra/identity/identity-store";
import { auditEvent } from "@infra/wire";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const db = await getDb();
  const principal = await resolveSession(db, cookie);
  if (principal.ok) {
    await revokeSession(db, principal.value.sessionId);
    await auditEvent(db, { orgId: principal.value.orgId, actor: principal.value.userId, action: "session.revoke", entityType: "Session", entityId: principal.value.sessionId, detail: "Signed out" });
  }
  const res = NextResponse.json({ ok: true });
  // The clearing cookie carries the SAME attributes as the session cookie
  // (httpOnly/secure/sameSite/path) so every user agent matches and drops it.
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
