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
import { fact, fixtureMetric } from "./provenance";
import { buildSpine } from "./spine";
import { buildVerificationProofs } from "./build-verification-proofs";
import { buildBankInstructionSafetyCheck } from "./build-safety-check";
import { executionReachFor } from "./execution-reach";
import {
  CAST,
  decisionIdentityFor,
  executionEligibilityFor,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import {
  formatDemoInstant,
  relatedDecisionAt,
  timelineFor,
} from "./timeline";

function executionIdentifiers(
  scenario: ScenarioData,
  firm: FirmData,
) {
  const eligibility = executionEligibilityFor(scenario, firm.id);
  if (!eligibility) return [];
  return [
    ...(eligibility.idempotencyKey
      ? [{ label: "Idempotency key", value: eligibility.idempotencyKey }]
      : []),
    ...eligibility.reservations.flatMap((reservation) => [
      { label: "Reservation", value: reservation.reservationId },
      { label: "Conflict keys", value: reservation.conflictKeys.join("  ·  ") },
      { label: "Reservation expiry", value: reservation.expiresAfter },
    ]),
    ...eligibility.preconditions.map((precondition) => ({
      label: `Precondition · ${precondition.code}`,
      value: `${precondition.requiredEvidence.join("  ·  ")} · execution hold ${precondition.mustStillHoldAtExecution ? "required" : "not required"}`,
    })),
  ];
}

export function buildSafety(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): SafetyVM {
  const timeline = timelineFor(scenario, firm);
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const eligibility = executionEligibilityFor(scenario, firm.id);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const invalidationAuthority = hasSignedInvalidationAuthority(
    scenario,
    firm.id,
  );
  const initial = authority.kind === "signed" ? authority.initialDecision : null;
  const refreshed = authority.kind === "signed" ? authority.preExecutionRevalidation : undefined;
  const initialAccount = sourceCase?.evidence.find(
    (entry) =>
      entry.evidenceKind === "account-balance" &&
      entry.liquidityPhase !== "pre-execution-revalidation",
  );
  const initialPending = sourceCase?.evidence.find(
    (entry) =>
      entry.evidenceKind === "pending-actions" &&
      entry.liquidityPhase !== "pre-execution-revalidation",
  );
  const refreshedAccount = sourceCase?.evidence.find(
    (entry) =>
      entry.evidenceKind === "account-balance" &&
      entry.liquidityPhase === "pre-execution-revalidation",
  );
  const refreshedPending = sourceCase?.evidence.find(
    (entry) =>
      entry.evidenceKind === "pending-actions" &&
      entry.liquidityPhase === "pre-execution-revalidation",
  );
  const bankInstructionEvidence = sourceCase?.evidence.filter(
    (entry) => entry.evidenceKind === "bank-instruction",
  ) ?? [];
  const invalidatedPass = invalidationAuthority && pass === "initial";
  const executionReach = executionReachFor(
    scenario,
    firm,
    pass,
  );
  const executionEligible = executionReach.reached;
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
            detail:
              refreshedPending?.summary ??
              `The refreshed bundle records ${refreshed.pendingNote}.`,
          },
          {
            label: "Pending actions re-checked against this household",
            status: "voided",
            statusLabel: "New activity found",
            detail: `${initialPending?.summary ?? "Initial pending evidence unavailable"} ${refreshedPending?.summary ?? "Refreshed pending evidence unavailable"}`,
          },
        ]
      : !executionEligible
        ? [
            {
              label: "Signed execution bindings remain incomplete",
              status: "pending",
              statusLabel: "Execution withheld",
              detail: executionReach.reason ?? "Exact signed structured execution bindings are unavailable.",
            },
          ]
      : invalidationAuthority && pass === "revalidated" && refreshed
        ? [
            {
              label: "Liquidity matches the refreshed derived decision",
              status: "done",
              statusLabel: "Verified",
              detail: `${refreshedAccount?.summary ?? "Refreshed account evidence unavailable"} ${refreshedPending?.summary ?? "Refreshed pending evidence unavailable"}`,
            },
            {
              label: "Pending distribution re-checked and counted",
              status: "done",
              statusLabel: "Verified",
              detail: refreshedPending?.summary ?? refreshed.pendingNote,
            },
          ]
      : [
          {
            label: "Liquidity unchanged since the decision",
            status: "done",
            statusLabel: "Verified",
            detail: initialAccount?.summary,
          },
          initial && initial.pendingActivityMinor > 0
            ? {
                label: "Pending actions re-checked against this household",
                status: "done",
                statusLabel: "Re-read",
                detail: `${initialPending?.summary ?? initial.pendingNote} It was counted against the decision's liquidity.`,
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
    checks.push(
      buildBankInstructionSafetyCheck(
        bankInstructionEvidence,
        eligibility?.preconditions,
      ),
    );
  }
  if (invalidationAuthority && pass === "revalidated") {
    checks.push({
      label: "Two fresh approvals bind to the derived decision",
      status: "done",
      statusLabel: "Verified",
      detail: "Both distinct operations approvers approved the derived decision and refreshed input-bundle hashes.",
    });
  }
  const related =
    authority.kind === "signed"
      ? authority.relatedDecisions?.[0]
      : undefined;
  if (related) {
    checks.push({
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
        decidedAt: formatDemoInstant(
          relatedDecisionAt(related.requestAt),
          undefined,
          true,
        ),
      },
    });
  }
  return {
    spine: buildSpine("Safety", invalidatedPass ? { status: "voided", label: "Approval voided" } : undefined),
    revalidatedAt: fact(
      `${executionEligible ? "Material evidence re-checked" : "Safety authority evaluated"} ${formatDemoInstant(timeline.revalidatedAt)}`,
      "deterministic-engine-output",
      timeline.revalidatedAt,
      formatDemoInstant(timeline.revalidatedAt),
    ),
    revalidatedAtIso: timeline.revalidatedAt,
    checks,
    reservationId:
      executionEligible
        ? (eligibility?.reservations[0]?.reservationId ?? null)
        : null,
    reservationAt: executionEligible
      ? formatDemoInstant(timeline.reservationAt, undefined, true)
      : null,
    reservationAtIso: executionEligible ? timeline.reservationAt : null,
    conflictKeys:
      executionEligible
        ? (eligibility?.reservations.flatMap(
            (reservation) => reservation.conflictKeys,
          ) ?? [])
        : [],
    idempotencyKey:
      executionEligible ? (eligibility?.idempotencyKey ?? null) : null,
    executionEligibility: executionEligible ? eligibility : null,
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
          deltaSentence:
            refreshedPending?.summary ??
            "Exact signed refreshed pending evidence unavailable.",
          before: {
            label: "Initial decision · pending activity",
            metric: fixtureMetric(
              initialPending?.displayValue?.valueMinor ??
                initial.pendingActivityMinor,
              "currency-minor",
              "synthetic-fixture",
              initialPending?.observedAt ?? sourceCase?.trigger.requestAt ?? timeline.sourceRequestAt,
            ),
            retrievedAt: initialPending
              ? formatDemoInstant(
                  initialPending.retrievedAt,
                  undefined,
                  true,
                )
              : formatDemoInstant(timeline.initialEvidenceSnapshotAt),
          },
          after: {
            label: "Pre-execution revalidation · pending distribution",
            metric: fixtureMetric(
              refreshedPending?.displayValue?.valueMinor ??
                refreshed.pendingActivityMinor,
              "currency-minor",
              "synthetic-fixture",
              refreshedPending?.observedAt ?? timeline.revalidatedAt,
            ),
            retrievedAt: refreshedPending
              ? formatDemoInstant(
                  refreshedPending.retrievedAt,
                  undefined,
                  true,
                )
              : formatDemoInstant(timeline.revalidatedAt),
          },
          why: {
            reason:
              `${initialAccount?.summary ?? "Initial account evidence unavailable"} ${initialPending?.summary ?? "Initial pending evidence unavailable"} ${refreshedAccount?.summary ?? "Refreshed account evidence unavailable"} ${refreshedPending?.summary ?? "Refreshed pending evidence unavailable"} Approval binds to the decision and input-bundle hashes, so the changed bundle requires a new decision and fresh approvals.`,
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
  const timeline = timelineFor(scenario, firm);
  const eligibility = executionEligibilityFor(scenario, firm.id);
  const verification = sourceCaseFor(scenario, firm.id)?.verification;
  const duplicateRetry =
    sourceCaseFor(scenario, firm.id)?.explanations.some(
      (entry) => entry.code === "duplicate-suppressed",
    ) ?? false;
  if (
    !executionReachFor(scenario, firm, pass).reached ||
    verification?.reached !== true
  ) {
    return null;
  }
  const rows: ExecutionRowVM[] = [];
  const identifiers = executionIdentifiers(scenario, firm);
  if (verification.observedStatus === "unknown") {
    rows.push(
      {
        step: "instruction-created",
        target: "Salesforce managed capability",
        status: "completed",
        statusLabel: "Completed part",
        timestamp: formatDemoInstant(timeline.executionSucceededAt),
        timestampIso: timeline.executionSucceededAt,
        honestyLine: "The external receipt confirms only that the instruction record was created.",
        identifiers,
        fakeClass: "fake-adapter-response",
      },
      {
        step: "disbursement-scheduled",
        target: "Salesforce managed capability",
        status: "unknown",
        statusLabel: "Unconfirmed",
        timestamp: formatDemoInstant(verification.observedAt),
        timestampIso: verification.observedAt,
        honestyLine: verification.currentReason,
        affordanceLabel: "Review the exception",
        identifiers,
        fakeClass: "fake-adapter-response",
      },
    );
  } else {
    rows.push({
      step: "Money-movement instruction",
      target: "Salesforce managed capability",
      status: "submitted",
      statusLabel: "Submitted",
      timestamp: formatDemoInstant(timeline.statusObservedAt),
      timestampIso: timeline.statusObservedAt,
      honestyLine: "Accepted for processing - settlement not yet confirmed.",
      identifiers,
      fakeClass: "fake-adapter-response",
    });
  }
  if (duplicateRetry) {
    rows.push({
      step: "Retry after timeout",
      target: "Salesforce managed capability",
      status: "duplicate-suppressed",
      statusLabel: "Duplicate suppressed",
      timestamp: formatDemoInstant(timeline.retryAt),
      timestampIso: timeline.retryAt,
      plainClaim: "Already submitted once - Verin did not send it again.",
      identifiers: eligibility?.idempotencyKey
        ? [{ label: "Idempotency key (matches the original byte-for-byte)", value: eligibility.idempotencyKey }]
        : [],
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
  const timeline = timelineFor(scenario, firm);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  if (
    !executionReachFor(scenario, firm, pass).reached ||
    sourceCase?.verification.reached !== true
  ) {
    return null;
  }
  const verification = sourceCase.verification;
  if (verification.observedAt === null) return null;
  const proves = buildVerificationProofs(verification, timeline);
  const appended: ExecutionRowVM[] = [];
  const identifiers = executionIdentifiers(scenario, firm);
  if (verification.observedStatus === "nigo") {
    appended.push({
      step: "Returned NIGO (ingested Jul 28)",
      target: "Salesforce managed capability",
      status: "nigo",
      statusLabel: "Returned NIGO",
      timestamp: formatDemoInstant(verification.observedAt),
      timestampIso: verification.observedAt,
      honestyLine: `${verification.currentReason}: ${verification.custodianReason}.`,
      affordanceLabel: "Fix and resubmit the authorization",
      identifiers,
      fakeClass: "fake-adapter-response",
    });
  }
  if (verification.observedStatus === "unknown") {
    appended.push({
      step: "Wire-transfer status",
      target: "Salesforce managed capability",
      status: "stuck",
      statusLabel: "Stuck",
      timestamp: formatDemoInstant(verification.observedAt),
      timestampIso: verification.observedAt,
      honestyLine: verification.currentReason,
      affordanceLabel: "Escalate to operations",
      identifiers,
      fakeClass: "fake-adapter-response",
    });
  }
  const nextPollAt =
    verification.polling.state === "scheduled"
      ? new Date(
          Date.parse(verification.observedAt) + 12 * 60 * 60 * 1_000,
        ).toISOString()
      : null;
  return {
    spine: buildSpine("Verification"),
    state: {
      observedStatus: verification.observedStatus,
      settledClaim: verification.settledClaim,
      observedAtIso: verification.observedAt,
      currentReason: verification.currentReason,
      custodianReason: verification.custodianReason,
    },
    proves,
    notProvenYet: verification.notProvenYet,
    polling:
      verification.polling.state === "stopped"
        ? {
            state: "stopped",
            reason: "terminal-nigo-exception-opened",
            latestObservationAtIso: verification.observedAt,
            nextPollAtIso: null,
            display:
              "Status polling stopped after terminal NIGO; remediation is governed by the exception decision.",
          }
        : {
            state: "scheduled",
            interval: "PT12H",
            latestObservationAtIso: verification.observedAt,
            nextPollAtIso: nextPollAt!,
            display: `Next status poll: ${formatDemoInstant(nextPollAt!)}`,
          },
    appended,
    exceptionDecision: verification.exception
      ? {
          eventType: "ExceptionDecisionRequested",
          reason: verification.exception.reason,
          priorDecisionId: decisionIdentityFor(
            scenario,
            firm.id,
            pass,
          ),
          triggeringLedgerEvent:
            verification.exception.triggeringLedgerEvent,
          requestedAt: formatDemoInstant(
            timeline.exceptionDecisionRequestedAt,
            undefined,
            true,
          ),
          requestedAtIso: timeline.exceptionDecisionRequestedAt,
          summary: verification.exception.summary,
        }
      : null,
    fakeClass: "fake-adapter-response",
  };
}
