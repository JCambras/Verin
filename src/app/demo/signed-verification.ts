import type { SignedVerificationData } from "./signed-case-types";
import {
  asArray,
  asBoolean,
  asRecord,
  asString,
  asStringArray,
} from "./signed-case-fields";

export function parseVerification(
  value: unknown,
  path: string,
): SignedVerificationData {
  const verification = asRecord(value, path);
  const reached = asBoolean(verification.reached, `${path}.reached`);
  const note = asString(verification.note, `${path}.note`);
  const currentReason = asString(
    verification.currentReason,
    `${path}.currentReason`,
  );
  const polling = asRecord(verification.polling, `${path}.polling`);
  const pollingState = asString(polling.state, `${path}.polling.state`);
  const rawException =
    verification.exception === null
      ? null
      : asRecord(verification.exception, `${path}.exception`);
  if (!reached) {
    if (
      verification.observedStatus !== null ||
      verification.settledClaim !== null ||
      verification.observedAt !== null ||
      verification.custodianReason !== null ||
      asArray(verification.proves, `${path}.proves`).length !== 0 ||
      asArray(verification.notProvenYet, `${path}.notProvenYet`).length !== 0 ||
      pollingState !== "not-reached" ||
      polling.reason !== "execution-not-reached" ||
      rawException !== null
    ) {
      throw new TypeError(`${path} is not a closed not-reached verification`);
    }
    return {
      reached: false,
      observedStatus: null,
      settledClaim: null,
      observedAt: null,
      currentReason,
      custodianReason: null,
      proves: [],
      notProvenYet: [],
      polling: {
        state: "not-reached",
        reason: "execution-not-reached",
      },
      exception: null,
      note,
    };
  }
  const observedStatus = asString(
    verification.observedStatus,
    `${path}.observedStatus`,
  );
  const settledClaim = asString(
    verification.settledClaim,
    `${path}.settledClaim`,
  );
  const observedAt = asString(
    verification.observedAt,
    `${path}.observedAt`,
  );
  const custodianReason =
    verification.custodianReason === null
      ? null
      : asString(
          verification.custodianReason,
          `${path}.custodianReason`,
        );
  const proves = asStringArray(verification.proves, `${path}.proves`);
  const notProvenYet = asStringArray(
    verification.notProvenYet,
    `${path}.notProvenYet`,
  );
  if (
    observedStatus === "submitted" &&
    settledClaim === "submitted-is-not-settled" &&
    custodianReason === null &&
    proves.length === 1 &&
    pollingState === "scheduled" &&
    polling.interval === "PT12H" &&
    rawException === null
  ) {
    return {
      reached: true,
      observedStatus,
      settledClaim,
      observedAt,
      currentReason,
      custodianReason,
      proves,
      notProvenYet,
      polling: { state: "scheduled", interval: "PT12H" },
      exception: null,
      note,
    };
  }
  if (
    observedStatus === "unknown" &&
    settledClaim === "partial-is-not-settled" &&
    custodianReason === null &&
    proves.length === 2 &&
    pollingState === "scheduled" &&
    polling.interval === "PT12H" &&
    rawException?.reason === "partial-execution" &&
    rawException.triggeringLedgerEvent === "ExecutionPartiallySucceeded"
  ) {
    return {
      reached: true,
      observedStatus,
      settledClaim,
      observedAt,
      currentReason,
      custodianReason,
      proves,
      notProvenYet,
      polling: { state: "scheduled", interval: "PT12H" },
      exception: {
        reason: "partial-execution",
        triggeringLedgerEvent: "ExecutionPartiallySucceeded",
        summary: asString(
          rawException.summary,
          `${path}.exception.summary`,
        ),
      },
      note,
    };
  }
  if (
    observedStatus === "nigo" &&
    settledClaim === "submitted-is-not-settled" &&
    custodianReason !== null &&
    proves.length === 2 &&
    pollingState === "stopped" &&
    polling.reason === "terminal-nigo-exception-opened" &&
    rawException?.reason === "delayed-nigo" &&
    rawException.triggeringLedgerEvent === "StatusObserved"
  ) {
    return {
      reached: true,
      observedStatus,
      settledClaim,
      observedAt,
      currentReason,
      custodianReason,
      proves,
      notProvenYet,
      polling: {
        state: "stopped",
        reason: "terminal-nigo-exception-opened",
      },
      exception: {
        reason: "delayed-nigo",
        triggeringLedgerEvent: "StatusObserved",
        summary: asString(
          rawException.summary,
          `${path}.exception.summary`,
        ),
      },
      note,
    };
  }
  throw new TypeError(`${path} has an unsupported verification combination`);
}
