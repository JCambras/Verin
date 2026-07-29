import type { SafetyCheckVM } from "./model";

export function buildBankInstructionSafetyCheck(
  evidenceSummary: string | null,
): SafetyCheckVM {
  return evidenceSummary === null
    ? {
        label: "Bank-instruction check not evaluated",
        status: "pending",
        statusLabel: "Evidence unavailable",
        detail:
          "Exact signed bank-instruction evidence is unavailable. No unchanged claim was made.",
      }
    : {
        label: "Bank instruction unchanged since the decision",
        status: "done",
        statusLabel: "Verified",
        detail: evidenceSummary,
      };
}
