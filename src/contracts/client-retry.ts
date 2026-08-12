/**
 * WHAT A SUBMITTER SHOULD DO NEXT - the browser's half of D-224 (a status or code
 * is an instruction to a NAMED audience, never a view of the internal taxonomy).
 *
 * No error CODE can carry this, which is why it is its own closed vocabulary. The
 * account-opening endpoint answers two different CONFLICTs whose remedies are
 * opposite: a spent request identity (an edited resubmit) clears the moment the
 * client mints a new one (the refusal's own message says so) while an execution
 * bound to a superseded configuration version can never be cleared by resubmitting
 * at all. A client that INFERS its next move from the code must get one of the two
 * wrong, and the two mistakes are not symmetric: minting a fresh identity after a
 * refusal the submitter cannot fix opens a SECOND execution (the per-write
 * idempotency keys are execution-scoped), turning one intended account opening into
 * duplicate household, contact and application rows, while keeping a spent one
 * dead-ends the user with no in-page remedy.
 *
 * So the server DECIDES, at the point where it knows, and the client OBEYS.
 *
 * PERMANENT VERSUS TRANSIENT WAS A FALSE BINARY. A third category exists and is
 * NEITHER: a refusal that WILL CLEAR ON OPERATOR ACTION - a superseded
 * configuration version an operator rolls back, a document repaired and
 * republished. Answering one of those "do not retry" throws the request away for
 * good, which on the e-sign callback path means a client signs and their account
 * never opens; answering it "retry now" spends the sender's retry budget against
 * a condition no retry can change. Both audiences need the same third arm, so
 * both read it from HERE (D-226).
 */
import type { AppError } from "@contracts/errors";

export const CLIENT_RETRY = Object.freeze({
  /** The request identity is SPENT: resubmitting needs a freshly minted one. */
  newIdentity: "retry-with-new-identity",
  /**
   * The submission did not complete. Resubmit under the SAME identity: it re-drives
   * the same execution from its saved cursor, whose committed writes replay under
   * their existing idempotency keys instead of duplicating.
   */
  sameIdentity: "retry-with-same-identity",
  /**
   * The refusal stands until an OPERATOR repairs the deployment, and then clears
   * on its own. Keep the request identity and send it again after the pacing
   * interval below; retrying sooner meets the identical refusal, and giving up
   * discards work that is still completable.
   */
  later: "retry-later",
  /** Nothing the submitter can do reaches a different outcome; an operator must act. */
  none: "do-not-retry",
} as const);

export type ClientRetry = (typeof CLIENT_RETRY)[keyof typeof CLIENT_RETRY];

/**
 * THE CLASSIFICATION RULE, STATED WHERE THE CATEGORIES ARE (D-228).
 *
 * A category belongs to a CAUSE, not to a call site. Assigning it per call site
 * is what produced the inconsistency this rule closes: the version guard and the
 * intake projection answered `later` for a document this deployment cannot use,
 * while the start path answered `none` ("resubmitting will not help; contact your
 * operations team") for the SAME broken document one layer in, and the resume path
 * answered nothing at all. Telling a submitter to give up on a refusal an operator
 * rollback WILL clear is the same false instruction, one layer down.
 *
 * So the rule is: EVERY refusal whose cause is "this deployment cannot resolve or
 * compile its published configuration" is operator-recoverable and therefore
 * `later`, wherever it arises - the load, the version guard, the compile, and the
 * missing execution adapter included. The mint site marks the cause, because that
 * is where it is known; every surface then READS the instruction rather than
 * choosing one, so a refusal added later inherits the classification without
 * anyone remembering to.
 */
const OPERATOR_RECOVERABLE = new WeakSet<object>();

/**
 * Mark a refusal as operator-recoverable, at the point that knows why. Returns
 * the same error, so a mint reads `operatorRecoverable(appError(...))`.
 */
export function operatorRecoverable(error: AppError): AppError {
  OPERATOR_RECOVERABLE.add(error);
  return error;
}

/**
 * The instruction a refusal INHERITS from its cause, falling back to what the
 * caller knows when the cause says nothing. Every surface that reports a refusal
 * asks this instead of naming a category, which is what makes the rule above
 * self-applying rather than a convention someone has to remember.
 */
export function clientRetryFor(error: AppError | undefined, otherwise: ClientRetry): ClientRetry {
  return error !== undefined && OPERATOR_RECOVERABLE.has(error) ? CLIENT_RETRY.later : otherwise;
}

/**
 * How long a `later` sender waits before sending again - the pacing every surface
 * that answers that arm puts on the wire (`Retry-After`).
 *
 * Unpaced redelivery is the failure the do-not-redeliver status was introduced to
 * stop, wearing a different number: a provider that retries a parked callback in a
 * tight loop burns its budget before the operator has read the alert. One minute
 * is long enough to be a repair window and short enough that a rollback completes
 * the signature within the provider's retention.
 */
export const RETRY_LATER_AFTER_SECONDS = 60;
