/**
 * Fake-service builders for the OUTCOME surfaces: pre-execution safety check
 * (surface 7, including the §7.3 approval-invalidation moment), execution timeline
 * (surface 8), and verification state (surface 9).
 *
 * Everything external here is a labeled fake-adapter response: the real managed
 * Salesforce invocation is deferred pending sandbox access (ADR-0024; demo contract
 * minute 4:05 deferral annotation). Honest-status doctrine (§8): submitted is never
 * settled, green is earned, NIGO and stuck are first-class.
 */
import type { ExecutionRowVM, ExecutionVM, SafetyVM, VerificationVM } from "./model";
import { fact } from "./provenance";
import { buildSpine } from "./spine";
import { BANK_INSTRUCTION, CAST, IDS, RETRIEVED_AT, type ScenarioData } from "./data";

const IDENTIFIERS = [
  { label: "Idempotency key", value: IDS.idempotencyKey },
  { label: "Conflict keys", value: IDS.conflictKeys.join("  ·  ") },
  { label: "Reservation", value: IDS.reservationId },
];

export function buildSafety(scenario: ScenarioData): SafetyVM {
  const spec = scenario.spec;
  const checks = [
    { label: "Liquidity unchanged since the decision", status: "done", statusLabel: "Verified" },
    scenario.liquidity.pendingActivityMinor > 0
      ? {
          label: "Pending actions re-checked against this household",
          status: "done",
          statusLabel: "Re-read",
          detail: `${scenario.liquidity.pendingNote}. It was already counted against the decision's liquidity, and the reserve floor still holds after this movement.`,
        }
      : { label: "No new pending actions against this household", status: "done", statusLabel: "Verified" },
  ];
  if (spec.invalidation) {
    checks.push({
      label: "Bank instruction changed after approval",
      status: "voided",
      statusLabel: "Evidence changed",
    } as (typeof checks)[number]);
  } else {
    checks.push({ label: "Bank instruction unchanged since the decision", status: "done", statusLabel: "Verified" });
  }
  if (spec.competing) {
    checks.push({
      label: "Concurrent request detected against the same liquidity",
      status: "done",
      statusLabel: "Reservation held",
      detail: "This request reserved first and proceeds. The competing request is blocked by the reservation and cannot jointly violate the reserve floor.",
    } as (typeof checks)[number]);
  }
  return {
    spine: buildSpine("Safety", spec.invalidation ? { status: "voided", label: "Approval voided" } : undefined),
    revalidatedAt: fact("Material evidence re-checked Jul 26, 13:58", "deterministic-engine-output", "2026-07-26", "Jul 26, 13:58"),
    checks,
    reservationId: IDS.reservationId,
    conflictKeys: IDS.conflictKeys,
    idempotencyKey: IDS.idempotencyKey,
    invalidation: spec.invalidation
      ? {
          voidedActor: { name: CAST.opsApprover1, role: "Operations", when: "Jul 26, 10:02" },
          deltaSentence: "The bank instruction changed after this approval was given.",
          before: fact(BANK_INSTRUCTION.stable, "synthetic-fixture", "2026-05-20", RETRIEVED_AT),
          after: fact(BANK_INSTRUCTION.changed, "synthetic-fixture", "2026-07-26", "Jul 26, 13:58"),
          why: {
            reason:
              "Approval binds to the decision hash and the input-bundle hash. The bundle changed when the bank instruction changed, so the approval cannot stand.",
          },
          primaryLabel: "Re-evaluate with current evidence",
        }
      : null,
    fakeClass: "deterministic-engine-output",
  };
}

export function buildExecution(scenario: ScenarioData): ExecutionVM {
  const spec = scenario.spec;
  const rows: ExecutionRowVM[] = [];
  if (spec.partial) {
    rows.push(
      {
        step: "Raise cash (money-market redemption)",
        target: "Salesforce managed capability",
        status: "completed",
        statusLabel: "Settled · verified",
        timestamp: "Jul 26, 14:02",
        honestyLine: "Verified against returned custodian status, Jul 26, 15:40.",
        identifiers: IDENTIFIERS,
        fakeClass: "fake-adapter-response",
      },
      {
        step: "Wire transfer to the household bank",
        target: "Salesforce managed capability",
        status: "unknown",
        statusLabel: "Unconfirmed",
        timestamp: "Jul 26, 14:02",
        honestyLine: "No returned status for this part - an exception decision has been requested.",
        affordanceLabel: "Review the exception",
        identifiers: IDENTIFIERS,
        fakeClass: "fake-adapter-response",
      },
    );
  } else {
    rows.push({
      step: "Money-movement instruction",
      target: "Salesforce managed capability",
      status: "submitted",
      statusLabel: "Submitted",
      timestamp: "Jul 26, 14:02",
      honestyLine: "Accepted for processing - settlement not yet confirmed.",
      identifiers: IDENTIFIERS,
      fakeClass: "fake-adapter-response",
    });
  }
  if (spec.duplicateRetry) {
    rows.push({
      step: "Retry after timeout",
      target: "Salesforce managed capability",
      status: "duplicate-suppressed",
      statusLabel: "Duplicate suppressed",
      timestamp: "Jul 26, 14:03",
      plainClaim: "Already submitted once - Verin did not send it again.",
      identifiers: [{ label: "Idempotency key (matches the original byte-for-byte)", value: IDS.idempotencyKey }],
      fakeClass: "fake-adapter-response",
    });
  }
  return {
    spine: buildSpine("Execution"),
    rows,
    deferredNote:
      "Executed against the fake ExecutionTarget adapter. The real managed-Salesforce invocation is deferred pending sandbox access (ADR-0024); the choreography, idempotency proof, and exactly-once behavior run now against the fake.",
    fakeClass: "fake-adapter-response",
  };
}

export function buildVerification(scenario: ScenarioData): VerificationVM {
  const spec = scenario.spec;
  const proves = [fact("Submission accepted by the capability", "fake-adapter-response", "2026-07-26", "Jul 26, 14:02")];
  if (spec.partial) proves.push(fact("Money-market redemption settled", "fake-adapter-response", "2026-07-26", "Jul 26, 15:40"));
  const appended: ExecutionRowVM[] = [];
  if (spec.delayedNigo) {
    appended.push({
      step: "Returned NIGO (ingested Jul 28)",
      target: "Salesforce managed capability",
      status: "nigo",
      statusLabel: "Returned NIGO",
      timestamp: "Jul 28, 07:12",
      honestyLine: "Returned - the bank letter of authorization is not in good order: signature missing.",
      affordanceLabel: "Fix and resubmit the authorization",
      identifiers: [{ label: "Idempotency key", value: IDS.idempotencyKey }],
      fakeClass: "fake-adapter-response",
    });
  }
  if (spec.partial) {
    appended.push({
      step: "Wire-transfer status",
      target: "Salesforce managed capability",
      status: "stuck",
      statusLabel: "Stuck",
      timestamp: "Jul 28, 14:02",
      honestyLine: "No status for two days - the stuck-state rule (forty-eight hours unconfirmed) fired.",
      affordanceLabel: "Escalate to operations",
      identifiers: [{ label: "Idempotency key", value: IDS.idempotencyKey }],
      fakeClass: "fake-adapter-response",
    });
  }
  return {
    spine: buildSpine("Verification"),
    proves,
    notProvenYet: [
      "Settlement at the custodian",
      "Funds availability at the destination bank",
      "That the instruction will not be returned not-in-good-order",
    ],
    nextPoll: "Next status poll: Jul 27, 06:00",
    appended,
    fakeClass: "fake-adapter-response",
  };
}
