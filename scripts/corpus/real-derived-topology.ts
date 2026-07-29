import { evidenceSupportProblems } from "./evidence-observation";
import {
  instructionConflictAnalysis,
  type InstructionConflictAnalysis,
} from "./instruction-conflicts";
import type { RealDerivedEvidenceKind } from "./real-derived-policy";
import type {
  LiquiditySource,
  RealDerivedCase,
} from "./real-derived-types";

const ENTITY_REF =
  /^(request|household|account|instruction|owner|actor|grant|policy|policy-version|restriction|legal-hold|pending-action|time-zone-rule):tok:[0-9a-f]{16}$/;

export function selectedSources(item: RealDerivedCase): LiquiditySource[] {
  return item.replayPayload.liquidity.selectedFundingRefs.flatMap((ref) => {
    const matches = item.replayPayload.liquidity.sources.filter(
      (source) => source.accountRef === ref,
    );
    return matches.length === 1 ? matches : [];
  });
}

export function realDerivedInstructionConflictAnalysis(
  item: RealDerivedCase,
): InstructionConflictAnalysis {
  const payload = item.replayPayload;
  return instructionConflictAnalysis(
    {
      firmRef: item.firmRef,
      requestRef: payload.request.requestRef,
      householdRef: payload.request.householdRef,
      action: payload.request.action,
      sourceAccountRef: payload.request.sourceAccountRef,
      destinationRef: payload.request.destinationRef,
      destinationSubjectRefs: payload.destination.ownerRefs,
    },
    payload.instructionConflict.instructions,
  );
}

function fundingProblems(item: RealDerivedCase): string[] {
  const payload = item.replayPayload;
  const selected = selectedSources(item);
  const problems: string[] = [];
  if (selected.length !== payload.liquidity.selectedFundingRefs.length) {
    problems.push(
      "selected funding references must each resolve to exactly one liquidity source",
    );
  }
  if (
    selected.some(
      (source) =>
        source.householdRef !== payload.request.householdRef ||
        source.sourceTaxClass === "unknown",
    )
  ) {
    problems.push(
      "selected funding sources must belong to the request household and carry a supported tax class",
    );
  }
  const sourceAccount = payload.liquidity.sources.find(
    (source) => source.accountRef === payload.request.sourceAccountRef,
  );
  const sourceOwners = new Set(sourceAccount?.ownerRefs ?? []);
  if (
    selected.some(
      (source) =>
        !source.ownerRefs.some((ownerRef) => sourceOwners.has(ownerRef)),
    )
  ) {
    problems.push(
      "selected funding sources must share an owner with the request source account",
    );
  }
  const action = payload.liquidity.pendingAction;
  const requiredParts = [
    payload.request.amountMinor,
    payload.liquidity.reserveRequiredMinor ?? 0,
    action.reducesEffectiveLiquidity ? action.amountMinor ?? 0 : 0,
  ];
  const availableParts = selected.map((source) => source.availableMinor);
  if (
    [...requiredParts, ...availableParts].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    problems.push("funding amounts must be safe integer minor units");
  } else if (
    availableParts.reduce(
      (total, value) => total + BigInt(value),
      0n,
    ) <
      requiredParts.reduce(
        (total, value) => total + BigInt(value),
        0n,
      )
  ) {
    problems.push(
      "selected funding aggregate does not cover request, reserve, and pending reductions",
    );
  }
  const retirementSelected = selected.some(
    (source) => source.sourceTaxClass === "retirement",
  );
  if (
    retirementSelected &&
    payload.taxReviewState === "not-required"
  ) {
    problems.push(
      "selected retirement funding cannot declare tax review not required",
    );
  }
  if (
    !retirementSelected &&
    payload.taxReviewState !== "not-required"
  ) {
    problems.push(
      "tax review state must be not-required when selected funding has no retirement source",
    );
  }
  return problems;
}

