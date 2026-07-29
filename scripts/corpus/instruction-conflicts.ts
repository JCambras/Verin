export const GOVERNED_INSTRUCTION_ACTIONS = ["distribution"] as const;
export const INSTRUCTION_POLARITIES = ["required", "forbidden"] as const;
export const INSTRUCTION_TARGET_KINDS = [
  "source-account",
  "destination-instruction",
  "destination-subject",
  "request",
] as const;

export type GovernedInstructionAction =
  (typeof GOVERNED_INSTRUCTION_ACTIONS)[number];
export type InstructionPolarity =
  (typeof INSTRUCTION_POLARITIES)[number];
export type InstructionTargetKind =
  (typeof INSTRUCTION_TARGET_KINDS)[number];

export interface InstructionTerm {
  readonly governedAction: GovernedInstructionAction;
  readonly sourceAccountRef: string;
  readonly targetKind: InstructionTargetKind;
  readonly targetRef: string;
  readonly polarity: InstructionPolarity;
}

export interface GovernedInstructionRequest {
  readonly firmRef: string;
  readonly requestRef: string;
  readonly householdRef: string;
  readonly action: GovernedInstructionAction;
  readonly sourceAccountRef: string;
  readonly destinationRef: string;
  readonly destinationSubjectRefs: readonly string[];
}

export interface InstructionWitness {
  readonly instructionRef: string;
  readonly firmRef: string;
  readonly householdRef: string;
  readonly term: InstructionTerm | null;
}

export interface InstructionConflictAnalysis {
  readonly present: boolean;
  readonly problems: readonly string[];
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export function instructionConflictAnalysis(
  request: GovernedInstructionRequest,
  instructions: readonly InstructionWitness[],
): InstructionConflictAnalysis {
  const problems: string[] = [];
  const requestValues = [
    request.firmRef,
    request.requestRef,
    request.householdRef,
    request.sourceAccountRef,
    request.destinationRef,
  ];
  if (
    requestValues.some((value) => !nonEmpty(value)) ||
    !GOVERNED_INSTRUCTION_ACTIONS.includes(request.action) ||
    request.destinationSubjectRefs.length !== 1 ||
    !nonEmpty(request.destinationSubjectRefs[0])
  ) {
    return {
      present: false,
      problems: ["instruction conflict request is incomplete or ambiguous"],
    };
  }
  const seen = new Set<string>();
  let present = false;
  for (const instruction of instructions) {
    if (!nonEmpty(instruction.instructionRef)) {
      problems.push("instruction conflict witness has no exact reference");
      continue;
    }
    if (seen.has(instruction.instructionRef)) {
      problems.push("instruction conflict witness references are ambiguous");
      continue;
    }
    seen.add(instruction.instructionRef);
    if (
      instruction.firmRef !== request.firmRef ||
      instruction.householdRef !== request.householdRef
    ) {
      problems.push(
        "instruction conflict witness is outside the request tenant or household",
      );
      continue;
    }
    const term = instruction.term;
    if (term === null) continue;
    if (
      !GOVERNED_INSTRUCTION_ACTIONS.includes(term.governedAction) ||
      !INSTRUCTION_POLARITIES.includes(term.polarity) ||
      !INSTRUCTION_TARGET_KINDS.includes(term.targetKind) ||
      !nonEmpty(term.sourceAccountRef) ||
      !nonEmpty(term.targetRef)
    ) {
      problems.push("instruction conflict witness has an incomplete typed term");
      continue;
    }
    if (
      term.governedAction !== request.action ||
      term.sourceAccountRef !== request.sourceAccountRef
    ) {
      continue;
    }
    const targetMatches = term.targetKind === "source-account"
      ? term.targetRef === request.sourceAccountRef
      : term.targetKind === "destination-instruction"
        ? term.targetRef === request.destinationRef
        : term.targetKind === "destination-subject"
          ? request.destinationSubjectRefs.includes(term.targetRef)
          : term.targetRef === request.requestRef;
    if (
      (term.polarity === "required" && !targetMatches) ||
      (term.polarity === "forbidden" && targetMatches)
    ) {
      present = true;
    }
  }
  return { present, problems };
}
