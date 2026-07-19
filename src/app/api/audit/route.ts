import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipalWithRole, errorResponse } from "@app/_server/context";
import { listOrgChain, verifyOrgChain } from "@infra/audit/audit-store";

export const runtime = "nodejs";

/**
 * The tamper-evident audit trail (charter #13). RBAC-gated to compliance roles
 * (ops/cco/principal/admin) — a base advisor is FORBIDDEN (demonstrates
 * server-side RBAC at the boundary). Returns the chain + a live integrity verdict.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["ops", "cco", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);
  const db = await getDb();
  const entries = await listOrgChain(db, p.value.orgId);
  const verdict = await verifyOrgChain(db, p.value.orgId);
  return NextResponse.json({
    verdict,
    entries: entries.map((e) => ({
      sequence: e.sequence,
      actor: e.actor,
      action: e.action,
      entityType: e.entityType,
      detail: e.detail,
      createdAt: e.createdAt,
      entryHash: e.entryHash.slice(0, 16),
    })),
  });
}
