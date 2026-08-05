import type {
  SignedEvidenceData,
  SignedMoneyData,
} from "./signed-case-types";
import {
  asBoolean,
  asMinor,
  asNullableMinor,
  asNumber,
  asRecord,
  asString,
} from "./signed-case-fields";

export function parseMoney(
  value: unknown,
  path: string,
  structuredMoneyMissing: boolean,
): SignedMoneyData {
  if (value === undefined && structuredMoneyMissing) {
    return {
      currency: null,
      cadence: null,
      requestAmountMinor: null,
      plannedWithdrawalMonthlyMinor: null,
      reserveFloorMinor: null,
      availableLiquidityMinor: null,
      pendingLiquidityMinor: null,
      preExecutionRevalidation: null,
    };
  }
  const money = asRecord(value, path);
  const revalidation =
    money.preExecutionRevalidation === undefined
      ? null
      : asRecord(
          money.preExecutionRevalidation,
          `${path}.preExecutionRevalidation`,
        );
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

export function parseEvidence(
  value: unknown,
  path: string,
): SignedEvidenceData {
  const evidence = asRecord(value, path);
  const rawDisplayValue =
    evidence.displayValue === undefined
      ? null
      : asRecord(evidence.displayValue, `${path}.displayValue`);
  const unit = rawDisplayValue
    ? asString(rawDisplayValue.unit, `${path}.displayValue.unit`)
    : null;
  if (unit !== null && unit !== "USD" && unit !== "USD/month") {
    throw new TypeError(`${path}.displayValue.unit is unsupported`);
  }
  return {
    ...(evidence.snapshotId === undefined
      ? {}
      : {
          snapshotId: asString(
            evidence.snapshotId,
            `${path}.snapshotId`,
          ),
        }),
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
    displayValue:
      rawDisplayValue && unit
        ? {
            valueMinor: asMinor(
              rawDisplayValue.value,
              `${path}.displayValue.value`,
            ),
            unit,
          }
        : null,
    freshnessWindowDays:
      evidence.freshnessWindowDays === undefined
        ? null
        : asNumber(
            evidence.freshnessWindowDays,
            `${path}.freshnessWindowDays`,
          ),
  };
}
