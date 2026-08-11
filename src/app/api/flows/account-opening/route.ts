import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, readJsonBody, errorResponse } from "@app/_server/context";
import { startAccountOpening, CLIENT_REQUEST_ID_RE } from "@infra/wire";
import { ACCOUNT_OPENING_DOMAIN, loadIntakeForm } from "@infra/config/domain-config-source";
import { appError } from "@contracts/errors";
import { admitIntakeSubmission, optionalIntakeValue, requiredIntakeValue } from "@domain/config/intake-view";

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

  // The admitted values are read back through the checked accessors, so a trigger
  // field renamed in the document is a refusal here rather than a blank passed on
  // for a value this boundary just declared required.
  const householdName = requiredIntakeValue(supplied, "householdName");
  if (!householdName.ok) return errorResponse(householdName.error);
  const firstName = requiredIntakeValue(supplied, "firstName");
  if (!firstName.ok) return errorResponse(firstName.error);
  const lastName = requiredIntakeValue(supplied, "lastName");
  if (!lastName.ok) return errorResponse(lastName.error);
  const accountType = requiredIntakeValue(supplied, "accountType");
  if (!accountType.ok) return errorResponse(accountType.error);
  const email = optionalIntakeValue(supplied, "email");
  if (!email.ok) return errorResponse(email.error);

  const db = await getDb();
  const result = await startAccountOpening(db, auth.value, pii.value, {
    householdName: householdName.value,
    firstName: firstName.value,
    lastName: lastName.value,
    email: email.value,
    accountType: accountType.value,
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
