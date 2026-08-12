/**
 * WHAT A BROWSER IS TOLD WHEN THE ACCOUNT-OPENING FLOW ITSELF REFUSES.
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
 * SHARED (D-228) because the demo's simulate-sign affordance drives the very same
 * flow and used to forward the raw `AppError` - so a superseded configuration
 * version answered 409 with the internal message and no typed instruction on the
 * one surface the shipped journey actually clicks. One taxonomy, one shape, every
 * surface that reports a refusal of this flow.
 */
import { NextResponse } from "next/server";
import { CLIENT_RETRY, RETRY_LATER_AFTER_SECONDS, type ClientRetry } from "@contracts/client-retry";
import type { AppError } from "@contracts/errors";

const REFUSAL_STATUS: Record<ClientRetry, number> = {
  [CLIENT_RETRY.newIdentity]: 409,
  [CLIENT_RETRY.sameIdentity]: 500,
  [CLIENT_RETRY.later]: 503,
  [CLIENT_RETRY.none]: 422,
};

const REFUSAL_MESSAGE: Record<ClientRetry, string> = {
  [CLIENT_RETRY.newIdentity]:
    "These details differ from the submission already sent under this form session. Submit again to send them as a new account opening.",
  [CLIENT_RETRY.sameIdentity]:
    "The account opening could not be completed. Submit again to continue it - resubmitting picks up where it stopped rather than opening a second one.",
  [CLIENT_RETRY.later]:
    "This deployment is not currently able to continue account openings. Nothing was lost - your operations team must restore it, and submitting again afterwards picks this up where it stopped.",
  [CLIENT_RETRY.none]:
    "This account opening cannot be continued on this deployment. Resubmitting will not help; contact your operations team.",
};

/**
 * THE REFERENCE THE REFUSAL MINTED, if it minted one. A refusal that narrowed its
 * own message to a generic sentence carries a correlation id its operator log line
 * carries too, and that reference is the ONLY thing the person staring at the
 * failure can hand to operations - so it belongs to the shape rather than to each
 * caller, which is how it was dropped at both surfaces three rounds running.
 */
const referenceOf = (error: AppError | undefined): string | undefined => {
  const reference = error?.context?.["correlationId"];
  return typeof reference === "string" && reference.length > 0 ? reference : undefined;
};

/**
 * One refusal shape: the typed instruction, a human sentence, the refusal's own
 * reference when it has one, and - for the arm that says "come back" - the pacing
 * that keeps a client from hammering a deployment an operator is still repairing.
 *
 * The SENTENCE is always this module's, never the refusal's: an `AppError`'s
 * message is written for whoever raised it and has carried dotted document paths
 * and SHA-256 digests across this boundary before (D-227/D-229).
 */
export function refusalResponse(retry: ClientRetry, error?: AppError): NextResponse {
  const status = REFUSAL_STATUS[retry];
  const reference = referenceOf(error);
  const message = reference === undefined
    ? REFUSAL_MESSAGE[retry]
    : `${REFUSAL_MESSAGE[retry]} Quote reference ${reference}.`;
  return NextResponse.json(
    { retry, error: { message } },
    retry === CLIENT_RETRY.later
      ? { status, headers: { "retry-after": String(RETRY_LATER_AFTER_SECONDS) } }
      : { status },
  );
}
