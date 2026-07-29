import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./_fence-utils";
import {
  GOLDEN_DOC,
  REQUIRED_SPEC_NAMES,
  STATUS_VOCABULARY_DOCS,
  V3_CORE_CONTRACTS,
  loadGoldenCases,
  loadScenarioRefs,
  loadStatusVocabularyDocs,
  validateGoldenCases,
  validateLedgerVocabulary,
  type LoadedCase,
  type ScenarioRefs,
} from "../../../scripts/golden-cases.lib";
import { loadDemoSemanticSnapshot } from "../../../scripts/golden-demo-snapshot";
import {
  readRenderedMajor,
  rendersAtCanonicalScale,
  validateGoldenDemoSemantics,
  validateStatusVocabularyDocs,
  type DemoSemanticSnapshot,
} from "../../../scripts/golden-demo-semantics.lib";

/**
 * GOLDEN-CASES FENCE (v3 build-sequence prompt 2; charter #1/#4). The golden
 * cases are the truth set the engine is later judged against, so an INCOMPLETE
 * or DISHONEST case is a build failure, not a doc nit:
 *  (a) every case states every required field, populated (trigger, firm config,
 *      household evidence, policy versions, household instructions, expected
 *      disposition / authority stages / execution eligibility / explanation
 *      nodes / ledger events / verification state, signoff);
 *  (b) evidence completeness and canonical UTC instants are explicit; signed
 *      request amount, units, monthly schedule, reserve horizons/floors, and
 *      status planes align with the live demo and scenarios.yaml;
 *  (c) vocabulary aligns with the LIVE config/demo/scenarios.yaml (firm ids,
 *      scenario ids, state vocabulary, provenance labels, deferral status) and
 *      ledger events with the v3 core-contracts LedgerEntry types;
 *  (d) structural consistency: blocked/prohibited cases carry no authority,
 *      no execution eligibility, no reached verification (v3 invariants 8/9);
 *      the partial-Salesforce case carries the deferred-pending-sandbox marking;
 *  (e) signoff honesty: pending-captain (unsigned) or signed-with-attribution;
 *      an agent-invented in-between state cannot pass; expected results remain
 *      product truth subject to captain signoff, never agent invention;
 *  (f) doc/fixture sync in BOTH directions: every fixture caseId appears in
 *      docs/golden-cases.md AND every full case id the doc names exists as a
 *      fixture; all twelve spec-enumerated cases are covered; at least twelve.
 * The validator core is shared with scripts/golden-cases-validate.ts (the
 * `golden-cases` CI job), so the enforced check and the proven check are the
 * same code. The companion below feeds violating cases and proves they CANNOT
 * pass (charter #4: detection is not verification).
 */
const realCases = loadGoldenCases();
const realRefs = loadScenarioRefs();
const realDoc = readFileSync(GOLDEN_DOC, "utf8");
const realDemo = loadDemoSemanticSnapshot();
const realContracts = readFileSync(V3_CORE_CONTRACTS, "utf8");
const realStatusDocs = loadStatusVocabularyDocs();

describe("golden-cases fence", () => {
  it("enforces: every golden case is complete, aligned, consistent, and signoff-gated", () => {
    const problems = [
      ...validateGoldenCases(realCases, realRefs, realDoc),
      ...validateGoldenDemoSemantics(realCases, realRefs, realDemo),
      ...validateLedgerVocabulary(realContracts),
      ...validateStatusVocabularyDocs(realStatusDocs),
    ];
    expect(problems, `golden-case problems:\n${problems.join("\n")}`).toEqual([]);
  });

  it("enforces: the normative documents are actually on disk and stating the vocabulary", () => {
    expect(realStatusDocs.map((d) => d.path)).toEqual([...STATUS_VOCABULARY_DOCS]);
    for (const doc of realStatusDocs) expect(doc.text.length, doc.path).toBeGreaterThan(0);
  });

  it("enforces: the truth set covers all twelve spec-enumerated cases with at least twelve fixtures", () => {
    expect(realCases.length).toBeGreaterThanOrEqual(12);
    expect(REQUIRED_SPEC_NAMES.length).toBe(12);
  });
});

