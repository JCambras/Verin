import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipal, errorResponse } from "@app/_server/context";
import { computeEsignSignature, esignCallback } from "@infra/wire";
import { appError } from "@contracts/errors";

export const runtime = "nodejs";

/**
 * The "click to sign" affordance for the demo (sacrificial component — ADR-0020).
 * Stands in for the e-sign provider: authenticated by the advisor's session, it
 * computes the valid HMAC signature server-side and drives the same webhook path
 * (which still verifies the signature). Not a legally valid signature.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipal(req);
  if (!p.ok) return errorResponse(p.error);

  const b = (await req.json().catch(() => ({}))) as { token?: string };
  if (!b.token) return errorResponse(appError("VALIDATION", "token required"));

  const db = await getDb();
  const signature = computeEsignSignature(b.token);
  const result = await esignCallback(db, b.token, signature, { signedAt: new Date().toISOString() });
  if (result.status === "not-found") return errorResponse(appError("NOT_FOUND", "Unknown signing token."));
  if (result.status === "invalid-signature") return errorResponse(appError("INTERNAL", "signature mismatch"));
  return NextResponse.json({ status: result.status });
}
