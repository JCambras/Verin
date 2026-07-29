import type { RealDerivedEvidenceKind } from "./real-derived-policy";
import type {
  RealDerivedCase,
  RealDerivedEvidence,
} from "./real-derived-types";

const AUTHORITIES: Readonly<
  Record<string, (item: RealDerivedCase) => boolean>
> = {
  request: () => false,
  identity: () => false,
  destination: () => false,
  "liquidity-source": () => false,
  reserve: (item) => item.replayPayload.liquidity.reserveState === "missing",
  "pending-action": () => false,
  authority: (item) =>
    item.replayPayload.authority.authorityState === "missing",
  policy: () => false,
  restriction: () => false,
  "legal-hold": () => false,
  "instruction-conflict": (item) =>
    item.replayPayload.instructionConflict.conflictState === "none" &&
    item.replayPayload.instructionConflict.instructions.length === 0,
  "recent-change": () => false,
  "tax-review": (item) =>
    item.replayPayload.taxReviewState === "unavailable",
  temporal: () => false,
  execution: () => false,
};

export function evidenceAllowsMissing(
  item: RealDerivedCase,
  plane: string,
): boolean {
  const authority = AUTHORITIES[plane];
  if (authority === undefined) {
    throw new Error(
      `semantic contract has no observation-state authority "${plane}"`,
    );
  }
  return authority(item);
}

interface EvidenceRequirement {
  readonly plane: string;
  readonly evidenceKind: RealDerivedEvidenceKind;
  readonly subjectRef: string;
  readonly sourceRef: string;
  readonly allowsMissing: boolean;
}

function requirement(
  item: RealDerivedCase,
  evidenceKindByPlane: ReadonlyMap<string, RealDerivedEvidenceKind>,
  plane: string,
  subjectRef: string,
  sourceRef: string,
): EvidenceRequirement {
  const evidenceKind = evidenceKindByPlane.get(plane);
  if (evidenceKind === undefined) {
    throw new Error(`semantic contract has no evidence plane "${plane}"`);
  }
  return {
    plane,
    evidenceKind,
    subjectRef,
    sourceRef,
    allowsMissing: evidenceAllowsMissing(item, plane),
  };
}

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
    requirement(item, evidenceKindByPlane, plane, subjectRef, sourceRef);
  const required = [
    need("request", payload.request.requestRef, payload.request.evidenceSourceRef),
    need("identity", payload.identity.subjectRef, payload.identity.evidenceSourceRef),
    need("destination", payload.destination.instructionRef, payload.destination.evidenceSourceRef),
    ...payload.liquidity.sources.map((source) =>
      need("liquidity-source", source.accountRef, source.evidenceSourceRef)
    ),
    need("reserve", payload.request.householdRef, payload.liquidity.reserveEvidenceSourceRef),
    need("authority", payload.authority.grantRef ?? payload.authority.actorRef, payload.authority.evidenceSourceRef),
    need("policy", payload.policy.policyVersionRef, payload.policy.evidenceSourceRef),
    ...(payload.instructionConflict.instructions.length === 0
      ? [
          need(
            "instruction-conflict",
            payload.request.householdRef,
            payload.instructionConflict.evidenceSourceRef,
          ),
        ]
      : payload.instructionConflict.instructions.map((instruction) =>
          need(
            "instruction-conflict",
            instruction.instructionRef,
            payload.instructionConflict.evidenceSourceRef,
          )
        )),
    need("tax-review", payload.request.requestRef, payload.taxReviewEvidenceSourceRef),
    need("temporal", payload.temporal.timeZoneRuleRef, payload.temporal.evidenceSourceRef),
    need("execution", payload.request.requestRef, payload.execution.evidenceSourceRef),
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
        )
      ),
    );
  }
  return required;
}

function sameEvidenceTuple(
  evidence: RealDerivedEvidence,
  expected: EvidenceRequirement,
): boolean {
  return evidence.evidenceKind === expected.evidenceKind &&
    evidence.subjectRef === expected.subjectRef &&
    evidence.sourceRef === expected.sourceRef;
}

function supportsRequirement(
  evidence: RealDerivedEvidence,
  expected: EvidenceRequirement,
): boolean {
  return sameEvidenceTuple(evidence, expected) &&
    (evidence.observationState === "observed" || expected.allowsMissing);
}

export function evidenceSupportProblems(
  item: RealDerivedCase,
  evidenceKindByPlane: ReadonlyMap<string, RealDerivedEvidenceKind>,
): string[] {
  const problems: string[] = [];
  const required = requiredEvidence(item, evidenceKindByPlane);
  for (const expected of required) {
    const tupleMatches = item.evidence.filter((entry) =>
      sameEvidenceTuple(entry, expected)
    );
    const count = tupleMatches.filter((entry) =>
      supportsRequirement(entry, expected)
    ).length;
    if (count !== 1) {
      if (
        !expected.allowsMissing &&
        tupleMatches.some((entry) => entry.observationState === "missing")
      ) {
        problems.push(
          `${expected.plane} evidence requires observed support for concrete replay values`,
        );
      } else {
        problems.push(
          `${expected.plane} evidence resolves to ${count} matching kind, subject, source, and observation records, expected exactly one`,
        );
      }
    }
  }
  for (const evidence of item.evidence) {
    if (
      !required.some((expected) => supportsRequirement(evidence, expected))
    ) {
      problems.push(
        `evidence ${evidence.id} does not support a material replay plane`,
      );
    }
  }
  return problems;
}

export function evidenceObservationAuthorityProblems(
  planes: readonly string[],
): string[] {
  const configured = new Set(planes);
  const authorities = new Set(Object.keys(AUTHORITIES));
  return [
    ...[...configured]
      .filter((plane) => !authorities.has(plane))
      .map(
        (plane) =>
          `evidence plane "${plane}" has no observation-state authority`,
      ),
    ...[...authorities]
      .filter((plane) => !configured.has(plane))
      .map(
        (plane) =>
          `observation-state authority "${plane}" has no evidence plane`,
      ),
  ];
}