describe("detects (companion): an incomplete, drifted, or prematurely signed case CANNOT pass", () => {
  // Real fixtures as the base so the companion exercises the same shape CI sees.
  const clone = (): LoadedCase[] => JSON.parse(JSON.stringify(realCases)) as LoadedCase[];
  const caseById = (cases: LoadedCase[], id: string): Record<string, unknown> => {
    const found = cases.find((c) => (c.data as Record<string, unknown>).caseId === id);
    if (!found) throw new Error(`fixture ${id} missing`);
    return found.data as Record<string, unknown>;
  };
  const run = (cases: LoadedCase[], doc = realDoc) => validateGoldenCases(cases, realRefs, doc);
  const demoClone = (): DemoSemanticSnapshot =>
    JSON.parse(JSON.stringify(realDemo)) as DemoSemanticSnapshot;

  it("flags a missing required field (expectedDisposition removed)", () => {
    const cases = clone();
    delete caseById(cases, "GC-01-firm-a-happy-path").expectedDisposition;
    expect(run(cases).some((p) => p.includes("GC-01") && p.includes("expectedDisposition"))).toBe(true);
  });

  it("flags a present-but-unpopulated field (empty explanation nodes, blank trigger description)", () => {
    const cases = clone();
    caseById(cases, "GC-02-firm-b-happy-path").expectedExplanationNodes = [];
    (caseById(cases, "GC-03-recent-bank-change-firm-a").trigger as Record<string, unknown>).description = "  ";
    const problems = run(cases);
    expect(problems.some((p) => p.includes("GC-02") && p.includes("expectedExplanationNodes"))).toBe(true);
    expect(problems.some((p) => p.includes("GC-03") && p.includes("trigger.description"))).toBe(true);
  });

  it("flags an AGENT-SIGNED case: signed without attribution, and a status outside the two legal shapes", () => {
    const cases = clone();
    const signoff = caseById(cases, "GC-01-firm-a-happy-path").signoff as Record<string, unknown>;
    signoff.status = "signed"; // with attribution stripped below - the dishonest middle
    signoff.signedBy = null;
    signoff.signedAt = null;
    const problems = run(cases);
    expect(problems.some((p) => p.includes("signoff.signedBy must name the signer"))).toBe(true);

    const cases2 = clone();
    (caseById(cases2, "GC-02-firm-b-happy-path").signoff as Record<string, unknown>).status = "approved-by-agent";
    expect(run(cases2).some((p) => p.includes('signoff.status must be "pending-captain" or "signed"'))).toBe(true);
  });

  it("flags vocabulary drift: unknown firm, scenario, disposition, provenance, and ledger type", () => {
    const cases = clone();
    const c = caseById(cases, "GC-01-firm-a-happy-path");
    c.firm = "firm-c";
    c.scenarioRef = "a-branch-nobody-pinned";
    c.expectedDisposition = "vetoed";
    c.provenance = "totally-real-data";
    (c.expectedLedgerEvents as Array<Record<string, unknown>>)[0]!.type = "SomethingHappened";
    const problems = run(cases);
    expect(problems.some((p) => p.includes("firm must be a scenarios.yaml firm id"))).toBe(true);
    expect(problems.some((p) => p.includes("scenarioRef must be null or a scenarios.yaml scenario id"))).toBe(true);
    expect(problems.some((p) => p.includes("expectedDisposition must be one of proceed|blocked|prohibited"))).toBe(true);
    expect(problems.some((p) => p.includes("provenance must be a scenarios.yaml provenance label"))).toBe(true);
    expect(problems.some((p) => p.includes("must be a v3 LedgerEntry type or an ADR-0030 authority-lapse event"))).toBe(true);
  });

  it("rejects reservation chronology that bypasses approval or revalidation", () => {
    const approvalBeforeDecision = clone();
    const stagedEvents = caseById(
      approvalBeforeDecision,
      "GC-01-firm-a-happy-path",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    const stagedDecision = stagedEvents.splice(1, 1)[0]!;
    stagedEvents.splice(4, 0, stagedDecision);
    expect(
      run(approvalBeforeDecision).some((problem) =>
        problem.includes("eligible ledger chronology"),
      ),
    ).toBe(true);

    const beforeApproval = clone();
    const beforeApprovalEvents = caseById(
      beforeApproval,
      "GC-01-firm-a-happy-path",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    const reservation = beforeApprovalEvents.splice(5, 1)[0]!;
    beforeApprovalEvents.splice(2, 0, reservation);
    expect(
      run(beforeApproval).some((problem) =>
        problem.includes(
          "ReservationCreated must follow the final still-valid ApprovalRecorded",
        ),
      ),
    ).toBe(true);

    const missingRevalidation = clone();
    const automaticEvents = caseById(
      missingRevalidation,
      "GC-02-firm-b-happy-path",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    automaticEvents.splice(2, 1);
    expect(
      run(missingRevalidation).some((problem) =>
        problem.includes("pre-execution revalidation"),
      ),
    ).toBe(true);

    const staleApproval = clone();
    const invalidationEvents = caseById(
      staleApproval,
      "GC-15-approval-invalidation",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    const invalidationReservation = invalidationEvents.splice(9, 1)[0]!;
    invalidationEvents.splice(7, 0, invalidationReservation);
    expect(
      run(staleApproval).some((problem) =>
        problem.includes("approval invalidation chronology"),
      ),
    ).toBe(true);

    const revalidationBeforeOriginalApprovals = clone();
    const twoPassEvents = caseById(
      revalidationBeforeOriginalApprovals,
      "GC-15-approval-invalidation",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    const changedEvidence = twoPassEvents.splice(4, 1)[0]!;
    twoPassEvents.splice(2, 0, changedEvidence);
    expect(
      run(revalidationBeforeOriginalApprovals).some((problem) =>
        problem.includes("approval invalidation chronology"),
      ),
    ).toBe(true);
  });

  it("flags a ledger vocabulary that drifts from the pinned v3 union or shadows it", () => {
    const dropped = realContracts.replace("  | VerificationStuck\n", "");
    expect(
      validateLedgerVocabulary(dropped).some((p) => p.includes('claims "VerificationStuck"')),
    ).toBe(true);

    const invented = realContracts.replace(
      "export type LedgerEntry =",
      "export type LedgerEntry =\n  | SomethingRatified",
    );
    expect(
      validateLedgerVocabulary(invented).some((p) => p.includes('"SomethingRatified" is missing')),
    ).toBe(true);

    const landed = realContracts.replace(
      "export type LedgerEntry =",
      "export type LedgerEntry =\n  | ApprovalStageExpired",
    );
    expect(
      validateLedgerVocabulary(landed).some((p) => p.includes("collapse it out of the ADR-0030 extension")),
    ).toBe(true);

    expect(validateLedgerVocabulary("no union here").some((p) => p.includes("declares no LedgerEntry union"))).toBe(true);
  });

  it("flags signed money carried only in prose, mis-derived, or contradicted by its summary", () => {
    const missing = clone();
    delete caseById(missing, "GC-01-firm-a-happy-path").signedMoney;
    const missingProblems = run(missing);
    expect(missingProblems.some((p) => p.includes("GC-01") && p.includes("signedMoney must state"))).toBe(true);
    expect(
      validateGoldenDemoSemantics(missing, realRefs, realDemo).some((p) => p.includes("signedMoney is missing or malformed")),
    ).toBe(true);

    const misderived = clone();
    (caseById(misderived, "GC-02-firm-b-happy-path").signedMoney as Record<string, unknown>).reserveFloorUsd = 90_000;
    expect(run(misderived).some((p) => p.includes("is not 8000 x 12 months"))).toBe(true);

    const contradicted = clone();
    (caseById(contradicted, "GC-01-firm-a-happy-path").trigger as Record<string, unknown>).maskedRequestSummary =
      "distribute 74000 USD for home-renovation (tokenized)";
    expect(
      run(contradicted).some((p) => p.includes("no longer states the signed request amount 75000")),
    ).toBe(true);
  });

  it("accepts a signed summary reworded around the same figures", () => {
    const reworded = clone();
    const c = caseById(reworded, "GC-01-firm-a-happy-path");
    (c.trigger as Record<string, unknown>).maskedRequestSummary =
      "distribute $75,000.00 for the home renovation by 2026-08-15 (tokenized before any LLM surface)";
    const schedule = (c.householdEvidence as Array<Record<string, unknown>>).find(
      (row) => row.evidenceKind === "planned-withdrawals",
    )!;
    schedule.summary = "Planned withdrawals of $8,000 per month leave a six-month reserve of $48,000.00.";
    expect(run(reworded)).toEqual([]);
  });

  it("flags an execution state outside the canonical observed vocabulary", () => {
    const widened: ScenarioRefs = { ...realRefs, executionStates: new Set([...realRefs.executionStates, "settled"]) };
    const cases = clone();
    (caseById(cases, "GC-01-firm-a-happy-path").expectedVerificationState as Record<string, unknown>).observedStatus = "settled";
    const problems = validateGoldenCases(cases, widened, realDoc);
    expect(problems.some((p) => p.includes("observedStatus must be one of submitted|in-flight|completed|rejected|nigo|unknown"))).toBe(true);

    // And the reverse: a pinned state the live matrix no longer defines fails too.
    const narrowed: ScenarioRefs = { ...realRefs, executionStates: new Set([...realRefs.executionStates].filter((s) => s !== "submitted")) };
    const drifted = validateGoldenCases(clone(), narrowed, realDoc);
    expect(drifted.some((p) => p.includes('observedStatus "submitted" is not a scenarios.yaml execution-class state'))).toBe(true);
  });

  it("flags non-canonical timestamps and evidence silence presented as completeness", () => {
    const cases = clone();
    const c = caseById(cases, "GC-01-firm-a-happy-path");
    (c.trigger as Record<string, unknown>).asOf = "2026-07-26T09:30:00-04:00";
    delete c.evidenceCompleteness;
    const problems = run(cases);
    expect(problems.some((p) => p.includes("trigger.asOf must be canonical UTC ISO"))).toBe(true);
    expect(problems.some((p) => p.includes("evidenceCompleteness must be a non-empty explicit fact matrix"))).toBe(true);
  });

  it("flags a proceed case that infers missing evidence is benign", () => {
    const cases = clone();
    const c = caseById(cases, "GC-02-firm-b-happy-path");
    c.evidenceCompleteness = (c.evidenceCompleteness as unknown[]).filter(
      (entry) => (entry as Record<string, unknown>).fact !== "pending-liquidity-activity",
    );
    expect(
      run(cases).some((p) => p.includes('proceed requires evidenceCompleteness fact "pending-liquidity-activity"')),
    ).toBe(true);
  });

  it("flags decisive evidence removed together with its matrix row from non-proceed cases", () => {
    const cases = clone();
    const gc04 = caseById(cases, "GC-04-recent-bank-change-firm-b");
    gc04.householdEvidence = (gc04.householdEvidence as Array<Record<string, unknown>>).filter(
      (row) => row.evidenceKind !== "bank-instruction",
    );
    gc04.evidenceCompleteness = (gc04.evidenceCompleteness as Array<Record<string, unknown>>).filter(
      (row) => row.fact !== "destination-bank-instruction",
    );
    const gc06 = caseById(cases, "GC-06-household-restriction");
    gc06.householdEvidence = (gc06.householdEvidence as Array<Record<string, unknown>>).filter(
      (row) => row.evidenceKind !== "household-instruction",
    );
    gc06.evidenceCompleteness = (gc06.evidenceCompleteness as Array<Record<string, unknown>>).filter(
      (row) => row.fact !== "destination-restriction",
    );
    const problems = run(cases);
    expect(
      problems.some((p) =>
        p.includes("GC-04-recent-bank-change-firm-b requires evidenceCompleteness fact") &&
        p.includes('"destination-bank-instruction"'),
      ),
    ).toBe(true);
    expect(
      problems.some((p) =>
        p.includes("GC-06-household-restriction requires evidenceCompleteness fact") &&
        p.includes('"destination-restriction"'),
      ),
    ).toBe(true);
  });

  it("flags signed request amount and monthly-withdrawal drift in the demo", () => {
    const amountDrift = demoClone();
    amountDrift.requestAmountMinor = 7_400_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, amountDrift).some((p) => p.includes("request amount drift")),
    ).toBe(true);

    const scheduleDrift = demoClone();
    scheduleDrift.plannedWithdrawalMonthlyMinor = 600_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, scheduleDrift).some((p) => p.includes("planned-withdrawal drift")),
    ).toBe(true);
  });

  it("flags reserve-horizon, unit, and derived-floor drift", () => {
    const horizonDrift = demoClone();
    horizonDrift.firms[0]!.reserveMonths = 5;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, horizonDrift).some((p) => p.includes("reserve horizon drift")),
    ).toBe(true);

    const unitDrift = demoClone();
    unitDrift.moneyRenders = [{ minor: 7_500_000, rendered: "$7,500.00" }];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, unitDrift).some((p) => p.includes("not at 100 minor units per major")),
    ).toBe(true);

    const unreadable = demoClone();
    unreadable.moneyRenders = [{ minor: 7_500_000, rendered: "seventy-five thousand" }];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, unreadable).some((p) => p.includes("not a readable 100-per-major amount")),
    ).toBe(true);

    const formatDrift = demoClone();
    formatDrift.moneyUnits = ["plain"];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, formatDrift).some((p) => p.includes('carries format "plain"')),
    ).toBe(true);

    const noMoney = demoClone();
    noMoney.moneyUnits = [];
    noMoney.moneyRenders = [];
    const vacuous = validateGoldenDemoSemantics(clone(), realRefs, noMoney);
    expect(vacuous.some((p) => p.includes("emits no money metrics"))).toBe(true);
    expect(vacuous.some((p) => p.includes("renders no money value"))).toBe(true);

    const floorDrift = demoClone();
    floorDrift.firms[1]!.reserveFloorMinor = 9_500_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, floorDrift).some((p) => p.includes("derived reserve floor drift")),
    ).toBe(true);
  });

  it("reads a rendered money value EXACTLY: whole dollars, fractional cents, and negatives", () => {
    // The false-failure this replaces: 7500010 / 75000.1 is 99.99999999999999 in
    // floating point, so a value that is not a whole number of dollars used to fail
    // the build. Integer arithmetic accepts it, and keeps the sign.
    for (const money of [
      { minor: 7_500_000, rendered: "$75,000.00" },
      { minor: 7_500_010, rendered: "$75,000.10" },
      { minor: -6_400_000, rendered: "-$64,000.00" },
      { minor: 0, rendered: "$0.00" },
    ]) {
      expect(rendersAtCanonicalScale(money), JSON.stringify(money)).toBe(true);
    }
    // A divisor changed anywhere on the display path still cannot pass.
    expect(rendersAtCanonicalScale({ minor: 7_500_000, rendered: "$7,500.00" })).toBe(false);
    expect(rendersAtCanonicalScale({ minor: -6_400_000, rendered: "$64,000.00" })).toBe(false);
    // Sub-cent precision is reported, never rounded into agreement.
    expect(rendersAtCanonicalScale({ minor: 7_500_010, rendered: "$75,000.105" })).toBe(false);
    expect(rendersAtCanonicalScale({ minor: 7_500_000, rendered: "seventy-five thousand" })).toBe(null);
    expect(rendersAtCanonicalScale({ minor: 7_500_000, rendered: "$1-2" })).toBe(null);
    expect(readRenderedMajor("-$64,000.00")).toEqual({ units: -6_400_000, scale: 2 });

    const fractional = demoClone();
    fractional.moneyRenders = [{ minor: 7_500_010, rendered: "$75,000.10" }];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, fractional).some((p) => p.includes("minor units per major")),
    ).toBe(false);
  });

  it("flags a displayed proceed whose own liquidity does not cover the request", () => {
    const drained = demoClone();
    const decision = drained.decisions.find((d) => d.disposition === "proceed")!;
    decision.availableCashMinor = 10_000_000;
    decision.headroomMinor = 10_000_000 - decision.pendingActivityMinor! - decision.reserveFloorMinor;
    const problems = validateGoldenDemoSemantics(clone(), realRefs, drained);
    expect(problems.some((p) => p.includes("available-liquidity drift"))).toBe(true);

    const contradicted = demoClone();
    for (const d of contradicted.decisions) {
      if (d.disposition !== "proceed") continue;
      d.headroomMinor = contradicted.requestAmountMinor - 1;
    }
    const contradictions = validateGoldenDemoSemantics(clone(), realRefs, contradicted);
    expect(contradictions.some((p) => p.includes("renders proceed beside"))).toBe(true);
    expect(contradictions.some((p) => p.includes("is not available - pending - reserve"))).toBe(true);
  });

  it("flags a simulated proceed the drafted reserve no longer supports", () => {
    const simulated = demoClone();
    for (const d of simulated.decisions) {
      if (d.simulatedDisposition !== "proceed") continue;
      d.simulatedFloorMinor = d.reserveFloorMinor + 1;
      d.simulatedHeadroomMinor = null;
    }
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, simulated).some((p) =>
        p.includes("policy-draft simulation renders proceed beside no available"),
      ),
    ).toBe(true);
  });

  it("flags a branch whose liquidity does not trace to a signed case", () => {
    const unsourced = demoClone();
    unsourced.decisions[0]!.sourceCaseId = "GC-99-invented";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, unsourced).some((p) => p.includes("GC-99-invented")),
    ).toBe(true);

    const figureless = demoClone();
    figureless.decisions[0]!.sourceCaseId = "GC-08-ambiguous-household";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, figureless).some((p) => p.includes("states no liquidity for the branch")),
    ).toBe(true);

    const inventedPending = demoClone();
    inventedPending.decisions[0]!.pendingActivityMinor = 4_000_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, inventedPending).some((p) => p.includes("pending-activity drift")),
    ).toBe(true);

    // A malformed figure is REPORTED, not thrown: a crash would discard every
    // diagnostic already collected (the D-062 lesson, applied to this fence too).
    const malformed = demoClone();
    malformed.decisions[0]!.availableCashMinor = Number.NaN;
    const malformedProblems = validateGoldenDemoSemantics(clone(), realRefs, malformed);
    expect(malformedProblems.some((p) => p.includes("must each be a whole non-negative amount"))).toBe(true);
    expect(malformedProblems.some((p) => p.includes("available-liquidity drift"))).toBe(true);

    const wrongBranch = demoClone();
    const safeFirmA = wrongBranch.decisions.find(
      (decision) => decision.scenarioId === "safe-proceed" && decision.firmId === "firm-a",
    )!;
    safeFirmA.sourceCaseId = "GC-10-simultaneous-distributions-first";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, wrongBranch).some((p) =>
        p.includes("belongs to scenario competing-liquidity, not this branch"),
      ),
    ).toBe(true);

    const wrongFirm = demoClone();
    wrongFirm.decisions.find(
      (decision) => decision.scenarioId === "safe-proceed" && decision.firmId === "firm-a",
    )!.sourceCaseId = "GC-02-firm-b-happy-path";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, wrongFirm).some((p) =>
        p.includes("belongs to firm firm-b, not this firm"),
      ),
    ).toBe(true);
  });

  it("rejects missing or incomplete source bindings when an exact signed candidate exists", () => {
    const missing = demoClone();
    const safeFirmA = missing.decisions.find(
      (decision) =>
        decision.scenarioId === "safe-proceed" &&
        decision.firmId === "firm-a" &&
        decision.decisionRole === "primary",
    )!;
    safeFirmA.sourceCaseId = null;
    safeFirmA.requestAt = null;
    safeFirmA.liquidityAuthorityMissing = "Missing";
    safeFirmA.availableCashMinor = null;
    safeFirmA.pendingActivityMinor = null;
    safeFirmA.headroomMinor = null;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, missing).some((p) =>
        p.includes("claims missing authority although exact signed candidate(s) exist"),
      ),
    ).toBe(true);

    const unsignedCases = clone();
    (caseById(unsignedCases, "GC-01-firm-a-happy-path").signoff as Record<string, unknown>).status =
      "pending-captain";
    expect(
      validateGoldenDemoSemantics(unsignedCases, realRefs, realDemo).some((p) =>
        p.includes("is not a signed exact match"),
      ),
    ).toBe(true);
  });

  it("requires source bindings to match disposition, request, units, cadence, and reserve policy", () => {
    const mutations: Array<
      [string, (source: Record<string, unknown>) => void]
    > = [
      ["disposition", (source) => { source.expectedDisposition = "blocked"; }],
      ["request", (source) => { (source.signedMoney as Record<string, unknown>).requestAmountUsd = 74_000; }],
      ["currency", (source) => { (source.signedMoney as Record<string, unknown>).currency = "EUR"; }],
      ["cadence", (source) => { (source.signedMoney as Record<string, unknown>).cadence = "year"; }],
      ["reserve", (source) => { (source.firmConfiguration as Record<string, unknown>).cashReserveMonths = 7; }],
    ];
    for (const [label, mutate] of mutations) {
      const cases = clone();
      mutate(caseById(cases, "GC-10-simultaneous-distributions-first"));
      expect(
        validateGoldenDemoSemantics(cases, realRefs, realDemo).some((p) =>
          p.includes("GC-10-simultaneous-distributions-first") &&
          p.includes("is not a signed exact match"),
        ),
        label,
      ).toBe(true);
    }
  });

  it("requires both signed sides of the competing-liquidity pair to remain represented", () => {
    const unbound = demoClone();
    unbound.decisions = unbound.decisions.filter(
      ({ sourceCaseId }) =>
        sourceCaseId !== "GC-11-simultaneous-distributions-second",
    );
    unbound.sourceTimelines = unbound.sourceTimelines.filter(
      ({ sourceCaseId }) =>
        sourceCaseId !== "GC-11-simultaneous-distributions-second",
    );
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, unbound).some((p) =>
        p.includes(
          "GC-11-simultaneous-distributions-second: exact signed branch-and-firm authority is not represented",
        ),
      ),
    ).toBe(true);
  });

  it("flags unreachable signed records, lost route context, and reused identities", () => {
    const unreachable = demoClone();
    unreachable.recordIdentities = unreachable.recordIdentities.filter(
      ({ routeSourceCaseId }) =>
        routeSourceCaseId !==
        "GC-11-simultaneous-distributions-second",
    );
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        unreachable,
      ).some((problem) =>
        problem.includes(
          "GC-11-simultaneous-distributions-second: exact signed case has no independently reachable printable record",
        ),
      ),
    ).toBe(true);

    const detached = demoClone();
    const gc07 = detached.recordIdentities.find(
      ({ routeSourceCaseId }) =>
        routeSourceCaseId === "GC-07-regulatory-prohibition",
    )!;
    gc07.headerSourceCaseId = "GC-06-household-restriction";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        detached,
      ).some((problem) =>
        problem.includes("printable record header loses exact route context"),
      ),
    ).toBe(true);

    const reused = demoClone();
    const gc06 = reused.recordIdentities.find(
      ({ routeSourceCaseId }) =>
        routeSourceCaseId === "GC-06-household-restriction",
    )!;
    const duplicate = reused.recordIdentities.find(
      ({ routeSourceCaseId }) =>
        routeSourceCaseId === "GC-07-regulatory-prohibition",
    )!;
    duplicate.decisionId = gc06.decisionId;
    duplicate.auditPosition = gc06.auditPosition;
    const reusedProblems = validateGoldenDemoSemantics(
      clone(),
      realRefs,
      reused,
    );
    expect(
      reusedProblems.some((problem) =>
        problem.includes("printable record decision identity is reused"),
      ),
    ).toBe(true);
    expect(
      reusedProblems.some((problem) =>
        problem.includes("printable record audit position is reused"),
      ),
    ).toBe(true);
  });

  it("flags inactive record timestamps, reused hashes, and stale approval bindings", () => {
    const inactive = demoClone();
    const revalidated = inactive.recordIdentities.find(
      ({ routeSourceCaseId, routePass }) =>
        routeSourceCaseId === "GC-15-approval-invalidation" &&
        routePass === "revalidated",
    )!;
    revalidated.headerCreatedAtIso =
      revalidated.decisionEventInstants[0]!;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, inactive).some((problem) =>
        problem.includes(
          "printable record created-at does not match the active DecisionRecorded event",
        ),
      ),
    ).toBe(true);

    const reused = demoClone();
    const gc06 = reused.recordIdentities.find(
      ({ routeSourceCaseId }) =>
        routeSourceCaseId === "GC-06-household-restriction",
    )!;
    const gc07 = reused.recordIdentities.find(
      ({ routeSourceCaseId }) =>
        routeSourceCaseId === "GC-07-regulatory-prohibition",
    )!;
    gc07.decisionBindings[0]!.decisionHash =
      gc06.decisionBindings[0]!.decisionHash;
    gc07.decisionBindings[0]!.bundleHash =
      gc06.decisionBindings[0]!.bundleHash;
    const reusedProblems = validateGoldenDemoSemantics(
      clone(),
      realRefs,
      reused,
    );
    expect(
      reusedProblems.some((problem) =>
        problem.includes(
          "decision hash is reused across exact case or lifecycle inputs",
        ),
      ),
    ).toBe(true);
    expect(
      reusedProblems.some((problem) =>
        problem.includes(
          "input-bundle hash is reused across exact case or lifecycle inputs",
        ),
      ),
    ).toBe(true);

    const staleApproval = demoClone();
    const staleRecord = staleApproval.recordIdentities.find(
      ({ routeSourceCaseId, routePass }) =>
        routeSourceCaseId === "GC-15-approval-invalidation" &&
        routePass === "revalidated",
    )!;
    const originalBinding = staleRecord.decisionBindings[0]!;
    staleRecord.approvalBinding = {
      decisionHash: originalBinding.decisionHash,
      bundleHash: originalBinding.bundleHash,
    };
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        staleApproval,
      ).some((problem) =>
        problem.includes(
          "approvals do not bind the active record decision and input bundle",
        ),
      ),
    ).toBe(true);
  });

  it("flags missing-evidence inference and policy-only comparison claims", () => {
    const inferred = demoClone();
    const gc07 = inferred.decisions.find(
      ({ sourceCaseId, decisionRole }) =>
        sourceCaseId === "GC-07-regulatory-prohibition" &&
        decisionRole === "primary",
    )!;
    gc07.policyTraceRows.find(
      ({ rule }) => rule === "Recent bank-instruction change handling",
    )!.result = "Not triggered - no recent change";
    gc07.recordPrecedenceRows = gc07.policyTraceRows.map((row) => ({
      ...row,
    }));
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, inferred).some((problem) =>
        problem.includes(
          "recent-change trace infers a result without exact signed bank-instruction evidence",
        ),
      ),
    ).toBe(true);

    const overstated = demoClone();
    const gc10 = overstated.decisions.find(
      ({ sourceCaseId, decisionRole }) =>
        sourceCaseId === "GC-10-simultaneous-distributions-first" &&
        decisionRole === "primary",
    )!;
    gc10.comparisonDescription =
      "The differences below are driven by policy provenance, not code.";
    gc10.comparisonDispositionReason =
      "Same evidence - the outcome differs because policy differs.";
    const overstatedProblems = validateGoldenDemoSemantics(
      clone(),
      realRefs,
      overstated,
    );
    expect(
      overstatedProblems.some((problem) =>
        problem.includes(
          "comparison does not disclose its exact signed evidence-authority gap",
        ),
      ),
    ).toBe(true);
    expect(
      overstatedProblems.some((problem) =>
        problem.includes(
          "attributes a disposition difference solely to policy",
        ),
      ),
    ).toBe(true);
  });

  it("flags source-bound visible events that precede or misorder the signed request", () => {
    const beforeRequest = demoClone();
    const duplicate = beforeRequest.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === "GC-12-duplicate-retry",
    )!;
    duplicate.events[1]!.instant = "2026-07-26T20:09:59.000Z";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, beforeRequest).some((p) =>
        p.includes("GC-12-duplicate-retry") &&
        p.includes("precedes its signed request"),
      ),
    ).toBe(true);

    const reversed = demoClone();
    reversed.sourceTimelines
      .find(({ sourceCaseId }) => sourceCaseId === "GC-13-partial-salesforce-success")!
      .events.reverse();
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, reversed).some((p) =>
        p.includes("GC-13-partial-salesforce-success") &&
        p.includes("out of order"),
      ),
    ).toBe(true);

    const detached = demoClone();
    detached.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === "GC-14-delayed-nigo",
    )!.requestAt = "2026-07-26T13:30:00.000Z";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, detached).some((p) =>
        p.includes("visible request instant") &&
        p.includes("signed trigger"),
      ),
    ).toBe(true);

    const detachedRevalidation = demoClone();
    detachedRevalidation.sourceTimelines
      .find(({ sourceCaseId }) => sourceCaseId === "GC-15-approval-invalidation")!
      .events.find(({ kind }) => kind === "revalidation")!.instant =
        "2026-07-26T22:10:00.000Z";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        detachedRevalidation,
      ).some((p) =>
        p.includes("visible revalidation instant") &&
        p.includes("signed evidence retrieval"),
      ),
    ).toBe(true);

    const earlySnapshot = demoClone();
    const gc01Timeline = earlySnapshot.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === "GC-01-firm-a-happy-path",
    )!;
    gc01Timeline.events.find(
      ({ kind }) => kind === "EvidenceSnapshotRecorded",
    )!.instant = gc01Timeline.requestAt;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, earlySnapshot).some(
        (problem) =>
          problem.includes("GC-01-firm-a-happy-path") &&
          problem.includes(
            "EvidenceSnapshotRecorded must follow every included evidence retrieval",
          ),
      ),
    ).toBe(true);

    const approvalBeforeDecision = demoClone();
    const staged = approvalBeforeDecision.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === "GC-01-firm-a-happy-path",
    )!;
    const decision = staged.events.find(({ kind }) => kind === "DecisionRecorded")!;
    const approval = staged.events.find(({ kind }) => kind === "ApprovalRecorded")!;
    [decision.kind, approval.kind] = [approval.kind, decision.kind];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, approvalBeforeDecision)
        .some((problem) => problem.includes("unsorted production timeline")),
    ).toBe(true);

    const approvalAfterRevalidation = demoClone();
    const twoPass = approvalAfterRevalidation.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === "GC-15-approval-invalidation",
    )!;
    const originalApproval = twoPass.events.find(
      ({ kind }) => kind === "ApprovalRecorded",
    )!;
    const revalidation = twoPass.events.find(({ kind }) => kind === "revalidation")!;
    [originalApproval.kind, revalidation.kind] = [
      revalidation.kind,
      originalApproval.kind,
    ];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, approvalAfterRevalidation)
        .some((problem) => problem.includes("unsorted production timeline")),
    ).toBe(true);

    const plantedInversion = demoClone();
    const invertedTimeline = plantedInversion.sourceTimelines.find(
      ({ sourceCaseId }) => sourceCaseId === "GC-12-duplicate-retry",
    )!;
    const finalApproval = invertedTimeline.events.find(
      ({ kind }, index) =>
        kind === "ApprovalRecorded" &&
        !invertedTimeline.events
          .slice(index + 1)
          .some((event) => event.kind === "ApprovalRecorded"),
    )!;
    const reservationEvent = invertedTimeline.events.find(
      ({ kind }) => kind === "ReservationCreated",
    )!;
    [finalApproval.kind, reservationEvent.kind] = [
      reservationEvent.kind,
      finalApproval.kind,
    ];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, plantedInversion).some(
        (problem) =>
          problem.includes("GC-12-duplicate-retry") &&
          problem.includes("unsorted production timeline"),
      ),
    ).toBe(true);

    const hiddenException = demoClone();
    const partialTimeline = hiddenException.sourceTimelines.find(
      ({ sourceCaseId }) =>
        sourceCaseId === "GC-13-partial-salesforce-success",
    )!;
    partialTimeline.events.find(
      ({ kind }) => kind === "ExceptionDecisionRequested",
    )!.kind = "execution-receipt";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, hiddenException).some(
        (problem) =>
          problem.includes("GC-13-partial-salesforce-success") &&
          problem.includes("ExceptionDecisionRequested must remain visible"),
      ),
    ).toBe(true);
  });

  it("flags GC-02's rendered arithmetic drifting from its own signed fixture", () => {
    const drifted = demoClone();
    for (const d of drifted.decisions) {
      if (d.scenarioId !== "safe-proceed") continue;
      d.availableCashMinor = 20_000_000;
      d.headroomMinor = 20_000_000 - d.pendingActivityMinor! - d.reserveFloorMinor;
    }
    const problems = validateGoldenDemoSemantics(clone(), realRefs, drifted);
    expect(problems.some((p) => p.includes("GC-02") && p.includes("rendered liquidity drift"))).toBe(true);
    expect(problems.some((p) => p.includes("GC-02") && p.includes("rendered headroom drift"))).toBe(true);

    const flipped = demoClone();
    for (const d of flipped.decisions) {
      if (d.scenarioId === "safe-proceed" && d.firmId === "firm-b") d.disposition = "blocked";
    }
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, flipped).some((p) => p.includes("GC-02") && p.includes("rendered disposition drift")),
    ).toBe(true);
  });

  it("flags a reserve floor stated with no signed monthly-withdrawal authority anywhere", () => {
    const cases = clone();
    for (const { data } of cases) {
      (data as { signedMoney: Record<string, unknown> }).signedMoney.plannedWithdrawalMonthlyUsd = null;
    }
    const problems = run(cases);
    expect(problems.some((p) => p.includes("no golden case states signedMoney.plannedWithdrawalMonthlyUsd"))).toBe(true);
    expect(problems.some((p) => p.includes("no signed monthly-withdrawal authority exists to derive it from"))).toBe(true);
  });

  it("derives a schedule-less case's floor from the canonical household schedule", () => {
    // GC-11 states reserveFloorUsd with plannedWithdrawalMonthlyUsd null: the floor
    // is still checked through the shared arithmetic, so an edited floor cannot pass
    // by rewording its prose to match.
    const cases = clone();
    const gc11 = caseById(cases, "GC-11-simultaneous-distributions-second");
    (gc11.signedMoney as Record<string, unknown>).reserveFloorUsd = 42_000;
    const schedule = (gc11.householdEvidence as Array<Record<string, unknown>>).find(
      (row) => row.evidenceKind === "planned-withdrawals",
    )!;
    schedule.summary = "Firm A six-month reserve is 42000 USD.";
    expect(run(cases).some((p) => p.includes("GC-11") && p.includes("is not 8000 x 6 months"))).toBe(true);

    const conflicting = clone();
    (caseById(conflicting, "GC-14-delayed-nigo").signedMoney as Record<string, unknown>).plannedWithdrawalMonthlyUsd = 9_000;
    expect(
      run(conflicting).some((p) => p.includes("conflicting planned-withdrawal schedules")),
    ).toBe(true);
  });

  it("flags signed liquidity carried only in prose, inferred, or contradicting the disposition", () => {
    const unstated = clone();
    (caseById(unstated, "GC-02-firm-b-happy-path").signedMoney as Record<string, unknown>).availableLiquidityUsd = 999_000;
    expect(
      run(unstated).some((p) => p.includes("availableLiquidityUsd 999000 is not stated by any account-balance")),
    ).toBe(true);

    const inferred = clone();
    (caseById(inferred, "GC-01-firm-a-happy-path").signedMoney as Record<string, unknown>).pendingLiquidityUsd = null;
    const inferredProblems = run(inferred);
    expect(inferredProblems.some((p) => p.includes("leaves pendingLiquidityUsd null"))).toBe(true);
    expect(inferredProblems.some((p) => p.includes("observed ABSENT must state signedMoney.pendingLiquidityUsd 0"))).toBe(true);

    const overdrawn = clone();
    (caseById(overdrawn, "GC-02-firm-b-happy-path").signedMoney as Record<string, unknown>).availableLiquidityUsd = 160_000;
    const balance = (caseById(overdrawn, "GC-02-firm-b-happy-path").householdEvidence as Array<Record<string, unknown>>).find(
      (row) => row.evidenceKind === "account-balance",
    )!;
    balance.summary = "Joint taxable brokerage available balance 160000 USD.";
    expect(
      run(overdrawn).some((p) => p.includes("a proceed case must leave the request covered")),
    ).toBe(true);

    const missingProceedAuthority = clone();
    (caseById(missingProceedAuthority, "GC-13-partial-salesforce-success").signedMoney as Record<string, unknown>).availableLiquidityUsd = null;
    expect(
      run(missingProceedAuthority).some((p) =>
        p.includes("GC-13") && p.includes("proceed case is missing structured liquidity authority: availableLiquidityUsd"),
      ),
    ).toBe(true);
  });

  it("flags liquidity-driven blocked cases whose own arithmetic covers the request", () => {
    for (const caseId of [
      "GC-05-insufficient-liquidity",
      "GC-11-simultaneous-distributions-second",
    ]) {
      const cases = clone();
      const blocked = caseById(cases, caseId);
      const signedMoney = blocked.signedMoney as Record<string, unknown>;
      signedMoney.availableLiquidityUsd = 300_000;
      const evidence = blocked.householdEvidence as Array<
        Record<string, unknown>
      >;
      const balance = evidence.find(
        (row) => row.evidenceKind === "account-balance",
      )!;
      (balance.displayValue as Record<string, unknown>).value = 300_000;
      balance.summary = "Available balance is 300000 USD.";
      blocked.expectedExplanationNodes = (
        blocked.expectedExplanationNodes as Array<Record<string, unknown>>
      ).map((node, index) => ({
        ...node,
        code: `unclassified-block-${index}`,
      }));
      const problems = run(cases);
      expect(
        problems.some(
          (problem) =>
            problem.includes(caseId) &&
            problem.includes(
              "liquidity-blocked case must leave the request uncovered",
            ),
        ),
      ).toBe(true);
    }
  });

  it("flags GC-15 liquidity rendered in the wrong evidence phase", () => {
    const timingDrift = demoClone();
    const decision = timingDrift.decisions.find(
      (candidate) => candidate.scenarioId === "approval-invalidation" && candidate.firmId === "firm-a",
    )!;
    decision.pendingActivityMinor = 1_500_000;
    decision.revalidationPendingActivityMinor = null;
    const problems = validateGoldenDemoSemantics(clone(), realRefs, timingDrift);
    expect(problems.some((p) => p.includes("pending-activity drift"))).toBe(true);
    expect(problems.some((p) => p.includes("pre-execution revalidation drift"))).toBe(true);

    const unphased = clone();
    const rows = caseById(unphased, "GC-15-approval-invalidation").householdEvidence as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (row.liquidityPhase === "pre-execution-revalidation") delete row.liquidityPhase;
    }
    expect(
      run(unphased).some((p) => p.includes("preExecutionRevalidation requires account-balance and pending-actions evidence")),
    ).toBe(true);

    const surfaceTiming = demoClone();
    surfaceTiming.approvalInvalidationPhases.initialSurfaceMoneyMinor.push(1_500_000);
    surfaceTiming.approvalInvalidationPhases.safetyBeforePendingMinor = 1_500_000;
    surfaceTiming.approvalInvalidationPhases.safetyAfterPendingMinor = 0;
    surfaceTiming.approvalInvalidationPhases.refreshedEvidencePendingMinor = 0;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, surfaceTiming).some((p) =>
        p.includes("keep revalidation pending activity off initial surfaces"),
      ),
    ).toBe(true);
  });

  it("fails closed when signed authority, quorum, or downstream reachability drifts", () => {
    const missingAuthority = demoClone();
    const unsupported = missingAuthority.executionGuards.find(
      (guard) =>
        guard.scenarioId === "partial-salesforce-success" &&
        guard.firmId === "firm-b",
    )!;
    unsupported.reservationVisible = true;
    unsupported.executionReached = true;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, missingAuthority).some(
        (problem) =>
          problem.includes("missing signed liquidity authority must expose no reservation"),
      ),
    ).toBe(true);

    const authorityDrift = demoClone();
    const gc03 = authorityDrift.authorityPlans.find(
      (plan) =>
        plan.scenarioId === "recent-bank-change-block" &&
        plan.firmId === "firm-a" &&
        plan.pass === "initial",
    )!;
    gc03.stages.reverse();
    gc03.stages[0]!.eligibleRoleIds = ["advisor"];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, authorityDrift).some(
        (problem) =>
          problem.includes("rendered authority stage") ||
          problem.includes("ordered plan"),
      ),
    ).toBe(true);

    const automaticDrift = demoClone();
    const gc02 = automaticDrift.authorityPlans.find(
      (plan) =>
        plan.scenarioId === "safe-proceed" &&
        plan.firmId === "firm-b" &&
        plan.pass === "initial",
    )!;
    gc02.automaticAuthorityVisible = false;
    gc02.bindingVisible = true;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, automaticDrift).some(
        (problem) =>
          problem.includes(
            "automatic authority must render explicitly without an approval binding",
          ),
      ),
    ).toBe(true);

    const authorityModeDrift = demoClone();
    authorityModeDrift.authorityPlans.find(
      (plan) =>
        plan.scenarioId === "safe-proceed" &&
        plan.firmId === "firm-b" &&
        plan.pass === "initial",
    )!.mode = "staged";
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, authorityModeDrift).some(
        (problem) => problem.includes("rendered authority mode staged"),
      ),
    ).toBe(true);
  });

  it("flags incomplete invalidation, partial-receipt, and latest-snapshot projections", () => {
    const incompleteLifecycle = demoClone();
    incompleteLifecycle.approvalInvalidationLifecycle.initialEventTypes.splice(
      5,
      1,
    );
    incompleteLifecycle.approvalInvalidationLifecycle.freshApprovals = 1;
    incompleteLifecycle.approvalInvalidationLifecycle.initialReservationVisible = true;
    incompleteLifecycle.approvalInvalidationLifecycle.initialExecutionReached =
      true;
    incompleteLifecycle.approvalInvalidationLifecycle.initialRecordEligibilityVisible =
      true;
    incompleteLifecycle.approvalInvalidationLifecycle.revalidatedExecutionStatuses =
      ["completed"];
    incompleteLifecycle.approvalInvalidationLifecycle.revalidatedRecordBindings.pop();
    incompleteLifecycle.approvalInvalidationLifecycle.initialRecommendationSource =
      incompleteLifecycle.approvalInvalidationLifecycle.revalidatedRecommendationSource;
    incompleteLifecycle.approvalInvalidationLifecycle.initialRecordEvidencePhases.push(
      "pre-execution-revalidation",
    );
    incompleteLifecycle.approvalInvalidationLifecycle.unsupportedFirmEventCount =
      13;
    incompleteLifecycle.approvalInvalidationLifecycle.revalidatedComparisonHeadroomMinor =
      25_200_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, incompleteLifecycle).some(
        (problem) => problem.includes("GC-15 visible lifecycle"),
      ),
    ).toBe(true);

    const roundedUpPartial = demoClone();
    roundedUpPartial.partialReceipt.incompleteParts = [];
    roundedUpPartial.partialReceipt.observedStatuses = ["completed", "completed"];
    roundedUpPartial.partialReceipt.statusLabels = ["Settled · verified"];
    roundedUpPartial.partialReceipt.exceptionDecision = null;
    roundedUpPartial.partialReceipt.recordExceptionDecision = null;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, roundedUpPartial).some(
        (problem) => problem.includes("GC-13 must render and print"),
      ),
    ).toBe(true);

    const staleSimulation = demoClone();
    staleSimulation.invalidationPolicySimulation.initialCurrentHeadroomMinor =
      23_700_000;
    staleSimulation.invalidationPolicySimulation.revalidatedDraftedHeadroomMinor =
      20_400_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, staleSimulation).some(
        (problem) =>
          problem.includes(
            "selected initial or pre-execution liquidity snapshot",
          ),
      ),
    ).toBe(true);
  });

  it("requires a source-bound reservation before the competing request and execution", () => {
    const lateReservation = demoClone();
    const causal = lateReservation.reservationCausality.find(
      ({ sourceCaseId }) =>
        sourceCaseId === "GC-10-simultaneous-distributions-first",
    )!;
    causal.reservationAt = causal.relatedRequestAt;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, lateReservation).some(
        (problem) =>
          problem.includes(
            "reservation must commit after its decision, before its signed sibling request and execution",
          ),
      ),
    ).toBe(true);

    const missingReservation = demoClone();
    missingReservation.reservationCausality = [];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, missingReservation).some(
        (problem) =>
          problem.includes(
            "reservation causality must bind exactly once to the signed GC-11 sibling",
          ),
      ),
    ).toBe(true);
  });

  it("rejects drifted triggers, evidence, and prohibition authority", () => {
    const missingVariant = demoClone();
    missingVariant.signedCaseVariants =
      missingVariant.signedCaseVariants.filter(
        (variant) =>
          (variant as { caseId?: string }).caseId !==
          "GC-08-ambiguous-household",
      );
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        missingVariant,
      ).some((problem) =>
        problem.includes(
          "exact signed-case registry must project all 16 captain-signed cases",
        ),
      ),
    ).toBe(true);

    const leakedTriggerTime = demoClone();
    leakedTriggerTime.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-06-household-restriction",
    )!.requestAt = "2026-07-26T14:15:00.000Z";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        leakedTriggerTime,
      ).some((problem) =>
        problem.includes("interactive request instant must remain firm-neutral"),
      ),
    ).toBe(true);

    const wrongRowMetric = demoClone();
    const ira = wrongRowMetric.decisions
      .find(
        (decision) =>
          decision.sourceCaseId === "GC-01-firm-a-happy-path",
      )!
      .visibleEvidence.find(
        (row) => row.subjectRef === "subject:smiths-ira",
      )!;
    ira.renderedValueMinor = 42_000_000;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        wrongRowMetric,
      ).some((problem) =>
        problem.includes("visible evidence projection drifts"),
      ),
    ).toBe(true);

    const wrongWorkspaceMetric = demoClone();
    const workspaceIra = wrongWorkspaceMetric.decisions
      .find(
        (decision) =>
          decision.sourceCaseId === "GC-01-firm-a-happy-path",
      )!
      .workspaceAccounts.find(
        ({ evidence }) => evidence.subjectRef === "subject:smiths-ira",
      )!;
    workspaceIra.evidence.renderedValueMinor = 31_000_000;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        wrongWorkspaceMetric,
      ).some((problem) =>
        problem.includes("workspace account cards drift"),
      ),
    ).toBe(true);

    const wrongPolicyBinding = demoClone();
    const safePolicy = wrongPolicyBinding.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-01-firm-a-happy-path",
    )!.policyBindings;
    safePolicy.householdInstructionVersions = [];
    safePolicy.recordPolicyVersion = "FA-4.2";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        wrongPolicyBinding,
      ).some((problem) =>
        problem.includes("policy trace or examiner record drifts"),
      ),
    ).toBe(true);

    const wrongCandidates = demoClone();
    const ambiguous = wrongCandidates.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-08-ambiguous-household",
    )!;
    ambiguous.visibleEvidence[0]!.summary =
      "Renovation funding instruction";
    ambiguous.visibleEvidence[0]!.observedAt =
      "2026-07-26T17:19:59.000Z";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        wrongCandidates,
      ).some((problem) =>
        problem.includes(
          "GC-08 must render both signed household candidates",
        ),
      ),
    ).toBe(true);

    const wrongCanonicalRequest = demoClone();
    wrongCanonicalRequest.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-06-household-restriction",
    )!.requestAmountMinor = 3_000_000;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        wrongCanonicalRequest,
      ).some(
        (problem) =>
          problem.includes("permanent-prohibition/firm-a") &&
          problem.includes("canonical request drift"),
      ),
    ).toBe(true);

    const wrongSignedTrigger = demoClone();
    wrongSignedTrigger.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-06-household-restriction",
    )!.signedTrigger!.requestAmountMinor = 7_500_000;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        wrongSignedTrigger,
      ).some(
        (problem) =>
          problem.includes("permanent-prohibition/firm-a") &&
          problem.includes("signed trigger projection"),
      ),
    ).toBe(true);

    const wrongProhibition = demoClone();
    const prohibition = wrongProhibition.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-06-household-restriction",
    )!.prohibition!;
    prohibition.id = "generic-source";
    prohibition.versionId = "HH-INSTR-SMITH-004 v3";
    prohibition.scope = "scope:generic";
    prohibition.reasonCode = "generic-prohibition";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        wrongProhibition,
      ).some(
        (problem) =>
          problem.includes("GC-06-household-restriction") &&
          problem.includes("visible prohibition projection"),
      ),
    ).toBe(true);

    const unreachableRegulatory = demoClone();
    unreachableRegulatory.decisions =
      unreachableRegulatory.decisions.filter(
        (decision) =>
          decision.sourceCaseId !== "GC-07-regulatory-prohibition",
      );
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        unreachableRegulatory,
      ).some((problem) =>
        problem.includes(
          "GC-07-regulatory-prohibition: exact signed branch-and-firm authority is not represented",
        ),
      ),
    ).toBe(true);

    const misclassifiedRegulatory = demoClone();
    const regulatoryDecision = misclassifiedRegulatory.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-07-regulatory-prohibition",
    )!;
    regulatoryDecision.policyTraceRows = regulatoryDecision.policyTraceRows
      .filter((row) => row.rule !== "Regulatory legal hold")
      .map((row) =>
        row.rule === "Household destination restriction"
          ? {
              ...row,
              result: "Violated - this movement is prohibited",
            }
          : row,
      );
    regulatoryDecision.recordPrecedenceRows = [
      ...regulatoryDecision.policyTraceRows,
    ];
    const regulatoryProblems = validateGoldenDemoSemantics(
      clone(),
      realRefs,
      misclassifiedRegulatory,
    );
    expect(
      regulatoryProblems.some((problem) =>
        problem.includes(
          "controlling policy trace rule drifts from the signed prohibition source",
        ),
      ),
    ).toBe(true);
    expect(
      regulatoryProblems.some((problem) =>
        problem.includes(
          "household-instruction trace does not preserve its exact signed result",
        ),
      ),
    ).toBe(true);

    const recordPrecedenceDrift = demoClone();
    recordPrecedenceDrift.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-07-regulatory-prohibition",
    )!.recordPrecedenceRows = [];
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        recordPrecedenceDrift,
      ).some((problem) =>
        problem.includes(
          "policy trace and examiner record precedence projections disagree",
        ),
      ),
    ).toBe(true);
  });

  it("rejects generic execution identifiers and incomplete authority timing", () => {
    const executionDrift = demoClone();
    const gc14 = executionDrift.executionGuards.find(
      (guard) => guard.sourceCaseId === "GC-14-delayed-nigo",
    )!;
    gc14.executionEligibility!.idempotencyKey =
      "generic-idempotency-key";
    gc14.executionEligibility!.reservations[0]!.reservationId =
      "generic-reservation";
    gc14.executionEligibility!.reservations[0]!.conflictKeys.push(
      "generic-bank-instruction",
    );
    gc14.executionEligibility!.reservations[0]!.expiresAfter = "P1D";
    gc14.executionEligibility!.preconditions = [];
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        executionDrift,
      ).some((problem) =>
        problem.includes(
          "rendered execution eligibility drifts from its signed eligibility",
        ),
      ),
    ).toBe(true);

    const authorityDrift = demoClone();
    const specialist = authorityDrift.authorityPlans
      .find(
        (plan) =>
          plan.scenarioId === "recent-bank-change-block" &&
          plan.firmId === "firm-a",
      )!
      .stages[0]!;
    specialist.executionMode = "parallel";
    specialist.expiresAfter = "P3D";
    specialist.escalationPath[0]!.after = "PT1H";
    specialist.escalationPath[0]!.roleIds = ["advisor"];
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        authorityDrift,
      ).some(
        (problem) =>
          problem.includes("execution mode") ||
          problem.includes("authority escalation path"),
      ),
    ).toBe(true);
  });

  it("rejects stale delayed-NIGO polling and malformed timeline instants", () => {
    const stalePoll = demoClone();
    const gc14 = stalePoll.executionGuards.find(
      (guard) => guard.sourceCaseId === "GC-14-delayed-nigo",
    )!;
    gc14.polling = {
      state: "scheduled",
      latestObservationAtIso: "2026-07-28T21:44:00.000Z",
      nextPollAtIso: "2026-07-27T09:44:00.000Z",
    };
    gc14.exceptionDecision = null;
    gc14.verificationProves = [
      {
        display: "Custodian returned the instruction NIGO: signature missing",
        ledgerEvent: "StatusObserved",
        observedAtIso: "2026-07-28T21:44:00.000Z",
      },
    ];
    gc14.verificationNotProvenYet = [
      "That the instruction will not be returned not-in-good-order",
    ];
    const staleProblems = validateGoldenDemoSemantics(
      clone(),
      realRefs,
      stalePoll,
    );
    expect(
      staleProblems.some((problem) =>
        problem.includes(
          "scheduled next poll must follow the latest observed state",
        ),
      ),
    ).toBe(true);
    expect(
      staleProblems.some((problem) =>
        problem.includes(
          "GC-14 must render observed NIGO with the exact custodian reason",
        ),
      ),
    ).toBe(true);

    const malformed = demoClone();
    malformed.sourceTimelines.find(
      (timeline) =>
        timeline.sourceCaseId === "GC-14-delayed-nigo",
    )!.events[1]!.instant = "not-an-instant";
    expect(() =>
      validateGoldenDemoSemantics(clone(), realRefs, malformed),
    ).not.toThrow();
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        malformed,
      ).some((problem) =>
        problem.includes("has a non-canonical instant not-an-instant"),
      ),
    ).toBe(true);
  });

  it("rejects receipt timestamps and verification state detached from signed events", () => {
    const receiptDrift = demoClone();
    const gc13 = receiptDrift.executionGuards.find(
      (guard) =>
        guard.sourceCaseId === "GC-13-partial-salesforce-success",
    )!;
    gc13.executionRows[0]!.timestampIso =
      "2026-07-26T21:14:00.000Z";
    gc13.executionRows[1]!.timestampIso =
      "2026-07-26T21:14:00.000Z";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        receiptDrift,
      ).some((problem) =>
        problem.includes("wrong event-specific instant"),
      ),
    ).toBe(true);

    const proofDrift = demoClone();
    const gc13Proofs = proofDrift.executionGuards.find(
      (guard) =>
        guard.sourceCaseId === "GC-13-partial-salesforce-success",
    )!;
    for (const proof of gc13Proofs.verificationProves) {
      proof.observedAtIso = "2026-07-28T21:14:00.000Z";
    }
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        proofDrift,
      ).some((problem) =>
        problem.includes(
          "verification proof provenance must bind each claim",
        ),
      ),
    ).toBe(true);

    const stateDrift = demoClone();
    const gc14 = stateDrift.executionGuards.find(
      (guard) => guard.sourceCaseId === "GC-14-delayed-nigo",
    )!;
    gc14.verificationState!.custodianReason = "signature missing";
    gc14.verificationState!.observedAtIso =
      "2026-07-26T21:44:00.000Z";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        stateDrift,
      ).some((problem) =>
        problem.includes("rendered verification state drifts"),
      ),
    ).toBe(true);

    const unsupported = clone();
    const verification = caseById(
      unsupported,
      "GC-14-delayed-nigo",
    ).expectedVerificationState as Record<string, unknown>;
    verification.custodianReason = null;
    expect(
      run(unsupported).some((problem) =>
        problem.includes("NIGO verification must preserve the custodian reason"),
      ),
    ).toBe(true);
  });

  it("reports derived arithmetic overflow as diagnostics rather than throwing", () => {
    const floorOverflow = clone();
    const floorCase = caseById(floorOverflow, "GC-01-firm-a-happy-path");
    const safeMajor = Math.floor(Number.MAX_SAFE_INTEGER / 100);
    (floorCase.signedMoney as Record<string, unknown>).plannedWithdrawalMonthlyUsd =
      safeMajor;
    expect(() => run(floorOverflow)).not.toThrow();
    expect(
      run(floorOverflow).some((problem) =>
        problem.includes("reserve derivation exceeds the safe integer range"),
      ),
    ).toBe(true);

    const headroomOverflow = clone();
    const headroomCase = caseById(
      headroomOverflow,
      "GC-01-firm-a-happy-path",
    );
    (headroomCase.signedMoney as Record<string, unknown>).availableLiquidityUsd =
      0;
    (headroomCase.signedMoney as Record<string, unknown>).pendingLiquidityUsd =
      safeMajor;
    expect(() => run(headroomOverflow)).not.toThrow();
    expect(
      run(headroomOverflow).some((problem) =>
        problem.includes("liquidity headroom derivation exceeds the safe integer range"),
      ),
    ).toBe(true);
  });

  it("flags a policy-draft simulation whose displayed reserve floor drifts off the signed horizon", () => {
    const draftDrift = demoClone();
    draftDrift.draftedReserveFloorMinor = 9_500_000;
    const problems = validateGoldenDemoSemantics(clone(), realRefs, draftDrift);
    expect(problems.some((p) => p.includes("GC-02") && p.includes("drafted-policy reserve floor drift"))).toBe(true);
    expect(problems.some((p) => p.includes("not the monthly withdrawal times the drafted horizon"))).toBe(true);

    const undisplayed = demoClone();
    undisplayed.draftedReserveFloorMinor = null;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, undisplayed).some((p) => p.includes("displays no reserve floor to fence")),
    ).toBe(true);
  });

  it("REPORTS rather than crashes on a non-integer reserve horizon (diagnostics must survive)", () => {
    const cases = clone();
    delete (caseById(cases, "GC-01-firm-a-happy-path").firmConfiguration as Record<string, unknown>).cashReserveMonths;
    (caseById(cases, "GC-02-firm-b-happy-path").firmConfiguration as Record<string, unknown>).cashReserveMonths = 6.5;
    const problems = [
      ...validateGoldenCases(cases, realRefs, realDoc),
      ...validateGoldenDemoSemantics(cases, realRefs, realDemo),
    ];
    expect(problems.some((p) => p.includes("GC-01") && p.includes("cashReserveMonths must be an integer"))).toBe(true);
    expect(problems.some((p) => p.includes("GC-01-firm-a-happy-path: firmConfiguration.cashReserveMonths is not a whole reserve horizon"))).toBe(true);
    expect(problems.some((p) => p.includes("GC-02-firm-b-happy-path: firmConfiguration.cashReserveMonths is not a whole reserve horizon"))).toBe(true);
  });

  it("flags status-register and status-plane drift", () => {
    const refs: ScenarioRefs = {
      ...realRefs,
      executionStates: new Set([...realRefs.executionStates, "settled"]),
    };
    expect(
      validateGoldenDemoSemantics(clone(), refs, realDemo).some((p) => p.includes("execution statuses must equal")),
    ).toBe(true);

    const demo = demoClone();
    demo.executionTimelineStatuses = [...demo.executionTimelineStatuses, "stuck"];
    demo.verificationTimelineStatuses = [...demo.verificationTimelineStatuses, "duplicate-suppressed"];
    const problems = validateGoldenDemoSemantics(clone(), realRefs, demo);
    expect(problems.some((p) => p.includes('"stuck" is neither an observed outcome nor an execution receipt'))).toBe(true);
    expect(problems.some((p) => p.includes('"duplicate-suppressed" is neither an observed outcome nor a verification projection'))).toBe(true);
  });

  it("flags normative status-vocabulary drift across the contract, checklist, and design language", () => {
    for (const target of STATUS_VOCABULARY_DOCS) {
      const dropped = realStatusDocs.map((doc) =>
        doc.path === target ? { ...doc, text: doc.text.replaceAll("`completed`", "`settled`") } : doc,
      );
      expect(
        validateStatusVocabularyDocs(dropped).some((p) => p.startsWith(`${target}:`) && p.includes("`completed`")),
        target,
      ).toBe(true);
    }

    const resurrected = realStatusDocs.map((doc) => ({
      ...doc,
      text: doc.text.replace(/no (separate )?canonical `settled` (status|state)/gi, "the canonical settled state"),
    }));
    const resurrectedProblems = validateStatusVocabularyDocs(resurrected);
    for (const target of STATUS_VOCABULARY_DOCS) {
      expect(resurrectedProblems.some((p) => p.startsWith(`${target}:`) && p.includes("no canonical")), target).toBe(true);
    }

    const planeless = realStatusDocs.map((doc) => ({
      ...doc,
      text: doc.text.replace(/[Vv]erification projection/g, "external status"),
    }));
    expect(
      validateStatusVocabularyDocs(planeless).some((p) => p.includes("`stuck`") && p.includes("verification projection")),
    ).toBe(true);

    const extraObserved = realStatusDocs.map((doc) => ({
      ...doc,
      text: doc.text.replace(
        "Canonical observed-status ids: `submitted`, `in-flight`, `completed`, `rejected`, `nigo`, `unknown`.",
        "Canonical observed-status ids: `submitted`, `in-flight`, `completed`, `rejected`, `nigo`, `unknown`, `queued`.",
      ),
    }));
    const extraProblems = validateStatusVocabularyDocs(extraObserved);
    for (const target of STATUS_VOCABULARY_DOCS) {
      expect(
        extraProblems.some(
          (problem) =>
            problem.startsWith(`${target}:`) &&
            problem.includes("canonical observed-status list must equal"),
        ),
        target,
      ).toBe(true);
    }

    expect(validateStatusVocabularyDocs([]).some((p) => p.includes("went vacuous"))).toBe(true);
    expect(
      validateStatusVocabularyDocs([{ path: "docs/demo-contract.md", text: "" }]).some((p) => p.includes("missing or empty")),
    ).toBe(true);
  });

  it("flags an incomplete or misordered GC-16 authority-lapse event sequence", () => {
    const cases = clone();
    const events = caseById(cases, "GC-16-specialist-review-expiration").expectedLedgerEvents as unknown[];
    events.reverse();
    expect(
      validateGoldenDemoSemantics(cases, realRefs, realDemo).some((p) => p.includes("GC-16 event sequence must be")),
    ).toBe(true);

    const visible = demoClone();
    visible.authorityLapseEvents.reverse();
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, visible).some((p) =>
        p.includes("GC-16 visible authority order must be"),
      ),
    ).toBe(true);
  });

  it("flags structural contradictions: a blocked case carrying authority/execution, a proceed case with none", () => {
    const cases = clone();
    const blocked = caseById(cases, "GC-04-recent-bank-change-firm-b");
    (blocked.expectedAuthority as Record<string, unknown>).mode = "approval";
    (blocked.expectedExecutionEligibility as Record<string, unknown>).eligible = true;
    (blocked.expectedVerificationState as Record<string, unknown>).reached = true;
    const problems = run(cases);
    expect(problems.some((p) => p.includes("a blocked decision carries no authority"))).toBe(true);
    expect(problems.some((p) => p.includes("a blocked decision is not execution-eligible"))).toBe(true);
    expect(problems.some((p) => p.includes("a blocked decision never reaches execution"))).toBe(true);

    const cases2 = clone();
    (caseById(cases2, "GC-01-firm-a-happy-path").expectedAuthority as Record<string, unknown>).mode = "none";
    expect(run(cases2).some((p) => p.includes('a proceed decision must state an authority mode other than "none"'))).toBe(true);
  });

  it("flags a partial-Salesforce case that dropped its deferred-pending-sandbox marking", () => {
    const cases = clone();
    caseById(cases, "GC-13-partial-salesforce-success").deferred = null;
    expect(run(cases).some((p) => p.includes("partial-Salesforce case must carry"))).toBe(true);
  });

  it("flags doc/fixture drift and a dropped spec-required case", () => {
    const cases = clone();
    expect(run(cases, realDoc.replaceAll("GC-05-insufficient-liquidity", "GC-05-renamed")).some((p) => p.includes("not referenced anywhere in docs/golden-cases.md"))).toBe(true);

    const fewer = clone().filter((c) => (c.data as Record<string, unknown>).caseId !== "GC-09-stale-evidence");
    expect(run(fewer).some((p) => p.includes('required spec case "stale evidence" is not covered'))).toBe(true);
  });

  it("flags a doc-only reference: a deleted fixture whose doc rows remain CANNOT pass", () => {
    // GC-15's spec name is not in REQUIRED_SPEC_NAMES and 15 cases still satisfy
    // the >=12 floor, so only the doc->fixture direction can catch this deletion.
    const fewer = clone().filter((c) => (c.data as Record<string, unknown>).caseId !== "GC-15-approval-invalidation");
    expect(
      run(fewer).some((p) => p.includes('references case id "GC-15-approval-invalidation"') && p.includes("no such fixture")),
    ).toBe(true);
  });

  it("flags a truth set below twelve cases and a duplicated caseId", () => {
    const four = clone().slice(0, 4);
    expect(run(four).some((p) => p.includes("the spec requires at least twelve"))).toBe(true);

    const doubled = clone();
    doubled.push({ rel: doubled[0]!.rel, data: JSON.parse(JSON.stringify(doubled[0]!.data)) as unknown });
    expect(run(doubled).some((p) => p.includes("duplicate caseId"))).toBe(true);
  });

  it("flags recorded-silence abuse: empty household instructions WITHOUT the recorded note", () => {
    const cases = clone();
    const c = caseById(cases, "GC-08-ambiguous-household");
    delete c.householdInstructionsNote;
    const problems = run(cases);
    expect(problems.some((p) => p.includes("householdInstructions is empty with no householdInstructionsNote"))).toBe(true);
    expect(problems.some((p) => p.includes("householdInstructionVersionIds is empty with no householdInstructionsNote"))).toBe(true);
  });

  it("flags stale-vocabulary injection via the refs themselves (a gutted scenarios.yaml cannot pass vacuously)", () => {
    const gutted = loadScenarioRefs("contract:\n  id: verin-demo-contract\n");
    const problems = validateGoldenCases(realCases, gutted, realDoc);
    expect(problems.some((p) => p.includes("firm must be a scenarios.yaml firm id"))).toBe(true);
  });

  it("accepts the real, honest truth set (cannot pass by always-failing)", () => {
    expect(validateGoldenCases(realCases, realRefs, realDoc)).toEqual([]);
  });

  it("accepts a properly attributed captain signature (the future signing PR stays green)", () => {
    const cases = clone();
    const signoff = caseById(cases, "GC-01-firm-a-happy-path").signoff as Record<string, unknown>;
    signoff.status = "signed";
    signoff.signedBy = "captain";
    signoff.signedAt = "2026-08-01T09:00:00-04:00";
    expect(run(cases)).toEqual([]);
  });

  it("sanity: the fixtures live where the loader looks (join is real, not mocked)", () => {
    expect(realCases.length).toBeGreaterThan(0);
    expect(realCases[0]!.rel.startsWith("fixtures/golden/")).toBe(true);
    expect(readFileSync(join(REPO_ROOT, realCases[0]!.rel), "utf8").length).toBeGreaterThan(0);
  });
});
