import {
  headroomMinor,
  reserveFloorMinor,
} from "@contracts/money-movement";
import type { DemoPolicyRerunResultVM } from "./model";
import {
  dispositionFor,
  liquidityAuthorityFor,
  plannedWithdrawalEvidenceFor,
  requestFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

export const DRAFT_RESERVE_MONTHS = 12;

export function evaluatePolicyRerun(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
  policyVersion: string,
  reserveMonths = DRAFT_RESERVE_MONTHS,
): DemoPolicyRerunResultVM | null {
  const planned = plannedWithdrawalEvidenceFor(scenario, firm.id, pass);
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  if (
    !planned?.displayValue ||
    authority.kind !== "signed" ||
    !sourceCase
  ) {
    return null;
  }
  const snapshot =
    pass === "revalidated"
      ? (authority.preExecutionRevalidation ?? authority.initialDecision)
      : authority.initialDecision;
  const floor = reserveFloorMinor(
    planned.displayValue.valueMinor,
    reserveMonths,
  );
  const headroom = headroomMinor(
    snapshot.availableCashMinor,
    snapshot.pendingActivityMinor,
    floor,
  );
  const request = requestFor(scenario, firm.id);
  const currentDisposition = dispositionFor(scenario, firm.id);
  const disposition =
    currentDisposition === "proceed" && headroom < request.amountMinor
      ? "blocked"
      : currentDisposition;
  const executionEligible =
    disposition === "proceed" &&
    sourceCase.executionEligibility.eligible;
  const executionReason =
    disposition === "blocked" && currentDisposition === "proceed"
      ? "The activated twelve-month reserve leaves insufficient post-reserve liquidity for this request."
      : disposition !== "proceed"
        ? sourceCase.executionEligibility.reason
        : executionEligible
          ? "The activated reserve rule permits a candidate execution plan; new authority and safety checks remain required before execution."
          : sourceCase.executionEligibility.reason;
  const horizon = reserveMonths === 12
    ? "twelve-month"
    : `${reserveMonths}-month`;
  const explanations = [
    {
      code: "activated-reserve-evaluation",
      summary: `Activated policy ${policyVersion} applies a ${horizon} reserve floor of ${floor} minor units and derives ${headroom} minor units of headroom.`,
    },
    disposition === "blocked" && currentDisposition === "proceed"
      ? {
          code: "activated-reserve-insufficient-liquidity",
          summary: `The activated ${horizon} reserve leaves ${headroom} minor units of headroom for a ${request.amountMinor} minor-unit request, so the derived decision is blocked.`,
        }
      : currentDisposition !== "proceed"
        ? {
            code: "activated-policy-disposition-preserved",
            summary: `Activated policy ${policyVersion} does not supersede the signed ${currentDisposition} disposition, so the derived decision remains ${disposition}.`,
          }
        : executionEligible
          ? {
              code: "activated-reserve-candidate-plan",
              summary: `The activated ${horizon} reserve covers the ${request.amountMinor} minor-unit request, so the derived decision permits a candidate execution plan subject to new authority and safety checks.`,
            }
          : {
              code: "activated-reserve-execution-withheld",
              summary: `The activated ${horizon} reserve covers the request, but the derived decision keeps execution withheld: ${executionReason}`,
            },
  ];
  return {
    disposition,
    reserveFloorMinor: floor,
    headroomMinor: headroom,
    executionEligible,
    executionReason,
    explanations,
    executionPlan: executionEligible
      ? {
          action: "money-movement",
          sourceCaseId: sourceCase.caseId,
          requestRef: sourceCase.trigger.requestRef,
          amountMinor: request.amountMinor,
          policyVersion,
        }
      : null,
  };
}
