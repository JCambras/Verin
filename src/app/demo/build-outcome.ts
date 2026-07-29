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
import type {
  ExecutionRowVM,
  ExecutionVM,
  SafetyCheckVM,
  SafetyVM,
  VerificationVM,
} from "./model";
import { fact } from "./provenance";
import { buildSpine } from "./spine";
import {
  CAST,
  DEMO_NOW,
  DEMO_TIMELINE,
  GC15_PENDING_DISTRIBUTION,
  IDS,
  demoTimestampLabel,
  pendingDistributionDeltaSentence,
  usdMinor,
  type ScenarioData,
} from "./data";

const IDENTIFIERS = [
  { label: "Idempotency key", value: IDS.idempotencyKey },
  { label: "Conflict keys", value: IDS.conflictKeys.join("  ·  ") },
  { label: "Reservation", value: IDS.reservationId },
];

export function buildSafety(scenario: ScenarioData): SafetyVM {
  const spec = scenario.spec;
  const checks: SafetyCheckVM[] = spec.invalidation
    ? [
        {
          label: `Pending approved activity changed from ${usdMinor(GC15_PENDING_DISTRIBUTION.beforeMinor)} to ${usdMinor(GC15_PENDING_DISTRIBUTION.afterMinor)}`,
          status: "voided",
          statusLabel: "Evidence changed",
        },
        {
          label: "Liquidity must be re-evaluated against the new pending amount",
          status: "voided",
          statusLabel: "Decision input changed",
        },
        {
          label: "Bank instruction unchanged since the decision",
          status: "done",
          statusLabel: "Verified",
        },
      ]
    : [
        {
          label: "Liquidity unchanged since the decision",
          status: "done",
          statusLabel: "Verified",
        },
        {
          label: "No new pending actions against this household",
          status: "done",
          statusLabel: "Verified",
        },
        {
          label: "Bank instruction unchanged since the decision",
          status: "done",
          statusLabel: "Verified",
        },
      ];
  if (spec.competing) {
    checks.push({
      label: "Concurrent request detected against the same liquidity",
      status: "done",
      statusLabel: "Reservation held",
      detail: "This request reserved first and proceeds. The competing request is blocked by the reservation and cannot jointly violate the reserve floor.",
    });
  }
  return {
    spine: buildSpine("Safety", spec.invalidation ? { status: "voided", label: "Approval voided" } : undefined),
    revalidatedAt: fact(
      `Material evidence re-checked ${demoTimestampLabel(DEMO_TIMELINE.revalidatedAt)}`,
      "deterministic-engine-output",
      DEMO_NOW,
      demoTimestampLabel(DEMO_TIMELINE.revalidatedAt),
    ),
    checks,
    reservationId: IDS.reservationId,
    conflictKeys: IDS.conflictKeys,
    idempotencyKey: IDS.idempotencyKey,
    invalidation: spec.invalidation
      ? {
          voidedActor: {
            name: CAST.opsApprover1,
            role: "Operations",
            when: demoTimestampLabel(DEMO_TIMELINE.operationsApproval1At),
          },
          deltaSentence: pendingDistributionDeltaSentence(
            GC15_PENDING_DISTRIBUTION,
          ),
          before: fact(
            `${usdMinor(GC15_PENDING_DISTRIBUTION.beforeMinor)} pending approved activity`,
            "synthetic-fixture",
            DEMO_TIMELINE.decisionCreatedAt,
            demoTimestampLabel(DEMO_TIMELINE.evidenceRetrievedAt),
          ),
          after: fact(
            `${usdMinor(GC15_PENDING_DISTRIBUTION.afterMinor)} pending approved distribution`,
            "synthetic-fixture",
            GC15_PENDING_DISTRIBUTION.observedAt,
            demoTimestampLabel(GC15_PENDING_DISTRIBUTION.retrievedAt),
          ),
          why: {
            reason:
              "Approval binds to the decision hash and input-bundle hash. The pending-distribution delta changed the evidence preimage, so the approval cannot stand.",
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
        status: "settled",
        statusLabel: "Settled · verified",
        timestamp: demoTimestampLabel(DEMO_TIMELINE.executionSubmittedAt),
        honestyLine: `Verified against returned custodian status, ${demoTimestampLabel(DEMO_TIMELINE.executionVerifiedAt)}.`,
        identifiers: IDENTIFIERS,
        fakeClass: "fake-adapter-response",
      },
      {
        step: "Wire transfer to the household bank",
        target: "Salesforce managed capability",
        status: "unknown",
        statusLabel: "Unconfirmed",
        timestamp: demoTimestampLabel(DEMO_TIMELINE.executionSubmittedAt),
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
      timestamp: demoTimestampLabel(DEMO_TIMELINE.executionSubmittedAt),
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
      timestamp: demoTimestampLabel(DEMO_TIMELINE.duplicateSuppressedAt),
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
  const proves = [
    fact(
      "Submission accepted by the capability",
      "fake-adapter-response",
      DEMO_NOW,
      demoTimestampLabel(DEMO_TIMELINE.executionSubmittedAt),
    ),
  ];
  if (spec.partial) {
    proves.push(
      fact(
        "Money-market redemption settled",
        "fake-adapter-response",
        DEMO_NOW,
        demoTimestampLabel(DEMO_TIMELINE.executionVerifiedAt),
      ),
    );
  }
  const appended: ExecutionRowVM[] = [];
  if (spec.delayedNigo) {
    appended.push({
      step: `Returned NIGO (ingested ${demoTimestampLabel(DEMO_TIMELINE.delayedNigoAt)})`,
      target: "Salesforce managed capability",
      status: "nigo",
      statusLabel: "Returned NIGO",
      timestamp: demoTimestampLabel(DEMO_TIMELINE.delayedNigoAt),
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
      timestamp: demoTimestampLabel(DEMO_TIMELINE.stuckAt),
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
    nextPoll: `Next status poll: ${demoTimestampLabel(DEMO_TIMELINE.nextPollAt)}`,
    appended,
    fakeClass: "fake-adapter-response",
  };
}
