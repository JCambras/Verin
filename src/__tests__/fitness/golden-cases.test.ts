import { beforeAll, describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./_fence-utils";
import {
  GOLDEN_DOC,
  DEFAULT_GOLDEN_AUTHORITY_GAPS,
  REQUIRED_SPEC_NAMES,
  STATUS_VOCABULARY_DOCS,
  V3_CORE_CONTRACTS,
  loadGoldenCases,
  loadScenarioRefs,
  loadStatusVocabularyDocs,
  validateGoldenCases,
  validateLedgerVocabulary,
  type LoadedCase,
  type GoldenAuthorityGap,
  type ScenarioRefs,
} from "../../../scripts/golden-cases.lib";
import { validateGoldenCaseArtifacts } from "../../../scripts/golden-cases-runner.lib";
import {
  deriveIndependentDemoBinding,
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
const realContracts = readFileSync(V3_CORE_CONTRACTS, "utf8");
const realStatusDocs = loadStatusVocabularyDocs();
let realDemo!: DemoSemanticSnapshot;
let approvalPlanSatisfied!: typeof import("../../app/demo/build-approval-stages").approvalPlanSatisfied;
let parseSignedCaseVariants!: typeof import("../../app/demo/signed-cases").parseSignedCaseVariants;

beforeAll(async () => {
  const rawProblems = validateGoldenCases(
    realCases,
    realRefs,
    realDoc,
  );
  if (rawProblems.length > 0) {
    throw new Error(
      `raw golden-case validation failed before production parsing:\n${rawProblems.join("\n")}`,
    );
  }
  const [snapshot, approvalStages, signedCases] = await Promise.all([
    import("../../../scripts/golden-demo-snapshot"),
    import("../../app/demo/build-approval-stages"),
    import("../../app/demo/signed-cases"),
  ]);
  realDemo = snapshot.loadDemoSemanticSnapshot();
  approvalPlanSatisfied = approvalStages.approvalPlanSatisfied;
  parseSignedCaseVariants = signedCases.parseSignedCaseVariants;
});

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

  it("binds every authority gap to immutable signed bytes and real missing authority", () => {
    const withoutGap = validateGoldenCases(
      realCases,
      realRefs,
      realDoc,
      [],
    );
    for (const expected of [
      "must be canonical UTC",
      "evidenceCompleteness",
      "signedMoney",
      "stageId",
      "approval quorum for initial stage bank-change-specialist-review",
      "pre-execution revalidation",
      "expectedVerificationState",
    ]) {
      expect(withoutGap.some((problem) => problem.includes(expected))).toBe(
        true,
      );
    }

    const badHash = JSON.parse(
      JSON.stringify(DEFAULT_GOLDEN_AUTHORITY_GAPS),
    ) as GoldenAuthorityGap[];
    badHash[0]!.fixtureSha256 = "0".repeat(64);
    expect(
      validateGoldenCases(realCases, realRefs, realDoc, badHash).some(
        (problem) => problem.includes("fixture bytes drift"),
      ),
    ).toBe(true);

    const weakenedReason = JSON.parse(
      JSON.stringify(DEFAULT_GOLDEN_AUTHORITY_GAPS),
    ) as GoldenAuthorityGap[];
    weakenedReason[0]!.reason = "Pending evidence.";
    expect(
      validateGoldenCases(
        realCases,
        realRefs,
        realDoc,
        weakenedReason,
      ).some((problem) =>
        problem.includes("must fail closed with an explicit pending-signature reason"),
      ),
    ).toBe(true);

    const mutated = clone();
    (
      caseById(mutated, "GC-03-recent-bank-change-firm-a")
        .trigger as Record<string, unknown>
    ).description = "changed after captain signoff";
    expect(
      run(mutated).some((problem) =>
        problem.includes("loaded data drifts from its signed fixture bytes"),
      ),
    ).toBe(true);

    const gc01 = realCases.find(
      ({ data }) =>
        (data as Record<string, unknown>).caseId ===
        "GC-01-firm-a-happy-path",
    )!;
    const gc01Data = gc01.data as Record<string, unknown>;
    const gc01Signoff = gc01Data.signoff as Record<string, unknown>;
    const staleGap: GoldenAuthorityGap = {
      caseId: "GC-01-firm-a-happy-path",
      fixtureSha256: createHash("sha256")
        .update(gc01.sourceText!)
        .digest("hex"),
      signedAt: String(gc01Signoff.signedAt),
      requiredSince: "2026-07-28",
      status: "awaiting-captain-signature",
      execution: "withheld",
      reason: "Awaiting captain-signed authority.",
      missingAuthorities: ["structured-money"],
    };
    expect(
      validateGoldenCases(realCases, realRefs, realDoc, [staleGap]).some(
        (problem) => problem.includes("declares stale authority gap"),
      ),
    ).toBe(true);

    const unknownGap = JSON.parse(
      JSON.stringify(DEFAULT_GOLDEN_AUTHORITY_GAPS),
    ) as GoldenAuthorityGap[];
    unknownGap[0]!.missingAuthorities = ["invented-authority"];
    expect(
      validateGoldenCases(realCases, realRefs, realDoc, unknownGap).some(
        (problem) =>
          problem.includes("missingAuthorities must be unique, non-empty, and closed"),
      ),
    ).toBe(true);
  });

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
    expect(problems.some((p) => p.includes("must be a v3 LedgerEntry type or an ADR-0040 authority-lapse event"))).toBe(true);
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

  it("requires every authority-stage quorum in each lifecycle pass", () => {
    const incompleteOps = clone();
    const opsEvents = caseById(
      incompleteOps,
      "GC-01-firm-a-happy-path",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    opsEvents.splice(
      opsEvents.findIndex(
        (event) =>
          event.type === "ApprovalRecorded" &&
          event.stageId === "ops-dual-approval",
      ),
      1,
    );
    expect(
      run(incompleteOps).some((problem) =>
        problem.includes(
          "approval quorum for initial stage ops-dual-approval requires 2 ApprovalRecorded events, found 1",
        ),
      ),
    ).toBe(true);

    const incompleteRevalidation = clone();
    const revalidationEvents = caseById(
      incompleteRevalidation,
      "GC-15-approval-invalidation",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    revalidationEvents.splice(
      revalidationEvents.findIndex(
        (event) =>
          event.type === "ApprovalRecorded" &&
          event.lifecyclePass === "revalidated",
      ),
      1,
    );
    expect(
      run(incompleteRevalidation).some((problem) =>
        problem.includes(
          "approval quorum for revalidated stage ops-dual-approval requires 2 ApprovalRecorded events, found 1",
        ),
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
      validateLedgerVocabulary(landed).some((p) => p.includes("collapse it out of the ADR-0040 extension")),
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
    floorDrift.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-02-firm-b-happy-path",
    )!.reserveFloorMinor = 9_500_000;
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, floorDrift).some((p) => p.includes("derived reserve floor drift")),
    ).toBe(true);
  });

  it("fences every structured firm-policy input across fixtures, config, demo, and rendering", () => {
    for (const [field, value] of [
      ["cashReserveMonths", 7],
      ["dualApprovalThresholdUsd", 26_000],
      ["approvalsRequired", 3],
      ["distinctActorsRequired", false],
      ["eligibleRole", "principal"],
      ["requesterConstraint", null],
      [
        "bankInstructionChangeHandling",
        "block-until-independently-verified",
      ],
    ] as const) {
      const cases = clone();
      const config = caseById(
        cases,
        "GC-01-firm-a-happy-path",
      ).firmConfiguration as Record<string, unknown>;
      config[field] = value;
      expect(
        run(cases).some((problem) =>
          problem.includes(
            `firmConfiguration.${field} does not match scenarios.yaml`,
          ),
        ),
        field,
      ).toBe(true);
    }

    for (const mutate of [
      (demo: DemoSemanticSnapshot) => {
        demo.firms[0]!.reserveMonths = 7;
      },
      (demo: DemoSemanticSnapshot) => {
        demo.firms[0]!.dualApprovalThresholdMinor = 2_600_000;
      },
      (demo: DemoSemanticSnapshot) => {
        demo.firms[0]!.approvalsRequired = 3;
      },
      (demo: DemoSemanticSnapshot) => {
        demo.firms[0]!.distinctActorsRequired = false;
      },
      (demo: DemoSemanticSnapshot) => {
        demo.firms[0]!.eligibleRole = "principal";
      },
      (demo: DemoSemanticSnapshot) => {
        demo.firms[0]!.requesterConstraint = null;
      },
      (demo: DemoSemanticSnapshot) => {
        demo.firms[0]!.bankChangeHandling =
          "block-until-independently-verified";
      },
    ]) {
      const demo = demoClone();
      mutate(demo);
      expect(
        validateGoldenDemoSemantics(
          clone(),
          realRefs,
          demo,
        ).some((problem) =>
          problem.includes(
            "demo firm policy inputs drift from scenarios.yaml",
          ),
        ),
      ).toBe(true);
    }

    const rendered = demoClone();
    rendered.renderedFirmPolicies[0]!.dualApprovalThresholdMinor =
      2_600_000;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        rendered,
      ).some((problem) =>
        problem.includes(
          "rendered comparison drifts from structured firm policy inputs",
        ),
      ),
    ).toBe(true);
  });

  it("keeps schedule-less cases from rendering reserve or policy simulations", () => {
    for (const caseId of [
      "GC-04-recent-bank-change-firm-b",
      "GC-06-household-restriction",
      "GC-07-regulatory-prohibition",
      "GC-08-ambiguous-household",
    ]) {
      const decision = realDemo.decisions.find(
        (candidate) =>
          candidate.sourceCaseId === caseId &&
          candidate.decisionRole === "primary",
      );
      expect(decision, caseId).toBeDefined();
      expect(decision?.plannedWithdrawalMonthlyMinor, caseId).toBeNull();
      expect(decision?.reserveFloorMinor, caseId).toBeNull();
      expect(decision?.headroomMinor, caseId).toBeNull();
      expect(decision?.simulatedFloorMinor, caseId).toBeNull();
      expect(decision?.simulatedHeadroomMinor, caseId).toBeNull();
      expect(decision?.simulatedDisposition, caseId).toBeNull();
      expect(decision?.policyApprovalAvailable, caseId).toBe(false);
    }
    expect(
      realDemo.decisions.find(
        (decision) =>
          decision.sourceCaseId ===
            "GC-01-firm-a-happy-path" &&
          decision.decisionRole === "primary",
      )?.policyApprovalAvailable,
    ).toBe(true);

    const borrowed = demoClone();
    const gc06 = borrowed.decisions.find(
      (decision) =>
        decision.sourceCaseId === "GC-06-household-restriction",
    )!;
    gc06.plannedWithdrawalMonthlyMinor = 800_000;
    gc06.reserveFloorMinor = 4_800_000;
    gc06.simulatedFloorMinor = 9_600_000;
    gc06.policyApprovalAvailable = true;
    const borrowedProblems = validateGoldenDemoSemantics(
      clone(),
      realRefs,
      borrowed,
    );
    expect(
      borrowedProblems.some((problem) =>
        problem.includes(
          "missing planned-withdrawal evidence must leave reserve and policy simulation unavailable",
        ),
      ),
    ).toBe(true);
    expect(
      borrowedProblems.some((problem) =>
        problem.includes(
          "policy approval and activation must remain unavailable until the exact-case simulation delta is computed",
        ),
      ),
    ).toBe(true);

    const suppressed = demoClone();
    suppressed.decisions.find(
      (decision) =>
        decision.sourceCaseId ===
          "GC-01-firm-a-happy-path" &&
        decision.decisionRole === "primary",
    )!.policyApprovalAvailable = false;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        suppressed,
      ).some((problem) =>
        problem.includes(
          "policy approval and activation must remain unavailable until the exact-case simulation delta is computed",
        ),
      ),
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
    decision.headroomMinor = 10_000_000 - decision.pendingActivityMinor! - decision.reserveFloorMinor!;
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
      d.simulatedFloorMinor = d.reserveFloorMinor! + 1;
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
    // diagnostic already collected (the D-099 lesson, applied to this fence too).
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
    duplicate.auditPosition = { ...gc06.auditPosition };
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

  it("independently binds evidence, policy, case, firm, scenario, pass, and decision inputs", () => {
    const baseRecord = realDemo.recordIdentities.find(
      (record) =>
        record.routeSourceCaseId ===
          "GC-01-firm-a-happy-path" &&
        record.routePass === "initial",
    )!;
    const base = deriveIndependentDemoBinding(
      clone(),
      realDemo,
      baseRecord,
      "initial",
    )!;
    const expectBothChanged = (
      derived: { decisionHash: string; bundleHash: string } | null,
      label: string,
    ) => {
      expect(derived, label).not.toBeNull();
      expect(derived?.bundleHash, label).not.toBe(base.bundleHash);
      expect(derived?.decisionHash, label).not.toBe(
        base.decisionHash,
      );
    };

    const evidenceCases = clone();
    const evidence = (
      caseById(
        evidenceCases,
        "GC-01-firm-a-happy-path",
      ).householdEvidence as Array<Record<string, unknown>>
    )[0]!;
    evidence.summary = `${String(evidence.summary)} changed`;
    expectBothChanged(
      deriveIndependentDemoBinding(
        evidenceCases,
        realDemo,
        baseRecord,
        "initial",
      ),
      "evidence",
    );

    const policyCases = clone();
    (
      caseById(
        policyCases,
        "GC-01-firm-a-happy-path",
      ).policyVersions as Record<string, unknown>
    ).firmPolicyVersionId = "firm-a-policy@changed";
    expectBothChanged(
      deriveIndependentDemoBinding(
        policyCases,
        realDemo,
        baseRecord,
        "initial",
      ),
      "policy",
    );

    for (const axis of ["case", "firm", "scenario"] as const) {
      const cases = clone();
      const demo = demoClone();
      const record = demo.recordIdentities.find(
        (candidate) =>
          candidate.routeSourceCaseId ===
            "GC-01-firm-a-happy-path" &&
          candidate.routePass === "initial",
      )!;
      const decision = demo.decisions.find(
        (candidate) =>
          candidate.sourceCaseId ===
          "GC-01-firm-a-happy-path",
      )!;
      if (axis === "case") {
        (
          caseById(
            cases,
            "GC-01-firm-a-happy-path",
          ) as Record<string, unknown>
        ).caseId = "GC-01-firm-a-happy-path-changed";
        record.routeSourceCaseId =
          "GC-01-firm-a-happy-path-changed";
        decision.sourceCaseId =
          "GC-01-firm-a-happy-path-changed";
      } else if (axis === "firm") {
        record.routeFirmId = "firm-changed";
        demo.firms[0]!.id = "firm-changed";
        decision.firmId = "firm-changed";
      } else {
        record.routeScenarioId = "safe-proceed-changed";
        decision.scenarioId = "safe-proceed-changed";
      }
      expectBothChanged(
        deriveIndependentDemoBinding(
          cases,
          demo,
          record,
          "initial",
        ),
        axis,
      );
    }

    const gc15Initial = realDemo.recordIdentities.find(
      (record) =>
        record.routeSourceCaseId ===
          "GC-15-approval-invalidation" &&
        record.routePass === "initial",
    )!;
    const gc15Revalidated = realDemo.recordIdentities.find(
      (record) =>
        record.routeSourceCaseId ===
          "GC-15-approval-invalidation" &&
        record.routePass === "revalidated",
    )!;
    const initial = deriveIndependentDemoBinding(
      clone(),
      realDemo,
      gc15Initial,
      "initial",
    )!;
    const revalidated = deriveIndependentDemoBinding(
      clone(),
      realDemo,
      gc15Revalidated,
      "revalidated",
    )!;
    expect(revalidated.bundleHash).not.toBe(initial.bundleHash);
    expect(revalidated.decisionHash).not.toBe(initial.decisionHash);

    const decisionOnly = demoClone();
    const decision = decisionOnly.decisions.find(
      (candidate) =>
        candidate.sourceCaseId ===
        "GC-01-firm-a-happy-path",
    )!;
    decision.disposition = "blocked";
    const changedDecision = deriveIndependentDemoBinding(
      clone(),
      decisionOnly,
      decisionOnly.recordIdentities.find(
        (record) =>
          record.routeSourceCaseId ===
            "GC-01-firm-a-happy-path" &&
          record.routePass === "initial",
      )!,
      "initial",
    )!;
    expect(changedDecision.bundleHash).toBe(base.bundleHash);
    expect(changedDecision.decisionHash).not.toBe(
      base.decisionHash,
    );
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
          "comparison does not disclose its complete signed evidence difference",
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

    const omittedEvidenceRow = demoClone();
    const gc01 = omittedEvidenceRow.decisions.find(
      ({ sourceCaseId, decisionRole }) =>
        sourceCaseId === "GC-01-firm-a-happy-path" &&
        decisionRole === "primary",
    )!;
    gc01.comparisonDescription =
      "The same household and request have signed evidence.";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        omittedEvidenceRow,
      ).some((problem) =>
        problem.includes(
          "comparison does not disclose its complete signed evidence difference",
        ),
      ),
    ).toBe(true);

    const summaryCases = clone();
    const sourceEvidence = caseById(
      summaryCases,
      "GC-01-firm-a-happy-path",
    ).householdEvidence as Array<Record<string, unknown>>;
    const counterpart = caseById(
      summaryCases,
      "GC-02-firm-b-happy-path",
    );
    counterpart.householdEvidence = JSON.parse(
      JSON.stringify(sourceEvidence),
    ) as Array<Record<string, unknown>>;
    (
      counterpart.householdEvidence as Array<
        Record<string, unknown>
      >
    )[0]!.summary =
      "The signed evidence now carries a materially different meaning.";
    const summaryDemo = demoClone();
    summaryDemo.decisions.find(
      ({ sourceCaseId, decisionRole }) =>
        sourceCaseId === "GC-01-firm-a-happy-path" &&
        decisionRole === "primary",
    )!.comparisonDescription =
      "The same household and request have exact signed equivalent evidence; differences are driven by policy provenance, not code.";
    expect(
      validateGoldenDemoSemantics(
        summaryCases,
        realRefs,
        summaryDemo,
      ).some((problem) =>
        problem.includes(
          "safe-proceed/firm-a/primary: comparison does not disclose its complete signed evidence difference",
        ),
      ),
    ).toBe(true);

    const exactComparisonCases = () => {
      const cases = clone();
      const source = caseById(cases, "GC-01-firm-a-happy-path");
      const target = caseById(cases, "GC-02-firm-b-happy-path");
      target.trigger = JSON.parse(JSON.stringify(source.trigger));
      target.householdEvidence = JSON.parse(
        JSON.stringify(source.householdEvidence),
      );
      return cases;
    };
    const exactComparisonDemo = () => {
      const demo = demoClone();
      const decision = demo.decisions.find(
        ({ sourceCaseId, decisionRole }) =>
          sourceCaseId === "GC-01-firm-a-happy-path" &&
          decisionRole === "primary",
      )!;
      decision.comparisonDescription =
        "The same household and request have exact signed equivalent evidence; differences are driven by policy provenance, not code.";
      decision.comparisonDispositionReason =
        "Same evidence - the outcome differs because policy differs.";
      return demo;
    };
    const exactProblems = validateGoldenDemoSemantics(
      exactComparisonCases(),
      realRefs,
      exactComparisonDemo(),
    );
    expect(
      exactProblems.some((problem) =>
        problem.includes("attributes a disposition difference solely to policy"),
      ),
    ).toBe(false);

    const omittedFieldMutations: Array<
      readonly [string, (target: Record<string, unknown>) => void]
    > = [
      [
        "request meaning",
        (target) => {
          (target.trigger as Record<string, unknown>).description =
            "A materially different request";
        },
      ],
      [
        "trigger kind",
        (target) => {
          (target.trigger as Record<string, unknown>).kind =
            "system_event";
        },
      ],
      [
        "requester",
        (target) => {
          (target.trigger as Record<string, unknown>).requesterRole =
            "client";
        },
      ],
      [
        "request identity",
        (target) => {
          (target.trigger as Record<string, unknown>).requestRef =
            "req:different";
        },
      ],
      [
        "request timing",
        (target) => {
          (target.trigger as Record<string, unknown>).asOf =
            "2026-07-26T13:31:00.000Z";
        },
      ],
      [
        "money inputs",
        (target) => {
          const money = target.signedMoney as Record<string, unknown>;
          money.plannedWithdrawalMonthlyUsd =
            Number(money.plannedWithdrawalMonthlyUsd) + 1;
        },
      ],
      [
        "domain configuration",
        (target) => {
          (
            target.policyVersions as Record<string, unknown>
          ).domainConfigVersionId = "money-movement@different";
        },
      ],
      [
        "household instruction",
        (target) => {
          const instructions = target.householdInstructions as Array<
            Record<string, unknown>
          >;
          instructions[0]!.summary = "A materially different instruction";
        },
      ],
      [
        "non-firm prohibition authority",
        (target) => {
          target.prohibition = {
            source: {
              sourceType: "regulatory",
              sourceId: "regulatory-hold",
              versionId: "regulation@different",
            },
            scope: "scope:distribution",
            reasonCode: "legal-hold",
            explanation: "A regulatory hold controls this request.",
          };
        },
      ],
      [
        "regulatory authority",
        (target) => {
          (
            target.policyVersions as Record<string, unknown>
          ).regulatoryVersionId = "regulation@different";
        },
      ],
    ];
    for (const [label, mutate] of omittedFieldMutations) {
      const cases = exactComparisonCases();
      mutate(caseById(cases, "GC-02-firm-b-happy-path"));
      const problems = validateGoldenDemoSemantics(
        cases,
        realRefs,
        exactComparisonDemo(),
      );
      expect(
        problems.some((problem) =>
          problem.includes(
            "attributes a disposition difference solely to policy",
          ),
        ),
        label,
      ).toBe(true);
    }

    const revalidatedCases = exactComparisonCases();
    const sourceMoney = caseById(
      revalidatedCases,
      "GC-01-firm-a-happy-path",
    ).signedMoney as Record<string, unknown>;
    const targetMoney = caseById(
      revalidatedCases,
      "GC-02-firm-b-happy-path",
    ).signedMoney as Record<string, unknown>;
    sourceMoney.preExecutionRevalidation = {
      availableLiquidityUsd: 420000,
      pendingLiquidityUsd: 0,
    };
    targetMoney.preExecutionRevalidation = {
      availableLiquidityUsd: 420000,
      pendingLiquidityUsd: 1,
    };
    const revalidatedDemo = exactComparisonDemo();
    revalidatedDemo.decisions.find(
      ({ sourceCaseId, decisionRole }) =>
        sourceCaseId === "GC-01-firm-a-happy-path" &&
        decisionRole === "primary",
    )!.pass = "revalidated";
    expect(
      validateGoldenDemoSemantics(
        revalidatedCases,
        realRefs,
        revalidatedDemo,
      ).some((problem) =>
        problem.includes(
          "attributes a disposition difference solely to policy",
        ),
      ),
    ).toBe(true);

    const authorityGapCases = exactComparisonCases();
    const authorityGapProblems = validateGoldenDemoSemantics(
      authorityGapCases,
      realRefs,
      exactComparisonDemo(),
      [
        ...DEFAULT_GOLDEN_AUTHORITY_GAPS,
        {
          caseId: "GC-02-firm-b-happy-path",
          fixtureSha256: "0".repeat(64),
          signedAt: "2026-07-28",
          requiredSince: "2026-08-05",
          status: "awaiting-captain-signature",
          execution: "withheld",
          reason: "Awaiting signed authority",
          missingAuthorities: ["verification-detail"],
        },
      ],
    );
    expect(
      authorityGapProblems.some((problem) =>
        problem.includes(
          "attributes a disposition difference solely to policy",
        ),
      ),
    ).toBe(true);
  });

  it("flags a verified bank-instruction claim without exact evidence", () => {
    const inferred = demoClone();
    const dualApproval = inferred.executionGuards.find(
      ({ scenarioId, firmId }) =>
        scenarioId === "dual-approval" && firmId === "firm-a",
    )!;
    expect(dualApproval.exactBankInstructionEvidence).toBe(false);
    expect(dualApproval.safetyChecks).toEqual([]);
    dualApproval.safetyChecks = [
      {
        label: "Bank instruction unchanged since the decision",
        status: "done",
        statusLabel: "Verified",
        detail: null,
      },
    ];
    dualApproval.recordSafetyChecks = dualApproval.safetyChecks.map(
      (check) => ({ ...check }),
    );
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        inferred,
      ).some((problem) =>
        problem.includes(
          "missing exact post-review bank-instruction evidence must remain unavailable",
        ),
      ),
    ).toBe(true);

    const recordDrift = demoClone();
    const recordGuard = recordDrift.executionGuards.find(
      ({ sourceCaseId }) =>
        sourceCaseId === "GC-03-recent-bank-change-firm-a",
    )!;
    expect(recordGuard.safetyChecks.length).toBeGreaterThan(0);
    recordGuard.recordSafetyChecks = [];
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        recordDrift,
      ).some((problem) =>
        problem.includes(
          "printable Record safety checks must preserve the fail-closed Safety claims",
        ),
      ),
    ).toBe(true);

    const changedFinding = demoClone();
    const gc03 = changedFinding.executionGuards.find(
      ({ sourceCaseId }) =>
        sourceCaseId ===
        "GC-03-recent-bank-change-firm-a",
    )!;
    expect(gc03.exactBankInstructionEvidence).toBe(true);
    expect(
      gc03.exactBankInstructionPostReviewEvidence,
    ).toBe(false);
    expect(gc03.executionEligibilityVisible).toBe(false);
    expect(gc03.reservationVisible).toBe(false);
    expect(gc03.executionReached).toBe(false);
    expect(gc03.verificationReached).toBe(false);
    expect(gc03.safetyChecks).toContainEqual(
      expect.objectContaining({
        label: "Bank-instruction revalidation not evaluated",
        status: "pending",
        statusLabel: "Post-review evidence unavailable",
        detail: expect.stringContaining(
          "changed on 2026-07-22",
        ),
      }),
    );
    expect(
      gc03.safetyChecks.find(
        ({ label }) =>
          label ===
          "Bank-instruction revalidation not evaluated",
      )?.detail,
    ).toContain(
      "Signed post-review bank-instruction evidence is absent. Execution is withheld pending captain-signed evidence.",
    );
    expect(gc03.stopNote).toContain(
      "Signed post-review bank-instruction evidence is absent. Execution is withheld pending captain-signed evidence.",
    );
    const hiddenEvidenceGap = demoClone();
    hiddenEvidenceGap.decisions.find(
      ({ sourceCaseId, decisionRole }) =>
        sourceCaseId === "GC-03-recent-bank-change-firm-a" &&
        decisionRole === "primary",
    )!.evidenceGaps = [];
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        hiddenEvidenceGap,
      ).some((problem) =>
        problem.includes(
          "direct Evidence surface omits the signed authority gap and execution-withheld reason",
        ),
      ),
    ).toBe(true);
    gc03.safetyChecks = [
      {
        label: "Bank instruction unchanged since the decision",
        status: "done",
        statusLabel: "Verified",
        detail:
          "Destination bank instruction changed and remains unverified.",
      },
    ];
    gc03.recordSafetyChecks = gc03.safetyChecks.map(
      (check) => ({ ...check }),
    );
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        changedFinding,
      ).some((problem) =>
        problem.includes(
          "missing exact post-review bank-instruction evidence must remain unavailable",
        ),
      ),
    ).toBe(true);

    const bypassedMustHold = demoClone();
    const bypassedGc03 = bypassedMustHold.executionGuards.find(
      ({ sourceCaseId }) =>
        sourceCaseId ===
        "GC-03-recent-bank-change-firm-a",
    )!;
    bypassedGc03.executionEligibilityVisible = true;
    bypassedGc03.reservationVisible = true;
    bypassedGc03.executionReached = true;
    bypassedGc03.verificationReached = true;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        bypassedMustHold,
      ).some((problem) =>
        problem.includes(
          "unresolved execution proof bank-instruction-independently-verified must expose no execution eligibility, reservation, execution, or verification state",
        ),
      ),
    ).toBe(true);

    const hiddenWithheldReason = demoClone();
    hiddenWithheldReason.executionGuards.find(
      ({ sourceCaseId }) =>
        sourceCaseId ===
        "GC-03-recent-bank-change-firm-a",
    )!.stopNote = "This journey stopped at Safety.";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        hiddenWithheldReason,
      ).some((problem) =>
        problem.includes(
          "unresolved post-review bank evidence must state that execution is withheld pending captain-signed evidence",
        ),
      ),
    ).toBe(true);

    const inventedPostReview = demoClone();
    inventedPostReview.executionGuards.find(
      ({ sourceCaseId }) =>
        sourceCaseId ===
        "GC-03-recent-bank-change-firm-a",
    )!.exactBankInstructionPostReviewEvidence = true;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        inventedPostReview,
      ).some((problem) =>
        problem.includes(
          "bank-instruction Safety authority drifts from the exact signed initial and post-review evidence",
        ),
      ),
    ).toBe(true);
  });

  it("rejects shape-only execution proof for every must-hold meaning", () => {
    const bindApprovalActors = (
      target: Record<string, unknown>,
    ) => {
      const authority = target.expectedAuthority as Record<string, unknown>;
      const stages = authority.stages as Array<Record<string, unknown>>;
      const events = target.expectedLedgerEvents as Array<Record<string, unknown>>;
      let actorIndex = 0;
      const assignedByStage = new Map<string, number>();
      for (const event of events) {
        if (event.type !== "ApprovalRecorded") continue;
        const pass = event.lifecyclePass === "revalidated"
          ? "revalidated"
          : "initial";
        const stage = stages.find(({ stageId }) => stageId === event.stageId) ??
          stages.find((candidate) => {
            const key = `${pass}:${String(candidate.stageId)}`;
            return (assignedByStage.get(key) ?? 0) <
              Number(candidate.approvalsRequired);
          })!;
        const key = `${pass}:${String(stage.stageId)}`;
        assignedByStage.set(key, (assignedByStage.get(key) ?? 0) + 1);
        const roles = stage.eligibleRoleIds as string[];
        actorIndex += 1;
        event.stageId = stage.stageId;
        event.lifecyclePass = pass;
        event.actorId = `signed-actor-${actorIndex}`;
        event.roleId = roles[0];
        event.requesterId = "signed-requester";
      }
    };
    const exposeGuard = (
      demo: DemoSemanticSnapshot,
      sourceCaseId: string,
    ) => {
      const guard = demo.executionGuards.find(
        (candidate) => candidate.sourceCaseId === sourceCaseId,
      )!;
      guard.executionEligibilityVisible = true;
      guard.reservationVisible = true;
      guard.executionReached = true;
      guard.verificationReached = true;
      return guard;
    };
    const expectProofFailure = (
      cases: LoadedCase[],
      sourceCaseId: string,
      demo: DemoSemanticSnapshot = demoClone(),
    ) => {
      expect(
        validateGoldenDemoSemantics(cases, realRefs, demo).some(
          (problem) =>
            problem.includes(sourceCaseId) &&
            problem.includes("unresolved execution proof"),
        ),
      ).toBe(true);
    };

    const stale = clone();
    const staleEvidence = caseById(
      stale,
      "GC-02-firm-b-happy-path",
    ).householdEvidence as Array<Record<string, unknown>>;
    staleEvidence.find(
      (entry) => entry.subjectRef === "subject:smiths-joint-taxable",
    )!.freshness = "stale";
    expectProofFailure(stale, "GC-02-firm-b-happy-path");

    const unbound = clone();
    bindApprovalActors(
      caseById(unbound, "GC-01-firm-a-happy-path"),
    );
    const unboundEvents = caseById(
      unbound,
      "GC-01-firm-a-happy-path",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    unboundEvents.find(
      (event) =>
        event.type === "ApprovalRecorded" &&
        typeof event.note === "string" &&
        event.note.includes("decision hash"),
    )!.note = "Approval recorded without an exact binding.";
    const unboundDemo = demoClone();
    exposeGuard(unboundDemo, "GC-01-firm-a-happy-path");
    expectProofFailure(unbound, "GC-01-firm-a-happy-path", unboundDemo);

    const released = clone();
    bindApprovalActors(
      caseById(released, "GC-10-simultaneous-distributions-first"),
    );
    const releasedEvents = caseById(
      released,
      "GC-10-simultaneous-distributions-first",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    releasedEvents.splice(
      releasedEvents.findIndex((event) => event.type === "ExecutionStarted"),
      0,
      { type: "ReservationReleased", note: "Reservation released before execution." },
    );
    const releasedDemo = demoClone();
    exposeGuard(releasedDemo, "GC-10-simultaneous-distributions-first");
    expectProofFailure(
      released,
      "GC-10-simultaneous-distributions-first",
      releasedDemo,
    );

    const expiredDemo = demoClone();
    const expiredGuard = expiredDemo.executionGuards.find(
      ({ sourceCaseId }) => sourceCaseId === "GC-02-firm-b-happy-path",
    )!;
    expiredGuard.executionAtIso = new Date(
      Date.parse(expiredGuard.reservationAtIso!) + 31 * 60 * 1_000,
    ).toISOString();
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, expiredDemo).some(
        (problem) => problem.includes(
          "reservation is not valid through the rendered execution instant",
        ),
      ),
    ).toBe(true);

    const refreshed = clone();
    bindApprovalActors(
      caseById(refreshed, "GC-15-approval-invalidation"),
    );
    const refreshedEvents = caseById(
      refreshed,
      "GC-15-approval-invalidation",
    ).expectedLedgerEvents as Array<Record<string, unknown>>;
    refreshedEvents.find(
      (event) => event.type === "ApprovalInvalidated",
    )!.note = "Approvals invalidated without persisted hash bindings.";
    const refreshedDemo = demoClone();
    exposeGuard(refreshedDemo, "GC-15-approval-invalidation");
    expectProofFailure(
      refreshed,
      "GC-15-approval-invalidation",
      refreshedDemo,
    );

    const unknown = clone();
    const unknownEligibility = caseById(
      unknown,
      "GC-02-firm-b-happy-path",
    ).expectedExecutionEligibility as Record<string, unknown>;
    (unknownEligibility.preconditions as Array<Record<string, unknown>>).push({
      code: "unknown-proof",
      requiredEvidence: [],
      mustStillHoldAtExecution: true,
    });
    expectProofFailure(unknown, "GC-02-firm-b-happy-path");

    const bankMeaning = clone();
    bindApprovalActors(
      caseById(bankMeaning, "GC-03-recent-bank-change-firm-a"),
    );
    const gc03Raw = caseById(
      bankMeaning,
      "GC-03-recent-bank-change-firm-a",
    );
    const gc03Evidence = gc03Raw.householdEvidence as Array<Record<string, unknown>>;
    const bank = gc03Evidence.find(
      (entry) => entry.evidenceKind === "bank-instruction",
    )!;
    gc03Evidence.push({
      ...bank,
      liquidityPhase: "pre-execution-revalidation",
      freshness: "fresh",
      summary: "Independent verification pending; the instruction is not yet verified.",
    });
    const bankDemo = demoClone();
    exposeGuard(bankDemo, "GC-03-recent-bank-change-firm-a");
    expectProofFailure(bankMeaning, "GC-03-recent-bank-change-firm-a", bankDemo);
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
    const revalidationEvent = invertedTimeline.events.find(
      ({ kind }) => kind === "revalidation",
    )!;
    [finalApproval.kind, revalidationEvent.kind] = [
      revalidationEvent.kind,
      finalApproval.kind,
    ];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, plantedInversion).some(
        (problem) =>
          problem.includes("GC-12-duplicate-retry") &&
          problem.includes("unsorted production timeline"),
      ),
    ).toBe(true);

    const inventedException = demoClone();
    const partialTimeline = inventedException.sourceTimelines.find(
      ({ sourceCaseId }) =>
        sourceCaseId === "GC-13-partial-salesforce-success",
    )!;
    partialTimeline.events.push({
      ...partialTimeline.events.at(-1)!,
      kind: "ExceptionDecisionRequested",
      instant: "2026-07-26T21:14:40.000Z",
      display: "Invented downstream exception",
      renderedInstant: "Jul 26, 2026, 5:14:40 PM EDT",
    });
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, inventedException).some(
        (problem) =>
          problem.includes("GC-13-partial-salesforce-success") &&
          problem.includes(
            "incomplete structured signed execution authority must hide every downstream timeline event",
          ),
      ),
    ).toBe(true);
  });

  it("flags GC-02's rendered arithmetic drifting from its own signed fixture", () => {
    const drifted = demoClone();
    for (const d of drifted.decisions) {
      if (d.scenarioId !== "safe-proceed") continue;
      d.availableCashMinor = 20_000_000;
      d.headroomMinor = 20_000_000 - d.pendingActivityMinor! - d.reserveFloorMinor!;
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
      const signedMoney = (data as { signedMoney?: Record<string, unknown> })
        .signedMoney;
      if (signedMoney) signedMoney.plannedWithdrawalMonthlyUsd = null;
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
    roundedUpPartial.partialReceipt.completedParts = ["instruction-created"];
    roundedUpPartial.partialReceipt.incompleteParts = ["disbursement-scheduled"];
    roundedUpPartial.partialReceipt.observedStatuses = ["completed", "unknown"];
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, roundedUpPartial).some(
        (problem) => problem.includes("GC-13 must retain the signed partial outcome"),
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

  it("withholds reservation causality until structured authority is complete", () => {
    const inventedReservation = demoClone();
    inventedReservation.reservationCausality.push({
      scenarioId: "simultaneous-distributions",
      firmId: "firm-a",
      sourceCaseId: "GC-10-simultaneous-distributions-first",
      requestAt: "2026-07-26T18:30:00.000Z",
      decisionAt: "2026-07-26T18:30:10.000Z",
      reservationAt: "2026-07-26T18:30:20.000Z",
      executionAt: "2026-07-26T18:30:30.000Z",
      relatedSourceCaseId: "GC-11-simultaneous-distributions-second",
      relatedRequestAt: "2026-07-26T18:30:25.000Z",
    });
    expect(
      validateGoldenDemoSemantics(clone(), realRefs, inventedReservation).some(
        (problem) =>
          problem.includes(
            "reservation causality must appear exactly when structured signed execution authority is complete",
          ),
      ),
    ).toBe(true);

    expect(
      validateGoldenDemoSemantics(clone(), realRefs, demoClone()).some(
        (problem) =>
          problem.includes(
            "reservation causality must appear exactly when structured signed execution authority is complete",
          ),
      ),
    ).toBe(false);
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
    const gc14Receipt = receiptDrift.executionGuards.find(
      (guard) =>
        guard.sourceCaseId === "GC-14-delayed-nigo",
    )!;
    gc14Receipt.executionRows[0]!.timestampIso =
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
    const gc14Proofs = proofDrift.executionGuards.find(
      (guard) =>
        guard.sourceCaseId === "GC-14-delayed-nigo",
    )!;
    for (const proof of gc14Proofs.verificationProves) {
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

    const causalEventDrift = demoClone();
    const nigoProof = causalEventDrift.executionGuards
      .find(
        (guard) =>
          guard.sourceCaseId === "GC-14-delayed-nigo",
      )!
      .verificationProves.find(
        ({ display }) =>
          display === "Submission accepted by the capability",
      )!;
    nigoProof.ledgerEvent = "StatusObserved";
    nigoProof.observedAtIso = "2026-07-28T21:44:00.000Z";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        causalEventDrift,
      ).some((problem) =>
        problem.includes(
          "verification proof provenance must bind each claim to its own signed ledger event instant",
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

  it("validates raw fixtures before loading the production projection", async () => {
    const cases = clone();
    delete caseById(
      cases,
      "GC-01-firm-a-happy-path",
    ).expectedDisposition;
    let projectionLoaded = false;
    const problems = await validateGoldenCaseArtifacts(
      cases,
      realRefs,
      realDoc,
      () => {
        projectionLoaded = true;
        return realDemo;
      },
    );
    expect(projectionLoaded).toBe(false);
    expect(
      problems.some(
        (problem) =>
          problem.includes("GC-01") &&
          problem.includes("expectedDisposition"),
      ),
    ).toBe(true);
  });

  it("converts production parser failures into bounded fixture diagnostics", async () => {
    const problems = await validateGoldenCaseArtifacts(
      clone(),
      realRefs,
      realDoc,
      () => {
        throw new TypeError(
          `GC-03-recent-bank-change-firm-a.expectedAuthority.stages[0].approvalsRequired must be a positive safe integer\n${"x".repeat(500)}`,
        );
      },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^fixtures\/golden\/GC-03-recent-bank-change-firm-a\.json :: production signed-case parser rejected the validated fixture:/,
    );
    expect(problems[0]).toContain(
      "approvalsRequired must be a positive safe integer",
    );
    expect(problems[0]).not.toContain("\n");
    expect(problems[0]!.length).toBeLessThan(450);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])(
    "rejects %s approval quorums before authority evaluation",
    (_label, approvalsRequired) => {
      const cases = clone();
      const fixture = caseById(cases, "GC-01-firm-a-happy-path");
      const authority = fixture.expectedAuthority as Record<
        string,
        unknown
      >;
      const stages = authority.stages as Array<
        Record<string, unknown>
      >;
      stages[0]!.approvalsRequired = approvalsRequired;
      const problems = run(cases);
      expect(
        problems.some((problem) =>
          problem.includes(
            "expectedAuthority.stages[0].approvalsRequired must be a positive safe integer",
          ),
        ),
      ).toBe(true);
      expect(() =>
        parseSignedCaseVariants([fixture]),
      ).toThrow(/approvalsRequired must be a positive safe integer/);
    },
  );

  it("fails closed if an invalid quorum reaches authority evaluation", () => {
    expect(
      approvalPlanSatisfied([
        {
          order: 1,
          satisfied: true,
          eligibleRoleIds: ["operations"],
          requesterMayApprove: false,
          distinctActorsRequired: true,
          approvalsRequired: 0,
          actors: [],
        } as never,
      ]),
    ).toBe(false);
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

  it("flags a policy simulation borrowed from another exact case", () => {
    const drifted = demoClone();
    const gc11 = drifted.decisions.find(
      (decision) =>
        decision.sourceCaseId ===
          "GC-11-simultaneous-distributions-second" &&
        decision.decisionRole === "primary",
    )!;
    gc11.simulatedHeadroomMinor = 6_400_000;
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        drifted,
      ).some((problem) =>
        problem.includes(
          "policy-draft simulation must use the exact selected case liquidity",
        ),
      ),
    ).toBe(true);
  });

  it("flags invented account metadata in authority restatements", () => {
    const drifted = demoClone();
    const gc03 = drifted.decisions.find(
      (decision) =>
        decision.sourceCaseId ===
          "GC-03-recent-bank-change-firm-a" &&
        decision.decisionRole === "primary",
    )!;
    gc03.approvalGateRestatement =
      "Approve moving the amount below from Smith Family Taxable.";
    expect(
      validateGoldenDemoSemantics(
        clone(),
        realRefs,
        drifted,
      ).some((problem) =>
        problem.includes(
          "authority restatement must use the exact signed account reference",
        ),
      ),
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
