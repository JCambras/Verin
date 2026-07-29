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
import type { RecordProvenance } from "@contracts/provenance";
import { projectReserve } from "@domain/money-movement/reserve-projection";
import { DISPOSITION_LABELS, type ApprovalStageVM, type ApprovalVM, type AuthorityPlanVM, type BlockerVM, type DispositionKind, type DispositionVM, type PolicyTraceVM, type RecommendationVM, type WhyVM } from "./model";
import {
  FIXTURE_RESERVE_HORIZON,
  derivedMetric,
  fact,
  headroomInputs,
  prov,
  reserveFloorInputs,
} from "./provenance";
import { buildSpine } from "./spine";
import { destinationFor } from "./build-context";
import {
  CANONICAL_REQUEST,
  BANK_INSTRUCTION,
  CAST,
  DEFAULT_APPROVAL_CLOCK,
  DEMO_NOW,
  DEMO_TIMELINE,
  DESTINATION_RESTRICTION,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  PLANNED_WITHDRAWAL_STALE_AGE_DAYS,
  SMITHS_LIQUIDITY,
  demoTimestampLabel,
  decisionConfigurationFor,
  dispositionFor,
  type DecisionIdentity,
  type FirmData,
  type ScenarioData,
} from "./data";
import {
  automaticAuthorityPlan,
  unreachedAuthorityPlan,
} from "./setup-authority";
/** The ONE reserve projection behind every displayed floor and headroom for a firm -
 * DERIVED figures (ADR-0022): computed from synthetic inputs, so they render as
 * watermarked demonstrations. The projection is fed the WHOLE signed basis -
 * available, pending, and the request being decided - so the journey and the setup
 * cannot model one request two ways. */
function reserveProjectionFor(firm: FirmData) {
  return projectReserve({
    availableMinor: SMITHS_LIQUIDITY.availableMinor,
    pendingMinor: SMITHS_LIQUIDITY.pendingMinor,
    requestMinor: SMITHS_LIQUIDITY.requestMinor,
    plannedMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    reserveMonths: firm.reserveMonths,
  });
}
export function headroomMinor(firm: FirmData): number {
  return reserveProjectionFor(firm).headroomMinor;
}
/** `horizon` names where `firm.reserveMonths` came from: the FIRMS fixture on the
 * journey, the administrator's closed choice after activation. */
export function headroomMetric(firm: FirmData, horizon: RecordProvenance = FIXTURE_RESERVE_HORIZON) {
  return derivedMetric(headroomMinor(firm), "currency-minor", headroomInputs(horizon), DEMO_NOW);
}
export function reserveFloorMetric(firm: FirmData, horizon: RecordProvenance = FIXTURE_RESERVE_HORIZON) {
  return derivedMetric(
    reserveProjectionFor(firm).requiredReserveMinor,
    "currency-minor",
    reserveFloorInputs(horizon),
    DEMO_NOW,
  );
}
export function amountMetric() {
  return metric(CANONICAL_REQUEST.amountMinor, "currency-minor", prov("user-entered-demo-input", DEMO_NOW));
}

/** The horizon prose the record and the setup both print. Derived from the activated
 * number so the words, the floor, and the headroom cannot disagree. */
