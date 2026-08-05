import { metric } from "@contracts/metric";
import {
  headroomMinor as calculateHeadroomMinor,
  reserveFloorMinor as calculateReserveFloorMinor,
} from "@contracts/money-movement";
import { DISPOSITION_LABELS, type ApprovalVM, type DispositionVM, type PolicyTraceVM, type RecommendationVM } from "./model";
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
import { decisionBindingFor } from "./decision-bindings";
import { formatDemoInstant } from "./timeline";
import {
  approvalPlanSatisfied,
  buildStages,
} from "./build-approval-stages";
export {
  buildStages,
} from "./build-approval-stages";
import {
  CANONICAL_REQUEST,
  OBSERVED_RECENT,
  dispositionFor,
  evidenceForPass,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  plannedWithdrawalEvidenceFor,
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
export function reserveFloorMinor(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): number | null {
  const planned = plannedWithdrawalEvidenceFor(scenario, firm.id, pass);
  return planned
    ? calculateReserveFloorMinor(
        planned.displayValue!.valueMinor,
        firm.reserveMonths,
      )
    : null;
}
export function headroomMinor(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): number | null {
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const reserveFloor = reserveFloorMinor(scenario, firm, pass);
  if (authority.kind === "missing" || reserveFloor === null) return null;
  const snapshot =
    pass === "revalidated"
      ? (authority.preExecutionRevalidation ?? authority.initialDecision)
      : authority.initialDecision;
  const { availableCashMinor, pendingActivityMinor } = snapshot;
  return calculateHeadroomMinor(
    availableCashMinor,
    pendingActivityMinor,
    reserveFloor,
  );
}
/** Whether the branch's signed liquidity covers the canonical request under this
 * firm's reserve floor - the one comparison every proceed claim on screen rests on. */
export function reserveHolds(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): boolean | null {
  const headroom = headroomMinor(scenario, firm, pass);
  return headroom === null
    ? null
    : headroom >= requestFor(scenario, firm.id).amountMinor;
}
export function reserveFloorMetric(
  firm: FirmData,
  scenario: ScenarioData,
  pass: JourneyPass = "initial",
) {
  const planned = plannedWithdrawalEvidenceFor(scenario, firm.id, pass);
  const floor = reserveFloorMinor(scenario, firm, pass);
  return planned && floor !== null
    ? derivedMetric(
        floor,
        "currency-minor",
        [prov("synthetic-fixture", planned.observedAt)],
        planned.observedAt,
      )
    : null;
}
export function headroomMetric(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
) {
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

export function buildPolicyTrace(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
  policyVersionOverride?: string,
): PolicyTraceVM {
  return buildExactPolicyTrace(
    scenario,
    firm,
    reserveHolds(scenario, firm, pass),
    pass,
    policyVersionOverride,
  );
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
  const sourceAccount = evidenceForPass(sourceCase, pass).find(
    (entry) => entry.evidenceKind === "account-balance",
  );
  const sourceAccountRestatement = sourceAccount
    ? `signed account reference ${sourceAccount.subjectRef} (account name unavailable)`
    : "source account unavailable in this signed case";
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
        ? decisionBindingFor(scenario, firm, pass)
        : null,
    gate: {
      restatement:
        mode === "automatic"
          ? `Continue moving the amount below from ${sourceAccountRestatement} to ${destinationFor(scenario, firm)} under automatic authority.`
          : `Approve moving the amount below from ${sourceAccountRestatement} to ${destinationFor(scenario, firm)}.`,
      figures: [{ label: "Amount", metric: amountMetric(scenario, firm) }],
      primaryLabel:
        mode === "automatic"
          ? "Continue under automatic authority"
          : "Continue after recorded approvals",
    },
    fakeClass: "synthetic-fixture",
  };
}
