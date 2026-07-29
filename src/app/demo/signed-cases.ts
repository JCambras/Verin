import { minorFromMajor } from "@contracts/money-movement";
import type { DispositionKind } from "./model";
import { RAW_SIGNED_CASES } from "./signed-case-fixtures";
export const SIGNED_CASE_IDS = [
  "GC-01-firm-a-happy-path",
  "GC-02-firm-b-happy-path",
  "GC-03-recent-bank-change-firm-a",
  "GC-04-recent-bank-change-firm-b",
  "GC-05-insufficient-liquidity",
  "GC-06-household-restriction",
  "GC-07-regulatory-prohibition",
  "GC-08-ambiguous-household",
  "GC-09-stale-evidence",
  "GC-10-simultaneous-distributions-first",
  "GC-11-simultaneous-distributions-second",
  "GC-12-duplicate-retry",
  "GC-13-partial-salesforce-success",
  "GC-14-delayed-nigo",
  "GC-15-approval-invalidation",
  "GC-16-specialist-review-expiration",
] as const;

export type SignedCaseId = (typeof SIGNED_CASE_IDS)[number];
export type SignedAuthorityMode =
  | "none"
  | "automatic"
  | "approval"
  | "specialist_review";

export interface SignedMoneyData {
  readonly currency: string;
  readonly cadence: string;
  readonly requestAmountMinor: number;
  readonly plannedWithdrawalMonthlyMinor: number | null;
  readonly reserveFloorMinor: number | null;
  readonly availableLiquidityMinor: number | null;
  readonly pendingLiquidityMinor: number | null;
  readonly preExecutionRevalidation: {
    readonly availableLiquidityMinor: number;
    readonly pendingLiquidityMinor: number;
  } | null;
}

export interface SignedEvidenceData {
  readonly evidenceKind: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly freshness: string;
  readonly source: string;
  readonly provenance: string;
  readonly summary: string;
  readonly liquidityPhase: string | null;
  readonly observedAbsent: boolean;
}

export interface SignedEscalationData {
  readonly after: string;
  readonly roleIds: readonly string[];
  readonly reasonCode: string;
}

export interface SignedAuthorityStageData {
  readonly stageId: string;
  readonly order: number;
  readonly executionMode: "sequential" | "parallel";
  readonly eligibleRoleIds: readonly string[];
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly requesterMayApprove: boolean;
  readonly expiresAfter: string;
  readonly escalationPath: readonly SignedEscalationData[];
}

export interface SignedAuthorityData {
  readonly mode: SignedAuthorityMode;
  readonly stages: readonly SignedAuthorityStageData[];
  readonly note: string;
}

export interface SignedReservationData {
  readonly reservationId: string;
  readonly conflictKeys: readonly string[];
  readonly expiresAfter: string;
}

export interface SignedPreconditionData {
  readonly code: string;
  readonly requiredEvidence: readonly string[];
  readonly mustStillHoldAtExecution: boolean;
}

export interface SignedExecutionEligibilityData {
  readonly eligible: boolean;
  readonly reason: string;
  readonly idempotencyKey: string | null;
  readonly reservations: readonly SignedReservationData[];
  readonly preconditions: readonly SignedPreconditionData[];
}

export interface SignedVerificationData {
  readonly reached: boolean;
  readonly observedStatus: string | null;
  readonly settledClaim: string | null;
  readonly note: string;
}

export interface SignedLedgerEventData {
  readonly type: string;
  readonly note: string;
}

export interface SignedExplanationData {
  readonly code: string;
  readonly summary: string;
}

export interface SignedCaseVariant {
  readonly caseId: SignedCaseId;
  readonly scenarioId: string | null;
  readonly firmId: string;
  readonly disposition: DispositionKind;
  readonly trigger: {
    readonly description: string;
    readonly requestAt: string;
  };
  readonly money: SignedMoneyData;
  readonly evidence: readonly SignedEvidenceData[];
  readonly authority: SignedAuthorityData;
  readonly executionEligibility: SignedExecutionEligibilityData;
  readonly verification: SignedVerificationData;
  readonly ledgerEvents: readonly SignedLedgerEventData[];
  readonly explanations: readonly SignedExplanationData[];
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as UnknownRecord;
};

