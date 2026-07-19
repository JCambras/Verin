import { NextResponse } from "next/server";
import { getDb } from "@infra/store/db";
import { log } from "@infra/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness (charter #11/#14): store reachable, outbox backlog bounded. Distinct
 * from /health (liveness). Unauthenticated, so the response carries ONLY a status
 * word and the 200/503 code — no internal counts (the outbox backlog is an
 * activity-volume side channel). Operators read the reason from logs.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const db = await getDb();
    await db.query("SELECT 1");
    const backlog = await db.query<{ n: string }>("SELECT count(*) AS n FROM audit_outbox WHERE status <> 'done'");
    const pending = Number(backlog.rows[0]?.n ?? 0);
    const ready = pending < 1000;
    if (!ready) log.warn({ outboxPending: pending }, "readiness degraded: audit outbox backlog over threshold");
    return NextResponse.json({ status: ready ? "ready" : "degraded" }, { status: ready ? 200 : 503 });
  } catch {
    return NextResponse.json({ status: "not-ready" }, { status: 503 });
  }
}
