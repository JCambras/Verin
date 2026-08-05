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
  plannedWithdrawalEvidenceFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import { evaluatePolicyRerun } from "./policy-rerun";

export { DRAFT_RESERVE_MONTHS } from "./policy-rerun";

const CORPUS_IMPACT_UNAVAILABLE: SimulationDeltaRowVM = {
  label: "Demo-corpus impact",
  before: { display: "Unavailable - no explicit replay corpus was loaded" },
  after: { display: "Unavailable - no explicit replay corpus was loaded" },
};

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
    CORPUS_IMPACT_UNAVAILABLE,
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
  const toVersion = isFirmA ? "FA-4.3" : "FB-2.1";
  const rerun = evaluatePolicyRerun(
    scenario,
    firm,
    pass,
    toVersion,
  );
  const twelveMonthFloor = rerun?.reserveFloorMinor ?? null;
  const simulationInputs = liquidityInputs(
    scenario,
    firm,
    pass,
  );
  const newHeadroom = rerun?.headroomMinor ?? null;
  const currentHeadroom = headroomMetric(
    scenario,
    firm,
    pass,
  );
  const disposition = dispositionFor(scenario, firm.id);
  const simulatedDisposition: DispositionKind | null =
    rerun?.disposition ?? null;

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
      CORPUS_IMPACT_UNAVAILABLE,
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
      CORPUS_IMPACT_UNAVAILABLE,
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
      CORPUS_IMPACT_UNAVAILABLE,
    ];
  }

  const noResult =
    !planned || currentFloor === null
      ? "Re-run not calculated: this exact case has no signed planned-withdrawal schedule, and no canonical schedule was substituted."
      : "Re-run not calculated: this branch and firm have no captain-signed numeric liquidity case, and no unrelated case was substituted.";
  const approval =
    !planned || currentFloor === null || rerun === null
      ? {
          kind: "unavailable" as const,
          reason: noResult,
        }
      : {
          kind: "available" as const,
          gateLabel: isFirmA
            ? "Approve and activate FA-4.3"
            : "Approve (no effective change for Firm B)",
          activation: isFirmA
            ? { fromVersion: "FA-4.2", toVersion }
            : { fromVersion: "FB-2.1", toVersion },
          changedRerunResult: isFirmA
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
        };
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
    approval,
    fakeClass: "deterministic-engine-output",
  };
}
