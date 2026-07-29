import { buildBankInstructionSafetyCheck } from "./build-safety-check";
import {
  evidenceForPass,
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
  if (
    hasSignedInvalidationAuthority(scenario, firm.id) &&
    pass !== "revalidated"
  ) {
    return {
      reached: false,
      reason: "Material evidence changed, so the original authority is void.",
    };
  }
  const sourceCase = sourceCaseFor(scenario, firm.id);
  if (!sourceCase) {
    return {
      reached: false,
      reason: "Exact signed case authority is unavailable.",
    };
  }
  const selectedEvidence = evidenceForPass(sourceCase, pass);
  const bankInstructionCheck = buildBankInstructionSafetyCheck(
    sourceCase.evidence.filter(
      (entry) => entry.evidenceKind === "bank-instruction",
    ),
  );
  for (const precondition of eligibility.preconditions) {
    if (!precondition.mustStillHoldAtExecution) continue;
    const hasEveryEvidence = precondition.requiredEvidence.every(
      (requiredRef) =>
        selectedEvidence.some(
          (entry) => entry.subjectRef === requiredRef,
        ),
    );
    const hasExactFinding =
      precondition.code !== "bank-instruction-independently-verified" ||
      bankInstructionCheck.status === "done";
    if (!hasEveryEvidence || !hasExactFinding) {
      return {
        reached: false,
        reason: `Execution precondition ${precondition.code} lacks exact signed proof.`,
      };
    }
  }
  return { reached: true, reason: null };
}
