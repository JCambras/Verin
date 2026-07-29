/**
 * Fake-service builders for the DECISION surfaces: recommendation and alternatives
 * (surface 4), policy and precedence trace (surface 5), approval stages (surface 6).
 *
 * The disposition each branch lands on is RECORDED contract data (data.ts, fenced
 * against config/demo/scenarios.yaml) - never computed here and never in a component.
 * These builders only translate that recorded outcome into the typed view models the
 * design language specifies (§5 disposition treatments, §7 authority surfaces).
 */
import { metric } from "@contracts/metric";
import {
  headroomMinor as calculateHeadroomMinor,
  reserveFloorMinor as calculateReserveFloorMinor,
} from "@contracts/money-movement";
import { DISPOSITION_LABELS, type ApprovalStageVM, type ApprovalVM, type BlockerVM, type DispositionVM, type PolicyTraceVM, type RecommendationVM, type WhyVM } from "./model";
import { derivedMetric, fact, prov } from "./provenance";
import { buildSpine } from "./spine";
import { destinationFor } from "./build-context";
import { buildProhibitedDisposition } from "./build-prohibition";
import { formatDemoInstant, timelineFor } from "./timeline";
import {
  CANONICAL_REQUEST,
  CAST,
  DEMO_NOW,
  IDS,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  dispositionFor,
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
const LIQUIDITY_INPUTS = [prov("synthetic-fixture", OBSERVED_RECENT), prov("synthetic-fixture", OBSERVED_RECENT)];
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
export function reserveFloorMetric(firm: FirmData) {
  return derivedMetric(reserveFloorMinor(firm), "currency-minor", LIQUIDITY_INPUTS, DEMO_NOW);
}
export function headroomMetric(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial") {
  const headroom = headroomMinor(scenario, firm, pass);
  return headroom === null ? null : derivedMetric(headroom, "currency-minor", LIQUIDITY_INPUTS, DEMO_NOW);
}
export function amountMetric(scenario: ScenarioData, firm: FirmData) {
  return metric(requestFor(scenario, firm.id).amountMinor, "currency-minor", prov("user-entered-demo-input", DEMO_NOW));
}

/** Reserve horizons read as words in demo copy, matching the policy-trace voice. */
function reserveHorizonWord(firm: FirmData): string {
  return firm.reserveMonths === 6 ? "six" : "twelve";
}

/** The §5 spine state-slot per disposition. */
export const DISPOSITION_BADGES = {
  proceed: { status: "proceed", label: DISPOSITION_LABELS.proceed },
  blocked: { status: "blocked", label: DISPOSITION_LABELS.blocked },
  prohibited: { status: "prohibited", label: DISPOSITION_LABELS.prohibited },
} as const;
function blockersFor(scenario: ScenarioData, firm: FirmData): BlockerVM[] {
  const spec = scenario.spec;
  const out: BlockerVM[] = [];
  if (spec.bankChanged && firm.bankChangeHandling === "block-until-independently-verified") {
    out.push({
      condition: "The bank instruction changed on Jul 24 and has not been independently verified",
      affordanceLabel: "Request independent verification of the bank instruction",
    });
  }
  if (spec.staleLiquidity) {
    out.push({
      condition: "Liquidity evidence is forty-four days old; policy allows thirty",
      affordanceLabel: "Refresh liquidity evidence",
    });
  }
  if (spec.conflictingInstruction) {
    out.push({
      condition: "The advisor's book contains two equally plausible Smith households",
      affordanceLabel: "Select the intended household",
    });
  }
  if (spec.competing && firm.id === "firm-b") {
    out.push({
      condition: "Firm B's twelve-month reserve blocks the first request before a live reservation can affect the outcome",
      affordanceLabel: "Reduce the amount or free additional liquidity",
    });
  } else if (!spec.staleLiquidity && reserveHolds(scenario, firm) === false) {
    out.push({
      condition: `This movement would leave the household below ${firm.name}'s ${reserveHorizonWord(firm)}-month cash reserve`,
      affordanceLabel: "Reduce the amount or free additional liquidity",
    });
  }
  return out;
}

function proceedWhy(firm: FirmData, bankChanged: boolean | undefined, hasLiquidityAuthority: boolean): WhyVM {
  const cite = firm.id === "firm-a" ? `${firm.policyVersion} §2, §4` : `${firm.policyVersion} §3, §4`;
  return {
    reason:
      (hasLiquidityAuthority
        ? "The destination passes the household restriction, the cash reserve holds after this movement, and available liquidity covers the amount."
        : "The recorded scenario disposition proceeds, but this branch and firm have no captain-signed numeric liquidity case to display; Verin does not substitute another case's figures.") +
      (bankChanged && firm.bankChangeHandling === "specialist-review" ? " The recent bank-instruction change routes to specialist review rather than blocking." : ""),
    regulation: `Firm policy ${cite}`,
  };
}

export function buildDisposition(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): DispositionVM {
  const kind = dispositionFor(scenario, firm.id);
  if (kind === "prohibited") {
    return buildProhibitedDisposition(scenario, firm);
  }
  if (kind === "blocked") {
    return {
      kind,
      headline: "This movement may proceed after the conditions below are satisfied.",
      blockers: blockersFor(scenario, firm),
      why: {
        reason: "Each named condition is resolvable by evidence or review. Verin does not substitute approval for missing evidence: resolve the condition and the decision re-evaluates.",
        regulation: `Firm policy ${firm.policyVersion}`,
      },
      fakeClass: "deterministic-engine-output",
    };
  }
  const dualApproval =
    sourceCaseFor(scenario, firm.id)?.authority.stages.some(
      (stage) => stage.stageId === "ops-dual-approval",
    ) ?? CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor;
  const headroom = headroomMetric(scenario, firm, pass);
  const authoritySummary = dualApproval
    ? "Requires two distinct operations approvers. The requester cannot satisfy both approvals." +
      (scenario.spec.bankChanged ? " The recent bank-instruction change adds a specialist-review stage." : "")
    : "Automatic authority applies because the amount is below this firm's dual-approval threshold; no approval stage is required.";
  return {
    kind,
    headline: `Move the requested amount from Smith Family Taxable to ${destinationFor(scenario)}.`,
    figures: [
      { label: "Amount", metric: amountMetric(scenario, firm) },
      ...(headroom ? [{ label: "Available after reserve", metric: headroom }] : []),
    ],
    authoritySummary,
    why: proceedWhy(firm, scenario.spec.bankChanged, headroom !== null),
    fakeClass: "deterministic-engine-output",
  };
}

export function buildRecommendation(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): RecommendationVM {
  const disposition = buildDisposition(scenario, firm, pass);
  const proceed = disposition.kind === "proceed";
  return {
    spine: buildSpine("Decision", DISPOSITION_BADGES[disposition.kind]),
    disposition,
    derivedDecision: scenario.spec.invalidation === true && pass === "revalidated",
    ...(proceed
      ? {
          recommendation: {
            amount: amountMetric(scenario, firm),
            source: fact("Smith Family Taxable · Fidelity", "deterministic-engine-output", DEMO_NOW, "Jul 26, 09:20"),
          },
        }
      : {}),
    alternatives: proceed
      ? [
          {
            title: "Sell from Elaine's Roth IRA",
            rejectedReason: "Spends tax-free space; firm policy prefers taxable sources for discretionary spending.",
            why: { reason: "Taxable-first funding for non-qualified spending preserves tax-advantaged space.", regulation: `Firm policy ${firm.policyVersion} §5` },
          },
          {
            title: "Wire from Joint Taxable",
            rejectedReason: "The balance would fall below the household's planned-withdrawal reserve.",
            why: { reason: "The reserve floor applies per account group; this source cannot absorb the movement.", regulation: `Firm policy ${firm.policyVersion} §2` },
          },
          {
            title: "Split across two accounts",
            rejectedReason: "Two custodian instructions double the not-in-good-order surface with no policy benefit.",
          },
        ]
      : [],
  };
}

export function buildPolicyTrace(scenario: ScenarioData, firm: FirmData, pass: JourneyPass = "initial"): PolicyTraceVM {
  const spec = scenario.spec;
  const prohibition = sourceCaseFor(scenario, firm.id)?.prohibition;
  const reserveCite = firm.id === "firm-a" ? `${firm.policyVersion} §2` : `${firm.policyVersion} §3`;
  const rows = [
    {
      order: 1,
      rule: "Household destination restriction",
      result: spec.thirdPartyDestination ? "Violated - this movement is prohibited" : "Passes - destination owned by household members",
      version: prohibition?.source.versionId ?? "Exact signed source unavailable",
      why: { reason: "Household instructions take precedence over firm policy for destination checks. A violation here is a prohibition, not a blocker." },
    },
    {
      order: 2,
      rule: "Cash-reserve floor (months of planned withdrawals)",
      result: spec.staleLiquidity
        ? "Cannot evaluate - liquidity evidence is older than policy allows"
        : reserveHolds(scenario, firm, pass) === null
          ? "Cannot display - no signed numeric liquidity case covers this branch and firm"
          : reserveHolds(scenario, firm, pass)
          ? "Satisfied after this movement"
          : "Breached - this movement would leave the household below the floor",
      version: reserveCite,
      why: { reason: `${firm.name} preserves ${reserveHorizonWord(firm)} months of planned withdrawals in cash.`, regulation: `Firm policy ${reserveCite}` },
    },
    {
      order: 3,
      rule: "Recent bank-instruction change handling",
      result: !spec.bankChanged
        ? "Not triggered - no recent change"
        : firm.bankChangeHandling === "specialist-review"
          ? "Specialist review required before execution"
          : "Blocked until independently verified",
      version: `${firm.policyVersion} §6`,
    },
    {
      order: 4,
      rule: "Dual-approval threshold",
      result:
        requestFor(scenario, firm.id).amountMinor > firm.dualApprovalThresholdMinor
          ? "Triggered - two distinct operations approvers required"
          : "Not triggered at this amount",
      version: `${firm.policyVersion} §4`,
    },
  ];
  return {
    spine: buildSpine("Decision", DISPOSITION_BADGES[dispositionFor(scenario, firm.id)]),
    firmPolicyVersion: firm.policyVersion,
    householdInstructionVersion:
      prohibition?.source.versionId ?? "Exact signed source unavailable",
    rows,
    fakeClass: "deterministic-engine-output",
  };
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
  const spec = scenario.spec;
  const timeline = timelineFor(scenario, firm);
  const sourceCase = sourceCaseFor(scenario, firm.id);
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
    const stageReached = !spec.specialistExpired;
    const approvalOneAt =
      pass === "revalidated" ? timeline.freshApprovalOneAt : timeline.approvalOneAt;
    const approvalTwoAt =
      pass === "revalidated" ? timeline.freshApprovalTwoAt : timeline.approvalTwoAt;
    const statusPrefix =
      pass === "revalidated" && spec.invalidation
        ? "Fresh approval on derived decision"
        : "Approved";
    const actors = specialistReview
      ? spec.specialistExpired
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
      ...(spec.specialistExpired && specialistReview
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
  const revalidated = scenario.spec.invalidation === true && pass === "revalidated";
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
            policyRef: `${firm.policyVersion} §4`,
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
          ? `Continue moving the amount below from Smith Family Taxable to ${destinationFor(scenario)} under automatic authority.`
          : `Approve moving the amount below from Smith Family Taxable to ${destinationFor(scenario)}.`,
      figures: [{ label: "Amount", metric: amountMetric(scenario, firm) }],
      primaryLabel:
        mode === "automatic"
          ? "Continue under automatic authority"
          : "Continue after recorded approvals",
    },
    fakeClass: "synthetic-fixture",
  };
}
