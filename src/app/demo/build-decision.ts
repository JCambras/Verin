import { metric } from "@contracts/metric";
import {
  headroomMinor as calculateHeadroomMinor,
  reserveFloorMinor as calculateReserveFloorMinor,
} from "@contracts/money-movement";
import { DISPOSITION_LABELS, type ApprovalStageVM, type ApprovalVM, type DispositionVM, type PolicyTraceVM, type RecommendationVM } from "./model";
import { derivedMetric, fact, prov } from "./provenance";
import { buildSpine } from "./spine";
import { destinationFor } from "./build-context";
import { buildProhibitedDisposition } from "./build-prohibition";
import {
  exactBlockers,
  exactProceedWhy,
  liquidityInputs,
} from "./build-decision-truth";
import { buildExactPolicyTrace } from "./build-policy-trace";
import { formatDemoInstant, timelineFor } from "./timeline";
import {
  CANONICAL_REQUEST,
  CAST,
  IDS,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  dispositionFor,
  evidenceForPass,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  requestFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
/** Reserve floor and post-reserve headroom under a firm's policy - DERIVED figures
 * (ADR-0022): computed from synthetic inputs, so they render as watermarked
 * demonstrations. The inputs list is the provenance trace, not a calculation cache.
 * Headroom reads the BRANCH's signed liquidity evidence, never a global assumption,
 * so the figure beside "Amount" is the one that branch's golden case states. */
const DEFAULT_LIQUIDITY_INPUTS = [
  prov("synthetic-fixture", OBSERVED_RECENT),
  prov("synthetic-fixture", OBSERVED_RECENT),
];
export function reserveFloorMinor(firm: FirmData): number {
  return calculateReserveFloorMinor(PLANNED_WITHDRAWAL_MONTHLY_MINOR, firm.reserveMonths);
}
export function headroomMinor(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): number | null {
  const authority = liquidityAuthorityFor(scenario, firm.id);
  if (authority.kind === "missing") return null;
  const snapshot =
    pass === "revalidated"
      ? (authority.preExecutionRevalidation ?? authority.initialDecision)
      : authority.initialDecision;
  const { availableCashMinor, pendingActivityMinor } = snapshot;
  return calculateHeadroomMinor(availableCashMinor, pendingActivityMinor, reserveFloorMinor(firm));
}
/** Whether the branch's signed liquidity covers the canonical request under this
 * firm's reserve floor - the one comparison every proceed claim on screen rests on. */
export function reserveHolds(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): boolean | null {
  const headroom = headroomMinor(scenario, firm, pass);
  return headroom === null
    ? null
    : headroom >= requestFor(scenario, firm.id).amountMinor;
}
export function reserveFloorMetric(
  firm: FirmData,
  scenario?: ScenarioData,
) {
  const planned = scenario
    ? sourceCaseFor(scenario, firm.id)?.evidence.find(
        (entry) => entry.evidenceKind === "planned-withdrawals",
      )
    : undefined;
  return derivedMetric(
    reserveFloorMinor(firm),
    "currency-minor",
    planned
      ? [prov("synthetic-fixture", planned.observedAt)]
      : DEFAULT_LIQUIDITY_INPUTS,
    planned?.observedAt ?? OBSERVED_RECENT,
  );
}
export function headroomMetric(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial") {
  const headroom = headroomMinor(scenario, firm, pass);
  const inputs = liquidityInputs(scenario, firm, pass);
  return headroom === null
    ? null
    : derivedMetric(
        headroom,
        "currency-minor",
        inputs,
        inputs.map(({ asOf }) => asOf).sort().at(-1) ?? OBSERVED_RECENT,
      );
}
export function amountMetric(scenario: ScenarioData, firm: FirmData) {
  const request = requestFor(scenario, firm.id);
  return metric(
    request.amountMinor,
    "currency-minor",
    prov("user-entered-demo-input", request.requestedAt),
  );
}

export const DISPOSITION_BADGES = {
  proceed: { status: "proceed", label: DISPOSITION_LABELS.proceed },
  blocked: { status: "blocked", label: DISPOSITION_LABELS.blocked },
  prohibited: { status: "prohibited", label: DISPOSITION_LABELS.prohibited },
} as const;
export function buildDisposition(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): DispositionVM {
  const kind = dispositionFor(scenario, firm.id);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const selectedEvidence = evidenceForPass(sourceCase, pass);
  if (kind === "prohibited") {
    return buildProhibitedDisposition(scenario, firm);
  }
  if (kind === "blocked") {
    return {
      kind,
      headline: "This movement may proceed after the conditions below are satisfied.",
      blockers: exactBlockers(
        scenario,
        firm,
        reserveHolds(scenario, firm),
      ),
      why: {
        reason:
          sourceCase?.explanations.map(({ summary }) => summary).join(" ") ??
          "The recorded branch is blocked, but exact signed evidence and resolution authority are unavailable for this branch and firm.",
        regulation:
          sourceCase?.policyVersions.firmPolicyVersionId
            ? `Firm policy ${sourceCase.policyVersions.firmPolicyVersionId}`
            : "Exact signed source unavailable",
      },
      fakeClass: "deterministic-engine-output",
    };
  }
  const dualApproval =
    sourceCase?.authority.stages.some(
      (stage) => stage.stageId === "ops-dual-approval",
    ) ?? CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor;
  const headroom = headroomMetric(scenario, firm, pass);
  const authoritySummary =
    sourceCase?.authority.note ??
    (dualApproval
      ? "Requires two distinct operations approvers. The requester cannot satisfy both approvals."
      : "Automatic authority applies because the amount is below this firm's dual-approval threshold; no approval stage is required.");
  const sourceEvidence = selectedEvidence.find(
    (entry) => entry.evidenceKind === "account-balance",
  );
  const destinationEvidence = selectedEvidence.find(
    (entry) => entry.evidenceKind === "bank-instruction",
  );
  return {
    kind,
    headline: `Move the requested amount from ${sourceEvidence?.subjectRef ?? "the selected source"} to ${destinationEvidence?.subjectRef ?? destinationFor(scenario, firm)}.`,
    figures: [
      { label: "Amount", metric: amountMetric(scenario, firm) },
      ...(headroom ? [{ label: "Available after reserve", metric: headroom }] : []),
    ],
    authoritySummary,
    why: exactProceedWhy(scenario, firm, headroom !== null),
    fakeClass: "deterministic-engine-output",
  };
}

export function buildRecommendation(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): RecommendationVM {
  const disposition = buildDisposition(scenario, firm, pass);
  const proceed = disposition.kind === "proceed";
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const selectedEvidence = evidenceForPass(sourceCase, pass);
  const sourceEvidence = selectedEvidence.find(
    (entry) => entry.evidenceKind === "account-balance",
  );
  const alternatives =
    selectedEvidence.filter(
      (entry) =>
        entry.evidenceKind === "account-balance" &&
        entry !== sourceEvidence,
    );
  const request = requestFor(scenario, firm.id);
  return {
    spine: buildSpine("Decision", DISPOSITION_BADGES[disposition.kind]),
    disposition,
    derivedDecision:
      hasSignedInvalidationAuthority(scenario, firm.id) &&
      pass === "revalidated",
    ...(proceed
      ? {
          recommendation: {
            amount: amountMetric(scenario, firm),
            source: sourceEvidence
              ? fact(
                  sourceEvidence.summary,
                  "deterministic-engine-output",
                  sourceEvidence.observedAt,
                  formatDemoInstant(
                    sourceEvidence.retrievedAt,
                    undefined,
                    true,
                  ),
                )
              : fact(
                  "Exact signed source evidence unavailable",
                  "deterministic-engine-output",
                  request.requestedAt,
                  formatDemoInstant(request.requestedAt),
                ),
          },
        }
      : {}),
    alternatives: proceed
      ? alternatives.map((alternative) => ({
          title: alternative.subjectRef,
          rejectedReason: alternative.summary,
          why: {
            reason: alternative.summary,
            regulation: `Household instruction ${sourceCase?.policyVersions.householdInstructionVersionIds.join(", ") || "unavailable"}`,
          },
        }))
      : [],
  };
}

export function buildPolicyTrace(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): PolicyTraceVM {
  return buildExactPolicyTrace(
    scenario,
    firm,
    reserveHolds(scenario, firm, pass),
  );
}
export function approvalPlanSatisfied(stages: readonly ApprovalStageVM[]): boolean {
  if (stages.length === 0) return false;
  let previousOrder = 0;
  for (const stage of stages) {
    if (stage.order <= previousOrder || !stage.satisfied) return false;
    previousOrder = stage.order;
    const eligible = stage.actors.filter(
      (actor) =>
        actor.status === "done" &&
        stage.eligibleRoleIds.includes(actor.roleId) &&
        (stage.requesterMayApprove || !actor.requesterExcluded),
    );
    const actorCount = stage.distinctActorsRequired
      ? new Set(eligible.map((actor) => actor.actorId)).size
      : eligible.length;
    if (actorCount < stage.approvalsRequired) return false;
  }
  return true;
}
export function buildStages(
  scenario: ScenarioData,
  firm: FirmData,
  _phase: "gate" | "final",
  pass: JourneyPass = "initial",
): ApprovalStageVM[] {
  const timeline = timelineFor(scenario, firm);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const specialistExpired =
    sourceCase?.ledgerEvents.some(
      (event) => event.type === "ApprovalStageExpired",
    ) ?? false;
  const invalidation = hasSignedInvalidationAuthority(
    scenario,
    firm.id,
  );
  const sourceStages =
    sourceCase?.authority.stages ??
    (CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor
      ? [{
          stageId: "ops-dual-approval",
          order: 1,
          executionMode: "parallel" as const,
          eligibleRoleIds: ["operations"],
          approvalsRequired: 2,
          distinctActorsRequired: true,
          requesterMayApprove: false,
          expiresAfter: "P3D",
          escalationPath: [{
            after: "P1D",
            roleIds: ["operations-manager"],
            reasonCode: "approval-stage-idle",
          }],
        }]
      : []);
  return sourceStages.map((stage): ApprovalStageVM => {
    const specialistReview =
      stage.stageId === "bank-change-specialist-review";
    const stageReached = !specialistExpired;
    const approvalOneAt =
      pass === "revalidated" ? timeline.freshApprovalOneAt : timeline.approvalOneAt;
    const approvalTwoAt =
      pass === "revalidated" ? timeline.freshApprovalTwoAt : timeline.approvalTwoAt;
    const statusPrefix =
      pass === "revalidated" && invalidation
        ? "Fresh approval on derived decision"
        : "Approved";
    const actors = specialistReview
      ? specialistExpired
        ? [
            {
              actorId: "actor-alex-kim",
              name: CAST.specialist,
              roleId: "bank-change-specialist",
              role: "Banking specialist",
              status: "expired",
              statusLabel: "Escalated, then expired",
            },
            {
              actorId: "actor-jordan-bell",
              name: CAST.principal,
              roleId: "operations-manager",
              role: "Operations manager (escalation)",
              status: "expired",
              statusLabel: "Expired unresolved",
            },
          ]
        : [
            {
              actorId: "actor-alex-kim",
              name: CAST.specialist,
              roleId: "bank-change-specialist",
              role: "Banking specialist",
              status: "done",
              statusLabel: `Reviewed · ${formatDemoInstant(timeline.specialistReviewedAt)}`,
              timestampIso: timeline.specialistReviewedAt,
            },
          ]
      : [
          {
            actorId: "actor-miguel-torres",
            name: CAST.opsApprover1,
            roleId: "operations",
            role: "Operations",
            status: stageReached ? "done" : "pending",
            statusLabel: stageReached
              ? `${statusPrefix} · ${formatDemoInstant(approvalOneAt)}`
              : "Awaiting prior stage",
            ...(stageReached ? { timestampIso: approvalOneAt } : {}),
          },
          {
            actorId: "actor-priya-nair",
            name: CAST.opsApprover2,
            roleId: "operations",
            role: "Operations",
            status: stageReached ? "done" : "pending",
            statusLabel: stageReached
              ? `${statusPrefix} · ${formatDemoInstant(approvalTwoAt)}`
              : "Awaiting prior stage",
            ...(stageReached ? { timestampIso: approvalTwoAt } : {}),
          },
          {
            actorId: "actor-dana-ellison",
            name: CAST.requester,
            roleId: "advisor",
            role: "Advisor (requester)",
            status: "pending",
            statusLabel: "Cannot approve",
            note: "Requested this movement - the requester cannot approve.",
            requesterExcluded: true,
          },
        ];
    return {
      ...stage,
      title: specialistReview
        ? `Stage ${stage.order} - Bank-instruction specialist review`
        : `Stage ${stage.order} - Dual operations approval`,
      requirement: specialistReview
        ? "The changed bank instruction requires review by a banking specialist before execution."
        : "Two approvals required from distinct operations approvers. The requester cannot satisfy both approvals.",
      satisfied: stageReached,
      stepState: stageReached ? "done" : "pending",
      actors,
      ...(specialistExpired && specialistReview
        ? {
            authorityEvents: [
              {
                type: "ApprovalStageEscalated" as const,
                timestamp: timeline.escalatedAt,
                display: `Escalated to operations manager · ${formatDemoInstant(timeline.escalatedAt)}`,
              },
              {
                type: "ApprovalStageExpired" as const,
                timestamp: timeline.expiredAt,
                display: `Expired unresolved · ${formatDemoInstant(timeline.expiredAt)}`,
              },
            ],
            expired: true,
          }
        : {}),
    };
  });
}

export function buildApprovals(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): ApprovalVM {
  const stages = buildStages(scenario, firm, "gate", pass);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const mode =
    sourceCase?.authority.mode === "automatic"
      ? "automatic"
      : stages.length === 0
        ? "automatic"
        : "staged";
  const satisfied = mode === "automatic" || approvalPlanSatisfied(stages);
  const revalidated =
    hasSignedInvalidationAuthority(scenario, firm.id) &&
    pass === "revalidated";
  return {
    spine: buildSpine("Authority"),
    mode,
    stages,
    satisfied,
    pass,
    automaticAuthority:
      mode === "automatic"
        ? {
            title: "Automatic authority",
            summary:
              sourceCase?.authority.note ??
              "No approval stage is required because this request is below the firm's dual-approval threshold.",
            policyRef:
              sourceCase?.policyVersions.firmPolicyVersionId ??
              firm.policyVersion,
          }
        : null,
    binding:
      mode === "staged"
        ? {
            decisionHash: revalidated ? IDS.derivedDecisionHash : IDS.decisionHash,
            bundleHash: revalidated ? IDS.refreshedBundleHash : IDS.bundleHash,
          }
        : null,
    gate: {
      restatement:
        mode === "automatic"
          ? `Continue moving the amount below from Smith Family Taxable to ${destinationFor(scenario, firm)} under automatic authority.`
          : `Approve moving the amount below from Smith Family Taxable to ${destinationFor(scenario, firm)}.`,
      figures: [{ label: "Amount", metric: amountMetric(scenario, firm) }],
      primaryLabel:
        mode === "automatic"
          ? "Continue under automatic authority"
          : "Continue after recorded approvals",
    },
    fakeClass: "synthetic-fixture",
  };
}
