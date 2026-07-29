/**
 * Fake-service builders for the CONTEXT surfaces: household workspace (surface 1),
 * contextual intent panel (surface 2), evidence and conflict view (surface 3).
 *
 * This module is part of the demo's fake service layer (charter #5 / ADR-0027): it
 * turns static contract data (./data.ts, mirroring config/demo/scenarios.yaml) into
 * typed view models. Surfaces render these VMs verbatim; no component recomputes any
 * of it. Which facts vary per branch is stated by the scenario's ScenarioSpec - the
 * recorded contract variation, not a computed decision.
 */
import { metric } from "@contracts/metric";
import type {
  EvidenceRowVM,
  EvidenceVM,
  FactVM,
  IntentVM,
  WorkspaceVM,
} from "./model";
import { fact, fixtureMetric, prov } from "./provenance";
import { buildSpine } from "./spine";
import {
  ACCOUNTS,
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_NOW,
  DESTINATION_RESTRICTION,
  HOUSEHOLD,
  OBSERVED_RECENT,
  SMITHS_LIQUIDITY,
  THIRD_PARTY_DESTINATION,
  demoTimestampLabel,
  type ScenarioData,
  usdMinor,
} from "./data";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
  type DemoEvidenceValue,
} from "./decision-evidence";

function pendingActivityStatement(amountMinor: number): string {
  return amountMinor === 0
    ? "None recorded against this household at this evaluation"
    : `${usdMinor(amountMinor)} recorded against this household at this evaluation`;
}

function snapshotFact<T>(
  evidence: DecisionEvidenceSnapshot,
  datum: DemoEvidenceValue<T>,
  display: string,
): FactVM {
  return {
    display,
    provenance: datum.provenance,
    retrievedAt: demoTimestampLabel(evidence.retrievedAt),
  };
}

/** The destination the interpreted intent binds to for this branch. */
export function destinationFor(scenario: ScenarioData): string {
  if (scenario.spec.thirdPartyDestination) return THIRD_PARTY_DESTINATION;
  return scenario.spec.bankChanged ? BANK_INSTRUCTION.changed : BANK_INSTRUCTION.stable;
}

export function buildWorkspace(
  scenario: ScenarioData,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(scenario),
): WorkspaceVM {
  const retrievedAt = demoTimestampLabel(evidence.retrievedAt);
  return {
    household: {
      name: HOUSEHOLD.name,
      advisor: HOUSEHOLD.advisor,
      provenance: prov("synthetic-fixture", OBSERVED_RECENT),
      fakeClass: "synthetic-fixture",
    },
    accounts: ACCOUNTS.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      // The taxable account's balance IS the signed available-cash datum, so it wears
      // the SAME observation date as the liquidity block below. One datum, one "as of":
      // the two rendered $420,000 figures can never disagree about when it was seen.
      balance: fixtureMetric(
        a.balanceMinor,
        "currency-minor",
        "synthetic-fixture",
        a.id === SMITHS_LIQUIDITY.availableAccountId
          ? evidence.availableCash.provenance.asOf
          : OBSERVED_RECENT,
      ),
      custodian: fact(
        a.custodian,
        "synthetic-fixture",
        OBSERVED_RECENT,
        retrievedAt,
      ),
      fakeClass: "synthetic-fixture",
    })),
    liquidity: metric(
      evidence.availableCash.value,
      "currency-minor",
      evidence.availableCash.provenance,
    ),
    plannedMonthlyWithdrawal: metric(
      evidence.plannedMonthlyWithdrawal.value,
      "currency-minor",
      evidence.plannedMonthlyWithdrawal.provenance,
    ),
    pendingActivity: snapshotFact(
      evidence,
      evidence.pendingApprovedActivity,
      `Pending approved activity: ${pendingActivityStatement(
        evidence.pendingApprovedActivity.value,
      ).toLowerCase()}`,
    ),
    onRamp: {
      title: "What do the Smiths need?",
      description: "Ask Verin in plain language. It gathers the evidence, determines the governed action, and routes the authority to approve it.",
    },
  };
}

