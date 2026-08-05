import { signedApprovalPlanSatisfied } from "./build-approval-stages";
import { decisionBindingFor } from "./decision-bindings";
import { evidenceForPass, type FirmData, type JourneyPass, type ScenarioData } from "./data";
import type {
  SignedCaseVariant,
  SignedEvidenceData,
  SignedPreconditionData,
} from "./signed-case-types";
import { timelineFor } from "./timeline";

const HASH = /^[a-f0-9]{64}$/;
const VERIFIED_BANK_FINDING = /\b(?:independently verified|verification (?:confirmed|completed)|verified unchanged)\b/i;
const NEGATED_BANK_FINDING = /\b(?:not(?: yet)? verified|unverified|unavailable|pending|failed)\b/i;

export function isVerifiedPostReviewBankEvidence(
  evidence: SignedEvidenceData,
): boolean {
  return evidence.evidenceKind === "bank-instruction" &&
    evidence.liquidityPhase === "pre-execution-revalidation" &&
    evidence.freshness === "fresh" &&
    VERIFIED_BANK_FINDING.test(evidence.summary) &&
    !NEGATED_BANK_FINDING.test(evidence.summary);
}

function eventIndexes(sourceCase: SignedCaseVariant, type: string): number[] {
  return sourceCase.ledgerEvents.flatMap((event, index) =>
    event.type === type ? [index] : [],
  );
}

function activeDecisionIndex(
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): number {
  const decisions = eventIndexes(sourceCase, "DecisionRecorded");
  return pass === "revalidated" ? (decisions.at(-1) ?? -1) : (decisions[0] ?? -1);
}

function activeApprovalIndexes(
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): number[] {
  return sourceCase.ledgerEvents.flatMap((event, index) =>
    event.type === "ApprovalRecorded" && event.lifecyclePass === pass
      ? [index]
      : [],
  );
}

function durationMilliseconds(value: string): number | null {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  const total = (((days! * 24 + hours!) * 60 + minutes!) * 60 + seconds!) * 1_000;
  return total > 0 ? total : null;
}

function reservationProof(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
): boolean {
  const reservations = sourceCase.executionEligibility.reservations;
  const created = eventIndexes(sourceCase, "ReservationCreated").at(-1) ?? -1;
  const execution = eventIndexes(sourceCase, "ExecutionStarted")[0] ?? Number.MAX_SAFE_INTEGER;
  const released = eventIndexes(sourceCase, "ReservationReleased").some(
    (index) => index > created && index < execution,
  );
  const timeline = timelineFor(scenario, firm);
  const heldFor = Date.parse(timeline.executionAt) - Date.parse(timeline.reservationAt);
  return reservations.length > 0 &&
    reservations.every(
      ({ reservationId, conflictKeys, expiresAfter }) =>
        reservationId.length > 0 &&
        conflictKeys.length > 0 &&
        conflictKeys.every((key) => key.length > 0) &&
        durationMilliseconds(expiresAfter) !== null &&
        heldFor >= 0 &&
        heldFor <= durationMilliseconds(expiresAfter)!,
    ) &&
    created >= 0 &&
    created < execution &&
    !released;
}

export function approvalBindingProof(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): boolean {
  if (sourceCase.authority.stages.length === 0) return sourceCase.authority.mode === "automatic";
  const decisionIndex = activeDecisionIndex(sourceCase, pass);
  const approvals = activeApprovalIndexes(sourceCase, pass);
  const reservation = eventIndexes(sourceCase, "ReservationCreated").at(-1) ?? -1;
  const required = sourceCase.authority.stages.reduce(
    (count, stage) => count + stage.approvalsRequired,
    0,
  );
  const binding = decisionBindingFor(scenario, firm, pass);
  return decisionIndex >= 0 &&
    approvals.length === required &&
    approvals.every((index) => index > decisionIndex && index < reservation) &&
    signedApprovalPlanSatisfied(sourceCase, pass) &&
    HASH.test(binding.decisionHash) &&
    HASH.test(binding.bundleHash);
}

