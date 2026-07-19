import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@app/_server/context";
import { resolveSession, SESSION_COOKIE } from "@infra/identity/session";
import { revokeSession } from "@infra/identity/identity-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const db = await getDb();
  const principal = await resolveSession(db, cookie);
  if (principal.ok) await revokeSession(db, principal.value.sessionId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
