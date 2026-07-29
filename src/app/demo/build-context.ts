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
import { formatDemoInstant, timelineFor } from "./timeline";
import {
  ACCOUNTS,
  BANK_INSTRUCTION,
  DEMO_NOW,
  DESTINATION_RESTRICTION,
  HOUSEHOLD,
  OBSERVED_RECENT,
  OBSERVED_STALE,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  RETRIEVED_AT,
  THIRD_PARTY_DESTINATION,
  liquidityAuthorityFor,
  requestFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

/** The destination the interpreted intent binds to for this branch. */
export function destinationFor(scenario: ScenarioData): string {
  if (scenario.spec.thirdPartyDestination) return THIRD_PARTY_DESTINATION;
  return scenario.spec.bankChanged ? BANK_INSTRUCTION.changed : BANK_INSTRUCTION.stable;
}

export function buildWorkspace(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): WorkspaceVM {
  const liquidityAsOf = scenario.spec.staleLiquidity ? OBSERVED_STALE : OBSERVED_RECENT;
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const timeline = timelineFor(scenario, firm);
  const refreshed =
    pass === "revalidated" && authority.kind === "signed"
      ? authority.preExecutionRevalidation
      : undefined;
  const liquidity =
    authority.kind === "signed"
      ? (refreshed ?? authority.initialDecision)
      : null;
  const liquidityObservedAt = refreshed ? timeline.revalidatedAt : liquidityAsOf;
  const liquidityRetrievedAt = refreshed
    ? formatDemoInstant(timeline.revalidatedAt)
    : RETRIEVED_AT;
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
    liquidity: liquidity
      ? fixtureMetric(liquidity.availableCashMinor, "currency-minor", "synthetic-fixture", liquidityObservedAt)
      : null,
    plannedMonthlyWithdrawal: fixtureMetric(PLANNED_WITHDRAWAL_MONTHLY_MINOR, "currency-minor", "synthetic-fixture", OBSERVED_RECENT),
    pendingActivity: liquidity
      ? fact(liquidity.pendingNote, "synthetic-fixture", liquidityObservedAt, liquidityRetrievedAt)
      : null,
    liquidityAuthorityMissing: authority.kind === "missing" ? authority.reason : null,
    onRamp: {
      title: "What do the Smiths need?",
      description: "Ask Verin in plain language. It gathers the evidence, determines the governed action, and routes the authority to approve it.",
    },
  };
}

export function buildIntent(scenario: ScenarioData, firm: FirmData): IntentVM {
  const requestAt = timelineFor(scenario, firm).requestAt;
  const request = requestFor(scenario, firm.id);
  return {
    spine: buildSpine("Intent"),
    household: HOUSEHOLD.name,
    requestText: request.text,
    requestAt: fact(
      `Request received ${formatDemoInstant(requestAt)}`,
      "user-entered-demo-input",
      requestAt,
      formatDemoInstant(requestAt),
    ),
    requestProvenance: prov("user-entered-demo-input", requestAt),
    requestFakeClass: "user-entered-demo-input",
    interpreted: {
      slots: [
        { label: "Household", value: HOUSEHOLD.name },
        { label: "Action", value: "Move money" },
        { label: "Amount", metric: metric(request.amountMinor, "currency-minor", prov("user-entered-demo-input", DEMO_NOW)) },
        { label: "Purpose", value: request.purpose },
        { label: "Needed by", value: request.deadline },
        { label: "Destination", value: destinationFor(scenario) },
      ],
      draftLabel: "Drafted - not yet reviewed",
      fakeClass: "llm-proposed-draft",
    },
  };
}

