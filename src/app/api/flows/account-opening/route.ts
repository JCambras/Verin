import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, readJsonBody, errorResponse } from "@app/_server/context";
import { startAccountOpening, CLIENT_REQUEST_ID_RE, START_INPUT_FIELDS } from "@infra/wire";
import { ACCOUNT_OPENING_DOMAIN, loadIntakeForm } from "@infra/config/domain-config-source";
import { appError } from "@contracts/errors";
import {
  admitIntakeSubmission,
  optionalIntakeValue,
  requiredIntakeValue,
  unmappedIntakeFields,
  CLIENT_REQUEST_ID_KEY,
} from "@domain/config/intake-view";

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
  // The start input is a FIXED shape, so a configured field it cannot carry is
  // refused here rather than admitted and dropped: dropping it would fail at
  // whatever step sources the slot, after the earlier steps had committed - the
  // partial write a clean boundary refusal exists to prevent. Deriving the input
  // from the configured trigger fields is prompt 12's intake pipeline (D-210).
  const unmapped = unmappedIntakeFields(supplied, START_INPUT_FIELDS);
  if (unmapped.length > 0) {
    return errorResponse(
      appError(
        "VALIDATION",
        `This deployment cannot carry the configured intake field(s) ${unmapped.map((field) => JSON.stringify(field)).join(", ")}; the account-opening start input is a fixed shape until the generic intake pipeline lands.`,
      ),
    );
  }
  // Double-submit protection (D-027): the client mints one UUID per form session;
  // it becomes the lowercase canonical executionId, so case variants and a
  // retry/second tab replay the same execution. The key is the platform's own
  // declaration, so this boundary reads exactly the name the loader reserves.
  const clientRequestId = b[CLIENT_REQUEST_ID_KEY];
  if (typeof clientRequestId !== "string" || !CLIENT_REQUEST_ID_RE.test(clientRequestId)) {
    return errorResponse(
      appError("VALIDATION", `${CLIENT_REQUEST_ID_KEY} is required (a UUID minted once per form session).`),
    );
  }

  // The admitted values are read back through the checked accessors, so a trigger
  // field renamed in the document is a refusal here rather than a blank passed on
  // for a value this boundary just declared required.
  const householdName = requiredIntakeValue(form.value, supplied, "householdName");
  if (!householdName.ok) return errorResponse(householdName.error);
  const firstName = requiredIntakeValue(form.value, supplied, "firstName");
  if (!firstName.ok) return errorResponse(firstName.error);
  const lastName = requiredIntakeValue(form.value, supplied, "lastName");
  if (!lastName.ok) return errorResponse(lastName.error);
  const accountType = requiredIntakeValue(form.value, supplied, "accountType");
  if (!accountType.ok) return errorResponse(accountType.error);
  const email = optionalIntakeValue(form.value, supplied, "email");
  if (!email.ok) return errorResponse(email.error);

  const db = await getDb();
  const result = await startAccountOpening(db, auth.value, pii.value, {
    householdName: householdName.value,
    firstName: firstName.value,
    lastName: lastName.value,
    email: email.value,
    accountType: accountType.value,
    clientRequestId,
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
