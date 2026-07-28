import { formatMetricValue, type DisplayMetric } from "@contracts/metric";
import { MONEY_CURRENCY, RESERVE_CADENCE } from "@contracts/money-movement";
import { buildExecution, buildVerification } from "../src/app/demo/build-outcome";
import { amountMetric, reserveFloorMetric, reserveFloorMinor } from "../src/app/demo/build-decision";
import { DRAFT_RESERVE_MONTHS, buildPolicyAuthoring } from "../src/app/demo/build-summary";
import {
  CANONICAL_REQUEST,
  FIRMS,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SCENARIOS,
  firmById,
} from "../src/app/demo/data";
import type { DemoSemanticSnapshot } from "./golden-demo-semantics.lib";

const DRAFT_FLOOR_LABEL = "Smith household reserve floor";

/** Invert the SHIPPED renderer to recover the minor-units-per-major divisor it
 * actually applies. Reading the constant would only prove the constant; formatting
 * a real demo metric and dividing the raw minor value by the rendered major value
 * catches a divisor changed anywhere on the display path. */
function renderedMinorUnitsPerMajor(money: DisplayMetric): number | null {
  const major = Number(formatMetricValue(money).replace(/[^0-9.]/g, ""));
  const minor = Number(money.value);
  if (!Number.isFinite(major) || major === 0 || !Number.isFinite(minor)) return null;
  return minor / major;
}

/** The reserve floor surface 11 actually displays for the drafted twelve-month policy. */
function draftedReserveFloorMinor(): number | null {
  const row = buildPolicyAuthoring(SCENARIOS[0]!, firmById("firm-a")).simulationDelta.find(
    (delta) => delta.label === DRAFT_FLOOR_LABEL,
  );
  const value = row?.after.metric?.value;
  return typeof value === "number" ? value : null;
}

/** Project the actual demo constants and emitted rows into the pure fence. */
export function loadDemoSemanticSnapshot(): DemoSemanticSnapshot {
  const firms = Object.values(FIRMS);
  const moneyMetrics = [amountMetric(), ...firms.map((firm) => reserveFloorMetric(firm))];
  return {
    requestAmountMinor: CANONICAL_REQUEST.amountMinor,
    plannedWithdrawalMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    moneyUnits: [...new Set(moneyMetrics.map((money) => money.format))],
    minorUnitsPerMajor: [...new Set(moneyMetrics.map(renderedMinorUnitsPerMajor))],
    currency: MONEY_CURRENCY,
    cadence: RESERVE_CADENCE,
    firms: firms.map((firm) => ({
      id: firm.id,
      reserveMonths: firm.reserveMonths,
      reserveFloorMinor: reserveFloorMinor(firm),
    })),
    draftedReserveMonths: DRAFT_RESERVE_MONTHS,
    draftedReserveFloorMinor: draftedReserveFloorMinor(),
    executionTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      buildExecution(scenario).rows.map((row) => row.status),
    ),
    verificationTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      buildVerification(scenario).appended.map((row) => row.status),
    ),
  };
}
