import {
  headroomMinor as calculateHeadroomMinor,
  reserveFloorMinor as calculateReserveFloorMinor,
} from "@contracts/money-movement";
import type {
  DispositionKind,
  PolicyAuthoringVM,
  SimulationDeltaRowVM,
} from "./model";
import { derivedMetric } from "./provenance";
import { buildSpine } from "./spine";
import {
  DISPOSITION_BADGES,
  headroomMetric,
  reserveFloorMetric,
} from "./build-decision";
import { liquidityInputs } from "./build-decision-truth";
import {
  dispositionFor,
  liquidityAuthorityFor,
  plannedWithdrawalEvidenceFor,
  requestFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

export const DRAFT_RESERVE_MONTHS = 12;

function unavailableScheduleRows(
  disposition: DispositionKind,
): SimulationDeltaRowVM[] {
  const unavailable =
    "Not simulated without exact signed schedule evidence";
  return [
    {
      label: "Smith household reserve floor",
      before: {
        display: "Planned-withdrawal schedule unavailable",
      },
      after: { display: unavailable },
    },
    {
      label: "Available after reserve",
      before: {
        display:
          "Not calculated without exact signed schedule evidence",
      },
      after: { display: unavailable },
    },
    {
      label: "This request",
      before: { badge: DISPOSITION_BADGES[disposition] },
      after: { display: unavailable },
    },
  ];
}

export function buildPolicyAuthoring(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): PolicyAuthoringVM {
  const isFirmA = firm.id === "firm-a";
  const planned = plannedWithdrawalEvidenceFor(
    scenario,
    firm.id,
    pass,
  );
  const currentFloor = reserveFloorMetric(firm, scenario, pass);
  const twelveMonthFloor = planned
    ? calculateReserveFloorMinor(
        planned.displayValue!.valueMinor,
        DRAFT_RESERVE_MONTHS,
      )
    : null;
  const simulationInputs = liquidityInputs(
    scenario,
    firm,
    pass,
  );
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const snapshot =
    authority.kind === "signed"
      ? pass === "revalidated"
        ? (authority.preExecutionRevalidation ??
          authority.initialDecision)
        : authority.initialDecision
      : null;
  const newHeadroom =
    snapshot && twelveMonthFloor !== null
      ? calculateHeadroomMinor(
          snapshot.availableCashMinor,
          snapshot.pendingActivityMinor,
          twelveMonthFloor,
        )
      : null;
  const currentHeadroom = headroomMetric(
    scenario,
    firm,
    pass,
  );
  const disposition = dispositionFor(scenario, firm.id);
  const request = requestFor(scenario, firm.id);
  const simulatedDisposition: DispositionKind | null =
    newHeadroom === null
      ? null
      : disposition === "proceed" &&
          newHeadroom < request.amountMinor
        ? "blocked"
        : disposition;

  let simulationDelta: SimulationDeltaRowVM[];
  if (!planned || !currentFloor) {
    simulationDelta = unavailableScheduleRows(disposition);
  } else if (
    isFirmA &&
    newHeadroom !== null &&
    currentHeadroom
  ) {
    simulationDelta = [
      {
        label: "Smith household reserve floor",
        before: { metric: currentFloor },
        after: {
          metric: derivedMetric(
            twelveMonthFloor!,
            "currency-minor",
            simulationInputs,
            planned.observedAt,
          ),
        },
      },
      {
        label: "Available after reserve",
        before: { metric: currentHeadroom },
        after: {
          metric: derivedMetric(
            newHeadroom,
            "currency-minor",
            simulationInputs,
            planned.observedAt,
          ),
        },
      },
      {
        label: "This request",
        before: { badge: DISPOSITION_BADGES[disposition] },
        after: {
          badge:
            DISPOSITION_BADGES[
              simulatedDisposition ?? disposition
            ],
        },
      },
      {
        label:
          "Demo-corpus households newly below the floor",
        before: {
          metric: derivedMetric(
            0,
            "count",
            simulationInputs,
            planned.observedAt,
          ),
        },
        after: {
          metric: derivedMetric(
            3,
            "count",
            simulationInputs,
            planned.observedAt,
          ),
        },
      },
    ];
  } else if (isFirmA) {
    simulationDelta = [
      {
        label: "Smith household reserve floor",
        before: { metric: currentFloor },
        after: {
          metric: derivedMetric(
            twelveMonthFloor!,
            "currency-minor",
            simulationInputs,
            planned.observedAt,
          ),
        },
      },
      {
        label: "Available after reserve",
        before: {
          display:
            "Missing signed branch-and-firm liquidity authority",
        },
        after: {
          display:
            "Not simulated without signed numeric authority",
        },
      },
      {
        label: "This request",
        before: { badge: DISPOSITION_BADGES[disposition] },
        after: {
          display:
            "Not simulated without signed numeric authority",
        },
      },
    ];
  } else {
    simulationDelta = [
      {
        label: "Smith household reserve floor",
        before: { metric: currentFloor },
        after: { metric: currentFloor },
      },
      {
        label: "This request",
        before: { badge: DISPOSITION_BADGES[disposition] },
        after: { badge: DISPOSITION_BADGES[disposition] },
      },
    ];
  }

  const noResult =
    !planned || currentFloor === null
      ? "Re-run not calculated: this exact case has no signed planned-withdrawal schedule, and no canonical schedule was substituted."
      : "Re-run not calculated: this branch and firm have no captain-signed numeric liquidity case, and no unrelated case was substituted.";
  return {
    spine: buildSpine("Decision", {
      status: "pending",
      label: "Draft simulation",
    }),
    sentence:
      "Always preserve twelve months of planned withdrawals in cash.",
    draft: {
      rows: [
        { field: "Effect", value: "Require" },
        { field: "Subject", value: "Cash reserve" },
        {
          field: "Quantity",
          value: "Twelve months of planned withdrawals",
        },
        { field: "Scope", value: "All households" },
        {
          field: "Supersedes",
          value: isFirmA
            ? `${firm.policyVersion} §2 (six months)`
            : `${firm.policyVersion} §3 (already twelve months - no change)`,
        },
      ],
      label: "Drafted - not yet reviewed",
      fakeClass: "llm-proposed-draft",
    },
    interpretation:
      "Reserve floor becomes twelve times the planned monthly withdrawal for each household, evaluated before any discretionary movement.",
    simulationDelta,
    gateLabel: isFirmA
      ? "Approve and activate FA-4.3"
      : "Approve (no effective change for Firm B)",
    activation: isFirmA
      ? { fromVersion: "FA-4.2", toVersion: "FA-4.3" }
      : { fromVersion: "FB-2.1", toVersion: "FB-2.1" },
    changedRerunResult:
      newHeadroom === null
        ? noResult
        : isFirmA
          ? {
              proceed:
                "Re-run under FA-4.3: the Smith request still proceeds, with a narrower margin above the reserve floor.",
              blocked:
                disposition === "proceed"
                  ? "Re-run under FA-4.3: the Smith request no longer proceeds - twelve months of planned withdrawals leave less than this movement needs."
                  : "Re-run under FA-4.3: the Smith request is still blocked - the reserve change does not resolve the named conditions.",
              prohibited:
                "Re-run under FA-4.3: the Smith request remains prohibited - the destination restriction is not resolvable by a reserve-policy change.",
            }[simulatedDisposition ?? disposition]
          : {
              proceed:
                "Re-run under FB-2.1: no change - Firm B already preserves twelve months.",
              blocked:
                "Re-run under FB-2.1: no reserve change - Firm B already preserves twelve months, and the named conditions still block this request.",
              prohibited:
                "Re-run under FB-2.1: no reserve change - Firm B already preserves twelve months, and the destination restriction is not resolvable by a reserve-policy change.",
            }[disposition],
    fakeClass: "deterministic-engine-output",
  };
}
