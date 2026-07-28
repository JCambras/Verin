import { formatMetricValue, type DisplayMetric } from "@contracts/metric";
import { MONEY_CURRENCY, RESERVE_CADENCE } from "@contracts/money-movement";
import { buildExecution, buildVerification } from "../src/app/demo/build-outcome";
import { getJourney } from "../src/app/demo/journey";
import {
  amountMetric,
  headroomMetric,
  headroomMinor,
  reserveFloorMetric,
  reserveFloorMinor,
  buildStages,
} from "../src/app/demo/build-decision";
import { DRAFT_RESERVE_MONTHS, buildPolicyAuthoring } from "../src/app/demo/build-summary";
import {
  CANONICAL_REQUEST,
  FIRMS,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SCENARIOS,
  dispositionFor,
  firmById,
  liquidityAuthorityFor,
} from "../src/app/demo/data";
import type { DemoSemanticSnapshot, DisplayedDecision, RenderedMoney } from "./golden-demo-semantics.lib";

const DRAFT_FLOOR_LABEL = "Smith household reserve floor";
const DRAFT_HEADROOM_LABEL = "Available after reserve";
const DRAFT_REQUEST_LABEL = "This request";

/** Run a real demo money metric through the SHIPPED renderer and carry both sides
 * across to the fence. Reading the constant would only prove the constant; the
 * fence inverts this rendered string with integer arithmetic, so a divisor changed
 * anywhere on the display path shows up as a mismatch rather than a rounding blur. */
function renderMoney(money: DisplayMetric): RenderedMoney {
  return { minor: Number(money.value), rendered: formatMetricValue(money) };
}

/** Surface 11's simulated policy draft, as it is actually emitted for a branch. */
function draftSimulation(scenarioId: string, firmId: string) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const rows = buildPolicyAuthoring(scenario, firmById(firmId)).simulationDelta;
  const numberAt = (label: string): number | null => {
    const value = rows.find((row) => row.label === label)?.after.metric?.value;
    return typeof value === "number" ? value : null;
  };
  return {
    floorMinor: numberAt(DRAFT_FLOOR_LABEL),
    headroomMinor: numberAt(DRAFT_HEADROOM_LABEL),
    disposition: rows.find((row) => row.label === DRAFT_REQUEST_LABEL)?.after.badge?.status ?? null,
  };
}

/** Every decision the demo actually renders, with the liquidity arithmetic behind it. */
function displayedDecisions(): DisplayedDecision[] {
  return SCENARIOS.flatMap((scenario) =>
    Object.values(FIRMS).map((firm) => {
      const simulated = draftSimulation(scenario.id, firm.id);
      const authority = liquidityAuthorityFor(scenario, firm.id);
      const initial = authority.kind === "signed" ? authority.initialDecision : null;
      const revalidation = authority.kind === "signed" ? authority.preExecutionRevalidation : undefined;
      return {
        scenarioId: scenario.id,
        firmId: firm.id,
        disposition: dispositionFor(scenario, firm.id),
        sourceCaseId: authority.kind === "signed" ? authority.sourceCaseId : null,
        liquidityAuthorityMissing: authority.kind === "missing" ? authority.reason : null,
        availableCashMinor: initial?.availableCashMinor ?? null,
        pendingActivityMinor: initial?.pendingActivityMinor ?? null,
        reserveFloorMinor: reserveFloorMinor(firm),
        headroomMinor: headroomMinor(scenario, firm),
        revalidationAvailableCashMinor: revalidation?.availableCashMinor ?? null,
        revalidationPendingActivityMinor: revalidation?.pendingActivityMinor ?? null,
        simulatedFloorMinor: simulated.floorMinor,
        simulatedHeadroomMinor: simulated.headroomMinor,
        simulatedDisposition: simulated.disposition,
      };
    }),
  );
}

/** Project the actual demo constants and emitted rows into the pure fence. */
export function loadDemoSemanticSnapshot(): DemoSemanticSnapshot {
  const firms = Object.values(FIRMS);
  const moneyMetrics = [
    amountMetric(),
    ...firms.map((firm) => reserveFloorMetric(firm)),
    ...SCENARIOS.flatMap((scenario) =>
      firms.flatMap((firm) => {
        const headroom = headroomMetric(scenario, firm);
        return headroom ? [headroom] : [];
      }),
    ),
  ];
  const lapseScenario = SCENARIOS.find((scenario) => scenario.id === "specialist-review-expiration")!;
  const authorityLapseEvents = buildStages(lapseScenario, FIRMS["firm-a"]!, "final")
    .flatMap((stage) => stage.authorityEvents ?? [])
    .map(({ type, timestamp }) => ({ type, timestamp }));
  const invalidationJourney = getJourney("approval-invalidation", "firm-a");
  const initialSurfaceMoneyMinor = [
    invalidationJourney.workspace.liquidity?.value,
    invalidationJourney.workspace.plannedMonthlyWithdrawal.value,
    ...invalidationJourney.evidence.rows.flatMap((row) => row.kind === "metric" ? [row.metric.value] : []),
    ...(invalidationJourney.recommendation.disposition.figures ?? []).map((figure) => figure.metric.value),
    ...(invalidationJourney.approvals?.gate.figures ?? []).map((figure) => figure.metric.value),
  ].flatMap((value) => typeof value === "number" ? [value] : []);
  const invalidation = invalidationJourney.safety?.invalidation;
  return {
    requestAmountMinor: CANONICAL_REQUEST.amountMinor,
    plannedWithdrawalMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    moneyUnits: [...new Set(moneyMetrics.map((money) => money.format))],
    moneyRenders: moneyMetrics.map(renderMoney),
    currency: MONEY_CURRENCY,
    cadence: RESERVE_CADENCE,
    firms: firms.map((firm) => ({
      id: firm.id,
      reserveMonths: firm.reserveMonths,
      reserveFloorMinor: reserveFloorMinor(firm),
    })),
    decisions: displayedDecisions(),
    draftedReserveMonths: DRAFT_RESERVE_MONTHS,
    draftedReserveFloorMinor: draftSimulation(SCENARIOS[0]!.id, "firm-a").floorMinor,
    executionTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      buildExecution(scenario).rows.map((row) => row.status),
    ),
    verificationTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      buildVerification(scenario).appended.map((row) => row.status),
    ),
    authorityLapseEvents,
    approvalInvalidationPhases: {
      initialSurfaceMoneyMinor,
      safetyBeforePendingMinor:
        typeof invalidation?.before.metric.value === "number" ? invalidation.before.metric.value : null,
      safetyAfterPendingMinor:
        typeof invalidation?.after.metric.value === "number" ? invalidation.after.metric.value : null,
    },
  };
}
