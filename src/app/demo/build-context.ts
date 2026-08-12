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
import type { EvidenceRowVM, EvidenceVM, IntentVM, WorkspaceVM } from "./model";
import { fact, fixtureMetric, prov } from "./provenance";
import { buildSpine } from "./spine";
import { actionLabel, evidenceLabel, slotLabel, type DemoVocabulary } from "./vocabulary";
import {
  ACCOUNTS,
  AVAILABLE_CASH_MINOR,
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_NOW,
  DESTINATION_RESTRICTION,
  HOUSEHOLD,
  OBSERVED_RECENT,
  OBSERVED_STALE,
  PENDING_DISTRIBUTION_MINOR,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  RETRIEVED_AT,
  THIRD_PARTY_DESTINATION,
  type ScenarioData,
} from "./data";

/**
 * The demo fixture's settlement qualifier, appended HERE rather than authored
 * into the configuration. `config/domains/money-movement.yaml` is the document a
 * real firm would deploy: its evidence-kind labels state what a kind IS, and a
 * fixture's settlement date is a property of this branch's fake row, not of the
 * kind. Keeping it on this side leaves the versioned, hash-pinned artifact free
 * of demonstration state while the visible copy is unchanged.
 */
const PENDING_DISTRIBUTION_QUALIFIER = "(settles Aug 1)";

/** The destination the interpreted intent binds to for this branch. */
export function destinationFor(scenario: ScenarioData): string {
  if (scenario.spec.thirdPartyDestination) return THIRD_PARTY_DESTINATION;
  return scenario.spec.bankChanged ? BANK_INSTRUCTION.changed : BANK_INSTRUCTION.stable;
}

export function buildWorkspace(scenario: ScenarioData): WorkspaceVM {
  const liquidityAsOf = scenario.spec.staleLiquidity ? OBSERVED_STALE : OBSERVED_RECENT;
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
      balance: fixtureMetric(a.balanceMinor, "currency-minor", "synthetic-fixture", OBSERVED_RECENT),
      custodian: fact(a.custodian, "synthetic-fixture", OBSERVED_RECENT, RETRIEVED_AT),
      fakeClass: "synthetic-fixture",
    })),
    liquidity: fixtureMetric(AVAILABLE_CASH_MINOR, "currency-minor", "synthetic-fixture", liquidityAsOf),
    plannedMonthlyWithdrawal: fixtureMetric(PLANNED_WITHDRAWAL_MONTHLY_MINOR, "currency-minor", "synthetic-fixture", OBSERVED_RECENT),
    pendingActivity: fact("One approved distribution settles Aug 1 and reduces available liquidity until then", "synthetic-fixture", OBSERVED_RECENT, RETRIEVED_AT),
    onRamp: {
      title: "What do the Smiths need?",
      description: "Ask Verin in plain language. It gathers the evidence, determines the governed action, and routes the authority to approve it.",
    },
  };
}

/**
 * The interpreted-intent panel. Every LABEL here is read from the money-movement
 * domain configuration (config/domains/money-movement.yaml) rather than written
 * into this builder: the demo shows the vocabulary the engine is configured
 * with, and the configuration is load-bearing rather than decorative.
 */
export function buildIntent(scenario: ScenarioData, vocabulary: DemoVocabulary): IntentVM {
  return {
    spine: buildSpine("Intent"),
    household: HOUSEHOLD.name,
    requestText: CANONICAL_REQUEST.text,
    requestProvenance: prov("user-entered-demo-input", DEMO_NOW),
    requestFakeClass: "user-entered-demo-input",
    interpreted: {
      slots: [
        { label: slotLabel(vocabulary, "household"), value: HOUSEHOLD.name },
        { label: "Action", value: actionLabel(vocabulary, "distribute-cash") },
        { label: slotLabel(vocabulary, "amount"), metric: metric(CANONICAL_REQUEST.amountMinor, "currency-minor", prov("user-entered-demo-input", DEMO_NOW)) },
        { label: slotLabel(vocabulary, "purpose"), value: CANONICAL_REQUEST.purpose },
        { label: slotLabel(vocabulary, "deadline"), value: CANONICAL_REQUEST.deadline },
        { label: slotLabel(vocabulary, "destination"), value: destinationFor(scenario) },
      ],
      draftLabel: "Drafted - not yet reviewed",
      fakeClass: "llm-proposed-draft",
    },
  };
}

export function buildEvidence(scenario: ScenarioData, vocabulary: DemoVocabulary): EvidenceVM {
  const spec = scenario.spec;
  const liquidityAsOf = spec.staleLiquidity ? OBSERVED_STALE : OBSERVED_RECENT;
  const rows: EvidenceRowVM[] = [
    {
      kind: "metric",
      label: evidenceLabel(vocabulary, "account-balance"),
      metric: fixtureMetric(AVAILABLE_CASH_MINOR, "currency-minor", "synthetic-fixture", liquidityAsOf),
      retrievedAt: RETRIEVED_AT,
      fakeClass: "synthetic-fixture",
    },
    {
      kind: "metric",
      label: evidenceLabel(vocabulary, "planned-withdrawals"),
      metric: fixtureMetric(PLANNED_WITHDRAWAL_MONTHLY_MINOR, "currency-minor", "synthetic-fixture", OBSERVED_RECENT),
      retrievedAt: RETRIEVED_AT,
      fakeClass: "synthetic-fixture",
    },
    {
      kind: "metric",
      label: `${evidenceLabel(vocabulary, "pending-actions")} ${PENDING_DISTRIBUTION_QUALIFIER}`,
      metric: fixtureMetric(PENDING_DISTRIBUTION_MINOR, "currency-minor", "synthetic-fixture", OBSERVED_RECENT),
      retrievedAt: RETRIEVED_AT,
      fakeClass: "synthetic-fixture",
      why: { reason: "Approved on Jul 18 and not yet settled, so it reduces the liquidity available to this request until it lands." },
    },
    spec.bankChanged
      ? {
          kind: "fact",
          label: evidenceLabel(vocabulary, "bank-instruction"),
          fact: fact(BANK_INSTRUCTION.changed, "synthetic-fixture", BANK_INSTRUCTION.changedOn, RETRIEVED_AT),
          fakeClass: "synthetic-fixture",
          why: { reason: "This instruction changed within the firm's recent-change window. Each firm's configured handling for a recent bank change applies to this movement." },
        }
      : {
          kind: "fact",
          label: evidenceLabel(vocabulary, "bank-instruction"),
          fact: fact(BANK_INSTRUCTION.stable, "synthetic-fixture", "2026-05-20", RETRIEVED_AT),
          fakeClass: "synthetic-fixture",
        },
    {
      kind: "fact",
      label: `${evidenceLabel(vocabulary, "household-instruction")} ${DESTINATION_RESTRICTION.ref}`,
      fact: fact(DESTINATION_RESTRICTION.text, "synthetic-fixture", "2026-02-14", RETRIEVED_AT),
      fakeClass: "synthetic-fixture",
      why: { reason: "A household-specific restriction. It takes precedence over firm policy defaults when the destination of a movement is checked." },
    },
  ];
  if (spec.conflictingInstruction) {
    rows.push({
      kind: "conflict",
      label: "Distribution funding instruction",
      rule: "A human must resolve this conflict (survivorship rule: manual)",
      a: fact("Renovation costs are paid from the Joint Taxable account", "synthetic-fixture", "2026-03-02", RETRIEVED_AT, "medium"),
      b: fact("Large one-time needs are funded from the Smith Family Taxable account", "synthetic-fixture", "2026-07-10", RETRIEVED_AT, "medium"),
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
