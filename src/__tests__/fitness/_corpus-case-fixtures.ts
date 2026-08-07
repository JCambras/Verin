import { pendingAvailabilitySelector } from "../../../scripts/corpus/pending-actions";
import {
  loadRealDerivedSemanticContract,
  semanticTreatment,
  type SemanticDefectRule,
} from "../../../scripts/corpus/semantic-contract";
import { canonicalJson } from "../../../src/contracts/decision-core/serialization";

// ── shared fixtures for the companions ─────────────────────────────────────────

const TOKEN = "tok:0123456789abcdef";
export const TOKEN_ALT = "tok:fedcba9876543210";
export const OPAQUE = TOKEN;
export const FIRM_REF = `firm:${TOKEN}`;
export const FIRM_REF_ALT = `firm:${TOKEN_ALT}`;
export const REQUEST_REF = `request:${TOKEN}`;
export const HOUSEHOLD_REF = `household:${TOKEN}`;
export const HOUSEHOLD_REF_ALT = `household:${TOKEN_ALT}`;
export const ACCOUNT_REF = `account:${TOKEN}`;
export const ACCOUNT_REF_ALT = `account:${TOKEN_ALT}`;
export const INSTRUCTION_REF = `instruction:${TOKEN}`;
export const INSTRUCTION_REF_ALT = `instruction:${TOKEN_ALT}`;
export const OWNER_REF = `owner:${TOKEN}`;
export const OWNER_REF_ALT = `owner:${TOKEN_ALT}`;
export const ACTOR_REF = `actor:${TOKEN}`;
export const ACTOR_REF_ALT = `actor:${TOKEN_ALT}`;
export const GRANT_REF = `grant:${TOKEN}`;
export const POLICY_REF = `policy:${TOKEN}`;
export const POLICY_VERSION_REF = `policy-version:${TOKEN}`;
export const RESTRICTION_REF = `restriction:${TOKEN}`;
export const LEGAL_HOLD_REF = `legal-hold:${TOKEN}`;
export const PENDING_ACTION_REF = `pending-action:${TOKEN}`;
export const TIME_ZONE_RULE_REF = `time-zone-rule:${TOKEN}`;
export const EVIDENCE_SOURCE_REF = `evidence-source:${TOKEN}`;
export const EVIDENCE_SOURCE_REF_ALT = `evidence-source:${TOKEN_ALT}`;
export const semanticContract = loadRealDerivedSemanticContract();
const treatmentSelectorValue = (
  rule: SemanticDefectRule,
  payload: Record<string, any>,
): string => {
  switch (rule.treatmentSelector) {
    case "fixed":
      return "fixed";
    case "authority-state":
      return payload.authority.authorityState === "effective"
        ? "effective"
        : "ineffective";
    case "reserve-state":
      return payload.liquidity.reserveState;
    case "pending-availability":
      return payload.liquidity.pendingAction.actionKind === null
        ? "unchanged"
        : pendingAvailabilitySelector(
            payload.liquidity.pendingAction.actionKind,
            payload.liquidity.pendingAction.actionState,
            payload.liquidity.pendingAction.availableMinorIncludesAction,
          );
    case "threshold-comparator":
      return payload.policy.thresholdComparator;
  }
};
export const treatmentOutcomes = (
  payload: Record<string, any>,
  defectClassId?: string,
): Array<Record<string, string>> =>
  semanticContract.defectRules.map((entry) => {
    const treatment = semanticTreatment(
      entry,
      treatmentSelectorValue(entry, payload),
    );
    return {
      defectClassId: entry.id,
      expectedTreatment: treatment.expectedTreatment,
      observedTreatment:
        entry.id === defectClassId
          ? treatment.defectTreatment
          : treatment.expectedTreatment,
    };
  });
export const canonicalFixtureBytes = (value: unknown): string => {
  const result = canonicalJson(value as any);
  if (!result.ok) throw result.error;
  return `${result.value}\n`;
};

export const observedEvidence = (
  evidenceKind: string,
  subjectRef: string,
  sourceRef: string = EVIDENCE_SOURCE_REF,
  token: string = TOKEN,
): Record<string, unknown> => ({
  id: `evs:${token}:${evidenceKind}`,
  evidenceKind,
  subjectRef,
  sourceRef,
  observationState: "observed",
  observedAt: "2026-04-28T05:00:00.000Z",
  retrievedAt: "2026-04-28T13:00:04.000Z",
  freshness: "fresh",
});

export const baselineEvidence = (): Array<Record<string, unknown>> => [
  observedEvidence("request", REQUEST_REF),
  observedEvidence("identity-resolution", ACTOR_REF),
  observedEvidence("bank-instruction", INSTRUCTION_REF),
  observedEvidence("balance", ACCOUNT_REF),
  observedEvidence("planned-withdrawals", HOUSEHOLD_REF),
  observedEvidence("authority", GRANT_REF),
  observedEvidence("policy", POLICY_VERSION_REF),
  observedEvidence("household-instruction", HOUSEHOLD_REF),
  observedEvidence("tax-review", REQUEST_REF),
  observedEvidence("time-zone-rule", TIME_ZONE_RULE_REF),
  observedEvidence("execution-precondition", REQUEST_REF),
];
