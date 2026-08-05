import {
  buildBankInstructionSafetyCheck,
  POST_REVIEW_BANK_EVIDENCE_WITHHELD,
} from "./build-safety-check";
import {
  approvalBindingProof,
  executionEligibilityProof,
} from "./execution-preconditions";
import { SIGNED_APPROVAL_BINDINGS_WITHHELD } from "./build-approval-stages";
import {
  executionEligibilityFor,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

export interface ExecutionReach {
  readonly reached: boolean;
  readonly reason: string | null;
}

export function executionReachFor(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): ExecutionReach {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  if (sourceCase?.authorityGap?.execution === "withheld") {
    return {
      reached: false,
      reason: sourceCase.authorityGap.reason,
    };
  }
  const authority = liquidityAuthorityFor(scenario, firm.id);
  if (authority.kind === "missing") {
    return { reached: false, reason: authority.reason };
  }
  const eligibility = executionEligibilityFor(scenario, firm.id);
  if (eligibility?.eligible !== true) {
    return {
      reached: false,
      reason:
        eligibility?.reason ??
        "Exact signed execution eligibility is unavailable.",
    };
  }
  if (!sourceCase) {
    return {
      reached: false,
      reason: "Exact signed case authority is unavailable.",
    };
  }
  if (
    sourceCase.authority.stages.length > 0 &&
    !approvalBindingProof(scenario, firm, sourceCase, pass)
  ) {
    return {
      reached: false,
      reason: SIGNED_APPROVAL_BINDINGS_WITHHELD,
    };
  }
  if (
    hasSignedInvalidationAuthority(scenario, firm.id) &&
    pass !== "revalidated"
  ) {
    return {
      reached: false,
      reason: "Material evidence changed, so the original authority is void.",
    };
  }
  const bankInstructionCheck = buildBankInstructionSafetyCheck(
    sourceCase.evidence.filter(
      (entry) => entry.evidenceKind === "bank-instruction",
    ),
    eligibility.preconditions,
  );
  if (!executionEligibilityProof(scenario, firm, sourceCase, pass)) {
    const unmet = eligibility.preconditions.find(
      (precondition) =>
        precondition.mustStillHoldAtExecution &&
        precondition.code === "bank-instruction-independently-verified" &&
        bankInstructionCheck.status !== "done",
    );
    return {
      reached: false,
      reason:
        unmet
          ? POST_REVIEW_BANK_EVIDENCE_WITHHELD
          : "Execution eligibility lacks exact signed proof for every active must-hold condition.",
    };
  }
  return { reached: true, reason: null };
}
