/**
 * Liveness endpoint (charter #11/#14). Readiness (store reachability, outbox
 * backlog, audit-chain head) is layered on in Phase E. Runs on the Node runtime
 * because later it touches the house-CRM store.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok", service: "verin" }, { status: 200 });
}