function relationshipProblems(item: RealDerivedCase): string[] {
  const payload = item.replayPayload;
  const problems: string[] = [];
  if (payload.request.firmRef !== item.firmRef) {
    problems.push("request firmRef must equal the case firmRef");
  }
  if (
    item.reservations.some(
      (reservation) => reservation.firmRef !== item.firmRef,
    )
  ) {
    problems.push("every reservation firmRef must equal the case firmRef");
  }
  const reservationIdentities = item.reservations.map(
    (reservation) => `${reservation.firmRef}\u0000${reservation.conflictKey}`,
  );
  if (
    new Set(reservationIdentities).size !== reservationIdentities.length
  ) {
    problems.push(
      "reservation identity must be unique by firmRef and conflictKey",
    );
  }
  const sourceMatches = payload.liquidity.sources.filter(
    (source) => source.accountRef === payload.request.sourceAccountRef,
  ).length;
  const sourceRefs = payload.liquidity.sources.map(
    (source) => source.accountRef,
  );
  if (new Set(sourceRefs).size !== sourceRefs.length) {
    problems.push("liquidity source account references must be unique");
  }
  if (sourceMatches !== 1) {
    problems.push(
      `request sourceAccountRef resolves to ${sourceMatches} liquidity sources, expected exactly one`,
    );
  }
  if (
    payload.request.actorRef !== payload.identity.subjectRef ||
    payload.request.actorRef !== payload.authority.actorRef
  ) {
    problems.push(
      "request, identity, and authority actor references must resolve to one actor",
    );
  }
  if (
    payload.identity.resolution === "unique" &&
    payload.identity.candidateRefs[0] !== payload.identity.subjectRef
  ) {
    problems.push(
      "unique identity candidate must equal identity.subjectRef",
    );
  }
  if (payload.request.destinationRef !== payload.destination.instructionRef) {
    problems.push(
      "request destinationRef must resolve to the destination instruction",
    );
  }
  const expectedOwnership =
    payload.request.householdRef === payload.destination.householdRef
      ? "same-household"
      : "cross-household";
  if (payload.destination.ownership !== expectedOwnership) {
    problems.push("destination ownership does not match household references");
  }
  const conflict = payload.instructionConflict;
  if (
    conflict.requestRef !== payload.request.requestRef ||
    conflict.householdRef !== payload.request.householdRef
  ) {
    problems.push(
      "instruction conflict must bind to the governed request and household",
    );
  }
  if (
    conflict.instructions.some(
      (instruction) =>
        instruction.firmRef !== item.firmRef ||
        instruction.householdRef !== payload.request.householdRef,
    )
  ) {
    problems.push(
      "instruction conflict instructions must belong to the request firm and household",
    );
  }
  const conflictAnalysis = realDerivedInstructionConflictAnalysis(item);
  problems.push(...conflictAnalysis.problems);
  if (
    (conflict.conflictState === "none") === conflictAnalysis.present
  ) {
    problems.push(
      "instruction conflict state does not match the signed typed instruction terms",
    );
  }
  const instructionRefs = conflict.instructions.map(
    (instruction) => instruction.instructionRef,
  );
  if (new Set(instructionRefs).size !== instructionRefs.length) {
    problems.push("instruction conflict references must be unique");
  }
  const requestSubjects = new Set([
    payload.request.sourceAccountRef,
    payload.request.destinationRef,
  ]);
  if (
    conflict.conflictState !== "none" &&
    !conflict.impactedSubjectRefs.some((ref) => requestSubjects.has(ref))
  ) {
    problems.push(
      "instruction conflict impacted subjects must intersect the request source or destination",
    );
  }
  const policy = payload.policy;
  if (
    (policy.restrictionRef === null) !==
      (policy.restrictionEvidenceSourceRef === null) ||
    (policy.legalHoldRef === null) !==
      (policy.legalHoldEvidenceSourceRef === null)
  ) {
    problems.push(
      "optional policy references and evidence sources must be present together",
    );
  }
  const action = payload.liquidity.pendingAction;
  if (
    (action.actionRef === null) !== (action.evidenceSourceRef === null)
  ) {
    problems.push(
      "pending action reference and evidence source must be present together",
    );
  }
  if (
    action.actionRef !== null &&
    (
      action.householdRef !== payload.request.householdRef ||
      action.accountRef === null ||
      !payload.liquidity.selectedFundingRefs.includes(action.accountRef) ||
      payload.liquidity.sources.filter(
        (source) => source.accountRef === action.accountRef,
      ).length !== 1
    )
  ) {
    problems.push(
      "pending action must belong to the request household and exactly one selected funding account",
    );
  }
  return problems;
}

function subjectInventoryProblems(item: RealDerivedCase): string[] {
  const referenced = new Set(item.evidence.map((entry) => entry.subjectRef));
  const pending: unknown[] = [item.replayPayload];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string" && ENTITY_REF.test(current)) {
      referenced.add(current);
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current !== null && typeof current === "object") {
      pending.push(...Object.values(current));
    }
  }
  const subjects = new Set(item.subjects);
  return subjects.size !== item.subjects.length ||
    subjects.size !== referenced.size ||
    [...referenced].some((ref) => !subjects.has(ref))
    ? ["subjects must exactly inventory entity-kind-scoped replay references"]
    : [];
}

export function realDerivedTopologyProblems(
  item: RealDerivedCase,
  evidenceKindByPlane: ReadonlyMap<string, RealDerivedEvidenceKind>,
): string[] {
  return [
    ...relationshipProblems(item),
    ...fundingProblems(item),
    ...evidenceSupportProblems(item, evidenceKindByPlane),
    ...subjectInventoryProblems(item),
  ];
}
