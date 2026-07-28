import {
  EXECUTION_RECEIPT_IDS,
  OBSERVED_STATUS_IDS,
  VERIFICATION_PROJECTION_IDS,
} from "@contracts/execution-status";
import { reserveFloorMinor } from "@contracts/money-movement";
import type { LoadedCase, ScenarioRefs } from "./golden-cases.lib";

export interface DemoSemanticSnapshot {
  requestAmountMinor: number;
  plannedWithdrawalMonthlyMinor: number;
  moneyUnit: "currency-minor";
  currency: "USD";
  cadence: "month";
  minorUnitsPerMajor: number;
  firms: Array<{
    id: string;
    reserveMonths: number;
    reserveFloorMinor: number;
  }>;
  executionTimelineStatuses: string[];
  verificationTimelineStatuses: string[];
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const caseData = (cases: LoadedCase[], id: string): Record<string, unknown> | undefined => {
  const found = cases.find(({ data }) => isObj(data) && data.caseId === id);
  return found && isObj(found.data) ? found.data : undefined;
};
const evidenceSummary = (c: Record<string, unknown>, kind: string): string | undefined => {
  if (!Array.isArray(c.householdEvidence)) return undefined;
  const row = c.householdEvidence.find(
    (value) => isObj(value) && value.evidenceKind === kind,
  );
  return isObj(row) && typeof row.summary === "string" ? row.summary : undefined;
};
const parseRequest = (c: Record<string, unknown>): { amount: number; currency: string } | undefined => {
  const trigger = c.trigger;
  const summary = isObj(trigger) ? trigger.maskedRequestSummary : undefined;
  const match = typeof summary === "string" ? summary.match(/\bdistribute\s+(\d+)\s+([A-Z]{3})\b/i) : null;
  return match ? { amount: Number(match[1]), currency: match[2]!.toUpperCase() } : undefined;
};
const parseReserve = (
  c: Record<string, unknown>,
): { monthly: number; currency: string; cadence: string; floor: number } | undefined => {
  const summary = evidenceSummary(c, "planned-withdrawals");
  const match = summary?.match(
    /planned withdrawals\s+(\d+)\s+([A-Z]{3})\/([a-z]+).*reserve\s*=\s*(\d+)\s+([A-Z]{3})/i,
  );
  if (!match || match[2]!.toUpperCase() !== match[5]!.toUpperCase()) return undefined;
  return {
    monthly: Number(match[1]),
    currency: match[2]!.toUpperCase(),
    cadence: match[3]!.toLowerCase(),
    floor: Number(match[4]),
  };
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

  for (const [caseId, firmId] of canonicalCases) {
    const c = caseData(cases, caseId);
    if (!c) {
      problems.push(`${caseId}: signed canonical fixture missing`);
      continue;
    }
    const request = parseRequest(c);
    const reserve = parseReserve(c);
    const config = isObj(c.firmConfiguration) ? c.firmConfiguration : undefined;
    const demoFirm = demo.firms.find((firm) => firm.id === firmId);
    if (!request) problems.push(`${caseId}: canonical request amount and currency are not parseable`);
    if (!reserve) problems.push(`${caseId}: planned withdrawal, cadence, and reserve floor are not parseable`);
    if (!demoFirm) problems.push(`${caseId}: demo has no firm "${firmId}"`);
    if (!request || !reserve || !demoFirm) continue;

    const reserveMonths = typeof config?.cashReserveMonths === "number"
      ? config.cashReserveMonths
      : Number.NaN;
    const expectedRequestMinor = request.amount * demo.minorUnitsPerMajor;
    const expectedMonthlyMinor = reserve.monthly * demo.minorUnitsPerMajor;
    const expectedFloorMinor = reserve.floor * demo.minorUnitsPerMajor;
    if (request.currency !== demo.currency || reserve.currency !== demo.currency) {
      problems.push(`${caseId}: currency drift, fixture=${request.currency}/${reserve.currency}, demo=${demo.currency}`);
    }
    if (reserve.cadence !== demo.cadence) {
      problems.push(`${caseId}: reserve cadence drift, fixture=${reserve.cadence}, demo=${demo.cadence}`);
    }
    if (demo.moneyUnit !== "currency-minor" || demo.minorUnitsPerMajor !== 100) {
      problems.push(`${caseId}: demo money unit must be currency-minor with 100 minor units per major`);
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
    if (refs.canonicalRequestAmountUsd !== request.amount) {
      problems.push(`${caseId}: scenarios.yaml canonical request amount drift`);
    }
    if (reserveFloorMinor(expectedMonthlyMinor, reserveMonths) !== expectedFloorMinor) {
      problems.push(`${caseId}: signed reserve floor is not monthly withdrawal times reserve horizon`);
    }
    if (demoFirm.reserveFloorMinor !== expectedFloorMinor) {
      problems.push(`${caseId}: derived reserve floor drift, fixture=${expectedFloorMinor}, demo=${demoFirm.reserveFloorMinor}`);
    }
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
