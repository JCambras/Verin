/**
 * Fake-service builders for the SUMMARY surfaces: Firm A / Firm B comparison
 * (surface 10), policy draft and simulation impact (surface 11), and the printable
 * examiner-grade decision record (surface 12).
 *
 * The comparison is driven by policy-version provenance (design §10): each column is
 * headed by the firm's active policy version, and every differing row cites the
 * provision that produced its value. The record derives its provenance through
 * ADR-0022 - every input here is synthetic, so it is a watermarked demonstration.
 */
import type { DisplayMetric } from "@contracts/metric";
import { DEMO_WATERMARK, isDemonstration } from "@contracts/provenance";
import type { ComparisonRowVM, ComparisonVM, RecordVM } from "./model";
import { prov, recordProvenance } from "./provenance";
import { buildEvidence, buildIntent } from "./build-context";
import {
  amountMetric,
  buildApprovals,
  buildDisposition,
  buildPolicyTrace,
  headroomMetric,
  reserveFloorMetric,
  DISPOSITION_BADGES,
} from "./build-decision";
import {
  buildExecution,
  buildSafety,
  buildVerification,
} from "./build-outcome";
import { executionReachFor } from "./execution-reach";
import {
  activeDecisionAt,
  recordDecisionBindings,
} from "./decision-bindings";
import {
  compareComparisonEvidence,
  type ComparisonEvidenceResult,
} from "./comparison-evidence";
import { formatDemoInstant, timelineFor } from "./timeline";
import { auditPositionFor } from "./audit-position";
import {
  DEMO_NOW,
  FIRMS,
  OBSERVED_RECENT,
  decisionIdentityFor,
  dispositionFor,
  evidenceForPass,
  executionEligibilityFor,
  hasSignedInvalidationAuthority,
  requestFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

function thresholdMetric(firm: FirmData): DisplayMetric {
  // A policy parameter, not a computed figure: fixture-sourced, labeled sample data.
  return { value: firm.dualApprovalThresholdMinor, format: "currency-minor", provenance: prov("synthetic-fixture", firm.policyActiveSince) };
}

function quorumAtAmount(
  firm: FirmData,
  requestAmountMinor: number,
): string {
  if (requestAmountMinor <= firm.dualApprovalThresholdMinor) {
    return `No dual approval at this amount; ${firm.name} states ${firm.requesterConstraint === null ? "no requester rule" : firm.requesterConstraint}`;
  }
  const role = firm.eligibleRole ?? "eligible";
  const actorRule = firm.distinctActorsRequired ? "distinct " : "";
  const requesterRule =
    firm.requesterConstraint === "may-not-satisfy-both-approvals"
      ? "requester excluded"
      : "no requester constraint";
  return `${firm.approvalsRequired} ${actorRule}${role} approvers - ${requesterRule}`;
}

function bankChangeHandlingLabel(firm: FirmData): string {
  return firm.bankChangeHandling === "specialist-review"
    ? "Specialist review before execution"
    : "Blocked until independently verified";
}

function evidenceDifferenceCopy(
  comparison: ComparisonEvidenceResult,
): string {
  const unavailable = [
    ...(!comparison.availableA ? ["Firm A"] : []),
    ...(!comparison.availableB ? ["Firm B"] : []),
  ];
  if (unavailable.length > 0) {
    return `Exact signed evidence is unavailable for ${unavailable.join(" and ")}.`;
  }
  const differences = [
    ...(comparison.onlyInA.length
      ? [`only Firm A includes ${comparison.onlyInA.join(", ")}`]
      : []),
    ...(comparison.onlyInB.length
      ? [`only Firm B includes ${comparison.onlyInB.join(", ")}`]
      : []),
    ...(comparison.changed.length
      ? [`signed values differ for ${comparison.changed.join(", ")}`]
      : []),
  ];
  return `The complete signed evidence sets differ: ${differences.join("; ")}.`;
}

export function buildComparison(
  scenario: ScenarioData,
  pass: JourneyPass = "initial",
): ComparisonVM {
  const a = FIRMS["firm-a"]!;
  const b = FIRMS["firm-b"]!;
  const dispA = dispositionFor(scenario, a.id);
  const dispB = dispositionFor(scenario, b.id);
  const headroomA = headroomMetric(scenario, a, pass);
  const headroomB = headroomMetric(scenario, b, pass);
  const reserveA = reserveFloorMetric(a, scenario, pass);
  const reserveB = reserveFloorMetric(b, scenario, pass);
  const sourceA = sourceCaseFor(scenario, a.id);
  const sourceB = sourceCaseFor(scenario, b.id);
  const evidenceComparison = compareComparisonEvidence(
    sourceA,
    sourceB,
    pass,
  );
  const equivalentEvidence = evidenceComparison.equivalent;
  const evidenceDifference = evidenceDifferenceCopy(evidenceComparison);
  const policyA =
    sourceA?.policyVersions.firmPolicyVersionId ?? a.policyVersion;
  const policyB =
    sourceB?.policyVersions.firmPolicyVersionId ?? b.policyVersion;
  const amountA = amountMetric(scenario, a);
  const amountB = amountMetric(scenario, b);
  const rows: ComparisonRowVM[] = [
    { dimension: "Household", a: { display: "The Smith Household" }, b: { display: "The Smith Household" }, differs: false },
    { dimension: "Requested amount", a: { metric: amountA }, b: { metric: amountB }, differs: amountA.value !== amountB.value },
    {
      dimension: "Cash-reserve requirement",
      a: reserveA
        ? { metric: reserveA }
        : { display: "Planned-withdrawal schedule unavailable" },
      b: reserveB
        ? { metric: reserveB }
        : { display: "Planned-withdrawal schedule unavailable" },
      differs: true,
      why: { reason: `Firm A preserves six months of planned withdrawals (policy ${policyA}); Firm B preserves twelve (policy ${policyB}).` },
    },
    {
      dimension: "Available after reserve",
      a: headroomA ? { metric: headroomA } : { display: "Missing signed branch-and-firm liquidity authority" },
      b: headroomB ? { metric: headroomB } : { display: "Missing signed branch-and-firm liquidity authority" },
      differs: true,
      why: {
        reason:
          headroomA && headroomB
            ? "Each figure is bound to the signed case for this exact branch and firm; the reserve floors come from the firms' approved policies."
            : "A branch-and-firm comparison never borrows liquidity from an unrelated signed case. Missing numeric authority remains visible.",
      },
    },
    {
      dimension: "Dual-approval threshold",
      a: { metric: thresholdMetric(a) },
      b: { metric: thresholdMetric(b) },
      differs: true,
      why: { reason: `Policy ${policyA} versus policy ${policyB}.` },
    },
    {
      dimension: "Quorum at this amount",
      a: { display: quorumAtAmount(a, Number(amountA.value)) },
      b: { display: quorumAtAmount(b, Number(amountB.value)) },
      differs: true,
      why: { reason: `The request sits between the two thresholds: above Firm A's (policy ${policyA}), below Firm B's (policy ${policyB}). Firm B's requester rule is contract silence, not a lighter rule.` },
    },
    {
      dimension: "Recent bank-change handling",
      a: { display: bankChangeHandlingLabel(a) },
      b: { display: bankChangeHandlingLabel(b) },
      differs: true,
      why: { reason: `Policy ${policyA} routes a recent change to a specialist; policy ${policyB} blocks execution until independent verification.` },
    },
    {
      dimension: "Disposition for this request",
      a: { badge: DISPOSITION_BADGES[dispA] },
      b: { badge: DISPOSITION_BADGES[dispB] },
      differs: dispA !== dispB,
      ...(dispA !== dispB
        ? {
            why: {
              reason: equivalentEvidence
                ? "Same household, same request, and exact signed equivalent evidence - the outcome differs because the approved policy version differs, with zero code change."
                : `${evidenceDifference} The outcome is not attributed solely to policy.`,
            },
          }
        : {}),
    },
  ];
  return {
    description: equivalentEvidence
      ? "The same household and the same request under exact signed equivalent evidence. The differences below are driven by policy provenance, not code."
      : `The same household and request are shown. ${evidenceDifference}`,
    columns: [
      {
        firmId: a.id,
        firm: a.name,
        policyVersion:
          policyA,
        activeSince: `active since ${a.policyActiveSince}`,
        sourceCaseId: sourceA?.caseId ?? null,
      },
      {
        firmId: b.id,
        firm: b.name,
        policyVersion:
          policyB,
        activeSince: `active since ${b.policyActiveSince}`,
        sourceCaseId: sourceB?.caseId ?? null,
      },
    ],
    rows,
    fakeClass: "deterministic-engine-output",
  };
}

function signedLifecycle(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): RecordVM["lifecycle"] {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  if (!sourceCase) return [];
  const timeline = timelineFor(scenario, firm);
  if (hasSignedInvalidationAuthority(scenario, firm.id)) {
    const instants = [
      timeline.initialEvidenceSnapshotAt,
      timeline.decisionAt,
      timeline.approvalOneAt,
      timeline.approvalTwoAt,
      timeline.revalidatedAt,
      timeline.approvalInvalidatedAt,
      timeline.derivedDecisionAt,
      timeline.freshApprovalOneAt,
      timeline.freshApprovalTwoAt,
      timeline.reservationAt,
      timeline.executionAt,
      timeline.executionSucceededAt,
      timeline.statusObservedAt,
    ];
    const lifecycle = sourceCase.ledgerEvents.map((event, index) => ({
      type: event.type,
      timestampIso: instants[index]!,
      display: formatDemoInstant(instants[index]!, undefined, true),
      note: event.note,
    }));
    if (pass === "revalidated") return lifecycle;
    const invalidatedAt = lifecycle.findIndex(
      (event) => event.type === "ApprovalInvalidated",
    );
    return invalidatedAt < 0
      ? lifecycle
      : lifecycle.slice(0, invalidatedAt + 1);
  }
  const approvalInstants = buildApprovals(scenario, firm).stages.flatMap(
    (stage) =>
      stage.actors.flatMap((actor) =>
        actor.timestampIso ? [actor.timestampIso] : [],
      ),
  );
  let evidenceIndex = 0;
  let approvalIndex = 0;
  let statusIndex = 0;
  const instantFor = (type: string): string => {
    if (type === "EvidenceSnapshotRecorded") {
      const instant =
        evidenceIndex === 0
          ? timeline.initialEvidenceSnapshotAt
          : timeline.revalidatedAt;
      evidenceIndex += 1;
      return instant;
    }
    if (type === "DecisionRecorded") return timeline.decisionAt;
    if (type === "ApprovalRecorded") {
      const instant = approvalInstants[approvalIndex] ?? timeline.approvalOneAt;
      approvalIndex += 1;
      return instant;
    }
    if (type === "ApprovalStageEscalated") return timeline.escalatedAt;
    if (type === "ApprovalStageExpired") return timeline.expiredAt;
    if (type === "ReservationCreated") return timeline.reservationAt;
    if (type === "ExecutionStarted") return timeline.executionAt;
    if (
      type === "ExecutionSucceeded" ||
      type === "ExecutionPartiallySucceeded"
    ) {
      return timeline.executionSucceededAt;
    }
    if (type === "StatusObserved") {
      const instant =
        sourceCase.verification.observedStatus === "unknown" ||
        statusIndex > 0
          ? timeline.delayedExceptionAt
          : timeline.statusObservedAt;
      statusIndex += 1;
      return instant;
    }
    if (type === "ExceptionDecisionRequested") {
      return timeline.exceptionDecisionRequestedAt;
    }
    return timeline.decisionAt;
  };
  const lifecycle = sourceCase.ledgerEvents.map((event) => {
    const timestampIso = instantFor(event.type);
    return {
    type: event.type,
    timestampIso,
    display: formatDemoInstant(timestampIso, undefined, true),
      note: event.note,
    };
  });
  return executionReachFor(scenario, firm, pass).reached
    ? lifecycle
    : lifecycle.filter(
        ({ type }) =>
          type !== "ReservationCreated" &&
          type !== "ExecutionStarted" &&
          type !== "ExecutionSucceeded" &&
          type !== "ExecutionPartiallySucceeded" &&
          type !== "StatusObserved" &&
          type !== "ExceptionDecisionRequested",
      );
}

export function buildRecord(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): RecordVM {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const selectedEvidence = evidenceForPass(sourceCase, pass);
  const sourceProvenance = selectedEvidence.length
    ? selectedEvidence.map((entry) =>
        prov("synthetic-fixture", entry.observedAt),
      )
    : [prov("synthetic-fixture", OBSERVED_RECENT)];
  const provenance = recordProvenance(
    [
      ...sourceProvenance,
      prov(
        "user-entered-demo-input",
        requestFor(scenario, firm.id).requestedAt,
      ),
    ],
    DEMO_NOW,
  );
  const proceed = dispositionFor(scenario, firm.id) === "proceed";
  const invalidation = hasSignedInvalidationAuthority(scenario, firm.id);
  const revalidated = invalidation && pass === "revalidated";
  const approvals = proceed ? buildApprovals(scenario, firm, pass) : null;
  const safetyReached = approvals?.satisfied === true;
  const execution = safetyReached ? buildExecution(scenario, firm, pass) : null;
  const verification = execution ? buildVerification(scenario, firm, pass) : null;
  const safety = safetyReached ? buildSafety(scenario, firm, pass) : null;
  const finalSafety =
    safety && revalidated
      ? {
          ...safety,
          invalidation: buildSafety(scenario, firm, "initial").invalidation,
        }
      : safety;
  const executionReach = executionReachFor(scenario, firm, pass);
  const stopNote =
    !proceed
      ? "This journey stopped at Decision."
      : !safetyReached
        ? "This journey stopped at Authority because the ordered authority plan was not satisfied."
        : invalidation && pass === "initial"
          ? "This journey returned to Decision: both approvals were voided when material evidence changed."
          : execution === null
            ? `This journey stopped at Safety: ${executionReach.reason}`
            : null;
  const decisionAt = activeDecisionAt(scenario, firm, pass);
  return {
    header: {
      decisionId: decisionIdentityFor(scenario, firm.id, pass),
      scenarioId: scenario.id,
      firmId: firm.id,
      sourceCaseId: sourceCase?.caseId ?? null,
      pass,
      createdAt: formatDemoInstant(decisionAt, undefined, true),
      createdAtIso: decisionAt,
      provenance,
      watermark: isDemonstration(provenance) ? DEMO_WATERMARK : null,
    },
    hashes: {
      policyVersion:
        sourceCase?.policyVersions.firmPolicyVersionId ??
        "Exact signed source unavailable",
      instructionVersion:
        sourceCase?.policyVersions.householdInstructionVersionIds.join(", ") ||
        "Exact signed source unavailable",
      auditPosition: auditPositionFor(scenario, firm.id, pass),
    },
    decisionBindings: recordDecisionBindings(scenario, firm, pass),
    intent: buildIntent(scenario, firm),
    evidence: buildEvidence(scenario, firm, pass).rows,
    disposition: buildDisposition(scenario, firm, pass),
    precedence: buildPolicyTrace(scenario, firm, pass).rows,
    approvalStages: approvals?.stages ?? null,
    authorityMode: approvals?.mode ?? null,
    automaticAuthority: approvals?.automaticAuthority ?? null,
    executionEligibility:
      safety?.reservationId
        ? executionEligibilityFor(scenario, firm.id)
        : null,
    safety: finalSafety,
    execution: execution?.rows ?? null,
    verification,
    lifecycle: signedLifecycle(scenario, firm, pass),
    stopNote,
    provenanceAppendix: provenance.derivedFrom,
  };
}
