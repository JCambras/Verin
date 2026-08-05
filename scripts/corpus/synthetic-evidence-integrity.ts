import { epochMs } from "./clock";
import type {
  EmittedCase,
  EmittedRecords,
} from "./synthetic-semantics";

export const evidenceSubjects = (
  item: EmittedCase,
  kind: string,
): Set<string> =>
  new Set(
    item.evidence
      .filter((evidence) => evidence.kind === kind)
      .map((evidence) => evidence.subjectRef),
  );

const citedAuthoritySigners = (item: EmittedCase) => {
  const cited = evidenceSubjects(item, "authority");
  return item.records.authorizedSigners.filter((row) => cited.has(row.id));
};

export const authorityEffective = (item: EmittedCase): boolean => {
  const signers = citedAuthoritySigners(item);
  const signer = signers[0];
  return signers.length === 1 && signer !== undefined &&
    signer.accountRef === item.request.sourceAccountRef &&
    ["full", "distribution-request"].includes(signer.authorityScope) &&
    epochMs(signer.effectiveFrom) <= epochMs(item.trigger.asOf) &&
    (signer.effectiveTo === null ||
      epochMs(signer.effectiveTo) > epochMs(item.trigger.asOf));
};

const destinationVerificationChronology = (
  item: EmittedCase,
  instruction: EmittedRecords["bankInstructions"][number],
): boolean => {
  if (instruction.verifiedAt === null) return true;
  return epochMs(instruction.verifiedAt) <= epochMs(instruction.observedAt) &&
    epochMs(instruction.verifiedAt) <= epochMs(item.trigger.asOf) &&
    (instruction.changedAt === null ||
      epochMs(instruction.changedAt) <= epochMs(instruction.verifiedAt));
};

export const destinationNotIntegral = (item: EmittedCase): boolean => {
  const instruction = item.records.bankInstructions.find(
    (row) => row.id === item.request.destinationRef,
  );
  const cited = evidenceSubjects(item, "bank-instruction");
  return instruction === undefined ||
    instruction.householdRef !== item.request.householdRef ||
    instruction.verifiedAt === null ||
    !destinationVerificationChronology(item, instruction) ||
    item.records.bankInstructions.some(
      (row) =>
        cited.has(row.id) &&
        row.id !== instruction.id &&
        row.bank === instruction.bank &&
        row.lastFour === instruction.lastFour,
    );
};

export const syntheticEvidenceIntegrityProblems = (
  item: EmittedCase,
): string[] => {
  const problems: string[] = [];
  const citedAuthority = evidenceSubjects(item, "authority");
  if (
    citedAuthority.size > 0 &&
    (
      citedAuthority.size !== 1 ||
      citedAuthoritySigners(item).length !== 1
    )
  ) {
    problems.push(
      `${item.caseId}: authority semantics require exactly one cited signer`,
    );
  }
  const destination = item.records.bankInstructions.find(
    (entry) => entry.id === item.request.destinationRef,
  );
  if (
    destination !== undefined &&
    destination.verifiedAt !== null &&
    !destinationVerificationChronology(item, destination)
  ) {
    problems.push(
      `${item.caseId}: destination verification chronology is invalid`,
    );
  }
  return problems;
};