export function buildEvidence(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): EvidenceVM {
  const spec = scenario.spec;
  const liquidityAsOf = spec.staleLiquidity ? OBSERVED_STALE : OBSERVED_RECENT;
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const timeline = timelineFor(scenario, firm);
  const refreshed =
    pass === "revalidated" && authority.kind === "signed"
      ? authority.preExecutionRevalidation
      : undefined;
  const liquidity =
    authority.kind === "signed"
      ? (refreshed ?? authority.initialDecision)
      : null;
  const liquidityObservedAt = refreshed ? timeline.revalidatedAt : liquidityAsOf;
  const liquidityRetrievedAt = refreshed
    ? formatDemoInstant(timeline.revalidatedAt)
    : RETRIEVED_AT;
  const rows: EvidenceRowVM[] = [
    {
      kind: "metric",
      label: "Planned monthly withdrawal",
      metric: fixtureMetric(PLANNED_WITHDRAWAL_MONTHLY_MINOR, "currency-minor", "synthetic-fixture", OBSERVED_RECENT),
      retrievedAt: RETRIEVED_AT,
      fakeClass: "synthetic-fixture",
    },
    spec.bankChanged
      ? {
          kind: "fact",
          label: "Bank instruction on file",
          fact: fact(BANK_INSTRUCTION.changed, "synthetic-fixture", BANK_INSTRUCTION.changedOn, RETRIEVED_AT),
          fakeClass: "synthetic-fixture",
          why: { reason: "This instruction changed within the firm's recent-change window. Each firm's configured handling for a recent bank change applies to this movement." },
        }
      : {
          kind: "fact",
          label: "Bank instruction on file",
          fact: fact(BANK_INSTRUCTION.stable, "synthetic-fixture", "2026-05-20", RETRIEVED_AT),
          fakeClass: "synthetic-fixture",
        },
    {
      kind: "fact",
      label: `Household instruction ${DESTINATION_RESTRICTION.ref}`,
      fact: fact(DESTINATION_RESTRICTION.text, "synthetic-fixture", "2026-02-14", RETRIEVED_AT),
      fakeClass: "synthetic-fixture",
      why: { reason: "A household-specific restriction. It takes precedence over firm policy defaults when the destination of a movement is checked." },
    },
  ];
  if (liquidity) {
    rows.unshift(
      {
        kind: "metric",
        label: refreshed
          ? "Pre-execution revalidation · available cash across household accounts"
          : "Available cash across household accounts",
        metric: fixtureMetric(liquidity.availableCashMinor, "currency-minor", "synthetic-fixture", liquidityObservedAt),
        retrievedAt: liquidityRetrievedAt,
        fakeClass: "synthetic-fixture",
      },
      liquidity.pendingActivityMinor > 0
        ? {
            kind: "metric",
            label: refreshed
              ? "Pre-execution revalidation · pending approved distribution"
              : "Pending approved distribution (not yet settled)",
            metric: fixtureMetric(liquidity.pendingActivityMinor, "currency-minor", "synthetic-fixture", liquidityObservedAt),
            retrievedAt: liquidityRetrievedAt,
            fakeClass: "synthetic-fixture",
            why: { reason: `${liquidity.pendingNote}.` },
          }
        : {
            kind: "fact",
            label: "Pending or reserved liquidity activity",
            fact: fact(`${liquidity.pendingNote}.`, "synthetic-fixture", OBSERVED_RECENT, RETRIEVED_AT),
            fakeClass: "synthetic-fixture",
            why: { reason: "Absence here is an observation, not a gap: the pending-activity source was read and returned nothing against this household." },
          },
    );
  } else {
    rows.unshift({
      kind: "missing",
      text: `Missing signed liquidity authority - ${authority.kind === "missing" ? authority.reason : "numeric evidence unavailable"}. No unrelated case was substituted.`,
      fakeClass: "synthetic-fixture",
    });
  }
  if (spec.conflictingInstruction) {
    const directoryEvidence = sourceCase?.evidence.find(
      (entry) => entry.evidenceKind === "household-directory",
    );
    const observedAt =
      directoryEvidence?.observedAt ?? timeline.requestAt;
    const retrievedAt =
      directoryEvidence?.retrievedAt ?? timeline.requestAt;
    rows.push({
      kind: "conflict",
      label: "Household directory match",
      rule: "A human must select the intended household; Verin cannot guess between two equal candidates",
      a: fact(
        "Robert & Ana Smith · subject:smiths-robert-ana",
        "synthetic-fixture",
        observedAt,
        formatDemoInstant(retrievedAt, undefined, true),
        "medium",
      ),
      b: fact(
        "Smith Family Trust · subject:smith-family-trust",
        "synthetic-fixture",
        observedAt,
        formatDemoInstant(retrievedAt, undefined, true),
        "medium",
      ),
      fakeClass: "synthetic-fixture",
      blockerAffordance: "Select the intended household",
    });
  }
  rows.push({
    kind: "missing",
    text: "Missing - planned-withdrawal schedule beyond twelve months unavailable from Verin CRM",
    fakeClass: "synthetic-fixture",
  });
  return {
    spine: buildSpine("Evidence"),
    rows,
    refreshNotice: refreshed
      ? {
          fact: fact(
            "Refreshed evidence bundle recorded after the material change",
            "deterministic-engine-output",
            timeline.revalidatedAt,
            formatDemoInstant(timeline.revalidatedAt),
          ),
          fakeClass: "deterministic-engine-output",
        }
      : null,
  };
}
