import { OBSERVED_STATUS_IDS } from "@contracts/execution-status";
import { buildExecution, buildVerification } from "../src/app/demo/build-outcome";
import { reserveFloorMinor } from "../src/app/demo/build-decision";
import {
  CANONICAL_REQUEST,
  FIRMS,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SCENARIOS,
} from "../src/app/demo/data";
import type { DemoSemanticSnapshot } from "./golden-demo-semantics.lib";

/** Project the actual demo constants and emitted rows into the pure fence. */
export function loadDemoSemanticSnapshot(): DemoSemanticSnapshot {
  return {
    requestAmountMinor: CANONICAL_REQUEST.amountMinor,
    plannedWithdrawalMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    moneyUnit: "currency-minor",
    currency: "USD",
    cadence: "month",
    minorUnitsPerMajor: 100,
    firms: Object.values(FIRMS).map((firm) => ({
      id: firm.id,
      reserveMonths: firm.reserveMonths,
      reserveFloorMinor: reserveFloorMinor(firm),
    })),
    executionTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      buildExecution(scenario).rows.map((row) => row.status),
    ),
    verificationTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      buildVerification(scenario).appended.map((row) => row.status),
    ),
  };
}

/** Compile-time linkage keeps the snapshot on the canonical observed vocabulary. */
export const DEMO_OBSERVED_STATUS_IDS = OBSERVED_STATUS_IDS;
