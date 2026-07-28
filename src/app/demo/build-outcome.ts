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
import { fact, fixtureMetric } from "./provenance";
import { buildSpine } from "./spine";
import { CAST, IDS, RETRIEVED_AT, liquidityAuthorityFor, type FirmData, type ScenarioData } from "./data";

const IDENTIFIERS = [
  { label: "Idempotency key", value: IDS.idempotencyKey },
  { label: "Conflict keys", value: IDS.conflictKeys.join("  ·  ") },
  { label: "Reservation", value: IDS.reservationId },
];

export function buildSafety(scenario: ScenarioData, firm: FirmData): SafetyVM {
  const spec = scenario.spec;
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const initial = authority.kind === "signed" ? authority.initialDecision : null;
  const refreshed = authority.kind === "signed" ? authority.preExecutionRevalidation : undefined;
  const checks = authority.kind === "missing"
    ? [
        {
          label: "Signed liquidity authority unavailable for this branch and firm",
          status: "pending",
          statusLabel: "Evidence missing",
          detail: `${authority.reason}. No unrelated case was substituted.`,
        },
      ]
    : refreshed
      ? [
          {
            label: "Liquidity snapshot changed after approval",
            status: "voided",
            statusLabel: "Evidence changed",
            detail: `The refreshed bundle records ${refreshed.pendingNote}.`,
          },
          {
            label: "Pending actions re-checked against this household",
            status: "voided",
            statusLabel: "New activity found",
            detail: "The initial decision observed no pending activity. Pre-execution revalidation found the new distribution.",
          },
        ]
      : [
          { label: "Liquidity unchanged since the decision", status: "done", statusLabel: "Verified" },
          initial && initial.pendingActivityMinor > 0
            ? {
                label: "Pending actions re-checked against this household",
                status: "done",
                statusLabel: "Re-read",
                detail: `${initial.pendingNote}. It was counted against the decision's liquidity.`,
              }
            : { label: "No new pending actions against this household", status: "done", statusLabel: "Verified" },
        ];
  if (spec.invalidation) {
    checks.push({
      label: "Input bundle refreshed after the liquidity change",
      status: "voided",
      statusLabel: "Approval invalidated",
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
    invalidation: spec.invalidation && initial && refreshed
      ? {
          voidedActor: { name: CAST.opsApprover1, role: "Operations", when: "Jul 26, 10:02" },
          deltaSentence: "A new $15,000 pending distribution appeared after this approval was given.",
          before: {
            label: "Initial decision · pending activity",
            metric: fixtureMetric(initial.pendingActivityMinor, "currency-minor", "synthetic-fixture", "2026-07-26"),
            retrievedAt: RETRIEVED_AT,
          },
          after: {
            label: "Pre-execution revalidation · pending distribution",
            metric: fixtureMetric(refreshed.pendingActivityMinor, "currency-minor", "synthetic-fixture", "2026-07-26"),
            retrievedAt: "Jul 26, 13:58",
          },
          why: {
            reason:
              "Approval binds to the decision hash and the input-bundle hash. Revalidation changed effective liquidity from $300,000 to $285,000, so the refreshed bundle requires a new decision and fresh approvals even though the reserve still holds.",
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
