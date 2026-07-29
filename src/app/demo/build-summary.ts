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
import {
  headroomMinor as calculateHeadroomMinor,
  reserveFloorMinor as calculateReserveFloorMinor,
} from "@contracts/money-movement";
import { DEMO_WATERMARK, isDemonstration } from "@contracts/provenance";
import type { ComparisonRowVM, ComparisonVM, DispositionKind, PolicyAuthoringVM, RecordVM } from "./model";
import { derivedMetric, prov, recordProvenance } from "./provenance";
import { buildSpine } from "./spine";
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
import { liquidityInputs } from "./build-decision-truth";
import { buildExecution, buildSafety, buildVerification } from "./build-outcome";
import { formatDemoInstant, timelineFor } from "./timeline";
import {
  DEMO_NOW,
  FIRMS,
  IDS,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  dispositionFor,
  evidenceForPass,
  executionEligibilityFor,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  requestFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

/** The reserve horizon the drafted policy proposes (surface 11's simulation). */
export const DRAFT_RESERVE_MONTHS = 12;

function thresholdMetric(firm: FirmData): DisplayMetric {
  // A policy parameter, not a computed figure: fixture-sourced, labeled sample data.
  return { value: firm.dualApprovalThresholdMinor, format: "currency-minor", provenance: prov("synthetic-fixture", firm.policyActiveSince) };
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
  const sourceA = sourceCaseFor(scenario, a.id);
  const sourceB = sourceCaseFor(scenario, b.id);
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
      a: { metric: reserveFloorMetric(a, scenario) },
      b: { metric: reserveFloorMetric(b, scenario) },
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
      a: { display: "Two distinct operations approvers - requester excluded" },
      b: { display: "No dual approval at this amount; Firm B states no requester rule" },
      differs: true,
      why: { reason: `The request sits between the two thresholds: above Firm A's (policy ${policyA}), below Firm B's (policy ${policyB}). Firm B's requester rule is contract silence, not a lighter rule.` },
    },
    {
      dimension: "Recent bank-change handling",
      a: { display: "Specialist review before execution" },
      b: { display: "Blocked until independently verified" },
      differs: true,
      why: { reason: `Policy ${policyA} routes a recent change to a specialist; policy ${policyB} blocks execution until independent verification.` },
    },
    {
      dimension: "Disposition for this request",
      a: { badge: DISPOSITION_BADGES[dispA] },
      b: { badge: DISPOSITION_BADGES[dispB] },
      differs: dispA !== dispB,
      ...(dispA !== dispB
        ? { why: { reason: "Same household, same request, same evidence - the outcome differs because the approved policy version differs, with zero code change." } }
        : {}),
    },
  ];
  return {
    columns: [
      {
        firm: a.name,
        policyVersion:
          policyA,
        activeSince: `active since ${a.policyActiveSince}`,
      },
      {
        firm: b.name,
        policyVersion:
          policyB,
        activeSince: `active since ${b.policyActiveSince}`,
      },
    ],
    rows,
    fakeClass: "deterministic-engine-output",
  };
}

