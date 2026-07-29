import { pendingActionLiquidityTreatment } from "./pending-actions";
import type { RealDerivedEvidenceKind } from "./real-derived-policy";
import { loadRealDerivedSemanticContract } from "./semantic-contract";
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

const contract = loadRealDerivedSemanticContract();
const evidenceKindByPlane = new Map(
  contract.evidencePlanes.map((entry) => [
    entry.plane,
    entry.evidenceKind,
  ]),
);
const ENTITY_REF =
  /^(request|household|account|instruction|owner|actor|grant|policy|policy-version|restriction|legal-hold|pending-action|time-zone-rule):tok:[0-9a-f]{16}$/;

function requirement(
  plane: string,
  subjectRef: string,
  sourceRef: string,
): EvidenceRequirement {
  const evidenceKind = evidenceKindByPlane.get(plane);
  if (evidenceKind === undefined) {
    throw new Error(`semantic contract has no evidence plane "${plane}"`);
  }
  return { plane, evidenceKind, subjectRef, sourceRef };
}

function requiredEvidence(item: RealDerivedCase): EvidenceRequirement[] {
  const payload = item.replayPayload;
  const required = [
    requirement(
      "request",
      payload.request.requestRef,
      payload.request.evidenceSourceRef,
    ),
    requirement(
      "identity",
      payload.identity.subjectRef,
      payload.identity.evidenceSourceRef,
    ),
    requirement(
      "destination",
      payload.destination.instructionRef,
      payload.destination.evidenceSourceRef,
    ),
    ...payload.liquidity.sources.map((source) =>
      requirement(
        "liquidity-source",
        source.accountRef,
        source.evidenceSourceRef,
      ),
    ),
    requirement(
      "reserve",
      payload.request.householdRef,
      payload.liquidity.reserveEvidenceSourceRef,
    ),
    requirement(
      "authority",
      payload.authority.grantRef ?? payload.authority.actorRef,
      payload.authority.evidenceSourceRef,
    ),
    requirement(
      "policy",
      payload.policy.policyVersionRef,
      payload.policy.evidenceSourceRef,
    ),
    requirement(
      "instruction-conflict",
      payload.request.householdRef,
      payload.instructionConflict.evidenceSourceRef,
    ),
    requirement(
      "tax-review",
      payload.request.requestRef,
      payload.taxReviewEvidenceSourceRef,
    ),
    requirement(
      "temporal",
      payload.temporal.timeZoneRuleRef,
      payload.temporal.evidenceSourceRef,
    ),
    requirement(
      "execution",
      payload.request.requestRef,
      payload.execution.evidenceSourceRef,
    ),
  ];
  const action = payload.liquidity.pendingAction;
  if (action.actionRef !== null && action.evidenceSourceRef !== null) {
    required.push(
      requirement("pending-action", action.actionRef, action.evidenceSourceRef),
    );
  }
  const policy = payload.policy;
  if (
    policy.restrictionRef !== null &&
    policy.restrictionEvidenceSourceRef !== null
  ) {
    required.push(
      requirement(
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
      requirement(
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
        requirement(
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

function evidenceSupportProblems(item: RealDerivedCase): string[] {
  const problems: string[] = [];
  const required = requiredEvidence(item);
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

function selectedSources(item: RealDerivedCase): LiquiditySource[] {
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
): string[] {
  return [
    ...relationshipProblems(item),
    ...fundingProblems(item),
    ...evidenceSupportProblems(item),
    ...subjectInventoryProblems(item),
  ];
}

const intervalCollapse = (item: RealDerivedCase): boolean => {
  const authority = item.replayPayload.authority;
  return authority.validTo !== null && item.evidence.some((evidence) =>
    evidence.evidenceKind === "authority" &&
    evidence.subjectRef === authority.grantRef &&
    evidence.sourceRef === authority.evidenceSourceRef &&
    evidence.observedAt !== null &&
    evidence.observedAt < authority.validTo! &&
    authority.validTo! <= evidence.retrievedAt
  );
};

const pendingMiscount = (item: RealDerivedCase): boolean => {
  const action = item.replayPayload.liquidity.pendingAction;
  return action.actionRef !== null &&
    (["blocked", "cancelled", "rejected"].includes(action.actionState ?? "") ||
      ["unknown", "unclassified"].includes(action.actionKind ?? ""));
};

const deadlineInfeasible = (item: RealDerivedCase): boolean => {
  const request = item.replayPayload.request;
  return request.deadlineAt !== null &&
    (request.deadlineAt < item.evaluation.asOf ||
      (request.settlementEarliestAt !== null &&
        request.deadlineAt < request.settlementEarliestAt));
};

const taxBlindness = (item: RealDerivedCase): boolean =>
  selectedSources(item).some(
    (source) => source.sourceTaxClass === "retirement",
  ) && item.replayPayload.taxReviewState !== "completed";

const RULES: Readonly<Record<string, (item: RealDerivedCase) => boolean>> = {
  "identity-ambiguous": (item) =>
    item.replayPayload.identity.resolution === "ambiguous",
  "authority-not-effective": (item) =>
    item.replayPayload.authority.authorityState !== "effective",
  "destination-not-integral": (item) =>
    item.replayPayload.destination.ownership === "cross-household" ||
    item.replayPayload.destination.verificationState !== "verified" ||
    item.replayPayload.destination.discriminatorState !== "unique",
  "instruction-conflict-present": (item) =>
    item.replayPayload.instructionConflict.conflictState === "present",
  "reserve-not-scalar": (item) =>
    item.replayPayload.liquidity.reserveState !== "modeled-scalar",
  "stale-evidence-present": (item) =>
    item.evidence.some((evidence) => evidence.freshness === "stale"),
  "authority-lapses-during-evidence-interval": intervalCollapse,
  "restriction-not-in-force": (item) =>
    ["expired", "future"].includes(
      item.replayPayload.policy.restrictionState,
    ),
  "position-hold-present": (item) =>
    item.replayPayload.policy.legalHoldScope === "position",
  "nonreducing-pending-action-present": pendingMiscount,
  "time-zone-boundary": (item) =>
    item.replayPayload.temporal.transitionState === "boundary",
  "canonical-identity-collision": (item) =>
    item.replayPayload.identity.resolution === "canonical-collision",
  "threshold-equality": (item) =>
    item.replayPayload.policy.thresholdComparison === "equal",
  "deadline-infeasible": deadlineInfeasible,
  "resolved-conflict-multi-subject": (item) =>
    item.replayPayload.instructionConflict.conflictState === "resolved" &&
    item.replayPayload.instructionConflict.impactedSubjectRefs.length > 1,
  "selected-retirement-source-unreviewed": taxBlindness,
};

export function realDerivedSemanticDefects(
  item: RealDerivedCase,
): string[] {
  return contract.defectRules.flatMap((entry) => {
    const rule = RULES[entry.rule];
    if (rule === undefined) {
      throw new Error(`semantic rule "${entry.rule}" has no executable authority`);
    }
    return rule(item) ? [entry.id] : [];
  });
}

export function realDerivedSemanticContractProblems(
  defectClassIds: ReadonlySet<string>,
): string[] {
  const configuredIds = new Set(contract.defectRules.map((entry) => entry.id));
  const configuredRules = new Set(
    contract.defectRules.map((entry) => entry.rule),
  );
  const planes = new Set(
    contract.evidencePlanes.map((entry) => entry.plane),
  );
  return [
    ...(configuredIds.size === contract.defectRules.length
      ? []
      : ["real-derived semantic contract has duplicate defect ids"]),
    ...(configuredRules.size === contract.defectRules.length
      ? []
      : ["real-derived semantic contract has duplicate executable rules"]),
    ...(planes.size === contract.evidencePlanes.length
      ? []
      : ["real-derived semantic contract has duplicate evidence planes"]),
    ...[...defectClassIds]
      .filter((id) => !configuredIds.has(id))
      .map(
        (id) =>
          `real-derived replay semantics missing defect class "${id}"`,
      ),
    ...[...configuredIds]
      .filter((id) => !defectClassIds.has(id))
      .map(
        (id) =>
          `real-derived replay semantics reference unknown defect class "${id}"`,
      ),
    ...[...configuredRules]
      .filter((rule) => RULES[rule] === undefined)
      .map(
        (rule) =>
          `real-derived semantic rule "${rule}" has no executable authority`,
      ),
  ];
}

export function pendingActionProblems(item: RealDerivedCase): string[] {
  const action = item.replayPayload.liquidity.pendingAction;
  const values = [
    action.actionRef,
    action.actionKind,
    action.actionState,
    action.direction,
    action.liquidityClass,
    action.amountMinor,
    action.evidenceSourceRef,
  ];
  const absent = values.every((value) => value === null);
  if (absent) {
    return action.reducesEffectiveLiquidity ||
      action.increasesAvailableLiquidity
      ? ["liquidity.pendingAction absent treatment is inconsistent"]
      : [];
  }
  if (values.some((value) => value === null)) {
    return ["liquidity.pendingAction is only partially populated"];
  }
  const expected = pendingActionLiquidityTreatment(
    action.actionKind!,
    action.actionState!,
  );
  return action.direction !== expected.direction ||
    action.liquidityClass !== expected.liquidityClass ||
    action.reducesEffectiveLiquidity !== expected.reducesEffectiveLiquidity ||
    action.increasesAvailableLiquidity !== expected.increasesAvailableLiquidity
    ? ["liquidity.pendingAction treatment is inconsistent"]
    : [];
}
