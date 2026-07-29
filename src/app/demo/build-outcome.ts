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
import type { ExecutionRowVM, ExecutionVM, SafetyCheckVM, SafetyVM, VerificationVM } from "./model";
import { fact, fixtureMetric } from "./provenance";
import { buildSpine } from "./spine";
import {
  CAST,
  IDS,
  RETRIEVED_AT,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import { formatDemoInstant, relatedDecisionAt, timelineFor } from "./timeline";

const IDENTIFIERS = [
  { label: "Idempotency key", value: IDS.idempotencyKey },
  { label: "Conflict keys", value: IDS.conflictKeys.join("  ·  ") },
  { label: "Reservation", value: IDS.reservationId },
];

export function buildSafety(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): SafetyVM {
  const spec = scenario.spec;
  const timeline = timelineFor(scenario, firm);
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const invalidationAuthority = hasSignedInvalidationAuthority(
    scenario,
    firm.id,
  );
  const initial = authority.kind === "signed" ? authority.initialDecision : null;
  const refreshed = authority.kind === "signed" ? authority.preExecutionRevalidation : undefined;
  const invalidatedPass = invalidationAuthority && pass === "initial";
  const executionEligible =
    authority.kind === "signed" &&
    (!spec.invalidation ||
      (invalidationAuthority && pass === "revalidated"));
  const checks: SafetyCheckVM[] = authority.kind === "missing"
    ? [
        {
          label: "Signed liquidity authority unavailable for this branch and firm",
          status: "pending",
          statusLabel: "Evidence missing",
          detail: `${authority.reason}. No unrelated case was substituted.`,
        },
      ]
    : invalidatedPass && refreshed
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
      : invalidationAuthority && pass === "revalidated" && refreshed
        ? [
            {
              label: "Liquidity matches the refreshed derived decision",
              status: "done",
              statusLabel: "Verified",
              detail: "Effective liquidity remains $285,000 on the refreshed bundle.",
            },
            {
              label: "Pending distribution re-checked and counted",
              status: "done",
              statusLabel: "Verified",
              detail: refreshed.pendingNote,
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
  if (invalidatedPass) {
    checks.push({
      label: "Input bundle refreshed after the liquidity change",
      status: "voided",
      statusLabel: "Approval invalidated",
    } as (typeof checks)[number]);
  } else {
    checks.push({ label: "Bank instruction unchanged since the decision", status: "done", statusLabel: "Verified" });
  }
  if (invalidationAuthority && pass === "revalidated") {
    checks.push({
      label: "Two fresh approvals bind to the derived decision",
      status: "done",
      statusLabel: "Verified",
      detail: "Both distinct operations approvers approved the derived decision and refreshed input-bundle hashes.",
    });
  }
  if (spec.competing) {
    const related = authority.kind === "signed" ? authority.relatedDecisions?.[0] : undefined;
    checks.push(
      related
        ? {
            label: "Concurrent request detected against the same liquidity",
            status: "done",
            statusLabel: "Reservation held",
            detail: `Signed case ${related.sourceCaseId} records the sibling request at ${formatDemoInstant(related.requestAt, undefined, true)} as ${related.disposition} at ${formatDemoInstant(relatedDecisionAt(related.requestAt), undefined, true)}, after this request's reservation committed.`,
            relatedDecision: {
              sourceCaseId: related.sourceCaseId,
              disposition: related.disposition,
              requestAtIso: related.requestAt,
              decidedAtIso: relatedDecisionAt(related.requestAt),
              requestAt: formatDemoInstant(related.requestAt, undefined, true),
              decidedAt: formatDemoInstant(relatedDecisionAt(related.requestAt), undefined, true),
            },
          }
        : {
            label: "Competing request outcome authority unavailable",
            status: "pending",
            statusLabel: "Evidence missing",
            detail: "The demo cannot state the sibling outcome without its own signed case binding.",
          },
    );
  }
  return {
    spine: buildSpine("Safety", invalidatedPass ? { status: "voided", label: "Approval voided" } : undefined),
    revalidatedAt: fact(
      `Material evidence re-checked ${formatDemoInstant(timeline.revalidatedAt)}`,
      "deterministic-engine-output",
      timeline.revalidatedAt,
      formatDemoInstant(timeline.revalidatedAt),
    ),
    revalidatedAtIso: timeline.revalidatedAt,
    checks,
    reservationId: executionEligible ? IDS.reservationId : null,
    reservationAt: executionEligible
      ? formatDemoInstant(timeline.reservationAt, undefined, true)
      : null,
    reservationAtIso: executionEligible ? timeline.reservationAt : null,
    conflictKeys: executionEligible ? IDS.conflictKeys : [],
    idempotencyKey: executionEligible ? IDS.idempotencyKey : null,
    invalidation: invalidatedPass && initial && refreshed
      ? {
          voidedActors: [
            {
              name: CAST.opsApprover1,
              role: "Operations",
              when: formatDemoInstant(timeline.approvalOneAt),
              timestampIso: timeline.approvalOneAt,
            },
            {
              name: CAST.opsApprover2,
              role: "Operations",
              when: formatDemoInstant(timeline.approvalTwoAt),
              timestampIso: timeline.approvalTwoAt,
            },
          ],
          deltaSentence: "A new $15,000 pending distribution appeared after this approval was given.",
          before: {
            label: "Initial decision · pending activity",
            metric: fixtureMetric(initial.pendingActivityMinor, "currency-minor", "synthetic-fixture", "2026-07-26"),
            retrievedAt: RETRIEVED_AT,
          },
          after: {
            label: "Pre-execution revalidation · pending distribution",
            metric: fixtureMetric(refreshed.pendingActivityMinor, "currency-minor", "synthetic-fixture", "2026-07-26"),
            retrievedAt: formatDemoInstant(timeline.revalidatedAt),
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

export function buildExecution(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): ExecutionVM | null {
  const spec = scenario.spec;
  const timeline = timelineFor(scenario, firm);
  const authority = liquidityAuthorityFor(scenario, firm.id);
  if (
    authority.kind === "missing" ||
    (spec.invalidation && pass !== "revalidated")
  ) {
    return null;
  }
  const rows: ExecutionRowVM[] = [];
  if (spec.partial) {
    rows.push(
      {
        step: "instruction-created",
        target: "Salesforce managed capability",
        status: "completed",
        statusLabel: "Completed part",
        timestamp: formatDemoInstant(timeline.executionAt),
        timestampIso: timeline.executionAt,
        honestyLine: "The external receipt confirms only that the instruction record was created.",
        identifiers: IDENTIFIERS,
        fakeClass: "fake-adapter-response",
      },
      {
        step: "disbursement-scheduled",
        target: "Salesforce managed capability",
        status: "unknown",
        statusLabel: "Unconfirmed",
        timestamp: formatDemoInstant(timeline.executionAt),
        timestampIso: timeline.executionAt,
        honestyLine: "The external receipt does not confirm this part; the movement remains unknown and unconfirmed.",
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
      timestamp: formatDemoInstant(timeline.executionAt),
      timestampIso: timeline.executionAt,
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
      timestamp: formatDemoInstant(timeline.retryAt),
      timestampIso: timeline.retryAt,
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

export function buildVerification(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): VerificationVM | null {
  const spec = scenario.spec;
  const timeline = timelineFor(scenario, firm);
  const authority = liquidityAuthorityFor(scenario, firm.id);
  if (
    authority.kind === "missing" ||
    (spec.invalidation && pass !== "revalidated")
  ) {
    return null;
  }
  const proves = [
    fact(
      "Submission accepted by the capability",
      "fake-adapter-response",
      timeline.executionAt,
      formatDemoInstant(timeline.executionAt),
    ),
  ];
  if (spec.partial) {
    proves.push(
      fact(
        "Completed part: instruction-created",
        "fake-adapter-response",
        timeline.completionVerifiedAt,
        formatDemoInstant(timeline.completionVerifiedAt),
      ),
    );
  }
  const appended: ExecutionRowVM[] = [];
  if (spec.delayedNigo) {
    appended.push({
      step: "Returned NIGO (ingested Jul 28)",
      target: "Salesforce managed capability",
      status: "nigo",
      statusLabel: "Returned NIGO",
      timestamp: formatDemoInstant(timeline.delayedExceptionAt),
      timestampIso: timeline.delayedExceptionAt,
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
      timestamp: formatDemoInstant(timeline.delayedExceptionAt),
      timestampIso: timeline.delayedExceptionAt,
      honestyLine: "No status for two days - the stuck-state rule (forty-eight hours unconfirmed) fired.",
      affordanceLabel: "Escalate to operations",
      identifiers: [{ label: "Idempotency key", value: IDS.idempotencyKey }],
      fakeClass: "fake-adapter-response",
    });
  }
  return {
    spine: buildSpine("Verification"),
    proves,
    notProvenYet: spec.partial
      ? [
          "Incomplete part: disbursement-scheduled",
          "Movement completion remains unknown and unconfirmed",
        ]
      : [
          "Settlement at the custodian",
          "Funds availability at the destination bank",
          "That the instruction will not be returned not-in-good-order",
        ],
    nextPoll: `Next status poll: ${formatDemoInstant(timeline.nextPollAt)}`,
    appended,
    exceptionDecision: spec.partial
      ? {
          eventType: "ExceptionDecisionRequested",
          reason: "partial-execution",
          priorDecisionId: "dec-smiths-renovation-2026-0726",
          triggeringLedgerEvent: "ExecutionPartiallySucceeded",
          requestedAt: formatDemoInstant(
            timeline.exceptionDecisionRequestedAt,
            undefined,
            true,
          ),
          requestedAtIso: timeline.exceptionDecisionRequestedAt,
          summary:
            "The partial receipt opened a governed exception decision while the incomplete disbursement remains unknown and unconfirmed.",
        }
      : null,
    fakeClass: "fake-adapter-response",
  };
}