export function buildIntent(scenario: ScenarioData): IntentVM {
  return {
    spine: buildSpine("Intent"),
    household: HOUSEHOLD.name,
    requestText: CANONICAL_REQUEST.text,
    requestProvenance: prov("user-entered-demo-input", DEMO_NOW),
    requestFakeClass: "user-entered-demo-input",
    interpreted: {
      slots: [
        { label: "Household", value: HOUSEHOLD.name },
        { label: "Action", value: "Move money" },
        { label: "Amount", metric: metric(CANONICAL_REQUEST.amountMinor, "currency-minor", prov("user-entered-demo-input", DEMO_NOW)) },
        { label: "Purpose", value: CANONICAL_REQUEST.purpose },
        { label: "Needed by", value: CANONICAL_REQUEST.deadline },
        { label: "Destination", value: destinationFor(scenario) },
      ],
      draftLabel: "Drafted - not yet reviewed",
      fakeClass: "llm-proposed-draft",
    },
  };
}

export function buildEvidence(
  scenario: ScenarioData,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(scenario),
): EvidenceVM {
  const spec = scenario.spec;
  const retrievedAt = demoTimestampLabel(evidence.retrievedAt);
  const availableAccount = ACCOUNTS.find(
    (account) =>
      account.id === SMITHS_LIQUIDITY.availableAccountId,
  );
  if (!availableAccount) {
    throw new Error(
      "The signed Smiths liquidity basis has no matching account",
    );
  }
  const rows: EvidenceRowVM[] = [
    {
      kind: "metric",
      label: `Available cash in ${availableAccount.name}`,
      metric: metric(
        evidence.availableCash.value,
        "currency-minor",
        evidence.availableCash.provenance,
      ),
      retrievedAt,
      fakeClass: "synthetic-fixture",
    },
    {
      kind: "metric",
      label: "Planned monthly withdrawal",
      metric: metric(
        evidence.plannedMonthlyWithdrawal.value,
        "currency-minor",
        evidence.plannedMonthlyWithdrawal.provenance,
      ),
      retrievedAt,
      fakeClass: "synthetic-fixture",
    },
    {
      kind: "fact",
      label: "Pending approved activity",
      fact: snapshotFact(
        evidence,
        evidence.pendingApprovedActivity,
        pendingActivityStatement(
          evidence.pendingApprovedActivity.value,
        ),
      ),
      fakeClass: "synthetic-fixture",
      why: { reason: "An approved but unsettled distribution would reduce the liquidity available to this request until it lands. The signed cases behind this request record none, so nothing is deducted from the available balance." },
    },
    spec.bankChanged
      ? {
          kind: "fact",
          label: "Bank instruction on file",
          fact: snapshotFact(
            evidence,
            evidence.bankInstruction,
            evidence.bankInstruction.value.destination,
          ),
          fakeClass: "synthetic-fixture",
          why: { reason: "This instruction changed within the firm's recent-change window. Each firm's configured handling for a recent bank change applies to this movement." },
        }
      : {
          kind: "fact",
          label: "Bank instruction on file",
          fact: snapshotFact(
            evidence,
            evidence.bankInstruction,
            evidence.bankInstruction.value.destination,
          ),
          fakeClass: "synthetic-fixture",
        },
    {
      kind: "fact",
      label: `Household instruction ${DESTINATION_RESTRICTION.ref}`,
      fact: snapshotFact(
        evidence,
        evidence.destinationRestriction,
        evidence.destinationRestriction.value.text,
      ),
      fakeClass: "synthetic-fixture",
      why: { reason: "A household-specific restriction. It takes precedence over firm policy defaults when the destination of a movement is checked." },
    },
  ];
  if (spec.conflictingInstruction) {
    rows.push({
      kind: "conflict",
      label: "Distribution funding instruction",
      rule: "A human must resolve this conflict (survivorship rule: manual)",
      a: snapshotFact(
        evidence,
        evidence.conflictingFundingInstructions[0]!,
        evidence.conflictingFundingInstructions[0]!.value,
      ),
      b: snapshotFact(
        evidence,
        evidence.conflictingFundingInstructions[1]!,
        evidence.conflictingFundingInstructions[1]!.value,
      ),
      fakeClass: "synthetic-fixture",
      blockerAffordance: "Choose the governing value",
    });
  }
  rows.push({
    kind: "missing",
    text: "Missing - planned-withdrawal schedule beyond twelve months unavailable from Verin CRM",
    fakeClass: "synthetic-fixture",
  });
  return { spine: buildSpine("Evidence"), rows };
}