const asArray = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
};

const asString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
};

const asNullableString = (value: unknown, path: string): string | null =>
  value === null ? null : asString(value, path);

const asNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
};

const asBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
};

const asMinor = (value: unknown, path: string): number => {
  const minor = minorFromMajor(asNumber(value, path));
  if (minor === null) throw new RangeError(`${path} cannot be represented in minor units`);
  return minor;
};

const asNullableMinor = (value: unknown, path: string): number | null =>
  value === null ? null : asMinor(value, path);

const asStringArray = (value: unknown, path: string): string[] =>
  asArray(value, path).map((entry, index) =>
    asString(entry, `${path}[${index}]`),
  );

function parseMoney(value: unknown, path: string): SignedMoneyData {
  const money = asRecord(value, path);
  const revalidation =
    money.preExecutionRevalidation === undefined
      ? null
      : asRecord(money.preExecutionRevalidation, `${path}.preExecutionRevalidation`);
  return {
    currency: asString(money.currency, `${path}.currency`),
    cadence: asString(money.cadence, `${path}.cadence`),
    requestAmountMinor: asMinor(
      money.requestAmountUsd,
      `${path}.requestAmountUsd`,
    ),
    plannedWithdrawalMonthlyMinor: asNullableMinor(
      money.plannedWithdrawalMonthlyUsd,
      `${path}.plannedWithdrawalMonthlyUsd`,
    ),
    reserveFloorMinor: asNullableMinor(
      money.reserveFloorUsd,
      `${path}.reserveFloorUsd`,
    ),
    availableLiquidityMinor: asNullableMinor(
      money.availableLiquidityUsd,
      `${path}.availableLiquidityUsd`,
    ),
    pendingLiquidityMinor: asNullableMinor(
      money.pendingLiquidityUsd,
      `${path}.pendingLiquidityUsd`,
    ),
    preExecutionRevalidation: revalidation
      ? {
          availableLiquidityMinor: asMinor(
            revalidation.availableLiquidityUsd,
            `${path}.preExecutionRevalidation.availableLiquidityUsd`,
          ),
          pendingLiquidityMinor: asMinor(
            revalidation.pendingLiquidityUsd,
            `${path}.preExecutionRevalidation.pendingLiquidityUsd`,
          ),
        }
      : null,
  };
}

function parseEvidence(value: unknown, path: string): SignedEvidenceData {
  const evidence = asRecord(value, path);
  return {
    evidenceKind: asString(evidence.evidenceKind, `${path}.evidenceKind`),
    subjectRef: asString(evidence.subjectRef, `${path}.subjectRef`),
    observedAt: asString(evidence.observedAt, `${path}.observedAt`),
    retrievedAt: asString(evidence.retrievedAt, `${path}.retrievedAt`),
    freshness: asString(evidence.freshness, `${path}.freshness`),
    source: asString(evidence.source, `${path}.source`),
    provenance: asString(evidence.provenance, `${path}.provenance`),
    summary: asString(evidence.summary, `${path}.summary`),
    liquidityPhase:
      evidence.liquidityPhase === undefined
        ? null
        : asString(evidence.liquidityPhase, `${path}.liquidityPhase`),
    observedAbsent:
      evidence.observedAbsent === undefined
        ? false
        : asBoolean(evidence.observedAbsent, `${path}.observedAbsent`),
  };
}

