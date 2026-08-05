import type { FirmData, JourneyPass, ScenarioData } from "./data";
import {
  approvalProofResult,
  evidenceProofResult,
  preExecutionEvidence,
} from "./execution-binding-proofs";
import { proof, type ProofResult } from "./execution-proof-shared";
import {
  refreshedBundleProofResult,
  reservationProofResult,
} from "./execution-reservation-proofs";
import type {
  SignedCaseVariant,
  SignedEvidenceData,
  SignedPreconditionData,
} from "./signed-case-types";

const VERIFIED_BANK_FINDING = /\b(?:independently verified|verification (?:confirmed|completed)|verified unchanged)\b/i;
const NEGATED_BANK_FINDING = /\b(?:not(?: yet)? verified|unverified|unavailable|pending|failed)\b/i;
const EVENT_FIELD_GAP = /^(expectedLedgerEvents\[\d+\] \S+) lacks exact structured (.+)$/;

export const STRUCTURED_EXECUTION_BINDINGS_WITHHELD =
  "Execution is withheld pending captain-signed structured event bindings.";

export function isVerifiedPostReviewBankEvidence(
  evidence: SignedEvidenceData,
): boolean {
  return evidence.evidenceKind === "bank-instruction" &&
    evidence.liquidityPhase === "pre-execution-revalidation" &&
    evidence.freshness === "fresh" &&
    VERIFIED_BANK_FINDING.test(evidence.summary) &&
    !NEGATED_BANK_FINDING.test(evidence.summary);
}

function preconditionProofResult(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
  precondition: SignedPreconditionData,
): ProofResult {
  if (!precondition.mustStillHoldAtExecution) return proof([]);
  switch (precondition.code) {
    case "material-evidence-fresh-at-execution":
      return evidenceProofResult(
        scenario,
        firm,
        sourceCase,
        pass,
        precondition.requiredEvidence,
      );
    case "approval-bound-to-decision-hash":
      return precondition.requiredEvidence.length === 0
        ? approvalProofResult(scenario, firm, sourceCase, pass)
        : proof(["Approval hash-binding precondition unexpectedly names evidence"]);
    case "reservation-still-held":
      return precondition.requiredEvidence.length === 0
        ? reservationProofResult(scenario, firm, sourceCase, pass)
        : proof(["Reservation precondition unexpectedly names evidence"]);
    case "bank-instruction-independently-verified": {
      const evidence = evidenceProofResult(
        scenario,
        firm,
        sourceCase,
        pass,
        precondition.requiredEvidence,
      );
      const selected = preExecutionEvidence(
        sourceCase,
        precondition.requiredEvidence,
      );
      return proof([
        ...evidence.gaps,
        ...(selected.length > 0 && selected.every(isVerifiedPostReviewBankEvidence)
          ? []
          : ["Pre-execution bank evidence lacks a fresh positive independent-verification finding"]),
      ]);
    }
    case "input-bundle-hash-unchanged-since-approval":
      return refreshedBundleProofResult(
        scenario,
        firm,
        sourceCase,
        pass,
        precondition.requiredEvidence,
      );
    default:
      return proof([`Unknown must-hold precondition code ${precondition.code}`]);
  }
}

export function approvalBindingProof(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): boolean {
  return approvalProofResult(scenario, firm, sourceCase, pass).ok;
}

export function executionProofGaps(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): readonly string[] {
  const results = [
    reservationProofResult(scenario, firm, sourceCase, pass),
    approvalProofResult(scenario, firm, sourceCase, pass),
    ...sourceCase.executionEligibility.preconditions.map((precondition) =>
      preconditionProofResult(
        scenario,
        firm,
        sourceCase,
        pass,
        precondition,
      ),
    ),
  ];
  return [
    ...new Set([
      ...(sourceCase.executionEligibility.eligible
        ? []
        : [sourceCase.executionEligibility.reason]),
      ...results.flatMap(({ gaps }) => gaps),
    ]),
  ];
}

export function executionProofGapReason(
  gaps: readonly string[],
): string {
  const eventFields = new Map<string, string[]>();
  const other: string[] = [];
  for (const gap of gaps) {
    const match = gap.match(EVENT_FIELD_GAP);
    if (!match) {
      other.push(gap);
      continue;
    }
    const fields = eventFields.get(match[1]!) ?? [];
    fields.push(match[2]!);
    eventFields.set(match[1]!, fields);
  }
  const grouped = [...eventFields].map(
    ([event, fields]) =>
      `${event} missing structured fields: ${fields.join(", ")}`,
  );
  return `Missing signed structured execution bindings: ${[...grouped, ...other].join("; ")}. ${STRUCTURED_EXECUTION_BINDINGS_WITHHELD}`;
}

export function executionEligibilityProof(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): boolean {
  return executionProofGaps(scenario, firm, sourceCase, pass).length === 0;
}
