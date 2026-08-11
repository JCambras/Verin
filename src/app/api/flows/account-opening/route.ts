import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, readJsonBody, errorResponse } from "@app/_server/context";
import { startAccountOpening, CLIENT_REQUEST_ID_RE } from "@infra/wire";
import { ACCOUNT_OPENING_DOMAIN, loadIntakeForm } from "@infra/config/domain-config-source";
import { appError } from "@contracts/errors";
import { admitIntakeSubmission } from "@domain/config/intake-view";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Starting the flow is the governed "execution.initiate" action (v3 §15.3);
  // the allowed roles (advisor/ops/principal/admin) are unchanged from the
  // original RBAC gate.
  const auth = await requireActionGrant(req, "execution.initiate");
  if (!auth.ok) return errorResponse(auth.error);
  const pii = await requireActionGrant(req, "pii.view");
  if (!pii.ok) return errorResponse(pii.error);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const b = parsed.value;
  // The intake rules this boundary enforces are the ones the published
  // configuration DECLARES - per-slot maximum lengths and the registration
  // vocabulary - so adding a registration to the document can never render a
  // select option this route then refuses.
  const form = loadIntakeForm(ACCOUNT_OPENING_DOMAIN);
  if (!form.ok) return errorResponse(form.error);
  const admitted = admitIntakeSubmission(form.value, b);
  if (!admitted.ok) return errorResponse(admitted.error);
  const supplied = admitted.value;
  // Double-submit protection (D-027): the client mints one UUID per form session;
  // it becomes the lowercase canonical executionId, so case variants and a
  // retry/second tab replay the same execution.
  if (typeof b.clientRequestId !== "string" || !CLIENT_REQUEST_ID_RE.test(b.clientRequestId)) {
    return errorResponse(appError("VALIDATION", "clientRequestId is required (a UUID minted once per form session)."));
  }

  const db = await getDb();
  const result = await startAccountOpening(db, auth.value, pii.value, {
    householdName: supplied["householdName"] ?? "",
    firstName: supplied["firstName"] ?? "",
    lastName: supplied["lastName"] ?? "",
    email: supplied["email"] ?? null,
    accountType: supplied["accountType"] ?? "",
    clientRequestId: b.clientRequestId,
  });
  if (result.status === "failed") {
    return errorResponse(result.error ?? appError("INTERNAL", "The account-opening flow failed to start."));
  }

  return NextResponse.json({
    executionId: result.executionId,
    status: result.status,
    token: result.token ?? null,
    awaiting: result.awaiting ?? null,
    applicationId: result.data.applicationId ?? null,
    householdId: result.data.householdId ?? null,
  });
}