function parseStage(value: unknown, path: string): SignedAuthorityStageData {
  const stage = asRecord(value, path);
  const mode = asString(stage.executionMode, `${path}.executionMode`);
  if (mode !== "sequential" && mode !== "parallel") {
    throw new TypeError(`${path}.executionMode is unsupported`);
  }
  return {
    stageId: asString(stage.stageId, `${path}.stageId`),
    order: asNumber(stage.order, `${path}.order`),
    executionMode: mode,
    eligibleRoleIds: asStringArray(
      stage.eligibleRoleIds,
      `${path}.eligibleRoleIds`,
    ),
    approvalsRequired: asNumber(
      stage.approvalsRequired,
      `${path}.approvalsRequired`,
    ),
    distinctActorsRequired: asBoolean(
      stage.distinctActorsRequired,
      `${path}.distinctActorsRequired`,
    ),
    requesterMayApprove: asBoolean(
      stage.requesterMayApprove,
      `${path}.requesterMayApprove`,
    ),
    expiresAfter: asString(stage.expiresAfter, `${path}.expiresAfter`),
    escalationPath: asArray(
      stage.escalationPath,
      `${path}.escalationPath`,
    ).map((entry, index) => {
      const escalation = asRecord(
        entry,
        `${path}.escalationPath[${index}]`,
      );
      return {
        after: asString(
          escalation.after,
          `${path}.escalationPath[${index}].after`,
        ),
        roleIds: asStringArray(
          escalation.roleIds,
          `${path}.escalationPath[${index}].roleIds`,
        ),
        reasonCode: asString(
          escalation.reasonCode,
          `${path}.escalationPath[${index}].reasonCode`,
        ),
      };
    }),
  };
}

