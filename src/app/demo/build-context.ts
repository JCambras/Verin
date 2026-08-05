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
  DEMO_NOW,
  HOUSEHOLD,
  OBSERVED_RECENT,
  RETRIEVED_AT,
  evidenceForPass,
  liquidityAuthorityFor,
  plannedWithdrawalEvidenceFor,
  requestFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import type { SignedEvidenceData } from "./signed-cases";

/** The destination the interpreted intent binds to for this branch. */
export function destinationFor(
  scenario: ScenarioData,
  firm?: FirmData,
): string {
  const exactDestination = firm
    ? sourceCaseFor(scenario, firm.id)?.evidence.find(
        (entry) => entry.evidenceKind === "bank-instruction",
      )
    : undefined;
  return exactDestination?.subjectRef ?? "Exact signed source unavailable";
}

function evidenceLabel(entry: SignedEvidenceData): string {
  return `${entry.evidenceKind.replaceAll("-", " ")} · ${entry.subjectRef} · ${entry.source} · ${entry.freshness}`;
}

function projectEvidenceRow(
  entry: SignedEvidenceData,
): Extract<EvidenceRowVM, { readonly kind: "fact" | "metric" }> {
  const sourceBinding = { ...entry };
  if (entry.displayValue) {
    return {
      kind: "metric",
      label: evidenceLabel(entry),
      metric: fixtureMetric(
        entry.displayValue.valueMinor,
        "currency-minor",
        "synthetic-fixture",
        entry.observedAt,
      ),
      summary: entry.summary,
      retrievedAt: formatDemoInstant(entry.retrievedAt, undefined, true),
      sourceBinding,
      fakeClass: "synthetic-fixture",
    };
  }
  return {
    kind: "fact",
    label: evidenceLabel(entry),
    fact: fact(
      entry.summary,
      "synthetic-fixture",
      entry.observedAt,
      formatDemoInstant(entry.retrievedAt, undefined, true),
    ),
    sourceBinding,
    fakeClass: "synthetic-fixture",
  };
}

export function buildWorkspace(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass = "initial",
): WorkspaceVM {
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const selectedEvidence = evidenceForPass(sourceCase, pass);
  const timeline = timelineFor(scenario, firm);
  const refreshed =
    pass === "revalidated" && authority.kind === "signed"
      ? authority.preExecutionRevalidation
      : undefined;
  const liquidity =
    authority.kind === "signed"
      ? (refreshed ?? authority.initialDecision)
      : null;
  const liquidityEvidence = selectedEvidence.find(
    (entry) => entry.evidenceKind === "account-balance",
  );
  const liquidityObservedAt =
    liquidityEvidence?.observedAt ??
    (refreshed ? timeline.revalidatedAt : OBSERVED_RECENT);
  const liquidityRetrievedAt = liquidityEvidence
    ? formatDemoInstant(liquidityEvidence.retrievedAt)
    : refreshed
      ? formatDemoInstant(timeline.revalidatedAt)
      : RETRIEVED_AT;
  const plannedEvidence = plannedWithdrawalEvidenceFor(
    scenario,
    firm.id,
    pass,
  );
  const accountEvidence =
    selectedEvidence.filter(
      (entry) => entry.evidenceKind === "account-balance",
    );
  return {
    household: {
      name: HOUSEHOLD.name,
      advisor: HOUSEHOLD.advisor,
      provenance: prov("synthetic-fixture", OBSERVED_RECENT),
      fakeClass: "synthetic-fixture",
    },
    accounts: accountEvidence.map((entry) => ({
      id: entry.subjectRef,
      evidence: projectEvidenceRow(entry),
      unavailableFields: ["account name", "account type", "custodian"],
    })),
    accountsUnavailable:
      accountEvidence.length === 0
        ? `No exact signed account-balance evidence is available for ${scenario.id}/${firm.id}`
        : null,
    liquidity: liquidity
      ? fixtureMetric(liquidity.availableCashMinor, "currency-minor", "synthetic-fixture", liquidityObservedAt)
      : null,
    plannedMonthlyWithdrawal: plannedEvidence
      ? fixtureMetric(
          plannedEvidence.displayValue!.valueMinor,
          "currency-minor",
          "synthetic-fixture",
          plannedEvidence.observedAt,
        )
      : null,
    plannedWithdrawalAuthorityMissing: plannedEvidence
      ? null
      : `No exact signed planned-withdrawal schedule covers ${scenario.id} for ${firm.id}`,
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
        { label: "Destination", value: destinationFor(scenario, firm) },
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
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const evidence = evidenceForPass(sourceCase, pass);
  const rows: EvidenceRowVM[] = evidence.map(projectEvidenceRow);
  if (sourceCase?.authorityGap) {
    rows.push({
      kind: "missing",
      text: sourceCase.authorityGap.reason,
      fakeClass: "synthetic-fixture",
    });
  } else if (!sourceCase) {
    rows.push({
      kind: "missing",
      text: `Missing exact signed evidence authority for ${scenario.id}/${firm.id}. No unrelated case was substituted.`,
      fakeClass: "synthetic-fixture",
    });
  }
  const latestRefresh = evidence
    .filter(
      (entry) => entry.liquidityPhase === "pre-execution-revalidation",
    )
    .sort((left, right) =>
      left.retrievedAt.localeCompare(right.retrievedAt),
    )
    .at(-1);
  return {
    spine: buildSpine("Evidence"),
    rows,
    refreshNotice: pass === "revalidated" && latestRefresh
      ? {
          fact: fact(
            "Refreshed evidence bundle recorded after the material change",
            "deterministic-engine-output",
            latestRefresh.retrievedAt,
            formatDemoInstant(latestRefresh.retrievedAt, undefined, true),
          ),
          fakeClass: "deterministic-engine-output",
        }
      : null,
  };
}
