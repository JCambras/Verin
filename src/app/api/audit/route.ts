import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipalWithRole, errorResponse } from "@app/_server/context";
import { verifyAndListOrgChain } from "@infra/audit/audit-store";

export const runtime = "nodejs";

/** The full chain is always verified; the response body carries only the latest entries. */
const MAX_ENTRIES = 200;

/**
 * The tamper-evident audit trail (charter #13). RBAC-gated to compliance roles
 * (ops/cco/principal/admin) — a base advisor is FORBIDDEN (demonstrates
 * server-side RBAC at the boundary). Live integrity verdict on every load (the
 * verify covers the WHOLE chain in the same single scan that feeds the listing);
 * the listing is capped to the latest entries, newest first, plus the total.
 * The persisted actor is an opaque userId (ADR-0006/0007); the email is resolved
 * here, at RENDER time, for this org's users only. System actors (seed,
 * esign-webhook) display as-is.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["ops", "cco", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);
  const db = await getDb();
  const { verdict, rows } = await verifyAndListOrgChain(db, p.value.orgId);
  const users = await db.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE org_id = $1", [p.value.orgId]);
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
