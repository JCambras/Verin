import type { SafetyCheckVM } from "./model";
import type {
  SignedEvidenceData,
  SignedPreconditionData,
} from "./signed-case-types";

export const POST_REVIEW_BANK_EVIDENCE_WITHHELD =
  "Signed post-review bank-instruction evidence is absent. Execution is withheld pending captain-signed evidence.";

export function buildBankInstructionSafetyCheck(
  evidence: readonly SignedEvidenceData[],
  preconditions: readonly SignedPreconditionData[] = [],
): SafetyCheckVM {
  const executionRequiresIndependentVerification =
    preconditions.some(
      (precondition) =>
        precondition.mustStillHoldAtExecution &&
        precondition.code ===
          "bank-instruction-independently-verified",
    );
  const initialEvidence = evidence.find(
    (entry) =>
      entry.liquidityPhase !== "pre-execution-revalidation",
  );
  const postReviewEvidence = evidence.find(
    (entry) =>
      entry.liquidityPhase === "pre-execution-revalidation",
  );
  if (postReviewEvidence) {
    return {
      label: "Bank-instruction post-review finding recorded",
      status: "done",
      statusLabel: "Recorded",
      detail: postReviewEvidence.summary,
    };
  }
  if (initialEvidence) {
    return {
      label: "Bank-instruction revalidation not evaluated",
      status: "pending",
      statusLabel: "Post-review evidence unavailable",
      detail: executionRequiresIndependentVerification
        ? `${initialEvidence.summary} ${POST_REVIEW_BANK_EVIDENCE_WITHHELD} No unchanged or Verified claim is made.`
        : `${initialEvidence.summary} No exact signed post-review result was recorded, so no unchanged or Verified claim was made.`,
    };
  }
  return {
    label: "Bank-instruction check not evaluated",
    status: "pending",
    statusLabel: "Evidence unavailable",
    detail:
      "Exact signed bank-instruction evidence is unavailable. No unchanged or Verified claim was made.",
  };
}
