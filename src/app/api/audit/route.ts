import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, errorResponse } from "@app/_server/context";
import { verifyAndListOrgChain } from "@infra/audit/audit-store";
import { listOrgUserEmails } from "@infra/identity/identity-store";

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
 * userId (ADR-0006/0007); the email is resolved at RENDER time, for this org's
 * users only. System actors (seed, esign-webhook) display as-is.
 *
 * TWO grants, not one: exporting the chain is `audit.export`, and resolving actor
 * userIds to raw emails is a PII read that owes its own `pii.view` authority. The
 * lookup runs behind the identity repository, because raw SQL in the app layer
 * escapes both governed-sink and tenant-scope derivation.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireActionGrant(req, "audit.export");
  if (!auth.ok) return errorResponse(auth.error);
  const pii = await requireActionGrant(req, "pii.view");
  if (!pii.ok) return errorResponse(pii.error);
  const db = await getDb();
  const { verdict, rows } = await verifyAndListOrgChain(db, auth.value);
  const emailById = new Map(
    (await listOrgUserEmails(db, pii.value)).map((u) => [u.id, u.email]),
  );
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
