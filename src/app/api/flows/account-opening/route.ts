import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, readJsonBody, errorResponse } from "@app/_server/context";
import { startAccountOpening, CLIENT_REQUEST_ID_RE, START_INPUT_FIELDS } from "@infra/wire";
import { ACCOUNT_OPENING_DOMAIN, loadIntakeForm } from "@infra/config/domain-config-source";
import { appError, logLevelFor } from "@contracts/errors";
import { CLIENT_RETRY, type ClientRetry } from "@contracts/client-retry";
import { log } from "@infra/observability/logger";
import {
  admitIntakeSubmission,
  optionalIntakeValue,
  requiredIntakeValue,
  unmappedIntakeFields,
  CLIENT_REQUEST_ID_KEY,
} from "@domain/config/intake-view";

export const runtime = "nodejs";

/**
 * WHAT THE BROWSER IS TOLD WHEN THE FLOW ITSELF FAILS.
 *
 * The status and the body are a MESSAGE TO THE SUBMITTER ABOUT WHAT TO DO NEXT,
 * never a window into our error taxonomy (D-224). Forwarding the flow's own
 * `AppError` made the journey's behavior depend on which code a step happened to
 * raise: `accountTypeOf` raises a VALIDATION from INSIDE `application.create`,
 * after `household.create` and `contact.create` have committed, and a client
 * reading that as "the submitter can fix this" would mint a fresh request id and
 * open a duplicate household on the next submit. So the flow's instruction picks
 * the status and the sentence, and WHICH failure it was goes to the log line
 * beside it, where an operator actually looks.
 *
 * Boundary refusals above (authorization, malformed body, an undeclared
 * registration, a field this deployment cannot carry) keep their own code: those
 * ARE the answer to the submitter's request, and nothing has been written yet.
 */
const REFUSAL_STATUS: Record<ClientRetry, number> = {
  [CLIENT_RETRY.newIdentity]: 409,
  [CLIENT_RETRY.sameIdentity]: 500,
  [CLIENT_RETRY.none]: 422,
};

const REFUSAL_MESSAGE: Record<ClientRetry, string> = {
  [CLIENT_RETRY.newIdentity]:
    "These details differ from the submission already sent under this form session. Submit again to send them as a new account opening.",
  [CLIENT_RETRY.sameIdentity]:
    "The account opening could not be completed. Submit again to continue it - resubmitting picks up where it stopped rather than opening a second one.",
  [CLIENT_RETRY.none]:
    "This account opening cannot be continued on this deployment. Resubmitting will not help; contact your operations team.",
};

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
  //
  // An INTERNAL, not a VALIDATION (D-224): this fires only when the PUBLISHED
  // DOCUMENT declares a field this deployment has no room for, which no
  // submission can cause and no user can fix. Filing it as a client 400 would
  // bury a broken configuration in client-error noise instead of raising the
  // server error an operator alerts on - the policy `intake-view.ts` already
  // states, and the reason every VALIDATION this route emits is one the
  // submitter can act on.
  const unmapped = unmappedIntakeFields(supplied, START_INPUT_FIELDS);
  if (unmapped.length > 0) {
    return errorResponse(
      appError(
        "INTERNAL",
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
    // Every failure `startAccountOpening` can return names its own instruction;
    // the fallback is the conservative one (stay attached to an execution that may
    // already exist) and is here only so this mapping is total.
    const retry = result.retry ?? CLIENT_RETRY.sameIdentity;
    const error = result.error ?? appError("INTERNAL", "The account-opening flow failed to start.");
    log[logLevelFor(error.code)]({ code: error.code, retry }, "account-opening flow start failed");
    return NextResponse.json(
      { retry, error: { message: REFUSAL_MESSAGE[retry] } },
      { status: REFUSAL_STATUS[retry] },
    );
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