function evidenceProof(
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
  requiredEvidence: readonly string[],
): boolean {
  if (requiredEvidence.length === 0) return false;
  const selected = evidenceForPass(sourceCase, pass);
  if (!requiredEvidence.every((requiredRef) =>
    selected.some(
      (entry) => entry.subjectRef === requiredRef && entry.freshness === "fresh",
    ))) {
    return false;
  }
  const snapshotIndexes = eventIndexes(sourceCase, "EvidenceSnapshotRecorded");
  const decisionIndex = activeDecisionIndex(sourceCase, pass);
  const approvals = activeApprovalIndexes(sourceCase, pass);
  const finalAuthorityIndex = approvals.at(-1) ?? decisionIndex;
  const reservationIndex = eventIndexes(sourceCase, "ReservationCreated").at(-1) ?? Number.MAX_SAFE_INTEGER;
  const invalidated = eventIndexes(sourceCase, "ApprovalInvalidated").at(-1) ?? -1;
  const originalApproval = sourceCase.ledgerEvents.flatMap((event, index) =>
    event.type === "ApprovalRecorded" && event.lifecyclePass === "initial"
      ? [index]
      : [],
  ).at(-1) ?? -1;
  return pass === "revalidated"
    ? snapshotIndexes.some(
        (index) => index > originalApproval && index < invalidated && invalidated < decisionIndex,
      )
    : snapshotIndexes.some(
        (index) => index > finalAuthorityIndex && index < reservationIndex,
      );
}

function refreshedBundleProof(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
  requiredEvidence: readonly string[],
): boolean {
  if (pass !== "revalidated" || !evidenceProof(sourceCase, pass, requiredEvidence)) return false;
  const invalidated = eventIndexes(sourceCase, "ApprovalInvalidated").at(-1) ?? -1;
  const decision = activeDecisionIndex(sourceCase, pass);
  const approvals = activeApprovalIndexes(sourceCase, pass);
  const reservation = eventIndexes(sourceCase, "ReservationCreated").at(-1) ?? -1;
  const original = decisionBindingFor(scenario, firm, "initial");
  const refreshed = decisionBindingFor(scenario, firm, "revalidated");
  return invalidated >= 0 &&
    decision > invalidated &&
    approvals.length > 0 &&
    approvals.every((index) => index > decision && index < reservation) &&
    original.bundleHash !== refreshed.bundleHash &&
    original.decisionHash !== refreshed.decisionHash &&
    approvalBindingProof(scenario, firm, sourceCase, pass);
}

export function executionPreconditionHolds(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
  precondition: SignedPreconditionData,
): boolean {
  if (!precondition.mustStillHoldAtExecution) return true;
  switch (precondition.code) {
    case "material-evidence-fresh-at-execution":
      return evidenceProof(sourceCase, pass, precondition.requiredEvidence);
    case "approval-bound-to-decision-hash":
      return precondition.requiredEvidence.length === 0 &&
        approvalBindingProof(scenario, firm, sourceCase, pass) &&
        sourceCase.ledgerEvents.some(
          (event) => event.type === "DecisionRecorded" && /input-bundle hash/i.test(event.note),
        ) &&
        sourceCase.ledgerEvents.some(
          (event) =>
            event.type === "ApprovalRecorded" &&
            event.lifecyclePass === pass &&
            /decision hash/i.test(event.note),
        );
    case "reservation-still-held":
      return precondition.requiredEvidence.length === 0 &&
        reservationProof(scenario, firm, sourceCase);
    case "bank-instruction-independently-verified":
      return precondition.requiredEvidence.length > 0 &&
        precondition.requiredEvidence.every((requiredRef) =>
          sourceCase.evidence.some(
            (entry) => entry.subjectRef === requiredRef && isVerifiedPostReviewBankEvidence(entry),
          ),
        );
    case "input-bundle-hash-unchanged-since-approval":
      return refreshedBundleProof(
        scenario,
        firm,
        sourceCase,
        pass,
        precondition.requiredEvidence,
      ) && sourceCase.ledgerEvents.some(
        (event) =>
          event.type === "ApprovalInvalidated" &&
          /prior decision hash/i.test(event.note) &&
          /new bundle hash/i.test(event.note),
      );
    default:
      return false;
  }
}

export function executionEligibilityProof(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): boolean {
  return reservationProof(scenario, firm, sourceCase) &&
    approvalBindingProof(scenario, firm, sourceCase, pass) &&
    sourceCase.executionEligibility.preconditions.every((precondition) =>
      executionPreconditionHolds(scenario, firm, sourceCase, pass, precondition),
    );
}
