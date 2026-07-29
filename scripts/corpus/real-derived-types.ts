import type {
  PendingActionKind,
  PendingActionState,
} from "./pending-actions";
import type { RealDerivedEvidenceKind } from "./real-derived-policy";

export type PendingReplay = {
  actionRef: string | null;
  actionKind: PendingActionKind | null;
  actionState: PendingActionState | null;
  amountMinor: number | null;
  direction: "outgoing" | "incoming" | "unknown" | null;
  liquidityClass:
    | "distribution"
    | "debit"
    | "credit"
    | "unclassified"
    | null;
  evidenceSourceRef: string | null;
  reducesEffectiveLiquidity: boolean;
  increasesAvailableLiquidity: boolean;
};

export type LiquiditySource = {
  accountRef: string;
  householdRef: string;
  ownerRefs: string[];
  evidenceSourceRef: string;
  availableMinor: number;
  sourceTaxClass:
    | "taxable"
    | "retirement"
    | "trust"
    | "entity"
    | "unknown";
};

export type TreatmentOutcome = {
  defectClassId: string;
  expectedTreatment: string;
  observedTreatment: string;
};

export type ReplayPayload = {
  request: {
    requestRef: string;
    householdRef: string;
    actorRef: string;
    sourceAccountRef: string;
    destinationRef: string;
    evidenceSourceRef: string;
    amountMinor: number;
    deadlineAt: string | null;
    settlementEarliestAt: string | null;
  };
  identity: {
    subjectRef: string;
    resolution: "unique" | "ambiguous" | "canonical-collision";
    candidateRefs: string[];
    evidenceSourceRef: string;
  };
  destination: {
    instructionRef: string;
    householdRef: string;
    ownerRefs: string[];
    ownership: "same-household" | "cross-household";
    verificationState: "verified" | "unverified" | "missing";
    discriminatorState: "unique" | "collision" | "missing";
    evidenceSourceRef: string;
  };
  liquidity: {
    sources: LiquiditySource[];
    selectedFundingRefs: string[];
    reserveState: "modeled-scalar" | "modeled-segmented" | "missing";
    reserveRequiredMinor: number | null;
    reserveEvidenceSourceRef: string;
    withdrawalSegmentsMinor: number[];
    pendingAction: PendingReplay;
  };
  authority: {
    grantRef: string | null;
    actorRef: string;
    evidenceSourceRef: string;
    authorityScope: "distribution-request" | "other" | "missing";
    authorityState:
      | "effective"
      | "expired"
      | "not-yet-effective"
      | "wrong-scope"
      | "missing";
    validFrom: string | null;
    validTo: string | null;
  };
  policy: {
    policyRef: string;
    policyVersionRef: string;
    evidenceSourceRef: string;
    thresholdMinor: number;
    thresholdComparison: "below" | "equal" | "above";
    restrictionRef: string | null;
    restrictionEvidenceSourceRef: string | null;
    restrictionState: "absent" | "in-force" | "expired" | "future";
    legalHoldRef: string | null;
    legalHoldEvidenceSourceRef: string | null;
    legalHoldScope: "none" | "account" | "position";
  };
  instructionConflict: {
    conflictState: "none" | "present" | "resolved";
    requestRef: string;
    householdRef: string;
    instructions: Array<{
      instructionRef: string;
      householdRef: string;
    }>;
    impactedSubjectRefs: string[];
    evidenceSourceRef: string;
  };
  taxReviewState:
    | "not-required"
    | "required-pending"
    | "completed"
    | "unavailable";
  taxReviewEvidenceSourceRef: string;
  temporal: {
    eventAt: string;
    timeZoneRuleRef: string;
    transitionState: "standard" | "daylight" | "boundary";
    evidenceSourceRef: string;
  };
  outcomes: TreatmentOutcome[];
  evidenceRefs: string[];
  execution: {
    reservationKeys: string[];
    preconditions: string[];
    evidenceSourceRef: string;
  };
};

type EvidenceBase = {
  id: string;
  evidenceKind: RealDerivedEvidenceKind;
  subjectRef: string;
  sourceRef: string;
  retrievedAt: string;
};

export type RealDerivedEvidence =
  | (EvidenceBase & {
      observationState: "observed";
      observedAt: string;
      freshness: "fresh" | "stale";
    })
  | (EvidenceBase & {
      observationState: "missing";
      observedAt: null;
      freshness: "unknown";
    });

export type RealDerivedCase = {
  caseId: string;
  corpusVersion: string;
  occurredAt: string;
  scrubAttestation: {
    extractedAt: string;
    extractedBy: string;
    scrubbedBy: string;
    scrubbedAt: string;
    reviewedBy: string;
    reviewedAt: string;
    recordsBefore: number;
    recordsAfter: number;
  };
  label:
    | { kind: "defect"; defectClassId: string }
    | { kind: "clean-control"; controlRationaleId: string };
  evaluation: { asOf: string; freshnessPolicyVersion: string };
  subjects: string[];
  replayPayload: ReplayPayload;
  evidence: RealDerivedEvidence[];
  reservations: Array<{ family: string; conflictKey: string }>;
};
