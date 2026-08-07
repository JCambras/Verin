import {
  instructionConflictAnalysis,
  type InstructionConflictAnalysis,
} from "./instruction-conflicts";
import type { EmittedCase } from "./synthetic-semantics";
import type { WorldSpec } from "./world";

export function syntheticInstructionConflictAnalysis(
  item: EmittedCase,
): InstructionConflictAnalysis {
  const cited = new Set(
    item.evidence
      .filter((evidence) =>
        ["household-instruction", "restriction"].includes(evidence.kind)
      )
      .map((evidence) => evidence.subjectRef),
  );
  const destinations = [
    ...item.records.bankInstructions,
    ...item.records.referencedBankInstructions,
  ].filter((instruction) => instruction.id === item.request.destinationRef);
  return instructionConflictAnalysis(
    {
      firmRef: item.request.firmRef,
      requestRef: item.request.requestRef,
      householdRef: item.request.householdRef,
      action: item.request.action,
      sourceAccountRef: item.request.sourceAccountRef,
      destinationRef: item.request.destinationRef,
      destinationSubjectRefs: destinations.map(
        (instruction) => instruction.titledTo,
      ),
    },
    item.records.restrictions
      .filter((restriction) =>
        cited.has(restriction.id) && restriction.inForceAtAsOf
      )
      .map((restriction) => ({
        instructionRef: restriction.id,
        firmRef: restriction.firmRef,
        householdRef: restriction.householdRef,
        term: restriction.term,
      })),
  );
}

export function restrictionReferenceProblems(
  world: WorldSpec,
): string[] {
  const problems: string[] = [];
  const householdByKey = new Map(
    world.households.map((household) => [household.key, household]),
  );
  const accountByKey = new Map(
    world.accounts.map((account) => [account.key, account]),
  );
  const parties = new Set(world.parties.map((party) => party.key));
  const instructions = new Set(
    world.bankInstructions.map((instruction) => instruction.key),
  );
  const need = (
    exists: boolean,
    ref: string,
    where: string,
  ): void => {
    if (!exists) problems.push(`${where} -> "${ref}" does not resolve`);
  };
  const needOwnedAccount = (
    ref: string,
    householdRef: string,
    where: string,
    noun: string,
  ): void => {
    const account = accountByKey.get(ref);
    need(account !== undefined, ref, where);
    if (account !== undefined && account.householdRef !== householdRef) {
      problems.push(
        `${where}: ${noun} belongs to household "${account.householdRef}", not restriction household "${householdRef}"`,
      );
    }
  };
  for (const restriction of world.restrictions) {
    const prefix = `restrictions[${restriction.key}]`;
    const household = householdByKey.get(restriction.householdRef);
    need(
      household !== undefined,
      restriction.householdRef,
      `${prefix}.householdRef`,
    );
    const where = `${prefix}.subjectRef`;
    if (restriction.scope === "household") {
      need(
        householdByKey.has(restriction.subjectRef),
        restriction.subjectRef,
        where,
      );
      if (restriction.subjectRef !== restriction.householdRef) {
        problems.push(
          `${where}: household restriction subject must equal its declared household`,
        );
      }
    } else if (restriction.scope === "party") {
      need(parties.has(restriction.subjectRef), restriction.subjectRef, where);
      if (
        parties.has(restriction.subjectRef) &&
        household !== undefined &&
        !household.memberRefs.includes(restriction.subjectRef)
      ) {
        problems.push(
          `${where}: party does not belong to the restriction household`,
        );
      }
    } else if (restriction.scope === "account") {
      needOwnedAccount(
        restriction.subjectRef,
        restriction.householdRef,
        where,
        "restriction account",
      );
    } else {
      problems.push(
        `${where}: scope "position" has no modeled subject form - use a position-scoped legal hold, or extend the spec and the household subgraph together`,
      );
    }
    const term = restriction.term;
    if (term === undefined) continue;
    needOwnedAccount(
      term.sourceAccountRef,
      restriction.householdRef,
      `${prefix}.term.sourceAccountRef`,
      "instruction source account",
    );
    const targetWhere = `${prefix}.term.targetRef`;
    if (term.targetKind === "source-account") {
      needOwnedAccount(
        term.targetRef,
        restriction.householdRef,
        targetWhere,
        "instruction target account",
      );
    } else if (term.targetKind === "destination-instruction") {
      need(instructions.has(term.targetRef), term.targetRef, targetWhere);
    } else {
      need(parties.has(term.targetRef), term.targetRef, targetWhere);
    }
  }
  return problems;
}
