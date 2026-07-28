import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./_fence-utils";
import {
  GOLDEN_DOC,
  REQUIRED_SPEC_NAMES,
  loadGoldenCases,
  loadScenarioRefs,
  validateGoldenCases,
  type LoadedCase,
  type ScenarioRefs,
} from "../../../scripts/golden-cases.lib";
import { loadDemoSemanticSnapshot } from "../../../scripts/golden-demo-snapshot";
import {
  validateGoldenDemoSemantics,
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

describe("golden-cases fence", () => {
  it("enforces: every golden case is complete, aligned, consistent, and signoff-gated", () => {
    const problems = [
      ...validateGoldenCases(realCases, realRefs, realDoc),
      ...validateGoldenDemoSemantics(realCases, realRefs, realDemo),
    ];
    expect(problems, `golden-case problems:\n${problems.join("\n")}`).toEqual([]);
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
    expect(problems.some((p) => p.includes("must be a v3 LedgerEntry type"))).toBe(true);
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
    unitDrift.minorUnitsPerMajor = 1_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, unitDrift).some((p) => p.includes("100 minor units per major")),
    ).toBe(true);

    const floorDrift = demoClone();
    floorDrift.firms[1]!.reserveFloorMinor = 9_500_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, floorDrift).some((p) => p.includes("derived reserve floor drift")),
    ).toBe(true);
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

  it("flags an incomplete or misordered GC-16 authority-lapse event sequence", () => {
    const cases = clone();
    const events = caseById(cases, "GC-16-specialist-review-expiration").expectedLedgerEvents as unknown[];
    events.reverse();
    expect(
      validateGoldenDemoSemantics(cases, realRefs, realDemo).some((p) => p.includes("GC-16 event sequence must be")),
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
