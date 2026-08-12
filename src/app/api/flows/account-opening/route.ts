import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, readJsonBody, errorResponse } from "@app/_server/context";
import { startAccountOpening, CLIENT_REQUEST_ID_RE, START_INPUT_FIELDS } from "@infra/wire";
import {
  ACCOUNT_OPENING_DOMAIN,
  configuredRefusal,
  loadIntakeForm,
} from "@infra/config/domain-config-source";
import { appError, logLevelFor, type AppError } from "@contracts/errors";
import { CLIENT_RETRY, clientRetryFor } from "@contracts/client-retry";
import { refusalResponse } from "@app/_server/refusal";
import { log } from "@infra/observability/logger";
import {
  admitIntakeSubmission,
  optionalIntakeValue,
  requiredIntakeValue,
  unmappedIntakeFault,
  CLIENT_REQUEST_ID_KEY,
} from "@domain/config/intake-view";

export const runtime = "nodejs";

/**
 * A CHECKED INTAKE READ THAT FAILED, answered by its CAUSE (D-241). The same
 * accessor raises two different things: a submitter's omission of a declared
 * field, which is theirs to fix and keeps its own VALIDATION, and a document that
 * declares no such trigger field at all, which no submission reaches and an
 * operator rollback clears - so that one takes the shared refusal shape and its
 * "come back" instruction rather than a bare server error.
 */
function intakeReadRefusal(error: AppError): NextResponse {
  const retry = clientRetryFor(error, CLIENT_RETRY.newIdentity);
  return retry === CLIENT_RETRY.later ? refusalResponse(retry, error) : errorResponse(error);
}

/**
 * Boundary refusals of the SUBMISSION (authorization, a malformed body, an
 * undeclared registration) keep their own code: those ARE the answer to the
 * submitter's request, and nothing has been written yet. Everything whose cause is
 * the published CONFIGURATION - whether the flow raised it or this boundary did -
 * takes the shared instruction shape in `@app/_server/refusal`.
 */
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
  // EVERY refusal below whose cause is the published document is minted HERE, so
  // this boundary carries no second opinion about what one means (D-245).
  const refuse = configuredRefusal(ACCOUNT_OPENING_DOMAIN);
  // The intake rules this boundary enforces are the ones the published
  // configuration DECLARES - per-slot maximum lengths and the registration
  // vocabulary - so adding a registration to the document can never render a
  // select option this route then refuses.
  const form = loadIntakeForm(ACCOUNT_OPENING_DOMAIN);
  // A configuration this deployment cannot resolve is an OPERATOR-RECOVERABLE
  // refusal, so it takes the third instruction (D-240/D-242) - read off the
  // refusal's own cause rather than named here. The message is the generic
  // sentence the source minted, carrying the correlation id its own log line
  // carries; the document path, version and hashes are on that line as registered
  // values, never on the wire.
  if (!form.ok) {
    return refusalResponse(clientRetryFor(form.error, CLIENT_RETRY.sameIdentity), form.error);
  }
  const admitted = admitIntakeSubmission(form.value, b);
  if (!admitted.ok) return errorResponse(admitted.error);
  const supplied = admitted.value;
  // The start input is a FIXED shape, so a configured field it cannot carry is
  // refused here rather than admitted and dropped: dropping it would fail at
  // whatever step sources the slot, after the earlier steps had committed - the
  // partial write a clean boundary refusal exists to prevent. Deriving the input
  // from the configured trigger fields is prompt 12's intake pipeline (D-223).
  //
  // CLASSIFIED BY CAUSE, NOT BY CALL SITE (D-241). This fires only when the
  // PUBLISHED DOCUMENT declares a field this deployment has no room for: a
  // configuration defect an operator rollback clears and no submitter can, which
  // is the same cause every other configuration refusal carries and therefore the
  // same operator-recoverable "come back" instruction. So it is minted through the
  // shared mint and the instruction is INHERITED here, rather than this boundary
  // deciding for itself that a bare server error with no retry arm would do - and
  // the field the document declares reaches the operator's log line as a
  // registered path instead of the browser as prose (D-242).
  const unmapped = unmappedIntakeFault(form.value, supplied, START_INPUT_FIELDS, refuse);
  if (unmapped !== null) {
    return refusalResponse(clientRetryFor(unmapped, CLIENT_RETRY.sameIdentity), unmapped);
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
  const householdName = requiredIntakeValue(form.value, supplied, "householdName", refuse);
  if (!householdName.ok) return intakeReadRefusal(householdName.error);
  const firstName = requiredIntakeValue(form.value, supplied, "firstName", refuse);
  if (!firstName.ok) return intakeReadRefusal(firstName.error);
  const lastName = requiredIntakeValue(form.value, supplied, "lastName", refuse);
  if (!lastName.ok) return intakeReadRefusal(lastName.error);
  const accountType = requiredIntakeValue(form.value, supplied, "accountType", refuse);
  if (!accountType.ok) return intakeReadRefusal(accountType.error);
  const email = optionalIntakeValue(form.value, supplied, "email", refuse);
  if (!email.ok) return intakeReadRefusal(email.error);

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
    // Every failure `startAccountOpening` can return carries its own instruction;
    // the fallback is the conservative one (stay attached to an execution that may
    // already exist) and is here only so this mapping is total. The cause is asked
    // again HERE rather than trusted, so a refusal that reaches this surface from a
    // path that forgot still inherits the classification (D-241).
    const error = result.error ?? appError("INTERNAL", "The account-opening flow failed to start.");
    const retry = clientRetryFor(error, result.retry ?? CLIENT_RETRY.sameIdentity);
    log[logLevelFor(error.code)]({ code: error.code, retry }, "account-opening flow start failed");
    // Whichever layer noticed the broken document, the browser gets the same
    // sentence AND the same quotable reference - the per-surface disagreement the
    // shared shape exists to remove ran the other way for three rounds here.
    return refusalResponse(retry, error);
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
