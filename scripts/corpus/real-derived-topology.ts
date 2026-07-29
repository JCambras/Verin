import type { RealDerivedEvidenceKind } from "./real-derived-policy";
import type {
  LiquiditySource,
  RealDerivedCase,
  RealDerivedEvidence,
} from "./real-derived-types";

type EvidenceRequirement = {
  plane: string;
  evidenceKind: RealDerivedEvidenceKind;
  subjectRef: string;
  sourceRef: string;
};

const ENTITY_REF =
  /^(request|household|account|instruction|owner|actor|grant|policy|policy-version|restriction|legal-hold|pending-action|time-zone-rule):tok:[0-9a-f]{16}$/;

const requirement = (
  evidenceKindByPlane: ReadonlyMap<string, RealDerivedEvidenceKind>,
  plane: string,
  subjectRef: string,
  sourceRef: string,
): EvidenceRequirement => {
  const evidenceKind = evidenceKindByPlane.get(plane);
  if (evidenceKind === undefined) {
    throw new Error(`semantic contract has no evidence plane "${plane}"`);
  }
  return { plane, evidenceKind, subjectRef, sourceRef };
};

function requiredEvidence(
  item: RealDerivedCase,
  evidenceKindByPlane: ReadonlyMap<string, RealDerivedEvidenceKind>,
): EvidenceRequirement[] {
  const payload = item.replayPayload;
  const need = (
    plane: string,
    subjectRef: string,
    sourceRef: string,
  ): EvidenceRequirement =>
    requirement(evidenceKindByPlane, plane, subjectRef, sourceRef);
  const required = [
    need(
      "request",
      payload.request.requestRef,
      payload.request.evidenceSourceRef,
    ),
    need(
      "identity",
      payload.identity.subjectRef,
      payload.identity.evidenceSourceRef,
    ),
    need(
      "destination",
      payload.destination.instructionRef,
      payload.destination.evidenceSourceRef,
    ),
    ...payload.liquidity.sources.map((source) =>
      need(
        "liquidity-source",
        source.accountRef,
        source.evidenceSourceRef,
      ),
    ),
    need(
      "reserve",
      payload.request.householdRef,
      payload.liquidity.reserveEvidenceSourceRef,
    ),
    need(
      "authority",
      payload.authority.grantRef ?? payload.authority.actorRef,
      payload.authority.evidenceSourceRef,
    ),
    need(
      "policy",
      payload.policy.policyVersionRef,
      payload.policy.evidenceSourceRef,
    ),
    need(
      "instruction-conflict",
      payload.request.householdRef,
      payload.instructionConflict.evidenceSourceRef,
    ),
    need(
      "tax-review",
      payload.request.requestRef,
      payload.taxReviewEvidenceSourceRef,
    ),
    need(
      "temporal",
      payload.temporal.timeZoneRuleRef,
      payload.temporal.evidenceSourceRef,
    ),
    need(
      "execution",
      payload.request.requestRef,
      payload.execution.evidenceSourceRef,
    ),
  ];
  const action = payload.liquidity.pendingAction;
  if (action.actionRef !== null && action.evidenceSourceRef !== null) {
    required.push(
      need("pending-action", action.actionRef, action.evidenceSourceRef),
    );
  }
  const policy = payload.policy;
  if (
    policy.restrictionRef !== null &&
    policy.restrictionEvidenceSourceRef !== null
  ) {
    required.push(
      need(
        "restriction",
        policy.restrictionRef,
        policy.restrictionEvidenceSourceRef,
      ),
    );
  }
  if (
    policy.legalHoldRef !== null &&
    policy.legalHoldEvidenceSourceRef !== null
  ) {
    required.push(
      need(
        "legal-hold",
        policy.legalHoldRef,
        policy.legalHoldEvidenceSourceRef,
      ),
    );
  }
  if (
    payload.instructionConflict.conflictState === "resolved" &&
    payload.instructionConflict.impactedSubjectRefs.length > 1
  ) {
    required.push(
      ...payload.instructionConflict.impactedSubjectRefs.map((subjectRef) =>
        need(
          "recent-change",
          subjectRef,
          payload.instructionConflict.evidenceSourceRef,
        ),
      ),
    );
  }
  return required;
}

const sameEvidence = (
  evidence: RealDerivedEvidence,
  expected: EvidenceRequirement,
): boolean =>
  evidence.evidenceKind === expected.evidenceKind &&
  evidence.subjectRef === expected.subjectRef &&
  evidence.sourceRef === expected.sourceRef;

function evidenceSupportProblems(
  item: RealDerivedCase,
  evidenceKindByPlane: ReadonlyMap<string, RealDerivedEvidenceKind>,
): string[] {
  const problems: string[] = [];
  const required = requiredEvidence(item, evidenceKindByPlane);
  for (const expected of required) {
    const count = item.evidence.filter((entry) =>
      sameEvidence(entry, expected),
    ).length;
    if (count !== 1) {
      problems.push(
        `${expected.plane} evidence resolves to ${count} matching kind, subject, and source records, expected exactly one`,
      );
    }
  }
  for (const evidence of item.evidence) {
    if (!required.some((expected) => sameEvidence(evidence, expected))) {
      problems.push(
        `evidence ${evidence.id} does not support a material replay plane`,
      );
    }
  }
  return problems;
}

export function selectedSources(item: RealDerivedCase): LiquiditySource[] {
  return item.replayPayload.liquidity.selectedFundingRefs.flatMap((ref) => {
    const matches = item.replayPayload.liquidity.sources.filter(
      (source) => source.accountRef === ref,
    );
    return matches.length === 1 ? matches : [];
  });
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
  const required =
    payload.request.amountMinor +
    (payload.liquidity.reserveRequiredMinor ?? 0) +
    (action.reducesEffectiveLiquidity ? action.amountMinor ?? 0 : 0);
  const available = selected.reduce(
    (total, source) => total + source.availableMinor,
    0,
  );
  if (available < required) {
    problems.push(
      "selected funding aggregate does not cover request, reserve, and pending reductions",
    );
  }
  return problems;
}

function relationshipProblems(item: RealDerivedCase): string[] {
  const payload = item.replayPayload;
  const problems: string[] = [];
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
        instruction.householdRef !== payload.request.householdRef,
    )
  ) {
    problems.push(
      "instruction conflict instructions must belong to the request household",
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
