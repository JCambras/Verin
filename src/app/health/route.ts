/**
 * Liveness endpoint (charter #11/#14). Distinct from /ready, which reports
 * readiness (store reachability, outbox backlog).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok", service: "verin" }, { status: 200 });
}
