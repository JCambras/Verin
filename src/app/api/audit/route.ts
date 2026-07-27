import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, errorResponse } from "@app/_server/context";
import { verifyAndListOrgChain } from "@infra/audit/audit-store";

export const runtime = "nodejs";

/** The full chain is always verified; the response body carries only the latest entries. */
const MAX_ENTRIES = 200;

/**
 * The tamper-evident audit trail (charter #13). Authorized per-action as the
 * governed "audit.export" hook (v3 §15.3) — the allowed roles
 * (ops/cco/principal/admin) are unchanged from the original RBAC gate; a base
 * advisor is FORBIDDEN (demonstrates server-side RBAC at the boundary). Live
 * integrity verdict on every load (the verify covers the WHOLE chain in the
 * same single scan that feeds the listing); the listing is capped to the latest
 * entries, newest first, plus the total. The persisted actor is an opaque
 * userId (ADR-0006/0007); the email is resolved here, at RENDER time, for this
 * org's users only. System actors (seed, esign-webhook) display as-is.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireActionGrant(req, "audit.export");
  if (!auth.ok) return errorResponse(auth.error);
  const tenant = auth.value.tenant;
  const db = await getDb();
  const { verdict, rows } = await verifyAndListOrgChain(db, auth.value);
  const users = await db.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE org_id = $1", [tenant.orgId]);
  const emailById = new Map(users.rows.map((u) => [u.id, u.email]));
  return NextResponse.json({
    verdict,
    total: rows.length,
    entries: rows.slice(-MAX_ENTRIES).reverse().map((e) => ({
      sequence: e.sequence,
      actor: emailById.get(e.actor) ?? e.actor,
      action: e.action,
      entityType: e.entityType,
      detail: e.detail,
      createdAt: e.createdAt,
      entryHash: e.entryHash.slice(0, 16),
    })),
  });
}
