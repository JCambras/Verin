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
import { projectReserve } from "@domain/money-movement/reserve-projection";
import { DISPOSITION_LABELS, type ApprovalStageVM, type ApprovalVM, type BlockerVM, type DispositionKind, type DispositionVM, type PolicyTraceVM, type RecommendationVM, type WhyVM } from "./model";
import { derivedMetric, fact, prov } from "./provenance";
import { buildSpine } from "./spine";
import { destinationFor } from "./build-context";
import {
  CANONICAL_REQUEST,
  CAST,
  DEMO_NOW,
  DESTINATION_RESTRICTION,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  decisionIdentityFor,
  dispositionFor,
  type DecisionIdentity,
  type FirmData,
  type ScenarioData,
} from "./data";

/** Reserve floor and post-reserve headroom under a firm's policy - DERIVED figures
 * (ADR-0022): computed from synthetic inputs, so they render as watermarked
 * demonstrations. The inputs list is the provenance trace, not a calculation cache.
 * The projection is fed the WHOLE signed basis - available, pending, and the request
 * being decided - so the journey and the setup cannot model one request two ways. */
const LIQUIDITY_INPUTS = [prov("synthetic-fixture", OBSERVED_RECENT), prov("synthetic-fixture", OBSERVED_RECENT)];
export function headroomMinor(firm: FirmData): number {
  return projectReserve({
    availableMinor: SMITHS_LIQUIDITY.availableMinor,
    pendingMinor: SMITHS_LIQUIDITY.pendingMinor,
    requestMinor: SMITHS_LIQUIDITY.requestMinor,
    plannedMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    reserveMonths: firm.reserveMonths,
  }).headroomMinor;
}
export function headroomMetric(firm: FirmData) {
  return derivedMetric(headroomMinor(firm), "currency-minor", LIQUIDITY_INPUTS, DEMO_NOW);
}
export function amountMetric() {
  return metric(CANONICAL_REQUEST.amountMinor, "currency-minor", prov("user-entered-demo-input", DEMO_NOW));
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
  if (spec.stalePlannedWithdrawals) {
    out.push({
      condition: "Planned-withdrawal evidence is 47 days old; policy allows 30",
      affordanceLabel: "Refresh planned-withdrawal evidence",
    });
  }
  if (spec.conflictingInstruction) {
    out.push({
      condition: "Two household instructions give conflicting funding guidance for this request",
      affordanceLabel: "Choose the governing value",
    });
  }
  return out;
}

function proceedWhy(firm: FirmData, bankChanged: boolean | undefined): WhyVM {
  const cite = firm.id === "firm-a" ? `${firm.policyVersion} §2, §4` : `${firm.policyVersion} §3, §4`;
  return {
    reason:
      "The destination passes the household restriction, the cash reserve holds after this movement, and available liquidity covers the amount." +
      (bankChanged && firm.bankChangeHandling === "specialist-review" ? " The recent bank-instruction change routes to specialist review rather than blocking." : ""),
    regulation: `Firm policy ${cite}`,
  };
}

