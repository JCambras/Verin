import { type NextRequest, NextResponse } from "next/server";
import { getDb, readJsonBody } from "@app/_server/context";
import { esignCallback } from "@infra/wire";
import { appError, isRetryable, logLevelFor, toResponse } from "@contracts/errors";
import { log } from "@infra/observability/logger";

export const runtime = "nodejs";

/**
 * The ONE status every downstream REFUSAL answers with.
 *
 * The status this endpoint returns is a MESSAGE TO THE PROVIDER ABOUT
 * REDELIVERY, not a window into our internal error taxonomy. Conflating the two
 * broke this twice: first by flattening every failure to 5xx (asking a provider
 * to redeliver a callback that can never succeed), then by passing an internal
 * error's own status straight through (answering 404 "unknown signing token"
 * when the token was fine and a downstream write failed). 422 is a status this
 * route does not otherwise use, so it says DO NOT REDELIVER unambiguously
 * whatever internal code produced it - and 401, 403 and 404 keep meaning only
 * what this handler already says they mean.
 *
 * WHICH refusal it was never rides on the status: it is in the response body's
 * `code` and in the log line beside it, where an operator actually looks.
 *
 * The general rule this is one instance of - a status is an instruction to a
 * NAMED audience about what to do next, never a view of our taxonomy - is D-224.
 */
const PERMANENT_REFUSAL_STATUS = 422;

/**
 * The e-sign provider's callback (charter #6/#16, STRIDE T-S3). Authenticated by
 * an HMAC signature over the token — NOT by a session (an external provider has no
 * session). A forged/invalid signature is rejected (401). Idempotent: a doubly-
 * fired callback yields exactly-once effect.
 *
 * Deliberately in the auth-enforcement fence's UNAUTHENTICATED allowlist: it is
 * token-authenticated, not session-authenticated.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = await readJsonBody<{ token?: string; signature?: string }>(req);
  if (!parsed.ok) return NextResponse.json({ error: { code: "VALIDATION", message: parsed.error.message } }, { status: 400 });
  const b = parsed.value;
  if (!b.token || !b.signature) {
    return NextResponse.json({ error: { code: "VALIDATION", message: "token and signature required" } }, { status: 400 });
  }
  const db = await getDb();
  const result = await esignCallback(db, b.token, b.signature, { signedAt: new Date().toISOString() });
  if (result.status === "invalid-signature") {
    return NextResponse.json({ error: { code: "AUTH_FAILED", message: "Invalid webhook signature." } }, { status: 401 });
  }
  if (result.status === "not-found") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown signing token." } }, { status: 404 });
  }
  if (result.status === "failed") {
    const mapped = toResponse(result.error ?? appError("INTERNAL", "Finalizing the account opening failed."));
    // A SERVER-SIDE failure answers 5xx: it tells the provider the callback was
    // NOT delivered, so it redelivers and resumeFlow retries the failed execution
    // idempotently from its saved cursor. That is every retryable code AND every
    // code the taxonomy already scores 5xx - an INTERNAL raised by a missing
    // table is an operational fault that a redelivery after repair completes, not
    // a refusal, even though `retryable` says a client repeating the request
    // cannot help. What is left is a genuine REFUSAL, which meets the identical
    // answer on every redelivery: it takes the single do-not-redeliver status
    // above rather than spending the provider's retry budget and then dropping
    // the signature event. A failed callback never answers success, whatever a
    // code's own status says.
    const refusal = mapped.body.error.code;
    const redeliverable = isRetryable(refusal) || mapped.status >= 500;
    const status = redeliverable ? Math.max(mapped.status, 500) : PERMANENT_REFUSAL_STATUS;
    // The status tells the provider what to DO; this tells the operator what
    // HAPPENED, at the severity the taxonomy assigns the code - so collapsing
    // every refusal onto one status never costs a diagnosis.
    log[logLevelFor(refusal)]({ code: refusal }, "e-sign callback finalization failed");
    return NextResponse.json(mapped.body, { status });
  }
  return NextResponse.json({ status: result.status });
}
