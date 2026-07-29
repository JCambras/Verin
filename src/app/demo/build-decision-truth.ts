import type { RecordProvenance } from "@contracts/provenance";
import type { BlockerVM, WhyVM } from "./model";
import { prov } from "./provenance";
import {
  OBSERVED_RECENT,
  evidenceForPass,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

const DEFAULT_LIQUIDITY_INPUTS = [
  prov("synthetic-fixture", OBSERVED_RECENT),
  prov("synthetic-fixture", OBSERVED_RECENT),
];

export function liquidityInputs(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): readonly RecordProvenance[] {
  const selected = evidenceForPass(
    sourceCaseFor(scenario, firm.id),
    pass,
  ).filter(
    (entry) =>
      (entry.evidenceKind === "account-balance" ||
        entry.evidenceKind === "pending-actions" ||
        entry.evidenceKind === "planned-withdrawals"),
  );
  return selected.length
    ? selected.map((entry) =>
        prov("synthetic-fixture", entry.observedAt),
      )
    : DEFAULT_LIQUIDITY_INPUTS;
}

function ageInDays(observedAt: string, asOf: string): number {
  return Math.floor(
    (Date.parse(asOf) - Date.parse(observedAt)) / (24 * 60 * 60 * 1_000),
  );
}

function reserveHorizonWord(firm: FirmData): string {
  return firm.reserveMonths === 6 ? "six" : "twelve";
}

export function exactBlockers(
  scenario: ScenarioData,
  firm: FirmData,
  reserveHolds: boolean | null,
): BlockerVM[] {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const blockers: BlockerVM[] = [];
  if (!sourceCase) {
    return [
      {
        condition:
          "Exact signed source unavailable for this branch and firm; no resolving evidence or action is projected.",
        affordanceLabel: "Return to a signed scenario",
      },
    ];
  }
  const stale = sourceCase?.evidence.find(
    (entry) => entry.freshness === "stale",
  );
  const conflict = sourceCase?.evidence.find(
    (entry) => entry.evidenceKind === "household-directory",
  );
  const bank = sourceCase?.evidence.find(
    (entry) => entry.evidenceKind === "bank-instruction",
  );
  if (
    sourceCase.explanations.some(
      (entry) => entry.code === "firm-b-blocks-until-verified",
    ) &&
    bank &&
    !stale &&
    !conflict
  ) {
    blockers.push({
      condition: bank.summary,
      affordanceLabel: "Request independent verification of the bank instruction",
    });
  }
  if (stale) {
    const age =
      sourceCase
        ? ageInDays(stale.observedAt, sourceCase.trigger.requestAt)
        : null;
    blockers.push({
      condition:
        stale && age !== null
          ? `${stale.summary} The signed evidence is ${age} days old and the freshness window is ${stale.freshnessWindowDays ?? "unstated"} days.`
          : "Exact signed stale-evidence authority is unavailable",
      affordanceLabel: "Refresh liquidity evidence",
    });
  }
  if (conflict) {
    blockers.push({
      condition:
        conflict?.summary ??
        "Exact signed household-directory evidence is unavailable",
      affordanceLabel: "Select the intended household",
    });
  }
  if (!stale && reserveHolds === false) {
    blockers.push({
      condition: `This movement would leave the household below ${firm.name}'s ${reserveHorizonWord(firm)}-month cash reserve`,
      affordanceLabel: "Reduce the amount or free additional liquidity",
    });
  }
  return blockers;
}

export function exactProceedWhy(
  scenario: ScenarioData,
  firm: FirmData,
  hasLiquidityAuthority: boolean,
): WhyVM {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const policy =
    sourceCase?.policyVersions.firmPolicyVersionId ?? firm.policyVersion;
  return {
    reason:
      sourceCase?.explanations.map(({ summary }) => summary).join(" ") ??
      (hasLiquidityAuthority
        ? "The exact signed case records a proceed disposition."
        : "The recorded scenario disposition proceeds, but this branch and firm have no captain-signed numeric liquidity case to display; Verin does not substitute another case's figures."),
    regulation: `Firm policy ${policy}`,
  };
}
