import { NextResponse } from "next/server";
import { getDb } from "@infra/store/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness (charter #11/#14): store reachable, outbox backlog bounded, audit
 * chain head present. Distinct from /health (liveness).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const db = await getDb();
    await db.query("SELECT 1");
    const backlog = await db.query<{ n: string }>("SELECT count(*) AS n FROM audit_outbox WHERE status <> 'done'");
    const pending = Number(backlog.rows[0]?.n ?? 0);
    const ready = pending < 1000;
    return NextResponse.json({ status: ready ? "ready" : "degraded", store: "ok", outboxPending: pending }, { status: ready ? 200 : 503 });
  } catch (e) {
    return NextResponse.json({ status: "not-ready", error: e instanceof Error ? e.message : "unknown" }, { status: 503 });
  }
}
