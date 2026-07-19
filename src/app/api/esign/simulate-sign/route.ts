import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipal, readJsonBody, errorResponse } from "@app/_server/context";
import { computeEsignSignature, esignCallback } from "@infra/wire";
import { getApplicationByToken } from "@infra/crm/application-store";
import { appError } from "@contracts/errors";
import { getConfig } from "@infra/config";

export const runtime = "nodejs";

/**
 * The "click to sign" affordance for the demo (sacrificial component — ADR-0020).
 * Stands in for the e-sign provider: authenticated by the advisor's session, it
 * computes the valid HMAC signature server-side and drives the same webhook path
 * (which still verifies the signature). Not a legally valid signature. REFUSED in
 * production (ADR-0020 guardrail): a server that forges valid client e-signatures
 * must never exist where signatures carry legal weight.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (getConfig().appEnv === "production") {
    return errorResponse(appError("NOT_FOUND", "Simulated signing is not available in production."));
  }
  const p = await requirePrincipal(req);
  if (!p.ok) return errorResponse(p.error);

  const parsed = await readJsonBody<{ token?: string }>(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const b = parsed.value;
  if (!b.token) return errorResponse(appError("VALIDATION", "token required"));

  const db = await getDb();
  // Defense-in-depth (Sable F5): this authenticated affordance must not let a user
  // in org A sign org B's application — the unguessable token is not the sole guard.
  const app = await getApplicationByToken(db, b.token);
  if (!app || app.org_id !== p.value.orgId) return errorResponse(appError("NOT_FOUND", "Unknown signing token."));
  const signature = computeEsignSignature(b.token);
  const result = await esignCallback(db, b.token, signature, { signedAt: new Date().toISOString() });
  if (result.status === "not-found") return errorResponse(appError("NOT_FOUND", "Unknown signing token."));
  if (result.status === "invalid-signature") return errorResponse(appError("INTERNAL", "signature mismatch"));
  if (result.status === "failed") {
    return errorResponse(result.error ?? appError("INTERNAL", "Finalizing the account opening failed."));
  }
  return NextResponse.json({ status: result.status });
}
