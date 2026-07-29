import type {
  Confidence,
  RecordProvenance,
} from "@contracts/provenance";
import {
  BANK_INSTRUCTION,
  DEMO_EVIDENCE_REF,
  DEMO_REVALIDATION_EVIDENCE_REF,
  DESTINATION_RESTRICTION,
  GC15_PENDING_DISTRIBUTION,
  OBSERVED_GC09_BALANCE,
  OBSERVED_RECENT,
  OBSERVED_STALE,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  type ScenarioData,
} from "./data";

export interface DemoEvidenceValue<T> {
  readonly sourceRef: string;
  readonly subjectRef: string;
  readonly value: T;
  readonly provenance: RecordProvenance;
}

export interface DecisionEvidenceSnapshot {
  readonly phase: "initial" | "revalidation";
  readonly ref: string;
  readonly retrievedAt: string;
  readonly availableCash: DemoEvidenceValue<number>;
  readonly pendingApprovedActivity: DemoEvidenceValue<number>;
  readonly plannedMonthlyWithdrawal: DemoEvidenceValue<number>;
  readonly bankInstruction: DemoEvidenceValue<{
    readonly destination: string;
    readonly independentlyVerified: boolean;
  }>;
  readonly destinationRestriction: DemoEvidenceValue<{
    readonly ref: string;
    readonly text: string;
  }>;
  readonly conflictingFundingInstructions: readonly DemoEvidenceValue<string>[];
}

function evidenceValue<T>(
  sourceRef: string,
  subjectRef: string,
  value: T,
  observedAt: string,
  confidence: Confidence = "high",
): DemoEvidenceValue<T> {
  return {
    sourceRef,
    subjectRef,
    value,
    provenance: {
      source: "fixture",
      asOf: observedAt,
      confidence,
    },
  };
}

export function decisionEvidenceSnapshotFor(
  scenario: ScenarioData,
  phase: DecisionEvidenceSnapshot["phase"] = "initial",
): DecisionEvidenceSnapshot {
  if (phase === "revalidation" && scenario.spec.invalidation !== true) {
    throw new Error(
      "A refreshed evidence snapshot requires a material-change scenario",
    );
  }
  const stalePlannedWithdrawals =
    scenario.spec.stalePlannedWithdrawals === true;
  const bankChanged = scenario.spec.bankChanged === true;
  const pending =
    phase === "initial"
      ? GC15_PENDING_DISTRIBUTION.before
      : GC15_PENDING_DISTRIBUTION.after;
  return {
    phase,
    ref:
      phase === "initial"
        ? DEMO_EVIDENCE_REF
        : DEMO_REVALIDATION_EVIDENCE_REF,
    retrievedAt: pending.retrievedAt,
    availableCash: evidenceValue(
      "house-crm:account-balance",
      "subject:smiths-joint-taxable",
      SMITHS_LIQUIDITY.availableMinor,
      stalePlannedWithdrawals
        ? `${OBSERVED_GC09_BALANCE}T06:00:00-04:00`
        : `${OBSERVED_RECENT}T06:00:00-04:00`,
    ),
    pendingApprovedActivity: evidenceValue(
      "house-crm:pending-approved-activity",
      "subject:smiths-household",
      pending.amountMinor,
      pending.observedAt,
    ),
    plannedMonthlyWithdrawal: evidenceValue(
      "house-crm:planned-withdrawals",
      "subject:smiths-household",
      PLANNED_WITHDRAWAL_MONTHLY_MINOR,
      stalePlannedWithdrawals
        ? `${OBSERVED_STALE}T08:00:00-04:00`
        : `${OBSERVED_RECENT}T06:00:00-04:00`,
    ),
    bankInstruction: evidenceValue(
      "house-crm:bank-instruction",
      "bank-instruction:smiths-primary",
      {
        destination: bankChanged
          ? BANK_INSTRUCTION.changed
          : BANK_INSTRUCTION.stable,
        independentlyVerified: !bankChanged,
      },
      bankChanged
        ? `${BANK_INSTRUCTION.changedOn}T14:12:00-04:00`
        : "2026-05-20T10:00:00-04:00",
    ),
    destinationRestriction: evidenceValue(
      "house-crm:household-instruction",
      "subject:smiths-household",
      DESTINATION_RESTRICTION,
      "2026-05-10T10:00:00-04:00",
    ),
    conflictingFundingInstructions:
      scenario.spec.conflictingInstruction === true
        ? [
            evidenceValue(
              "house-crm:household-instruction",
              "household-instruction:smiths-renovation-source",
              "Renovation costs are paid from the Joint Taxable account",
              "2026-03-02T10:00:00-05:00",
              "medium",
            ),
            evidenceValue(
              "house-crm:household-instruction",
              "household-instruction:smiths-large-needs-source",
              "Large one-time needs are funded from the Smith Family Taxable account",
              "2026-07-10T10:00:00-04:00",
              "medium",
            ),
          ]
        : [],
  };
}
