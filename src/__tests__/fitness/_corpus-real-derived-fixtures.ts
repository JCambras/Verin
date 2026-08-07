import {
  ACCOUNT_REF,
  ACCOUNT_REF_ALT,
  ACTOR_REF,
  ACTOR_REF_ALT,
  baselineEvidence,
  EVIDENCE_SOURCE_REF,
  EVIDENCE_SOURCE_REF_ALT,
  FIRM_REF,
  GRANT_REF,
  HOUSEHOLD_REF,
  INSTRUCTION_REF,
  INSTRUCTION_REF_ALT,
  LEGAL_HOLD_REF,
  observedEvidence,
  OPAQUE,
  OWNER_REF,
  PENDING_ACTION_REF,
  POLICY_REF,
  POLICY_VERSION_REF,
  REQUEST_REF,
  RESTRICTION_REF,
  TIME_ZONE_RULE_REF,
  TOKEN_ALT,
  treatmentOutcomes,
} from "./_corpus-case-fixtures";

const OPAQUE_REVIEWER = TOKEN_ALT;

export const realDerivedCase = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const evidence = baselineEvidence();
  const label = overrides.label as
    | { kind: "defect"; defectClassId: string }
    | { kind: "clean-control" }
    | undefined;
  const defectClassId =
    label?.kind === "defect"
      ? label.defectClassId
      : label?.kind === "clean-control"
        ? undefined
        : "destination-integrity-defect";
  const item = {
  caseId: "RD-00112233445566aa",
  firmRef: FIRM_REF,
  corpusVersion: "2026.07.0",
  partition: "real-derived",
  provenance: "real-derived-fixture",
  scrubAttestation: {
    sourceSystemClass: "custodian-exception-feed",
    extractedAt: "2026-05-01T13:00:00.000Z",
    extractedBy: "tok:0011223344556677",
    scrubbedBy: OPAQUE,
    scrubbedAt: "2026-05-02T13:00:00.000Z",
    reviewedBy: OPAQUE_REVIEWER,
    reviewedAt: "2026-05-03T13:00:00.000Z",
    recordsBefore: 40,
    recordsAfter: 40,
    method: "deterministic-tokenization",
  },
  label: { kind: "defect", defectClassId: "destination-integrity-defect" },
  occurredAt: "2026-04-28T13:00:00.000Z",
  evaluation: {
    asOf: "2026-04-28T13:00:05.000Z",
    freshnessPolicyVersion: "verin-real-derived-freshness/1.0.0",
  },
  subjects: [
    REQUEST_REF,
    HOUSEHOLD_REF,
    ACCOUNT_REF,
    INSTRUCTION_REF,
    OWNER_REF,
    ACTOR_REF,
    GRANT_REF,
    POLICY_REF,
    POLICY_VERSION_REF,
    TIME_ZONE_RULE_REF,
  ],
  replayPayload: {
    schemaVersion: "verin-real-derived-replay/1.11.0",
    request: {
      firmRef: FIRM_REF,
      requestRef: REQUEST_REF,
      householdRef: HOUSEHOLD_REF,
      action: "distribution",
      actorRef: ACTOR_REF,
      sourceAccountRef: ACCOUNT_REF,
      destinationRef: INSTRUCTION_REF,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
      amountMinor: 10_000,
      currency: "USD",
      deadlineAt: "2026-04-30T13:00:00.000Z",
      settlementEarliestAt: "2026-04-29T13:00:00.000Z",
    },
    identity: {
      subjectRef: ACTOR_REF,
      resolution: "unique",
      candidateRefs: [ACTOR_REF],
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    destination: {
      instructionRef: INSTRUCTION_REF,
      householdRef: HOUSEHOLD_REF,
      ownerRefs: [OWNER_REF],
      ownership: "same-household",
      verificationState: "verified",
      discriminatorState: "collision",
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    liquidity: {
      sources: [
        {
          accountRef: ACCOUNT_REF,
          householdRef: HOUSEHOLD_REF,
          ownerRefs: [OWNER_REF],
          evidenceSourceRef: EVIDENCE_SOURCE_REF,
          availableMinor: 20_000,
          sourceTaxClass: "taxable",
        },
      ],
      selectedFundingRefs: [ACCOUNT_REF],
      reserveState: "modeled-scalar",
      reserveRequiredMinor: 1_000,
      reserveEvidenceSourceRef: EVIDENCE_SOURCE_REF,
      withdrawalSegmentsMinor: [1_000],
      pendingAction: {
        actionRef: null,
        accountRef: null,
        householdRef: null,
        actionKind: null,
        actionState: null,
        direction: null,
        liquidityClass: null,
        availableMinorIncludesAction: null,
        amountMinor: null,
        evidenceSourceRef: null,
        reducesEffectiveLiquidity: false,
        increasesAvailableLiquidity: false,
      },
    },
    authority: {
      grantRef: GRANT_REF,
      actorRef: ACTOR_REF,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
      authorityScope: "distribution-request",
      authorityState: "effective",
      validFrom: "2026-04-01T13:00:00.000Z",
      validTo: null,
    },
    policy: {
      policyRef: POLICY_REF,
      policyVersionRef: POLICY_VERSION_REF,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
      thresholdMinor: 5_000,
      thresholdComparator: "strict",
      thresholdComparison: "above",
      restrictionRef: null,
      restrictionEvidenceSourceRef: null,
      restrictionState: "absent",
      restrictionEffectiveFrom: null,
      restrictionEffectiveTo: null,
      legalHoldRef: null,
      legalHoldEvidenceSourceRef: null,
      legalHoldScope: "none",
    },
    taxReviewState: "not-required",
    taxReviewEvidenceSourceRef: EVIDENCE_SOURCE_REF,
    instructionConflict: {
      conflictState: "none",
      requestRef: REQUEST_REF,
      householdRef: HOUSEHOLD_REF,
      instructions: [],
      impactedSubjectRefs: [],
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    temporal: {
      eventAt: "2026-04-28T13:00:00.000Z",
      eventAtLocal: "2026-04-28T09:00:00.000-04:00",
      timeZone: "America/New_York",
      timeZoneDataVersion: "iana-tzdb/2026b",
      standardOffsetMinutes: -300,
      timeZoneTransitions: [
        { at: "2026-01-01T00:00:00.000Z", offsetMinutes: -300 },
        { at: "2026-03-08T07:00:00.000Z", offsetMinutes: -240 },
        { at: "2026-11-01T06:00:00.000Z", offsetMinutes: -300 },
      ],
      timeZoneRuleRef: TIME_ZONE_RULE_REF,
      transitionState: "daylight",
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    outcomes: [],
    evidenceRefs: evidence.map((entry) => String(entry.id)),
    execution: {
      reservationKeys: [
        "conflict:tok:0123456789abcdef:liquidity",
      ],
      preconditions: ["evidence-fresh"],
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
  },
  evidence,
  reservations: [{
    firmRef: FIRM_REF,
    family: "liquidity",
    conflictKey: "conflict:tok:0123456789abcdef:liquidity",
  }],
  ...overrides,
  };
  const payload = item.replayPayload as Record<string, any>;
  payload.outcomes = treatmentOutcomes(payload, defectClassId);
  return item;
};

export const realDerivedDefectCase = (defectClassId: string): Record<string, unknown> => {
  const item = realDerivedCase({
    label: { kind: "defect", defectClassId },
  });
  const payload = item.replayPayload as Record<string, any>;
  payload.destination.discriminatorState = "unique";
  switch (defectClassId) {
    case "identity-resolution-ambiguity":
      payload.identity.resolution = "ambiguous";
      payload.identity.candidateRefs.push(ACTOR_REF_ALT);
      (item.subjects as string[]).push(ACTOR_REF_ALT);
      break;
    case "authority-scope-error":
      payload.authority.authorityScope = "other";
      payload.authority.authorityState = "wrong-scope";
      break;
    case "destination-integrity-defect":
      payload.destination.discriminatorState = "collision";
      break;
    case "instruction-conflict-unresolved": {
      payload.instructionConflict = {
        conflictState: "present",
        requestRef: REQUEST_REF,
        householdRef: HOUSEHOLD_REF,
        instructions: [
          {
            instructionRef: INSTRUCTION_REF,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "required",
            },
          },
          {
            instructionRef: INSTRUCTION_REF_ALT,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "forbidden",
            },
          },
        ],
        impactedSubjectRefs: [ACCOUNT_REF],
        evidenceSourceRef: EVIDENCE_SOURCE_REF,
      };
      const unresolvedEvidence =
        item.evidence as Array<Record<string, unknown>>;
      const unresolvedConflictEvidence = unresolvedEvidence.find(
        (entry) => entry.evidenceKind === "household-instruction",
      )!;
      unresolvedConflictEvidence.subjectRef = INSTRUCTION_REF;
      unresolvedEvidence.push(
        observedEvidence(
          "household-instruction",
          INSTRUCTION_REF_ALT,
          EVIDENCE_SOURCE_REF,
          TOKEN_ALT,
        ),
      );
      payload.evidenceRefs = unresolvedEvidence.map((entry) => entry.id);
      (item.subjects as string[]).push(INSTRUCTION_REF_ALT);
      break;
    }
    case "liquidity-reserve-miscalculation":
      payload.liquidity.reserveState = "modeled-segmented";
      payload.liquidity.withdrawalSegmentsMinor = [500, 1_000];
      break;
    case "evidence-staleness-unnoticed":
      (item.evidence as Array<Record<string, unknown>>).find(
        (entry) => entry.evidenceKind === "balance",
      )!.observedAt =
        "2026-04-26T05:00:00.000Z";
      (item.evidence as Array<Record<string, unknown>>).find(
        (entry) => entry.evidenceKind === "balance",
      )!.freshness = "stale";
      break;
    case "evidence-interval-collapse": {
      payload.authority.authorityState = "expired";
      payload.authority.validTo = "2026-04-28T10:00:00.000Z";
      break;
    }
    case "restriction-lifecycle-error":
      payload.policy.restrictionRef = RESTRICTION_REF;
      payload.policy.restrictionEvidenceSourceRef = EVIDENCE_SOURCE_REF;
      payload.policy.restrictionState = "expired";
      payload.policy.restrictionEffectiveFrom =
        "2025-01-01T00:00:00.000Z";
      payload.policy.restrictionEffectiveTo =
        "2026-04-27T00:00:00.000Z";
      (item.subjects as string[]).push(RESTRICTION_REF);
      (item.evidence as Array<Record<string, unknown>>).push(
        observedEvidence("restriction", RESTRICTION_REF),
      );
      payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
        .map((entry) => entry.id);
      break;
    case "hold-scope-error":
      payload.policy.legalHoldRef = LEGAL_HOLD_REF;
      payload.policy.legalHoldEvidenceSourceRef = EVIDENCE_SOURCE_REF;
      payload.policy.legalHoldScope = "position";
      (item.subjects as string[]).push(LEGAL_HOLD_REF);
      (item.evidence as Array<Record<string, unknown>>).push(
        observedEvidence("legal-hold", LEGAL_HOLD_REF),
      );
      payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
        .map((entry) => entry.id);
      break;
    case "pending-activity-miscount":
      payload.liquidity.pendingAction = {
        actionRef: PENDING_ACTION_REF,
        accountRef: ACCOUNT_REF,
        householdRef: HOUSEHOLD_REF,
        actionKind: "outgoing-distribution",
        actionState: "blocked",
        direction: "outgoing",
        liquidityClass: "distribution",
        availableMinorIncludesAction: false,
        amountMinor: 500,
        evidenceSourceRef: EVIDENCE_SOURCE_REF,
        reducesEffectiveLiquidity: false,
        increasesAvailableLiquidity: false,
      };
      (item.subjects as string[]).push(PENDING_ACTION_REF);
      (item.evidence as Array<Record<string, unknown>>).push(
        observedEvidence("pending-actions", PENDING_ACTION_REF),
      );
      payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
        .map((entry) => entry.id);
      break;
    case "temporal-rendering-defect":
      payload.temporal.eventAt = "2026-03-08T07:00:00.000Z";
      payload.temporal.eventAtLocal = "2026-03-08T03:00:00.000-04:00";
      payload.temporal.transitionState = "boundary";
      break;
    case "canonical-identity-defect":
      payload.identity.resolution = "canonical-collision";
      payload.identity.candidateRefs.push(ACTOR_REF_ALT);
      (item.subjects as string[]).push(ACTOR_REF_ALT);
      break;
    case "threshold-boundary-error":
      payload.request.amountMinor = payload.policy.thresholdMinor;
      payload.policy.thresholdComparison = "equal";
      break;
    case "deadline-feasibility-error":
      payload.request.deadlineAt = "2026-04-27T13:00:00.000Z";
      break;
    case "blast-radius-underestimation": {
      payload.instructionConflict = {
        conflictState: "resolved",
        requestRef: REQUEST_REF,
        householdRef: HOUSEHOLD_REF,
        instructions: [
          {
            instructionRef: INSTRUCTION_REF,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "required",
            },
          },
          {
            instructionRef: INSTRUCTION_REF_ALT,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "forbidden",
            },
          },
        ],
        impactedSubjectRefs: [ACCOUNT_REF, ACCOUNT_REF_ALT],
        evidenceSourceRef: EVIDENCE_SOURCE_REF_ALT,
      };
      const evidence = item.evidence as Array<Record<string, unknown>>;
      const conflictEvidence = evidence.find(
        (entry) => entry.evidenceKind === "household-instruction",
      )!;
      conflictEvidence.subjectRef = INSTRUCTION_REF;
      conflictEvidence.sourceRef = EVIDENCE_SOURCE_REF_ALT;
      evidence.push(
        observedEvidence(
          "household-instruction",
          INSTRUCTION_REF_ALT,
          EVIDENCE_SOURCE_REF_ALT,
          TOKEN_ALT,
        ),
        {
          ...observedEvidence(
            "recent-change",
            ACCOUNT_REF,
            EVIDENCE_SOURCE_REF_ALT,
          ),
          retrievedAt: "2026-04-28T13:00:03.000Z",
        },
        {
          ...observedEvidence(
            "recent-change",
            ACCOUNT_REF_ALT,
            EVIDENCE_SOURCE_REF_ALT,
            TOKEN_ALT,
          ),
          retrievedAt: "2026-04-28T13:00:03.000Z",
        },
      );
      payload.evidenceRefs = evidence.map((entry) => entry.id);
      (item.subjects as string[]).push(
        INSTRUCTION_REF_ALT,
        ACCOUNT_REF_ALT,
      );
      break;
    }
    case "tax-consequence-blindness":
      payload.liquidity.sources[0].sourceTaxClass = "retirement";
      payload.taxReviewState = "required-pending";
      break;
  }
  payload.outcomes = treatmentOutcomes(payload, defectClassId);
  return item;
};