export function buildPolicyAuthoring(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): PolicyAuthoringVM {
  const isFirmA = firm.id === "firm-a";
  const twelveMonthFloor = calculateReserveFloorMinor(PLANNED_WITHDRAWAL_MONTHLY_MINOR, DRAFT_RESERVE_MONTHS);
  const simulationInputs = liquidityInputs(scenario, firm, pass);
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const snapshot =
    authority.kind === "signed"
      ? pass === "revalidated"
        ? (authority.preExecutionRevalidation ?? authority.initialDecision)
        : authority.initialDecision
      : null;
  const newHeadroom = snapshot
    ? calculateHeadroomMinor(snapshot.availableCashMinor, snapshot.pendingActivityMinor, twelveMonthFloor)
    : null;
  const currentHeadroom = headroomMetric(scenario, firm, pass);
  const disp = dispositionFor(scenario, firm.id);
  const request = requestFor(scenario, firm.id);
  // The simulation's own arithmetic decides whether the request survives the drafted
  // floor. Asserting "still proceeds" as fixed copy is how surface 11 would come to
  // contradict the figure printed directly above it.
  const simulatedDisp: DispositionKind | null =
    newHeadroom === null ? null : disp === "proceed" && newHeadroom < request.amountMinor ? "blocked" : disp;
  return {
    spine: buildSpine("Decision", { status: "pending", label: "Draft simulation" }),
    sentence: "Always preserve twelve months of planned withdrawals in cash.",
    draft: {
      rows: [
        { field: "Effect", value: "Require" },
        { field: "Subject", value: "Cash reserve" },
        { field: "Quantity", value: "Twelve months of planned withdrawals" },
        { field: "Scope", value: "All households" },
        { field: "Supersedes", value: isFirmA ? `${firm.policyVersion} §2 (six months)` : `${firm.policyVersion} §3 (already twelve months - no change)` },
      ],
      label: "Drafted - not yet reviewed",
      fakeClass: "llm-proposed-draft",
    },
    interpretation: "Reserve floor becomes twelve times the planned monthly withdrawal for each household, evaluated before any discretionary movement.",
    simulationDelta: isFirmA && newHeadroom !== null && currentHeadroom
      ? [
          {
            label: "Smith household reserve floor",
            before: { metric: reserveFloorMetric(firm, scenario) },
            after: { metric: derivedMetric(twelveMonthFloor, "currency-minor", simulationInputs, DEMO_NOW) },
          },
          {
            label: "Available after reserve",
            before: { metric: currentHeadroom },
            after: { metric: derivedMetric(newHeadroom, "currency-minor", simulationInputs, DEMO_NOW) },
          },
          {
            label: "This request",
            before: { badge: DISPOSITION_BADGES[disp] },
            after: { badge: DISPOSITION_BADGES[simulatedDisp ?? disp] },
          },
          {
            label: "Demo-corpus households newly below the floor",
            before: { metric: derivedMetric(0, "count", simulationInputs, DEMO_NOW) },
            after: { metric: derivedMetric(3, "count", simulationInputs, DEMO_NOW) },
          },
        ]
      : isFirmA
        ? [
            {
              label: "Smith household reserve floor",
              before: { metric: reserveFloorMetric(firm, scenario) },
              after: { metric: derivedMetric(twelveMonthFloor, "currency-minor", simulationInputs, DEMO_NOW) },
            },
            {
              label: "Available after reserve",
              before: { display: "Missing signed branch-and-firm liquidity authority" },
              after: { display: "Not simulated without signed numeric authority" },
            },
            {
              label: "This request",
              before: { badge: DISPOSITION_BADGES[disp] },
              after: { display: "Not simulated without signed numeric authority" },
            },
          ]
        : [
          {
            label: "Smith household reserve floor",
            before: { metric: reserveFloorMetric(firm, scenario) },
            after: { metric: reserveFloorMetric(firm, scenario) },
          },
          {
            label: "This request",
            before: { badge: DISPOSITION_BADGES[disp] },
            after: { badge: DISPOSITION_BADGES[disp] },
          },
        ],
    gateLabel: isFirmA ? "Approve and activate FA-4.3" : "Approve (no effective change for Firm B)",
    activation: isFirmA ? { fromVersion: "FA-4.2", toVersion: "FA-4.3" } : { fromVersion: "FB-2.1", toVersion: "FB-2.1" },
    changedRerunResult: newHeadroom === null
      ? "Re-run not calculated: this branch and firm have no captain-signed numeric liquidity case, and no unrelated case was substituted."
      : isFirmA
      ? {
          proceed: "Re-run under FA-4.3: the Smith request still proceeds, with a narrower margin above the reserve floor.",
          blocked:
            disp === "proceed"
              ? "Re-run under FA-4.3: the Smith request no longer proceeds - twelve months of planned withdrawals leave less than this movement needs."
              : "Re-run under FA-4.3: the Smith request is still blocked - the reserve change does not resolve the named conditions.",
          prohibited: "Re-run under FA-4.3: the Smith request remains prohibited - the destination restriction is not resolvable by a reserve-policy change.",
        }[simulatedDisp ?? disp]
      : {
          proceed: "Re-run under FB-2.1: no change - Firm B already preserves twelve months.",
          blocked: "Re-run under FB-2.1: no reserve change - Firm B already preserves twelve months, and the named conditions still block this request.",
          prohibited: "Re-run under FB-2.1: no reserve change - Firm B already preserves twelve months, and the destination restriction is not resolvable by a reserve-policy change.",
        }[disp],
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
  return sourceCase.ledgerEvents.map((event) => {
    const timestampIso = instantFor(event.type);
    return {
    type: event.type,
    timestampIso,
    display: formatDemoInstant(timestampIso, undefined, true),
    note: event.note,
    };
  });
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
  const timeline = timelineFor(scenario, firm);
  const proceed = dispositionFor(scenario, firm.id) === "proceed";
  const invalidation = hasSignedInvalidationAuthority(scenario, firm.id);
  const revalidated = invalidation && pass === "revalidated";
  const approvals = proceed ? buildApprovals(scenario, firm, pass) : null;
  const originalApproval = revalidated
    ? buildApprovals(scenario, firm, "initial")
    : approvals;
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
  const stopNote =
    !proceed
      ? "This journey stopped at Decision."
      : !safetyReached
        ? "This journey stopped at Authority because the ordered authority plan was not satisfied."
        : invalidation && pass === "initial"
          ? "This journey returned to Decision: both approvals were voided when material evidence changed."
          : execution === null
            ? "This journey stopped at Safety because exact signed liquidity authority is unavailable."
            : null;
  return {
    header: {
      decisionId: "dec-smiths-renovation-2026-0726",
      createdAt: formatDemoInstant(timeline.decisionAt, undefined, true),
      createdAtIso: timeline.decisionAt,
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
      auditPosition: IDS.auditPosition,
    },
    decisionBindings: [
      {
        kind: "original",
        decisionHash: originalApproval?.binding?.decisionHash ?? IDS.decisionHash,
        bundleHash: originalApproval?.binding?.bundleHash ?? IDS.bundleHash,
      },
      ...(revalidated && approvals?.binding
        ? [
            {
              kind: "derived" as const,
              decisionHash: approvals.binding.decisionHash,
              bundleHash: approvals.binding.bundleHash,
            },
          ]
        : []),
    ],
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