export function reserveHorizonPhrase(firm: FirmData): string {
  return `${firm.reserveMonths} months of planned withdrawals`;
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
      condition: `The bank instruction changed on ${BANK_INSTRUCTION.changedOn}, ${BANK_INSTRUCTION.changedAgeDays} days before this decision, and has not been independently verified`,
      affordanceLabel: "Request independent verification of the bank instruction",
    });
  }
  if (spec.stalePlannedWithdrawals) {
    out.push({
      condition: `Planned-withdrawal evidence is ${PLANNED_WITHDRAWAL_STALE_AGE_DAYS} days old; policy allows ${decisionConfigurationFor(firm).freshnessDays}`,
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
  horizon: RecordProvenance = FIXTURE_RESERVE_HORIZON,
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
    : scenario.spec.bankChanged &&
        firm.bankChangeHandling === "specialist-review"
      ? "Requires specialist review. No dual-approval stage applies at this amount."
      : "Authority resolves automatically because this request is at or below the firm's dual-approval threshold.";
  return {
    kind,
    headline: `Move the requested amount from Smith Family Taxable to ${destinationFor(scenario)}.`,
    figures: [
      { label: "Amount", metric: amountMetric() },
      { label: "Available after this request and reserve", metric: headroomMetric(firm, horizon) },
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
            source: fact(
              "Smith Family Taxable · Fidelity",
              "deterministic-engine-output",
              DEMO_NOW,
              demoTimestampLabel(DEMO_TIMELINE.recommendationRetrievedAt),
            ),
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
      result:
        kind === "prohibited"
          ? "Not applicable - precedence stopped at the household destination prohibition"
          : spec.stalePlannedWithdrawals
            ? "Cannot evaluate - planned-withdrawal evidence is older than policy allows"
            : "Satisfied after this movement",
      version: reserveCite,
      why:
        kind === "prohibited"
          ? {
              reason:
                "The binding household instruction ended evaluation before firm reserve policy could apply.",
            }
          : {
              reason: `${firm.name} preserves ${reserveHorizonPhrase(firm)} in cash.`,
              regulation: `Firm policy ${reserveCite}`,
            },
    },
    {
      order: 3,
      rule: "Recent bank-instruction change handling",
      result:
        kind === "prohibited"
          ? "Not applicable - precedence stopped at the household destination prohibition"
          : !spec.bankChanged
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
        kind === "prohibited"
          ? "Not applicable - precedence stopped at the household destination prohibition"
          : CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor
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
 * (the authority surface mid-journey) or "final" (what the printable record shows).
 * The clock is the SHARED catalog entry the fixture configuration hashes, so the
 * printed escalation and expiry can never disagree with the hashed clock id. The
 * setup-activated path never reaches here: its stages are evaluator-owned and frozen
 * in the snapshot (F9). */
function buildStages(
  scenario: ScenarioData,
  firm: FirmData,
  phase: "gate" | "final",
): ApprovalStageVM[] {
  const approvalClock = DEFAULT_APPROVAL_CLOCK;
  const spec = scenario.spec;
  const stages: ApprovalStageVM[] = [];
  const dualApproval = CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor;
  const hasSpecialist =
    spec.bankChanged && firm.bankChangeHandling === "specialist-review";
  const specialistComplete =
    !hasSpecialist || (phase === "final" && !spec.specialistExpired);
  if (hasSpecialist) {
    stages.push(
      spec.specialistExpired
        ? {
            title: "Stage 1 - Bank-instruction specialist review",
            requirement:
              "The changed bank instruction requires review by a banking specialist before execution.",
            stepState: "active",
            actors: [
              {
                name: CAST.specialist,
                role: "Banking specialist",
                status: "expired",
                statusLabel: `Expired · ${demoTimestampLabel(DEMO_TIMELINE.specialistExpiredAt)}`,
              },
              {
                name: CAST.principal,
                role: "Principal (escalation)",
                status: "pending",
                statusLabel: "Awaiting review",
              },
            ],
            expiry: `Expired ${demoTimestampLabel(DEMO_TIMELINE.specialistExpiredAt)}`,
            escalation: "Escalates to: principal",
          }
        : {
            title: "Stage 1 - Bank-instruction specialist review",
            requirement:
              "The changed bank instruction requires review by a banking specialist before execution.",
            stepState: phase === "final" ? "done" : "active",
            actors: [
              phase === "final"
                ? {
                    name: CAST.specialist,
                    role: "Banking specialist",
                    status: "done",
                    statusLabel: `Reviewed · ${demoTimestampLabel(DEMO_TIMELINE.specialistReviewedAt)}`,
                  }
                : {
                    name: CAST.specialist,
                    role: "Banking specialist",
                    status: "pending",
                    statusLabel: "Awaiting review",
                  },
            ],
            expiry: "Expires after 2 days",
            escalation: "Escalates after 1 day to operations manager",
          },
    );
  }
  const operationsStage = stages.length + 1;
  if (dualApproval) {
    const second =
      phase === "final" && specialistComplete && !spec.invalidation
        ? {
            name: CAST.opsApprover2,
            role: "Operations",
            status: "done",
            statusLabel: `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval2At)}`,
          }
        : { name: CAST.opsApprover2, role: "Operations", status: "pending", statusLabel: "Awaiting approval" };
    stages.push({
      title: `Stage ${operationsStage} - Dual operations approval`,
      requirement:
        firm.requesterParticipation.mode === "unbound"
          ? "Two approvals required from distinct operations approvers. Requester participation remains unbound in this demonstration."
          : "Two approvals required from distinct operations approvers. The requester cannot approve.",
      stepState:
        phase === "final" && specialistComplete && !spec.invalidation
          ? "done"
          : !specialistComplete
            ? "pending"
            : "active",
      actors: [
        {
          name: CAST.opsApprover1,
          role: "Operations",
          status:
            spec.invalidation && phase === "final"
              ? "voided"
              : specialistComplete && (phase === "final" || !hasSpecialist)
                ? "done"
                : "pending",
          statusLabel:
            spec.invalidation && phase === "final"
              ? "Approval voided - evidence changed"
              : specialistComplete && (phase === "final" || !hasSpecialist)
                ? `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval1At)}`
                : "Awaiting approval",
        },
        second,
        ...(firm.requesterParticipation.mode === "unbound"
          ? []
          : [
              {
                name: CAST.requester,
                role: "Advisor (requester)",
                status: "pending",
                statusLabel: "Cannot approve",
                note: "Requested this movement - the requester cannot approve.",
                requesterExcluded: true,
              },
            ]),
      ],
      expiry: approvalClock.expiry,
      escalation: approvalClock.escalation,
    });
  }
  return stages;
}

export function buildAuthorityPlan(
  scenario: ScenarioData,
  firm: FirmData,
  phase: "gate" | "final",
): AuthorityPlanVM {
  const disposition = dispositionFor(scenario, firm.id);
  if (disposition !== "proceed") {
    return unreachedAuthorityPlan(
      disposition === "prohibited"
        ? "The binding prohibition ended the journey before authority."
        : "The named conditions must be resolved before authority can be requested.",
    );
  }
  const stages = buildStages(scenario, firm, phase);
  if (stages.length === 0) {
    return automaticAuthorityPlan(
      firm,
      prov("synthetic-fixture", OBSERVED_RECENT),
    );
  }
  if (firm.eligibleRole !== "operations") {
    throw new Error(
      "Staged authority requires the Operations eligible role",
    );
  }
  const hasSpecialist = scenario.spec.bankChanged &&
    firm.bankChangeHandling === "specialist-review";
  return {
    mode: "staged",
    summary: hasSpecialist
      ? CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor
        ? "Specialist review, then two distinct operations approvers"
        : "Specialist review; no dual approval at this amount"
      : "Two distinct operations approvers",
    detail: `${DEFAULT_APPROVAL_CLOCK.escalation}. ${DEFAULT_APPROVAL_CLOCK.expiry}.`,
    eligibleRole: firm.eligibleRole,
    requesterParticipation: firm.requesterParticipation,
    stages: [stages[0]!, ...stages.slice(1)],
  };
}

export function buildApprovals(
  scenario: ScenarioData,
  firm: FirmData,
  identity: DecisionIdentity,
  authority: AuthorityPlanVM = buildAuthorityPlan(scenario, firm, "gate"),
): ApprovalVM {
  if (authority.mode === "not-reached") {
    throw new Error("An authority surface cannot be built for an unreached plan");
  }
  const common = {
    spine: buildSpine("Authority"),
    binding: {
      decisionHash: identity.decisionHash,
      bundleHash: identity.bundleHash,
    },
    fakeClass: "synthetic-fixture" as const,
  };
  if (authority.mode === "automatic") {
    return {
      ...common,
      ...authority,
      continueLabel: "Continue to pre-execution safety",
    };
  }
  return {
    ...common,
    ...authority,
    gate: {
      restatement: `Approve moving the amount below from Smith Family Taxable to ${destinationFor(scenario)}.`,
      figures: [{ label: "Amount", metric: amountMetric() }],
      primaryLabel: "Approve this movement",
    },
  };
}
