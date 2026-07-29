import { DISPOSITION_LABELS, type PolicyTraceVM } from "./model";
import { buildSpine } from "./spine";
import {
  dispositionFor,
  sourceCaseFor,
  type FirmData,
  type ScenarioData,
} from "./data";

const dispositionBadges = {
  proceed: { status: "proceed", label: DISPOSITION_LABELS.proceed },
  blocked: { status: "blocked", label: DISPOSITION_LABELS.blocked },
  prohibited: { status: "prohibited", label: DISPOSITION_LABELS.prohibited },
} as const;

function reserveHorizonWord(firm: FirmData): string {
  return firm.reserveMonths === 6 ? "six" : "twelve";
}

export function buildExactPolicyTrace(
  scenario: ScenarioData,
  firm: FirmData,
  reserveHolds: boolean | null,
): PolicyTraceVM {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const prohibition = sourceCase?.prohibition;
  const policy =
    sourceCase?.policyVersions.firmPolicyVersionId ?? firm.policyVersion;
  const instructionVersions =
    sourceCase?.policyVersions.householdInstructionVersionIds ?? [];
  const instructionResult = sourceCase?.householdInstructions.length
    ? sourceCase.householdInstructions
        .map(({ summary }) => summary)
        .join(" ")
    : "Exact signed source unavailable";
  const staleEvidence = sourceCase?.evidence.some(
    (entry) => entry.freshness === "stale",
  );
  const specialistReview = sourceCase?.authority.stages.some(
    (stage) => stage.stageId === "bank-change-specialist-review",
  );
  const blockedBankChange =
    sourceCase?.disposition === "blocked" &&
    sourceCase.evidence.some(
      (entry) => entry.evidenceKind === "bank-instruction",
    ) &&
    !staleEvidence;
  const dualApproval = sourceCase?.authority.stages.some(
    (stage) => stage.stageId === "ops-dual-approval",
  );
  const householdViolation =
    prohibition?.source.sourceType === "household_instruction";
  const controllingProhibition =
    prohibition && !householdViolation
      ? {
          rule:
            prohibition.source.sourceType === "regulatory"
              ? "Regulatory legal hold"
              : "Firm prohibition",
          result: prohibition.explanation,
          version: prohibition.source.versionId,
          why: {
            reason: prohibition.explanation,
            ...(prohibition.source.sourceType === "regulatory"
              ? { regulation: prohibition.source.versionId }
              : {}),
          },
        }
      : null;
  const rows: Omit<PolicyTraceVM["rows"][number], "order">[] = [
    ...(controllingProhibition ? [controllingProhibition] : []),
    {
      rule: "Household destination restriction",
      result: householdViolation
        ? prohibition.explanation
        : instructionResult,
      version:
        instructionVersions.join(", ") ||
        (householdViolation
          ? prohibition.source.versionId
          : "Exact signed source unavailable"),
      why: {
        reason: householdViolation
          ? prohibition.explanation
          : "Household instructions are evaluated independently and remain visible when a higher-precedence source controls the outcome.",
      },
    },
    {
      rule: "Cash-reserve floor (months of planned withdrawals)",
      result: staleEvidence
        ? "Cannot evaluate - liquidity evidence is older than policy allows"
        : reserveHolds === null
          ? "Cannot display - no signed numeric liquidity case covers this branch and firm"
          : reserveHolds
            ? "Satisfied after this movement"
            : "Breached - this movement would leave the household below the floor",
      version: policy,
      why: {
        reason: `${firm.name} preserves ${reserveHorizonWord(firm)} months of planned withdrawals in cash.`,
        regulation: `Firm policy ${policy}`,
      },
    },
    {
      rule: "Recent bank-instruction change handling",
      result: specialistReview
        ? "Specialist review required before execution"
        : blockedBankChange
          ? "Blocked until independently verified"
          : "Not triggered - no recent change",
      version: policy,
    },
    {
      rule: "Dual-approval threshold",
      result: dualApproval
        ? "Triggered - two distinct operations approvers required"
        : sourceCase?.authority.mode === "automatic"
          ? "Not triggered at this amount"
          : "Exact signed authority unavailable",
      version: policy,
    },
  ];
  return {
    spine: buildSpine(
      "Decision",
      dispositionBadges[dispositionFor(scenario, firm.id)],
    ),
    domainConfigVersion:
      sourceCase?.policyVersions.domainConfigVersionId ??
      "Exact signed source unavailable",
    firmPolicyVersion: policy,
    householdInstructionVersions: instructionVersions,
    regulatoryVersion:
      sourceCase?.policyVersions.regulatoryVersionId ?? null,
    rows: rows.map((row, index) => ({ ...row, order: index + 1 })),
    fakeClass: "deterministic-engine-output",
  };
}
