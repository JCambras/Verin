import { type NextRequest, NextResponse } from "next/server";
import { getDb, readJsonBody } from "@app/_server/context";
import { esignCallback } from "@infra/wire";

export const runtime = "nodejs";

/**
 * The e-sign provider's callback (charter #6/#16, STRIDE T-S3). Authenticated by
 * an HMAC signature over the token — NOT by a session (an external provider has no
 * session). A forged/invalid signature is rejected (401). Idempotent: a doubly-
 * fired callback yields exactly-once effect.
 *
 * Deliberately in the auth-enforcement fence's UNAUTHENTICATED allowlist: it is
 * token-authenticated, not session-authenticated.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = await readJsonBody<{ token?: string; signature?: string }>(req);
  if (!parsed.ok) return NextResponse.json({ error: { code: "VALIDATION", message: parsed.error.message } }, { status: 400 });
  const b = parsed.value;
  if (!b.token || !b.signature) {
    return NextResponse.json({ error: { code: "VALIDATION", message: "token and signature required" } }, { status: 400 });
  }
  const db = await getDb();
  const result = await esignCallback(db, b.token, b.signature, { signedAt: new Date().toISOString() });
  if (result.status === "invalid-signature") {
    return NextResponse.json({ error: { code: "AUTH_FAILED", message: "Invalid webhook signature." } }, { status: 401 });
  }
  if (result.status === "not-found") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown signing token." } }, { status: 404 });
  }
  return NextResponse.json({ status: result.status });
}
