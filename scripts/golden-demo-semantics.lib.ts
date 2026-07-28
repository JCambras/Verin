import type { MetricFormat } from "@contracts/metric";
import {
  EXECUTION_RECEIPT_IDS,
  OBSERVED_STATUS_IDS,
  VERIFICATION_PROJECTION_IDS,
} from "@contracts/execution-status";
import {
  MINOR_UNITS_PER_MAJOR,
  MONEY_METRIC_FORMAT,
  isMoneyQuantity,
  minorFromMajor,
  reserveFloorMinor,
} from "@contracts/money-movement";
import { readSignedMoney, type LoadedCase, type ScenarioRefs } from "./golden-cases.lib";

export interface DemoSemanticSnapshot {
  requestAmountMinor: number;
  plannedWithdrawalMonthlyMinor: number;
  /** Every distinct format the demo's money metrics actually carry. */
  moneyUnits: MetricFormat[];
  /** Every distinct divisor the shipped renderer actually applies to those metrics. */
  minorUnitsPerMajor: Array<number | null>;
  currency: string;
  cadence: string;
  firms: Array<{
    id: string;
    reserveMonths: number;
    reserveFloorMinor: number;
  }>;
  draftedReserveMonths: number;
  draftedReserveFloorMinor: number | null;
  executionTimelineStatuses: string[];
  verificationTimelineStatuses: string[];
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const caseData = (cases: LoadedCase[], id: string): Record<string, unknown> | undefined => {
  const found = cases.find(({ data }) => isObj(data) && data.caseId === id);
  return found && isObj(found.data) ? found.data : undefined;
};
const sameMembers = (left: Iterable<string>, right: Iterable<string>): boolean => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

/** Cross-artifact signed truth fence. The fixtures supply the numbers. */
export function validateGoldenDemoSemantics(
  cases: LoadedCase[],
  refs: ScenarioRefs,
  demo: DemoSemanticSnapshot,
): string[] {
  const problems: string[] = [];
  const canonicalCases = [
    ["GC-01-firm-a-happy-path", "firm-a"],
    ["GC-02-firm-b-happy-path", "firm-b"],
  ] as const;

  for (const unit of demo.moneyUnits) {
    if (unit !== MONEY_METRIC_FORMAT) {
      problems.push(`demo money metric carries format "${unit}", not "${MONEY_METRIC_FORMAT}"`);
    }
  }
  if (demo.moneyUnits.length === 0) problems.push("demo emits no money metrics to project a unit from");
  if (demo.minorUnitsPerMajor.length === 0) problems.push("demo renders no money value to project its divisor from");
  for (const divisor of demo.minorUnitsPerMajor) {
    if (divisor !== MINOR_UNITS_PER_MAJOR) {
      problems.push(`demo renders money at ${divisor ?? "an unreadable"} minor units per major, not ${MINOR_UNITS_PER_MAJOR}`);
    }
  }

  for (const [caseId, firmId] of canonicalCases) {
    const c = caseData(cases, caseId);
    if (!c) {
      problems.push(`${caseId}: signed canonical fixture missing`);
      continue;
    }
    const signed = readSignedMoney(c);
    const config = isObj(c.firmConfiguration) ? c.firmConfiguration : undefined;
    const demoFirm = demo.firms.find((firm) => firm.id === firmId);
    const reserveMonths = config?.cashReserveMonths;
    if (!signed) problems.push(`${caseId}: signedMoney is missing or malformed`);
    if (!isMoneyQuantity(reserveMonths)) problems.push(`${caseId}: firmConfiguration.cashReserveMonths is not a whole reserve horizon`);
    if (!demoFirm) problems.push(`${caseId}: demo has no firm "${firmId}"`);
    if (!signed || !isMoneyQuantity(reserveMonths) || !demoFirm) continue;

    const expectedRequestMinor = minorFromMajor(signed.requestAmountUsd);
    const expectedMonthlyMinor = minorFromMajor(signed.plannedWithdrawalMonthlyUsd);
    const expectedFloorMinor = minorFromMajor(signed.reserveFloorUsd);
    if (expectedRequestMinor === null) problems.push(`${caseId}: signedMoney.requestAmountUsd does not convert to minor units`);
    if (expectedMonthlyMinor === null) problems.push(`${caseId}: the canonical case must state signedMoney.plannedWithdrawalMonthlyUsd`);
    if (expectedFloorMinor === null) problems.push(`${caseId}: the canonical case must state signedMoney.reserveFloorUsd`);
    if (expectedRequestMinor === null || expectedMonthlyMinor === null || expectedFloorMinor === null) continue;

    if (signed.currency !== demo.currency) {
      problems.push(`${caseId}: currency drift, fixture=${signed.currency}, demo=${demo.currency}`);
    }
    if (signed.cadence !== demo.cadence) {
      problems.push(`${caseId}: reserve cadence drift, fixture=${signed.cadence}, demo=${demo.cadence}`);
    }
    if (demo.requestAmountMinor !== expectedRequestMinor) {
      problems.push(`${caseId}: request amount drift, fixture=${expectedRequestMinor}, demo=${demo.requestAmountMinor}`);
    }
    if (demo.plannedWithdrawalMonthlyMinor !== expectedMonthlyMinor) {
      problems.push(`${caseId}: planned-withdrawal drift, fixture=${expectedMonthlyMinor}, demo=${demo.plannedWithdrawalMonthlyMinor}`);
    }
    if (demoFirm.reserveMonths !== reserveMonths) {
      problems.push(`${caseId}: reserve horizon drift, fixture=${reserveMonths}, demo=${demoFirm.reserveMonths}`);
    }
    if (refs.firmReserveMonths.get(firmId) !== reserveMonths) {
      problems.push(`${caseId}: scenarios.yaml reserve horizon drift for ${firmId}`);
    }
    if (refs.canonicalRequestAmountUsd !== signed.requestAmountUsd) {
      problems.push(`${caseId}: scenarios.yaml canonical request amount drift`);
    }
    if (reserveFloorMinor(expectedMonthlyMinor, reserveMonths) !== expectedFloorMinor) {
      problems.push(`${caseId}: signed reserve floor is not monthly withdrawal times reserve horizon`);
    }
    if (demoFirm.reserveFloorMinor !== expectedFloorMinor) {
      problems.push(`${caseId}: derived reserve floor drift, fixture=${expectedFloorMinor}, demo=${demoFirm.reserveFloorMinor}`);
    }
    // Surface 11's simulated policy draft shows a floor too: bind it to the signed
    // horizon it simulates so the displayed figure cannot drift on its own path.
    if (demo.draftedReserveMonths === reserveMonths && demo.draftedReserveFloorMinor !== expectedFloorMinor) {
      problems.push(`${caseId}: drafted-policy reserve floor drift, fixture=${expectedFloorMinor}, demo=${demo.draftedReserveFloorMinor}`);
    }
  }

  if (demo.draftedReserveFloorMinor === null) {
    problems.push("the policy-draft simulation displays no reserve floor to fence");
  } else if (!isMoneyQuantity(demo.draftedReserveMonths) || !isMoneyQuantity(demo.plannedWithdrawalMonthlyMinor)) {
    problems.push("the policy-draft simulation has no whole reserve horizon or monthly schedule to derive from");
  } else if (
    demo.draftedReserveFloorMinor !== reserveFloorMinor(demo.plannedWithdrawalMonthlyMinor, demo.draftedReserveMonths)
  ) {
    problems.push("the policy-draft reserve floor is not the monthly withdrawal times the drafted horizon");
  }

  if (!sameMembers(refs.executionStates, OBSERVED_STATUS_IDS)) {
    problems.push(`scenarios.yaml execution statuses must equal ${OBSERVED_STATUS_IDS.join("|")}`);
  }
  const executionAllowed = new Set<string>([...OBSERVED_STATUS_IDS, ...EXECUTION_RECEIPT_IDS]);
  for (const status of demo.executionTimelineStatuses) {
    if (!executionAllowed.has(status)) {
      problems.push(`demo execution timeline status "${status}" is neither an observed outcome nor an execution receipt`);
    }
  }
  const verificationAllowed = new Set<string>([...OBSERVED_STATUS_IDS, ...VERIFICATION_PROJECTION_IDS]);
  for (const status of demo.verificationTimelineStatuses) {
    if (!verificationAllowed.has(status)) {
      problems.push(`demo verification timeline status "${status}" is neither an observed outcome nor a verification projection`);
    }
  }

  const gc16 = caseData(cases, "GC-16-specialist-review-expiration");
  const gc16Events = Array.isArray(gc16?.expectedLedgerEvents)
    ? gc16.expectedLedgerEvents.flatMap((event) =>
        isObj(event) && typeof event.type === "string" ? [event.type] : [],
      )
    : [];
  const requiredGc16 = [
    "EvidenceSnapshotRecorded",
    "DecisionRecorded",
    "ApprovalStageEscalated",
    "ApprovalStageExpired",
  ];
  if (!sameMembers(gc16Events, requiredGc16) ||
      gc16Events.some((event, index) => event !== requiredGc16[index])) {
    problems.push(`GC-16 event sequence must be ${requiredGc16.join(" -> ")}`);
  }
  return problems;
}