export function buildDisposition(
  scenario: ScenarioData,
  firm: FirmData,
  kind: DispositionKind = dispositionFor(scenario, firm.id),
): DispositionVM {
  if (kind === "prohibited") {
    return {
      kind,
      headline: "This movement is prohibited for this household.",
      prohibitedScope: "Distributions from household accounts to third-party or business destinations",
      source: {
        kind: "household-instruction",
        ref: DESTINATION_RESTRICTION.ref,
        provenance: prov("synthetic-fixture", "2026-02-14"),
      },
      doctrine: "Verin will not route this for approval: the restriction is not resolvable by evidence or authority.",
      why: {
        reason:
          "The household instruction prohibits distributions to third-party or business accounts not owned by a household member. The requested destination is a third-party business account, so no approval path exists at any amount.",
      },
      fakeClass: "deterministic-engine-output",
    };
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
  const dualApproval = CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor;
  const authoritySummary = dualApproval
    ? "Requires two distinct operations approvers. The requester cannot satisfy both approvals." +
      (scenario.spec.bankChanged ? " The recent bank-instruction change adds a specialist-review stage." : "")
    : "Below this firm's dual-approval threshold at this amount - a standard approval stage applies.";
  return {
    kind,
    headline: `Move the requested amount from Smith Family Taxable to ${destinationFor(scenario)}.`,
    figures: [
      { label: "Amount", metric: amountMetric() },
      { label: "Available after this request and reserve", metric: headroomMetric(firm) },
    ],
    authoritySummary,
    why: proceedWhy(firm, scenario.spec.bankChanged),
    fakeClass: "deterministic-engine-output",
  };
}

export function buildRecommendation(scenario: ScenarioData, firm: FirmData): RecommendationVM {
  const disposition = buildDisposition(scenario, firm);
  const proceed = disposition.kind === "proceed";
  return {
    spine: buildSpine("Decision", DISPOSITION_BADGES[disposition.kind]),
    disposition,
    ...(proceed
      ? {
          recommendation: {
            amount: amountMetric(),
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

export function buildPolicyTrace(
  scenario: ScenarioData,
  firm: FirmData,
  kind: DispositionKind = dispositionFor(scenario, firm.id),
): PolicyTraceVM {
  const spec = scenario.spec;
  const reserveCite = firm.id === "firm-a" ? `${firm.policyVersion} §2` : `${firm.policyVersion} §3`;
  const rows = [
    {
      order: 1,
      rule: "Household destination restriction",
      result: spec.thirdPartyDestination ? "Violated - this movement is prohibited" : "Passes - destination owned by household members",
      version: DESTINATION_RESTRICTION.ref,
      why: { reason: "Household instructions take precedence over firm policy for destination checks. A violation here is a prohibition, not a blocker." },
    },
    {
      order: 2,
      rule: "Cash-reserve floor (months of planned withdrawals)",
      result: spec.stalePlannedWithdrawals
        ? "Cannot evaluate - planned-withdrawal evidence is older than policy allows"
        : "Satisfied after this movement",
      version: reserveCite,
      why: { reason: `${firm.name} preserves ${firm.reserveMonths === 6 ? "six" : "twelve"} months of planned withdrawals in cash.`, regulation: `Firm policy ${reserveCite}` },
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
        CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor
          ? "Triggered - two distinct operations approvers required"
          : "Not triggered at this amount",
      version: `${firm.policyVersion} §4`,
    },
  ];
  return {
    spine: buildSpine("Decision", DISPOSITION_BADGES[kind]),
    firmPolicyVersion: firm.policyVersion,
    householdInstructionVersion: "HH-INSTR-SMITH v3",
    rows,
    fakeClass: "deterministic-engine-output",
  };
}

/** Approval stages. `phase` selects the recorded moment the surface shows: "gate"
 * (the authority surface mid-journey) or "final" (what the printable record shows). */
export interface ApprovalClock {
  readonly escalation: string;
  readonly expiry: string;
}

const DEFAULT_APPROVAL_CLOCK: ApprovalClock = {
  escalation: "Escalates after 1 day",
  expiry: "Expires after 3 days",
};

export function buildStages(
  scenario: ScenarioData,
  firm: FirmData,
  phase: "gate" | "final",
  approvalClock: ApprovalClock = DEFAULT_APPROVAL_CLOCK,
): ApprovalStageVM[] {
  const spec = scenario.spec;
  const stages: ApprovalStageVM[] = [];
  const dualApproval = CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor;
  if (dualApproval) {
    const second =
      phase === "final" && !spec.invalidation
        ? { name: CAST.opsApprover2, role: "Operations", status: "done", statusLabel: "Approved · Jul 26, 10:31" }
        : { name: CAST.opsApprover2, role: "Operations", status: "pending", statusLabel: "Awaiting approval" };
    stages.push({
      title: "Stage 1 - Dual operations approval",
      requirement: "Two approvals required from distinct operations approvers. The requester cannot satisfy both approvals.",
      stepState: phase === "final" && !spec.invalidation ? "done" : "active",
      actors: [
        {
          name: CAST.opsApprover1,
          role: "Operations",
          status: spec.invalidation && phase === "final" ? "voided" : "done",
          statusLabel: spec.invalidation && phase === "final" ? "Approval voided - evidence changed" : "Approved · Jul 26, 10:02",
        },
        second,
        {
          name: CAST.requester,
          role: "Advisor (requester)",
          status: "pending",
          statusLabel: "Cannot approve",
          note: "Requested this movement - the requester cannot approve.",
          requesterExcluded: true,
        },
      ],
      expiry: approvalClock.expiry,
      escalation: approvalClock.escalation,
    });
  } else {
    const approver =
      spec.invalidation && phase === "final"
        ? { name: CAST.opsApprover1, role: "Operations", status: "voided", statusLabel: "Approval voided - evidence changed" }
        : spec.invalidation || phase === "final"
          ? { name: CAST.opsApprover1, role: "Operations", status: "done", statusLabel: "Approved · Jul 26, 10:02" }
          : { name: CAST.opsApprover1, role: "Operations", status: "pending", statusLabel: "Awaiting approval" };
    stages.push({
      title: "Stage 1 - Approval",
      requirement: `Below ${firm.name}'s dual-approval threshold at this amount. ${firm.name} policy does not name an approver role for this stage.`,
      stepState: phase === "final" && !spec.invalidation ? "done" : "active",
      actors: [approver],
      expiry: approvalClock.expiry,
      escalation: approvalClock.escalation,
    });
  }
  if (spec.bankChanged && firm.bankChangeHandling === "specialist-review") {
    if (spec.specialistExpired) {
      stages.push({
        title: "Stage 2 - Bank-instruction specialist review",
        requirement: "The changed bank instruction requires review by a banking specialist before execution.",
        stepState: "active",
        actors: [
          { name: CAST.specialist, role: "Banking specialist", status: "expired", statusLabel: "Expired - escalated" },
          { name: CAST.principal, role: "Principal (escalation)", status: "pending", statusLabel: "Awaiting review" },
        ],
        expiry: "expired Jul 25",
        escalation: "Escalates to: principal",
      });
    } else {
      stages.push({
        title: "Stage 2 - Bank-instruction specialist review",
        requirement: "The changed bank instruction requires review by a banking specialist before execution.",
        stepState: phase === "final" ? "done" : "pending",
        actors: [
          phase === "final"
            ? { name: CAST.specialist, role: "Banking specialist", status: "done", statusLabel: "Reviewed · Jul 26, 11:15" }
            : { name: CAST.specialist, role: "Banking specialist", status: "pending", statusLabel: "Awaiting review" },
        ],
        expiry: "expires Aug 12",
        escalation: "Escalates to: principal",
      });
    }
  }
  return stages;
}

export function buildApprovals(
  scenario: ScenarioData,
  firm: FirmData,
  identity: DecisionIdentity = decisionIdentityFor(scenario, firm),
  approvalClock: ApprovalClock = DEFAULT_APPROVAL_CLOCK,
): ApprovalVM {
  return {
    spine: buildSpine("Authority"),
    stages: buildStages(scenario, firm, "gate", approvalClock),
    binding: { decisionHash: identity.decisionHash, bundleHash: identity.bundleHash },
    gate: {
      restatement: `Approve moving the amount below from Smith Family Taxable to ${destinationFor(scenario)}.`,
      figures: [{ label: "Amount", metric: amountMetric() }],
      primaryLabel: "Approve this movement",
    },
    fakeClass: "synthetic-fixture",
  };
}