function parseVariant(value: unknown): SignedCaseVariant {
  const fixture = asRecord(value, "fixture");
  const caseId = asString(fixture.caseId, "fixture.caseId");
  if (!SIGNED_CASE_IDS.includes(caseId as SignedCaseId)) {
    throw new TypeError(`fixture.caseId ${caseId} is unsupported`);
  }
  const disposition = asString(
    fixture.expectedDisposition,
    `${caseId}.expectedDisposition`,
  );
  if (
    disposition !== "proceed" &&
    disposition !== "blocked" &&
    disposition !== "prohibited"
  ) {
    throw new TypeError(`${caseId}.expectedDisposition is unsupported`);
  }
  const trigger = asRecord(fixture.trigger, `${caseId}.trigger`);
  const authority = asRecord(
    fixture.expectedAuthority,
    `${caseId}.expectedAuthority`,
  );
  const mode = asString(authority.mode, `${caseId}.expectedAuthority.mode`);
  if (
    mode !== "none" &&
    mode !== "automatic" &&
    mode !== "approval" &&
    mode !== "specialist_review"
  ) {
    throw new TypeError(`${caseId}.expectedAuthority.mode is unsupported`);
  }
  const eligibility = asRecord(
    fixture.expectedExecutionEligibility,
    `${caseId}.expectedExecutionEligibility`,
  );
  const verification = asRecord(
    fixture.expectedVerificationState,
    `${caseId}.expectedVerificationState`,
  );
  return {
    caseId: caseId as SignedCaseId,
    scenarioId:
      fixture.scenarioRef === null
        ? null
        : asString(fixture.scenarioRef, `${caseId}.scenarioRef`),
    firmId: asString(fixture.firm, `${caseId}.firm`),
    disposition,
    trigger: {
      description: asString(trigger.description, `${caseId}.trigger.description`),
      requestAt: asString(trigger.asOf, `${caseId}.trigger.asOf`),
    },
    money: parseMoney(fixture.signedMoney, `${caseId}.signedMoney`),
    evidence: asArray(
      fixture.householdEvidence,
      `${caseId}.householdEvidence`,
    ).map((entry, index) =>
      parseEvidence(entry, `${caseId}.householdEvidence[${index}]`),
    ),
    authority: {
      mode,
      stages: asArray(
        authority.stages,
        `${caseId}.expectedAuthority.stages`,
      ).map((entry, index) =>
        parseStage(entry, `${caseId}.expectedAuthority.stages[${index}]`),
      ),
      note: asString(authority.note, `${caseId}.expectedAuthority.note`),
    },
    executionEligibility: {
      eligible: asBoolean(
        eligibility.eligible,
        `${caseId}.expectedExecutionEligibility.eligible`,
      ),
      reason: asString(
        eligibility.reason,
        `${caseId}.expectedExecutionEligibility.reason`,
      ),
      idempotencyKey: asNullableString(
        eligibility.idempotencyKey,
        `${caseId}.expectedExecutionEligibility.idempotencyKey`,
      ),
      reservations: asArray(
        eligibility.reservations,
        `${caseId}.expectedExecutionEligibility.reservations`,
      ).map((entry, index) => {
        const reservation = asRecord(
          entry,
          `${caseId}.expectedExecutionEligibility.reservations[${index}]`,
        );
        return {
          reservationId: asString(
            reservation.reservationId,
            `${caseId}.expectedExecutionEligibility.reservations[${index}].reservationId`,
          ),
          conflictKeys: asStringArray(
            reservation.conflictKeys,
            `${caseId}.expectedExecutionEligibility.reservations[${index}].conflictKeys`,
          ),
          expiresAfter: asString(
            reservation.expiresAfter,
            `${caseId}.expectedExecutionEligibility.reservations[${index}].expiresAfter`,
          ),
        };
      }),
      preconditions: asArray(
        eligibility.preconditions,
        `${caseId}.expectedExecutionEligibility.preconditions`,
      ).map((entry, index) => {
        const precondition = asRecord(
          entry,
          `${caseId}.expectedExecutionEligibility.preconditions[${index}]`,
        );
        return {
          code: asString(
            precondition.code,
            `${caseId}.expectedExecutionEligibility.preconditions[${index}].code`,
          ),
          requiredEvidence: asStringArray(
            precondition.requiredEvidence,
            `${caseId}.expectedExecutionEligibility.preconditions[${index}].requiredEvidence`,
          ),
          mustStillHoldAtExecution: asBoolean(
            precondition.mustStillHoldAtExecution,
            `${caseId}.expectedExecutionEligibility.preconditions[${index}].mustStillHoldAtExecution`,
          ),
        };
      }),
    },
    verification: {
      reached: asBoolean(
        verification.reached,
        `${caseId}.expectedVerificationState.reached`,
      ),
      observedStatus:
        verification.observedStatus === null
          ? null
          : asString(
              verification.observedStatus,
              `${caseId}.expectedVerificationState.observedStatus`,
            ),
      settledClaim:
        verification.settledClaim === null
          ? null
          : asString(
              verification.settledClaim,
              `${caseId}.expectedVerificationState.settledClaim`,
            ),
      note: asString(
        verification.note,
        `${caseId}.expectedVerificationState.note`,
      ),
    },
    ledgerEvents: asArray(
      fixture.expectedLedgerEvents,
      `${caseId}.expectedLedgerEvents`,
    ).map((entry, index) => {
      const ledger = asRecord(entry, `${caseId}.expectedLedgerEvents[${index}]`);
      return {
        type: asString(
          ledger.type,
          `${caseId}.expectedLedgerEvents[${index}].type`,
        ),
        note: asString(
          ledger.note,
          `${caseId}.expectedLedgerEvents[${index}].note`,
        ),
      };
    }),
    explanations: asArray(
      fixture.expectedExplanationNodes,
      `${caseId}.expectedExplanationNodes`,
    ).map((entry, index) => {
      const explanation = asRecord(
        entry,
        `${caseId}.expectedExplanationNodes[${index}]`,
      );
      return {
        code: asString(
          explanation.code,
          `${caseId}.expectedExplanationNodes[${index}].code`,
        ),
        summary: asString(
          explanation.summary,
          `${caseId}.expectedExplanationNodes[${index}].summary`,
        ),
      };
    }),
  };
}

export const SIGNED_CASE_VARIANTS = RAW_SIGNED_CASES.map(parseVariant);

export const SIGNED_CASE_BY_ID = Object.fromEntries(
  SIGNED_CASE_VARIANTS.map((variant) => [variant.caseId, variant]),
) as Readonly<Record<SignedCaseId, SignedCaseVariant>>;
