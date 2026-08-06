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
import { DISPOSITION_LABELS, type ApprovalVM, type AuthorityPlanVM, type BlockerVM, type DispositionKind, type DispositionVM, type PolicyTraceVM, type RecommendationVM, type RecordReserveVM, type WhyVM } from "./model";
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
  DEMO_NOW,
  DEMO_TIMELINE,
  DESTINATION_RESTRICTION,
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
import { buildAuthorityPlan } from "./build-decision-authority";

export { buildAuthorityPlan };
/** The ONE reserve projection behind every displayed floor and headroom for a firm -
 * DERIVED figures (ADR-0022): computed from synthetic inputs, so they render as
 * watermarked demonstrations. The projection is fed the WHOLE signed basis -
 * available, pending, and the request being decided - so the journey and the setup
 * cannot model one request two ways. */
export type ReserveProjection = ReturnType<typeof projectReserve>;

export function reserveProjectionFor(firm: FirmData): ReserveProjection {
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

type ReserveEvaluationState =
  | {
      readonly kind: "evaluated";
      readonly result: string;
    }
  | {
      readonly kind: "not-evaluated" | "not-applicable";
      readonly result: string;
      readonly reason: string;
    };

/**
 * The three states a reserve check can honestly be in, and NOTHING else: evaluated
 * (the projection ran - its own `reserveSatisfied` is the result), not evaluated (an
 * input was missing, so no floor or headroom exists), or not applicable (precedence
 * stopped first). The satisfaction sentence is READ from the projection that produced
 * the disposition, never asserted beside it: this string feeds precedence row 2 and
 * the record's reserve block, and both are hashed into `decisionHash`, so a hardcoded
 * claim would sign a result the evaluator never established.
 */
function reserveEvaluationState(
  scenario: ScenarioData,
  kind: DispositionKind,
  projection: ReserveProjection,
): ReserveEvaluationState {
  if (kind === "prohibited") {
    return {
      kind: "not-applicable",
      result:
        "Not applicable - precedence stopped at the household destination prohibition",
      reason:
        "The household destination prohibition stopped precedence before reserve evaluation.",
    };
  }
  if (scenario.spec.stalePlannedWithdrawals) {
    return {
      kind: "not-evaluated",
      result:
        "Cannot evaluate - planned-withdrawal evidence is older than policy allows",
      reason:
        "Planned-withdrawal evidence is outside the active freshness window, so no reserve floor or headroom was calculated.",
    };
  }
  if (scenario.spec.conflictingInstruction) {
    return {
      kind: "not-evaluated",
      result:
        "Cannot evaluate - conflicting instructions leave the funding source unresolved",
      reason:
        "Conflicting funding instructions mean the funding source remains unresolved, so no reserve floor or headroom was calculated.",
    };
  }
  return {
    kind: "evaluated",
    result: projection.reserveSatisfied
      ? "Satisfied after this movement"
      : "Not satisfied - this movement would leave the household below the cash-reserve floor",
  };
}

export function buildRecordReserve(
  scenario: ScenarioData,
  firm: FirmData,
  disposition: DispositionVM,
  reserveHorizon: RecordProvenance,
  projection: ReserveProjection = reserveProjectionFor(firm),
): RecordReserveVM {
  const evaluation = reserveEvaluationState(
    scenario,
    disposition.kind,
    projection,
  );
  if (evaluation.kind !== "evaluated") {
    return {
      kind: evaluation.kind,
      reason: evaluation.reason,
    };
  }
  return {
    kind: "evaluated",
    horizon: reserveHorizonPhrase(firm),
    floor: reserveFloorMetric(firm, reserveHorizon),
    headroom: headroomMetric(firm, reserveHorizon),
  };
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
  const requesterAuthority =
    firm.requesterParticipation.mode === "unbound"
      ? "Requester participation remains unbound in this demonstration."
      : "The requester cannot satisfy both approvals.";
  const authoritySummary = dualApproval
    ? `Requires two distinct operations approvers. ${requesterAuthority}` +
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
  projection: ReserveProjection = reserveProjectionFor(firm),
): PolicyTraceVM {
  const spec = scenario.spec;
  const reserveEvaluation = reserveEvaluationState(
    scenario,
    kind,
    projection,
  );
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
      result: reserveEvaluation.result,
      version: reserveCite,
      why:
        reserveEvaluation.kind === "evaluated"
          ? {
              reason: `${firm.name} preserves ${reserveHorizonPhrase(firm)} in cash.`,
              regulation: `Firm policy ${reserveCite}`,
            }
          : {
              reason: reserveEvaluation.reason,
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
