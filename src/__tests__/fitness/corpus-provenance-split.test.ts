import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { REPO_ROOT } from "./_fence-utils";
import { canonicalJson } from "../../../src/contracts/decision-core/serialization";
import { loadGoldenCases, loadScenarioRefs } from "../../../scripts/golden-cases.lib";
import { defectClassIds, taxonomyExerciseProblems } from "../../../scripts/corpus/defects";
import { evidenceResolutionProblems } from "../../../scripts/corpus/graph";
import {
  buildInventory,
  buildManifest,
  corpusDigest,
  currentFreshnessPolicyBinding,
  generatedSignatureProblems,
  REAL_DERIVED_SCHEMA_FILES,
  realDerivedSchemaBindings,
  taxonomySemanticDigest,
} from "../../../scripts/corpus/manifest";
import {
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATES,
  pendingActionLiquidityTreatment,
} from "../../../scripts/corpus/pending-actions";
import {
  freshnessPolicySemanticDigest,
  REAL_DERIVED_FRESHNESS_POLICY,
} from "../../../scripts/corpus/real-derived-policy";
import {
  realDerivedCollectionProblems,
} from "../../../scripts/corpus/real-derived";
import {
  renderCorpusReport,
  type RealDerivedCaseOutcome,
  type ReportInput,
  type SyntheticCaseOutcome,
} from "../../../scripts/corpus/report";
import * as corpusReportRuntime from "../../../scripts/corpus/report";
import {
  loadRealDerivedDelivery,
  realDerivedCaseProblems,
  realDerivedSemanticContractProblems,
} from "../../../scripts/corpus/scrub-contract";
import {
  CAPTAIN_SIGNING_AUTHORITY,
  parseSignoff,
  signoffProblems,
  type CorpusSignoff,
} from "../../../scripts/corpus/signoff";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import {
  cleanControlProblems,
  labelProblems,
  readCommittedCorpus,
  realDerivedDeferralProblems,
  realDerivedProblems,
  validateCorpus,
} from "../../../scripts/corpus/validate";
import { specReferenceProblems } from "../../../scripts/corpus/world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE (v3 prompt 11, ADR-0034; charter #3/#4;
 * architecture v3 §2.4; demo contract §7).
 *
 * Architecture §2.4 requires the corpus metric to be split by provenance and
 * warns that a synthetic-only rate is circular. Nothing enforced that before
 * this fence. Six rules, each mechanical:
 *
 *  (a) LABELED - every corpus case carries a provenance label from the LIVE
 *      config/demo/scenarios.yaml vocabulary and a defect class from the closed
 *      taxonomy, or the labeled clean control;
 *  (b) DISJOINT - no corpus case id collides with a signed `GC-` golden case.
 *      The golden sixteen were authored to be caught; counting them in a corpus
 *      denominator is the circularity §2.4 exists to prevent;
 *  (c) NO BLENDING - no expression anywhere in `src/` or `scripts/` combines the
 *      two partitions arithmetically, and the report type carries no aggregate
 *      key. The two figures even have different NAMES:
 *      `syntheticDefectCoverage` vs `detectionRate`;
 *  (d) HONEST EMPTY - with an empty real-derived partition the reporter emits
 *      `detectionRate: null` with `reasonCode: "real-derived-corpus-absent"` and
 *      never substitutes the synthetic figure. The companion populates the
 *      partition and gets a NUMBER, proving `null` is a real branch, not a stub;
 *  (e) FALSE POSITIVES BESIDE COVERAGE - clean controls exist; a detector that
 *      flags everything scores 1.0 coverage AND 1.0 false positives; no control
 *      carries the defect being measured (stale, lapsed, expired, unverified or
 *      dangling evidence, or an infeasible deadline), because a polluted
 *      denominator makes the false-positive rate meaningless; and every class in
 *      the closed taxonomy is exercised by at least one labeled defect case -
 *      the mirror of the spec loader's unexercised-assumption rule;
 *  (f) FAIL-CLOSED INTAKE + AGENTS NEVER SIGN - the real-derived contract rejects
 *      an unattested or free-text-bearing case, and no code path under
 *      `scripts/` can originate a `signedBy` value.
 */
const CORPUS_MANIFEST = join(REPO_ROOT, "fixtures/corpus/manifest.json");
const SCENARIOS = join(REPO_ROOT, "config/demo/scenarios.yaml");

const reportExportProblems = (names: readonly string[]): string[] =>
  names.filter((name) => name !== "renderCorpusReport");

// ── shared fixtures for the companions ─────────────────────────────────────────

const OPAQUE = "tok:0123456789abcdef";
const OPAQUE_REVIEWER = "tok:fedcba9876543210";
const canonicalFixtureBytes = (value: unknown): string => {
  const result = canonicalJson(value as any);
  if (!result.ok) throw result.error;
  return `${result.value}\n`;
};

const realDerivedCase = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  caseId: "RD-00112233445566aa",
  corpusVersion: "2026.07.0",
  partition: "real-derived",
  provenance: "real-derived-fixture",
  scrubAttestation: {
    sourceSystemClass: "custodian-exception-feed",
    extractedAt: "2026-05-01T13:00:00.000Z",
    extractedBy: "tok:0011223344556677",
    scrubbedBy: OPAQUE,
    scrubbedAt: "2026-05-02T13:00:00.000Z",
    reviewedBy: OPAQUE_REVIEWER,
    reviewedAt: "2026-05-03T13:00:00.000Z",
    recordsBefore: 40,
    recordsAfter: 40,
    method: "deterministic-tokenization",
  },
  label: { kind: "defect", defectClassId: "destination-integrity-defect" },
  occurredAt: "2026-04-28T13:00:00.000Z",
  evaluation: {
    asOf: "2026-04-28T13:00:05.000Z",
    freshnessPolicyVersion: "verin-real-derived-freshness/1.0.0",
  },
  subjects: [OPAQUE],
  replayPayload: {
    schemaVersion: "verin-real-derived-replay/1.0.0",
    request: {
      requestRef: OPAQUE,
      householdRef: OPAQUE,
      sourceAccountRef: OPAQUE,
      destinationRef: OPAQUE,
      amountMinor: 10_000,
      currency: "USD",
      deadlineAt: "2026-04-30T13:00:00.000Z",
      settlementEarliestAt: "2026-04-29T13:00:00.000Z",
    },
    identity: {
      subjectRef: OPAQUE,
      resolution: "unique",
      candidateRefs: [OPAQUE],
    },
    destination: {
      instructionRef: OPAQUE,
      householdRef: OPAQUE,
      ownerRefs: [OPAQUE],
      ownership: "same-household",
      verificationState: "verified",
      discriminatorState: "collision",
    },
    liquidity: {
      sources: [
        {
          accountRef: OPAQUE,
          availableMinor: 20_000,
          sourceTaxClass: "taxable",
        },
      ],
      reserveState: "modeled-scalar",
      reserveRequiredMinor: 1_000,
      withdrawalSegmentsMinor: [1_000],
      pendingAction: {
        actionRef: null,
        actionKind: null,
        actionState: null,
        direction: null,
        liquidityClass: null,
        amountMinor: null,
        reducesEffectiveLiquidity: false,
        increasesAvailableLiquidity: false,
      },
    },
    authority: {
      grantRef: OPAQUE,
      actorRef: OPAQUE,
      authorityScope: "distribution-request",
      authorityState: "effective",
      validFrom: "2026-04-01T13:00:00.000Z",
      validTo: null,
    },
    policy: {
      policyRef: OPAQUE,
      policyVersionRef: OPAQUE,
      thresholdMinor: 5_000,
      thresholdComparison: "above",
      restrictionRef: null,
      restrictionState: "absent",
      legalHoldRef: null,
      legalHoldScope: "none",
    },
    taxReviewState: "completed",
    instructionConflict: {
      conflictState: "none",
      instructionRefs: [],
      impactedSubjectRefs: [],
    },
    temporal: {
      eventAt: "2026-04-28T13:00:00.000Z",
      timeZoneRuleRef: OPAQUE,
      transitionState: "daylight",
    },
    evidenceRefs: ["evs:tok:0123456789abcdef:balance"],
    execution: {
      reservationKeys: [
        "conflict:tok:0123456789abcdef:liquidity",
      ],
      preconditions: ["evidence-fresh"],
    },
  },
  evidence: [
    {
      id: "evs:tok:0123456789abcdef:balance",
      evidenceKind: "balance",
      subjectRef: OPAQUE,
      observationState: "observed",
      observedAt: "2026-04-28T05:00:00.000Z",
      retrievedAt: "2026-04-28T13:00:04.000Z",
      freshness: "fresh",
    },
  ],
  reservations: [{ family: "liquidity", conflictKey: "conflict:tok:0123456789abcdef:liquidity" }],
  ...overrides,
});

const realDerivedDefectCase = (defectClassId: string): Record<string, unknown> => {
  const item = realDerivedCase({
    label: { kind: "defect", defectClassId },
  });
  const payload = item.replayPayload as Record<string, any>;
  payload.destination.discriminatorState = "unique";
  switch (defectClassId) {
    case "identity-resolution-ambiguity":
      payload.identity.resolution = "ambiguous";
      payload.identity.candidateRefs.push(OPAQUE_REVIEWER);
      (item.subjects as string[]).push(OPAQUE_REVIEWER);
      break;
    case "authority-scope-error":
      payload.authority.authorityScope = "other";
      payload.authority.authorityState = "wrong-scope";
      break;
    case "destination-integrity-defect":
      payload.destination.discriminatorState = "collision";
      break;
    case "instruction-conflict-unresolved":
      payload.instructionConflict = {
        conflictState: "present",
        instructionRefs: [OPAQUE, OPAQUE_REVIEWER],
        impactedSubjectRefs: [OPAQUE],
      };
      (item.subjects as string[]).push(OPAQUE_REVIEWER);
      break;
    case "liquidity-reserve-miscalculation":
      payload.liquidity.reserveState = "modeled-segmented";
      payload.liquidity.withdrawalSegmentsMinor = [500, 1_000];
      break;
    case "evidence-staleness-unnoticed":
      (item.evidence as Array<Record<string, unknown>>)[0]!.observedAt =
        "2026-04-26T05:00:00.000Z";
      (item.evidence as Array<Record<string, unknown>>)[0]!.freshness = "stale";
      break;
    case "evidence-interval-collapse": {
      payload.authority.authorityState = "expired";
      payload.authority.validTo = "2026-04-28T10:00:00.000Z";
      const evidence = (item.evidence as Array<Record<string, unknown>>)[0]!;
      evidence.id = "evs:tok:0123456789abcdef:authority";
      evidence.evidenceKind = "authority";
      payload.evidenceRefs = [evidence.id];
      break;
    }
    case "restriction-lifecycle-error":
      payload.policy.restrictionRef = OPAQUE;
      payload.policy.restrictionState = "expired";
      break;
    case "hold-scope-error":
      payload.policy.legalHoldRef = OPAQUE;
      payload.policy.legalHoldScope = "position";
      break;
    case "pending-activity-miscount":
      payload.liquidity.pendingAction = {
        actionRef: OPAQUE,
        actionKind: "outgoing-distribution",
        actionState: "blocked",
        direction: "outgoing",
        liquidityClass: "distribution",
        amountMinor: 500,
        reducesEffectiveLiquidity: false,
        increasesAvailableLiquidity: false,
      };
      break;
    case "temporal-rendering-defect":
      payload.temporal.transitionState = "boundary";
      break;
    case "canonical-identity-defect":
      payload.identity.resolution = "canonical-collision";
      payload.identity.candidateRefs.push(OPAQUE_REVIEWER);
      (item.subjects as string[]).push(OPAQUE_REVIEWER);
      break;
    case "threshold-boundary-error":
      payload.request.amountMinor = payload.policy.thresholdMinor;
      payload.policy.thresholdComparison = "equal";
      break;
    case "deadline-feasibility-error":
      payload.request.deadlineAt = "2026-04-27T13:00:00.000Z";
      break;
    case "blast-radius-underestimation": {
      payload.instructionConflict = {
        conflictState: "resolved",
        instructionRefs: [OPAQUE, OPAQUE_REVIEWER],
        impactedSubjectRefs: [OPAQUE, OPAQUE_REVIEWER],
      };
      const evidence = {
        id: "evs:tok:fedcba9876543210:recent-change",
        evidenceKind: "recent-change",
        subjectRef: OPAQUE_REVIEWER,
        observationState: "observed",
        observedAt: "2026-04-28T05:00:00.000Z",
        retrievedAt: "2026-04-28T13:00:03.000Z",
        freshness: "fresh",
      };
      (item.evidence as Array<Record<string, unknown>>).push(evidence);
      payload.evidenceRefs.push(evidence.id);
      (item.subjects as string[]).push(OPAQUE_REVIEWER);
      break;
    }
    case "tax-consequence-blindness":
      payload.liquidity.sources[0].sourceTaxClass = "retirement";
      payload.taxReviewState = "required-pending";
      break;
  }
  return item;
};

const outcomes = (
  defects: number,
  controls: number,
  detected: boolean | null,
): SyntheticCaseOutcome[] => [
  ...Array.from({ length: defects }, (_, i) => ({
    caseId: `d${i}`,
    attributedDefectClassIds:
      detected === null ? null : detected ? ["test-defect"] : [],
    provenance: "synthetic-fixture" as const,
  })),
  ...Array.from({ length: controls }, (_, i) => ({
    caseId: `c${i}`,
    attributedDefectClassIds:
      detected === null ? null : detected ? ["test-defect"] : [],
    provenance: "synthetic-fixture" as const,
  })),
];

const inventoryOf = (
  synthetic: readonly SyntheticCaseOutcome[],
  realDerived: readonly RealDerivedCaseOutcome[] = [],
) => [
  ...synthetic.map((outcome) => ({
    caseId: outcome.caseId,
    file: `synthetic/${outcome.caseId}.json`,
    digest: outcome.caseId,
    partition: "synthetic" as const,
    labelKind: outcome.caseId.startsWith("d") ? "defect" as const : "clean-control" as const,
    labelId:
      outcome.caseId.startsWith("d") ? "test-defect" : "clean-control",
  })),
  ...realDerived.map((outcome) => ({
    caseId: outcome.caseId,
    file: `real-derived/${outcome.caseId}.json`,
    digest: outcome.caseId,
    partition: "real-derived" as const,
    labelKind: outcome.caseId === "RD-c" ? "clean-control" as const : "defect" as const,
    labelId:
      outcome.caseId === "RD-c" ? "clean-control" : "test-defect",
  })),
];

const signedSignoff = (
  corpusVersion = "x",
  corpusDigest = "y",
): CorpusSignoff => ({
  corpusVersion,
  status: "signed",
  signedBy: CAPTAIN_SIGNING_AUTHORITY,
  signedAt: "2026-07-28T12:00:00.000Z",
  signedDigest: corpusDigest,
});

const reportInput = (
  syntheticOutcomes: readonly SyntheticCaseOutcome[],
  realDerivedOutcomes: readonly RealDerivedCaseOutcome[] = [],
  overrides: Partial<ReportInput> = {},
): ReportInput => {
  const corpusVersion = overrides.corpusVersion ?? "x";
  const seed = overrides.seed ?? "test-seed";
  const taxonomyDigest = overrides.taxonomyDigest ?? "test-taxonomy-digest";
  const freshnessPolicy =
    overrides.freshnessPolicy ?? currentFreshnessPolicyBinding();
  const inventory =
    overrides.inventory ??
    inventoryOf(syntheticOutcomes, realDerivedOutcomes);
  const digest =
    overrides.corpusDigest ??
    corpusDigest(
      corpusVersion,
      seed,
      taxonomyDigest,
      inventory,
      freshnessPolicy,
    );
  return {
    corpusVersion,
    corpusDigest: digest,
    seed,
    taxonomyDigest,
    freshnessPolicy,
    signoff:
      overrides.signoff ?? signedSignoff(corpusVersion, digest),
    inventory,
    syntheticOutcomes:
      overrides.syntheticOutcomes ?? syntheticOutcomes,
    realDerivedOutcomes:
      overrides.realDerivedOutcomes ?? realDerivedOutcomes,
  };
};

const real = validateCorpus();
const refs = loadScenarioRefs();
const goldenIds = new Set(loadGoldenCases().map((e) => String((e.data as Record<string, unknown>).caseId)));
const classes = defectClassIds(real.taxonomy);

describe("corpus-provenance-split fence", () => {
  it("(a)+(b) enforces: every corpus case is labeled, in-vocabulary, and disjoint from the signed golden set", () => {
    const problems = labelProblems(real.cases, real.taxonomy, refs.provenanceLabels, goldenIds);
    expect(problems, `corpus labeling problems:\n${problems.join("\n")}`).toEqual([]);
    expect(real.cases.length).toBeGreaterThan(0);
    expect(goldenIds.size).toBe(16);
  });

  it("(c) enforces: structured partition measurements stay inside the partition-safe report owner", () => {
    const names = Object.keys(corpusReportRuntime);
    expect(names).toEqual(["renderCorpusReport"]);
    expect(reportExportProblems(names)).toEqual([]);
  });

  it("(c) enforces: the report type has no aggregate key and the two figures have different names", () => {
    const report = renderCorpusReport(reportInput(outcomes(2, 1, true)));
    expect(report).toContain("syntheticDefectCoverage  100.00%");
    expect(report).toContain("detectionRate            null (real-derived-corpus-absent)");
    expect(report).not.toContain("overallRate");
  });

  it("(d) enforces: with an empty real-derived partition the reporter withholds detectionRate", () => {
    const synthetic = outcomes(3, 2, true);
    const report = renderCorpusReport(reportInput(synthetic));
    expect(report).toContain("detectionRate            null (real-derived-corpus-absent)");
    expect(report).toContain("syntheticDefectCoverage  100.00%");
  });

  it("(d) enforces: the committed real-derived partition IS empty and ships its intake contract", () => {
    const manifest = JSON.parse(readFileSync(CORPUS_MANIFEST, "utf8")) as Record<string, any>;
    expect(manifest.partitions.realDerived.total).toBe(0);
    expect(manifest.partitions.realDerived.provenance).toBe("real-derived-fixture");
    expect(manifest.partitions.realDerived.deferral.status).toBe("deferred-pending-authorized-source");
    expect(String(manifest.partitions.realDerived.deferral.unDeferTrigger).length).toBeGreaterThan(40);
    expect(existsSync(join(REPO_ROOT, manifest.partitions.realDerived.deferral.adr))).toBe(true);
    expect(
      realDerivedProblems(real.taxonomy, real.spec.world.corpusVersion),
    ).toEqual([]);
  });

  it("(d) enforces: every evidence and request reference resolves exactly once in its emitted case graph", () => {
    expect(evidenceResolutionProblems(real.cases)).toEqual([]);
    const crossHousehold = real.cases.find(
      (item) => item.caseId === "CS-beneficiary-versus-destination-restriction",
    )!;
    expect(crossHousehold.records.bankInstructions.map((row) => row.id)).not.toContain(
      "bank-instruction:mira-primary",
    );
    expect(crossHousehold.records.accounts.map((row) => row.id)).not.toContain(
      "subject:mira-roth",
    );
    expect(crossHousehold.records.referencedAccounts).toEqual([
      {
        id: "subject:mira-roth",
        householdRef: "subject:smith-mira",
      },
    ]);
    expect(crossHousehold.records.referencedBankInstructions).toEqual([
      {
        id: "bank-instruction:mira-primary",
        householdRef: "subject:smith-mira",
        accountRefs: ["subject:mira-roth"],
      },
    ]);
    expect(crossHousehold.records.referencedHouseholds).toEqual([
      {
        id: "subject:smith-mira",
        relationshipReasons: [
          "owns-account",
          "owns-bank-instruction",
        ],
      },
    ]);
    expect(
      crossHousehold.records.referencedAccounts.find(
        (row) => row.id === "subject:mira-roth",
      )?.householdRef,
    ).toBe("subject:smith-mira");
    expect(
      crossHousehold.records.referencedBankInstructions.find(
        (row) => row.id === "bank-instruction:mira-primary",
      )?.householdRef,
    ).toBe("subject:smith-mira");
    const modelCase = real.cases.find(
      (item) => item.caseId === "CS-pending-rebalance-during-evaluation",
    )!;
    expect(modelCase.records.modelAssignments.map((row) => row.id)).toContain(
      "model-assignment:smiths-joint-model",
    );
    const scheduleCase = real.cases.find(
      (item) => item.caseId === "CS-segmented-withdrawal-schedule",
    )!;
    expect(scheduleCase.records.plannedWithdrawals[0]?.id).toBe(
      "planned-withdrawal:smiths",
    );
    const changeCase = real.cases.find(
      (item) => item.caseId === "CS-shared-instruction-change-blast-radius",
    )!;
    expect(changeCase.records.recentChanges[0]?.id).toBe("change:smiths-bank-change");
    expect(changeCase.records.restrictions.every((row) => row.subjectRef.length > 0)).toBe(true);
    const cleanLiquidity = real.cases.find(
      (item) => item.caseId === "CS-clean-ample-liquidity",
    )!;
    expect(cleanLiquidity.records.pendingActions[0]).toMatchObject({
      direction: "incoming",
      liquidityClass: "credit",
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: false,
    });
  });

  it("(d) enforces: real-derived files are rejected while deferred and inventory-ready after un-deferral", () => {
    expect(realDerivedDeferralProblems(["RD-00112233445566aa.json"]).length).toBe(1);
    expect(realDerivedDeferralProblems(["RD-00112233445566aa.json"], null)).toEqual([]);
    const value = realDerivedCase();
    const file = {
      relPath: "real-derived/RD-00112233445566aa.json",
      bytes: `${JSON.stringify(value)}\n`,
      value: value as any,
    };
    const syntheticInventory = buildInventory(real.generated);
    const realInventory = buildInventory([file], "real-derived");
    const manifest = buildManifest(
      real.spec,
      real.taxonomy,
      real.generated,
      CORPUS_SEED,
      [...syntheticInventory, ...realInventory],
    );
    const partition = (manifest.value as any).partitions.realDerived;
    expect(partition.total).toBe(1);
    expect(partition.cases[0].caseId).toBe("RD-00112233445566aa");
    expect((manifest.value as any).corpusDigest).not.toBe(real.corpusDigest);
  });

  it("(d) enforces: real-derived collection identity, version, and filenames are canonical before inventory", () => {
    const value = realDerivedCase();
    const canonical = {
      relPath: "real-derived/RD-00112233445566aa.json",
      bytes: `${JSON.stringify(value)}\n`,
      value: value as any,
    };
    expect(
      realDerivedCollectionProblems(
        [canonical],
        real.spec.world.corpusVersion,
      ),
    ).toEqual([]);
    const stale = {
      ...canonical,
      value: {
        ...value,
        corpusVersion: "2026.06.0",
      } as any,
    };
    const duplicate = {
      ...canonical,
      relPath: "real-derived/RD-aabbccddeeff0011.json",
    };
    const problems = realDerivedCollectionProblems(
      [stale, duplicate],
      real.spec.world.corpusVersion,
    );
    expect(problems.some((problem) => problem.includes("canonical filename"))).toBe(true);
    expect(problems.some((problem) => problem.includes("does not match active corpus"))).toBe(true);
    expect(problems.some((problem) => problem.includes("duplicate caseId"))).toBe(true);
  });

  it("(d) enforces: an active real-derived partition requires both measurement denominators", () => {
    const value = realDerivedCase();
    const defect = {
      relPath: "real-derived/RD-00112233445566aa.json",
      bytes: canonicalFixtureBytes(value),
      value: value as any,
    };
    const controlValue = realDerivedCase({
      caseId: "RD-aabbccddeeff0011",
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    });
    ((controlValue.replayPayload as Record<string, any>).destination).discriminatorState =
      "unique";
    const control = {
      relPath: "real-derived/RD-aabbccddeeff0011.json",
      bytes: canonicalFixtureBytes(controlValue),
      value: controlValue as any,
    };
    expect(
      realDerivedCollectionProblems(
        [defect],
        real.spec.world.corpusVersion,
        null,
      ).join("\n"),
    ).toContain("no labeled clean controls");
    expect(
      realDerivedCollectionProblems(
        [control],
        real.spec.world.corpusVersion,
        null,
      ).join("\n"),
    ).toContain("no labeled defect cases");
    expect(
      realDerivedCollectionProblems(
        [defect, control],
        real.spec.world.corpusVersion,
        null,
      ),
    ).toEqual([]);
  });

  it("(d) enforces: generated and real-derived trees are recursively inventoried, including hidden and nested files", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-tree-"));
    try {
      mkdirSync(join(root, "synthetic", "nested"), { recursive: true });
      writeFileSync(join(root, "manifest.json"), "{}\n");
      writeFileSync(join(root, "synthetic", ".hidden"), "hidden\n");
      writeFileSync(join(root, "synthetic", "note.txt"), "note\n");
      writeFileSync(join(root, "synthetic", "nested", "case.json"), "{}\n");
      expect(readCommittedCorpus(root).map((file) => file.relPath)).toEqual([
        "manifest.json",
        "synthetic/.hidden",
        "synthetic/nested/case.json",
        "synthetic/note.txt",
      ]);

      const intake = join(root, "real-derived");
      mkdirSync(join(intake, "nested"), { recursive: true });
      writeFileSync(join(intake, "README.md"), "intake\n");
      writeFileSync(join(intake, ".hidden"), "hidden\n");
      writeFileSync(
        join(intake, "nested", "RD-00112233445566aa.json"),
        canonicalFixtureBytes(realDerivedCase()),
      );
      const problems = realDerivedProblems(
        real.taxonomy,
        real.spec.world.corpusVersion,
        intake,
      );
      expect(
        problems.some((problem) =>
          problem.includes("2 delivered file(s) present"),
        ),
      ).toBe(true);
      expect(
        problems.some((problem) =>
          problem.includes("filename must be a top-level RD-<16 lowercase hex>.json"),
        ),
      ).toBe(true);
      expect(problems.join("\n")).not.toContain(".hidden");
      expect(problems.join("\n")).not.toContain("nested");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(d) enforces: the signed digest covers versioned defect-taxonomy semantics", () => {
    const changed = structuredClone(real.taxonomy);
    changed.defectClasses[0]!.description = `${changed.defectClasses[0]!.description} changed`;
    const originalTaxonomyDigest = taxonomySemanticDigest(real.taxonomy);
    const changedTaxonomyDigest = taxonomySemanticDigest(changed);
    expect(changedTaxonomyDigest).not.toBe(originalTaxonomyDigest);
    const inventory = buildInventory(real.generated);
    expect(
      corpusDigest(
        real.spec.world.corpusVersion,
        CORPUS_SEED,
        changedTaxonomyDigest,
        inventory,
      ),
    ).not.toBe(real.corpusDigest);
  });

  it("(d) enforces: the signed digest binds each case label beside its bytes", () => {
    const inventory = buildInventory(real.generated);
    const relabeled = inventory.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            labelKind: "clean-control" as const,
            labelId: "clean-control",
          }
        : entry,
    );
    expect(
      corpusDigest(
        real.spec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(real.taxonomy),
        relabeled,
      ),
    ).not.toBe(real.corpusDigest);
  });

  it("(d) enforces: the signed digest covers the versioned real-derived freshness policy semantics", () => {
    const changedPolicy = {
      ...REAL_DERIVED_FRESHNESS_POLICY,
      freshnessWindowDays: {
        ...REAL_DERIVED_FRESHNESS_POLICY.freshnessWindowDays,
        balance:
          REAL_DERIVED_FRESHNESS_POLICY.freshnessWindowDays.balance + 1,
      },
    };
    const original = currentFreshnessPolicyBinding();
    const changed = {
      version: changedPolicy.version,
      digest: freshnessPolicySemanticDigest(changedPolicy),
    };
    expect(changed.digest).not.toBe(original.digest);
    expect(
      corpusDigest(
        real.spec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(real.taxonomy),
        real.inventory,
        changed,
      ),
    ).not.toBe(real.corpusDigest);
  });

  it("(d) enforces: the signed digest covers both real-derived schema ids and bytes", () => {
    const raw = Object.fromEntries(
      REAL_DERIVED_SCHEMA_FILES.map((name) => [
        name,
        readFileSync(join(REPO_ROOT, "fixtures/corpus/spec", name), "utf8"),
      ]),
    );
    const original = realDerivedSchemaBindings(raw);
    const replay = JSON.parse(raw["real-derived-replay-schema.json"]!) as Record<string, unknown>;
    replay.title = `${String(replay.title)} changed`;
    const changed = realDerivedSchemaBindings({
      ...raw,
      "real-derived-replay-schema.json": `${JSON.stringify(replay, null, 2)}\n`,
    });
    expect(changed).not.toEqual(original);
    expect(original.map((binding) => binding.id)).toEqual([
      "verin-real-derived-case/1.0.0",
      "verin-real-derived-replay/1.0.0",
    ]);
    expect(
      corpusDigest(
        real.spec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(real.taxonomy),
        real.inventory,
        currentFreshnessPolicyBinding(),
        changed,
      ),
    ).not.toBe(real.corpusDigest);
  });

  it("(d) enforces: the scenario matrix records the same deferral, with the same trigger", () => {
    const matrix = (parseDocument(readFileSync(SCENARIOS, "utf8")).toJS() ?? {}) as Record<string, any>;
    const manifest = JSON.parse(readFileSync(CORPUS_MANIFEST, "utf8")) as Record<string, any>;
    const elementIds = new Set((matrix.elements ?? []).map((e: { id: string }) => e.id));
    expect(matrix.corpus_deferral?.id).toBe("replay-corpus-real-derived");
    expect(matrix.corpus_deferral?.status).toBe(manifest.partitions.realDerived.deferral.status);
    expect(matrix.corpus_deferral?.deferred_elements).toEqual(["replay-corpus"]);
    for (const id of matrix.corpus_deferral?.deferred_elements ?? []) expect(elementIds.has(id)).toBe(true);
    expect(existsSync(join(REPO_ROOT, String(matrix.corpus_deferral?.adr)))).toBe(true);
    // BYTE equality, not a length floor: two un-defer triggers that merely happen
    // to be long can say entirely different things about when this partition may
    // be populated.
    expect(matrix.corpus_deferral?.un_defer_trigger).toBe(
      manifest.partitions.realDerived.deferral.unDeferTrigger,
    );
  });

  it("(e) enforces: the signed corpus carries labeled clean controls", () => {
    const controls = real.cases.filter((item) => item.label.kind === "clean-control");
    expect(controls.length, "no clean controls means no false-positive rate is computable").toBeGreaterThan(0);
  });

  it("(e) enforces: no clean control carries a defect implicitly (stale, lapsed, expired, or unverified evidence)", () => {
    const problems = cleanControlProblems(real.cases);
    expect(problems, `clean controls carrying the defect being measured:\n${problems.join("\n")}`).toEqual([]);
    // Non-vacuity: the rules must actually have controls to run over.
    expect(real.cases.filter((item) => item.label.kind === "clean-control").length).toBeGreaterThanOrEqual(5);
  });

  it("(e) enforces: every class in the closed taxonomy is exercised by a labeled defect case", () => {
    const problems = taxonomyExerciseProblems(real.taxonomy, real.spec.cases);
    expect(problems, `unexercised defect classes:\n${problems.join("\n")}`).toEqual([]);
    expect(real.taxonomy.defectClasses.length).toBeGreaterThanOrEqual(16);
  });

  it("(f) enforces: no actual generated artifact contains a signature field", () => {
    const violations = generatedSignatureProblems([
      ...real.generated,
      real.manifest,
    ]);
    expect(
      violations,
      `generated signature fields:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("(f) enforces: the generator can only emit into synthetic/ - never spec/ or real-derived/", () => {
    const emitted = [...real.generated.map((f) => f.relPath), real.manifest.relPath];
    const escaping = emitted.filter((path) => path !== "manifest.json" && !path.startsWith("synthetic/"));
    expect(escaping, `generator output escaping its partition:\n${escaping.join("\n")}`).toEqual([]);
    expect(emitted.length).toBeGreaterThan(1);
  });
});

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {
  it("an unlabeled case, a label outside the vocabulary, and an off-taxonomy defect class are all flagged", () => {
    const base = JSON.parse(JSON.stringify(real.cases[0])) as (typeof real.cases)[number];
    const unlabeled = { ...base, caseId: "CS-x1", provenance: "" };
    const outside = { ...base, caseId: "CS-x2", provenance: "totally-real-data" };
    const offTaxonomy = { ...base, caseId: "CS-x3", label: { kind: "defect", defectClassId: "invented-class" } };
    const problems = labelProblems(
      [unlabeled, outside, offTaxonomy] as typeof real.cases,
      real.taxonomy,
      refs.provenanceLabels,
      goldenIds,
    );
    expect(problems.some((p) => p.startsWith("CS-x1") && p.includes("is not a config/demo/scenarios.yaml provenance label"))).toBe(true);
    expect(problems.some((p) => p.startsWith("CS-x2") && p.includes("totally-real-data"))).toBe(true);
    expect(problems.some((p) => p.startsWith("CS-x3") && p.includes("outside the closed taxonomy"))).toBe(true);
  });

  it("a golden GC- case id appearing in the corpus is flagged (disjointness)", () => {
    const collided = [
      { ...JSON.parse(JSON.stringify(real.cases[0])), caseId: [...goldenIds][0]! },
    ] as typeof real.cases;
    const problems = labelProblems(collided, real.taxonomy, refs.provenanceLabels, goldenIds);
    expect(problems.some((p) => p.includes("collides with a signed golden case id"))).toBe(true);
  });

  /** One REAL defect case, relabeled as a control. Its defect signature is
   * unchanged, so whatever the rule fails to notice ships as a control. */
  const relabeledAsControl = (caseId: string): typeof real.cases => {
    const found = real.cases.find((item) => item.caseId === caseId);
    expect(found, `${caseId} must exist for the companion to drive the rule`).toBeDefined();
    return [
      { ...(JSON.parse(JSON.stringify(found)) as (typeof real.cases)[number]), label: { kind: "clean-control" } },
    ];
  };

  it.each([
    ["CS-stale-model-assignment-evidence", "cannot carry evidence-staleness-unnoticed"],
    ["CS-authority-lapse-inside-retrieval", "that is evidence-interval-collapse"],
    ["CS-expired-and-future-restrictions", "that is restriction-lifecycle-error"],
    ["CS-duplicate-last-four-destinations", "that is destination-integrity-defect"],
    ["CS-deadline-precedes-decision", "that is deadline-feasibility-error"],
  ])("a defect case relabeled as a clean control is caught: %s", (caseId, expected) => {
    const problems = cleanControlProblems(relabeledAsControl(caseId));
    expect(problems.join("\n"), `${caseId} passed as a control`).toContain(expected);
  });

  it("a control that still asserts an awkward structure, or cites a record absent from its own subgraph, is flagged", () => {
    const asserting = cleanControlProblems(relabeledAsControl("CS-position-scoped-legal-hold"));
    expect(asserting.some((p) => p.includes("a control carries none by definition"))).toBe(true);

    const control = JSON.parse(JSON.stringify(real.cases.find((c) => c.caseId === "CS-clean-fresh-authority"))) as
      (typeof real.cases)[number];
    expect(cleanControlProblems([control])).toEqual([]);
    control.records.authorizedSigners = [];
    expect(
      cleanControlProblems([control]).some((p) => p.includes("absent from the case's own subgraph")),
    ).toBe(true);
  });

  it("a missing evidence collection, dangling subject, multi-resolving subject, and duplicate spec key are rejected", () => {
    const changeCase = structuredClone(
      real.cases.find((item) => item.caseId === "CS-shared-instruction-change-blast-radius")!,
    );
    (changeCase.records as any).recentChanges = undefined;
    expect(
      evidenceResolutionProblems([changeCase]).some((problem) =>
        problem.includes("records.recentChanges: required emitted collection is missing"),
      ),
    ).toBe(true);

    const modelCase = structuredClone(
      real.cases.find((item) => item.caseId === "CS-pending-rebalance-during-evaluation")!,
    );
    modelCase.records.modelAssignments.push(
      structuredClone(
        modelCase.records.modelAssignments.find(
          (row) => row.id === "model-assignment:smiths-joint-model",
        )!,
      ),
    );
    expect(
      evidenceResolutionProblems([modelCase]).some((problem) =>
        problem.includes("resolves to 2 emitted records"),
      ),
    ).toBe(true);

    const destinationCase = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-beneficiary-versus-destination-restriction",
      )!,
    );
    destinationCase.records.referencedAccounts = destinationCase.records.referencedAccounts.filter(
      (row) => row.id !== "subject:mira-roth",
    );
    expect(
      evidenceResolutionProblems([destinationCase]).some((problem) =>
        problem.includes("records.referencedBankInstructions.bank-instruction:mira-primary.accountRefs"),
      ),
    ).toBe(true);
    const missingHousehold = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId ===
          "CS-beneficiary-versus-destination-restriction",
      )!,
    );
    missingHousehold.records.referencedHouseholds = [];
    expect(
      evidenceResolutionProblems([missingHousehold]).some((problem) =>
        problem.includes(
          "records.referencedAccounts.subject:mira-roth.householdRef",
        ),
      ),
    ).toBe(true);

    const world = structuredClone(real.spec.world);
    world.modelAssignments.push(structuredClone(world.modelAssignments[0]!));
    expect(
      specReferenceProblems(world, real.spec.cases).some((problem) =>
        problem.includes('modelAssignments: duplicate key "smiths-joint-model"'),
      ),
    ).toBe(true);
  });

  it("pending-action liquidity treatment is closed and direction-aware for every kind and state", () => {
    for (const kind of PENDING_ACTION_KINDS) {
      for (const state of PENDING_ACTION_STATES) {
        const treatment = pendingActionLiquidityTreatment(kind, state);
        const expectedReduction =
          (state === "pending" || state === "settling") &&
          treatment.direction === "outgoing" &&
          (treatment.liquidityClass === "distribution" ||
            treatment.liquidityClass === "debit");
        const expectedIncrease =
          state === "settled" &&
          treatment.direction === "incoming" &&
          treatment.liquidityClass === "credit";
        expect(treatment.reducesEffectiveLiquidity).toBe(expectedReduction);
        expect(treatment.increasesAvailableLiquidity).toBe(expectedIncrease);
      }
    }
  });

  it("a defect class carried by NO case is flagged (an unexercised class is decoration)", () => {
    const orphaned = real.taxonomy.defectClasses[0]!.id;
    const withoutIt = {
      ...real.spec.cases,
      cases: real.spec.cases.cases.filter(
        (entry) => entry.label.kind !== "defect" || entry.label.defectClassId !== orphaned,
      ),
    };
    const problems = taxonomyExerciseProblems(real.taxonomy, withoutIt);
    expect(problems.some((p) => p.includes(orphaned) && p.includes("unexercised class is decoration"))).toBe(true);
    expect(taxonomyExerciseProblems(real.taxonomy, real.spec.cases)).toEqual([]);
  });

  it("a corpus with NO clean controls is flagged (coverage without false positives is not a measurement)", () => {
    const onlyDefects = real.cases.filter((item) => item.label.kind === "defect").slice(0, 3);
    const problems = labelProblems(onlyDefects, real.taxonomy, refs.provenanceLabels, goldenIds);
    expect(problems.some((p) => p.includes("no labeled clean controls"))).toBe(true);
  });

  it("a POPULATED real-derived partition DOES produce a detectionRate (null is a real branch, not a stub)", () => {
    const realDerivedOutcomes: RealDerivedCaseOutcome[] = [
      {
        caseId: "RD-a",
        attributedDefectClassIds: ["test-defect"],
        provenance: "real-derived-fixture",
      },
      {
        caseId: "RD-b",
        attributedDefectClassIds: [],
        provenance: "real-derived-fixture",
      },
      {
        caseId: "RD-c",
        attributedDefectClassIds: [],
        provenance: "real-derived-fixture",
      },
    ];
    const report = renderCorpusReport(
      reportInput(outcomes(2, 1, true), realDerivedOutcomes),
    );
    expect(report).toContain("detectionRate            50.00%");
    expect(report).toContain("falsePositiveRate        0.00%");
  });

  it("a detector that flags EVERYTHING cannot claim success: 1.0 coverage arrives with 1.0 false positives", () => {
    const report = renderCorpusReport(reportInput(outcomes(5, 5, true)));
    expect(report).toContain("syntheticDefectCoverage  100.00%");
    expect(report).toContain("falsePositiveRate        100.00%");
  });

  it("coverage credits only the exact signed defect class attribution", () => {
    const exact = outcomes(2, 1, false);
    exact[0] = {
      ...exact[0]!,
      attributedDefectClassIds: ["test-defect"],
    };
    const report = renderCorpusReport(reportInput(exact));
    expect(report).toContain("syntheticDefectCoverage  50.00%");

    const contradictory = outcomes(2, 1, false);
    contradictory[0] = {
      ...contradictory[0]!,
      attributedDefectClassIds: ["other-defect"],
    };
    contradictory[1] = {
      ...contradictory[1]!,
      attributedDefectClassIds: ["other-defect"],
    };
    const inventory = inventoryOf(contradictory).map((entry) =>
      entry.caseId === "d1" ? { ...entry, labelId: "other-defect" } : entry,
    );
    expect(() =>
      renderCorpusReport(
        reportInput(contradictory, [], { inventory }),
      ),
    ).toThrow("contradicts its signed defect label");

    const unknown = outcomes(1, 1, false);
    unknown[0] = {
      ...unknown[0]!,
      attributedDefectClassIds: ["unknown-defect"],
    };
    expect(() => renderCorpusReport(reportInput(unknown))).toThrow(
      "attributes unknown defect class",
    );
  });

  it("an unsigned corpus and an unevaluated corpus both withhold every figure with a reason code", () => {
    const evaluated = outcomes(5, 5, true);
    const unsigned = renderCorpusReport(
      reportInput(evaluated, [], {
        signoff: {
          corpusVersion: "x",
          status: "pending-captain",
          signedBy: null,
          signedAt: null,
          signedDigest: null,
        },
      }),
    );
    expect(unsigned).toContain("syntheticDefectCoverage  null (corpus-signoff-pending)");
    const unevaluated = renderCorpusReport(
      reportInput(outcomes(5, 5, null)),
    );
    expect(unevaluated).toContain("syntheticDefectCoverage  null (detector-outcomes-absent)");
  });

  it("a partially evaluated corpus withholds both figures instead of reporting the favorable subset", () => {
    const partial = outcomes(2, 2, null);
    partial[0] = { ...partial[0]!, attributedDefectClassIds: ["test-defect"] };
    partial[2] = { ...partial[2]!, attributedDefectClassIds: [] };
    const report = renderCorpusReport(reportInput(partial));
    expect(report).toContain("syntheticDefectCoverage  null (detector-outcomes-incomplete)");
    expect(report).toContain("falsePositiveRate        null (detector-outcomes-incomplete)");
  });

  it("omitting unevaluated manifest cases cannot turn a favorable subset into a complete run", () => {
    const completeInventory = outcomes(2, 2, true);
    const favorableSubset = [completeInventory[0]!, completeInventory[2]!];
    const report = renderCorpusReport(
      reportInput(favorableSubset, [], {
        inventory: inventoryOf(completeInventory),
      }),
    );
    expect(report).toContain("cases 4  defects 2  clean controls 2  evaluated 2");
    expect(report).toContain("syntheticDefectCoverage  null (detector-outcomes-incomplete)");
  });

  it("duplicate or non-inventoried outcomes are rejected at the measurement boundary", () => {
    const complete = outcomes(1, 1, true);
    expect(() =>
      renderCorpusReport(
        reportInput(
          [complete[0]!, complete[0]!, complete[1]!],
          [],
          { inventory: inventoryOf(complete) },
        ),
      ),
    ).toThrow("duplicate outcome");
    expect(() =>
      renderCorpusReport(
        reportInput(
          [
            ...complete,
            {
              caseId: "not-in-manifest",
              attributedDefectClassIds: ["test-defect"],
              provenance: "synthetic-fixture",
            },
          ],
          [],
          { inventory: inventoryOf(complete) },
        ),
      ),
    ).toThrow("absent from the signed manifest inventory");
  });

  it("the signed corpus digest binds the exact inventory supplied to reporting", () => {
    const input = reportInput(outcomes(2, 2, true));
    expect(() =>
      renderCorpusReport({
        ...input,
        inventory: input.inventory.slice(0, 2),
        syntheticOutcomes: input.syntheticOutcomes.slice(0, 2),
      }),
    ).toThrow("manifest inventory digest");
  });

  it("the report validates signoff instead of trusting a caller-supplied signed flag", () => {
    expect(() =>
      renderCorpusReport(
        reportInput(outcomes(1, 1, true), [], {
          signoff: {
            ...signedSignoff(),
            signedDigest: "not-the-corpus-digest",
          },
        }),
      ),
    ).toThrow("invalid signoff");
  });

  it("coverage measured with NO clean controls is marked uninterpretable", () => {
    const report = renderCorpusReport(reportInput(outcomes(4, 0, true)));
    expect(report).toContain("syntheticDefectCoverage  100.00%");
    expect(report).toContain("falsePositiveRate        null (no-clean-controls)");
  });

  it("the structured builder cannot be acquired through any module syntax", () => {
    expect("buildCorpusReport" in corpusReportRuntime).toBe(false);
    expect(
      reportExportProblems(["renderCorpusReport", "buildCorpusReport"]),
    ).toEqual(["buildCorpusReport"]);
  });

  it("the measurement boundary rejects outcomes from the wrong provenance partition", () => {
    expect(() =>
      renderCorpusReport(
        reportInput(
          [
          {
            caseId: "RD-wrong",
            attributedDefectClassIds: ["test-defect"],
            provenance: "real-derived-fixture",
          },
          ] as any,
        ),
      ),
    ).toThrow("received 1 outcome(s) from another provenance partition");
  });

  it("recursive signature keys are rejected in actual generated artifacts", () => {
    const key = "signedBy";
    const value = {
      nested: {
        [key]: "captain",
        ...{ signedAt: "2026-07-28T12:00:00.000Z" },
      },
      signedDigest: null,
    };
    expect(
      generatedSignatureProblems([
        {
          relPath: "synthetic/CS-signature.json",
          bytes: JSON.stringify(value),
          value: value as any,
        },
      ]),
    ).toHaveLength(3);
  });

  it("a VALID real-derived case is accepted (the intake contract is not a blanket reject)", () => {
    expect(realDerivedCaseProblems(realDerivedCase(), classes, "real-derived/RD-ok.json")).toEqual([]);
  });

  it("a real-derived defect label must match its closed replay semantics", () => {
    const mislabeled = realDerivedCase();
    ((mislabeled.replayPayload as Record<string, any>).destination).discriminatorState =
      "unique";
    const problems = realDerivedCaseProblems(
      mislabeled,
      classes,
      "real-derived/RD-mislabeled-defect.json",
    );
    expect(problems.join("\n")).toContain(
      "label.defectClassId does not match replay semantics",
    );
  });

  it("the real-derived semantic registry exactly covers the signed taxonomy", () => {
    expect(realDerivedSemanticContractProblems(classes)).toEqual([]);
    const missing = new Set(classes);
    missing.delete("destination-integrity-defect");
    expect(realDerivedSemanticContractProblems(missing).join("\n")).toContain(
      "reference unknown defect class",
    );
    expect(
      realDerivedSemanticContractProblems(
        new Set([...classes, "invented-defect"]),
      ).join("\n"),
    ).toContain("missing defect class");
  });

  it("a semantically clean real-derived control is accepted", () => {
    const control = realDerivedCase({
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    });
    ((control.replayPayload as Record<string, any>).destination).discriminatorState =
      "unique";
    expect(
      realDerivedCaseProblems(
        control,
        classes,
        "real-derived/RD-clean.json",
      ),
    ).toEqual([]);
  });

  it.each([...classes])(
    "the %s signature is live and cannot pass as a clean control",
    (defectClassId) => {
      const defect = realDerivedDefectCase(defectClassId);
      expect(
        realDerivedCaseProblems(
          defect,
          classes,
          `real-derived/RD-${defectClassId}.json`,
        ),
      ).toEqual([]);
      const control = structuredClone(defect);
      control.label = {
        kind: "clean-control",
        controlRationaleId: "defect-class-absent",
      };
      expect(
        realDerivedCaseProblems(
          control,
          classes,
          `real-derived/RD-${defectClassId}-control.json`,
        ).join("\n"),
      ).toContain("clean-control carries replay defect signatures");
    },
  );

  it("the real-derived replay payload is versioned, complete, strict, and internally consistent", () => {
    const missing = realDerivedCase();
    delete missing.replayPayload;
    expect(
      realDerivedCaseProblems(
        missing,
        classes,
        "real-derived/RD-missing-payload.json",
      ).some((problem) => problem.includes("replayPayload")),
    ).toBe(true);

    const extra = realDerivedCase();
    (extra.replayPayload as Record<string, unknown>).accountNumber =
      "tok:1111222233334444";
    expect(
      realDerivedCaseProblems(
        extra,
        classes,
        "real-derived/RD-extra-payload.json",
      ).length,
    ).toBeGreaterThan(0);

    const ambiguous = realDerivedCase();
    (
      (ambiguous.replayPayload as Record<string, any>).identity
        .candidateRefs as string[]
    ).push(OPAQUE_REVIEWER);
    expect(
      realDerivedCaseProblems(
        ambiguous,
        classes,
        "real-derived/RD-ambiguous-payload.json",
      ).length,
    ).toBeGreaterThan(0);

    const mismatched = realDerivedCase();
    const pending = (mismatched.replayPayload as Record<string, any>).liquidity
      .pendingAction;
    Object.assign(pending, {
      actionRef: OPAQUE,
      actionKind: "incoming-transfer",
      actionState: "pending",
      direction: "outgoing",
      liquidityClass: "credit",
      amountMinor: 500,
    });
    expect(
      realDerivedCaseProblems(
        mismatched,
        classes,
        "real-derived/RD-incompatible-payload.json",
      ).length,
    ).toBeGreaterThan(0);

    const incompatibleMutations: Array<(payload: Record<string, any>) => void> = [
      (payload) => { payload.schemaVersion = "verin-real-derived-replay/9.9.9"; },
      (payload) => { payload.liquidity.reserveState = "missing"; },
      (payload) => { payload.authority.authorityState = "missing"; },
      (payload) => { payload.instructionConflict.conflictState = "present"; },
      (payload) => { payload.policy.restrictionRef = OPAQUE; },
      (payload) => { payload.request.destinationRef = OPAQUE_REVIEWER; },
      (payload) => { payload.policy.thresholdComparison = "below"; },
      (payload) => { payload.destination.ownerRefs.push(OPAQUE); },
    ];
    for (const mutate of incompatibleMutations) {
      const candidate = realDerivedCase();
      mutate(candidate.replayPayload as Record<string, any>);
      expect(
        realDerivedCaseProblems(
          candidate,
          classes,
          "real-derived/RD-incompatible-payload.json",
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("duplicate JSON keys are rejected before a delivered value can enter inventory", () => {
    const dir = mkdtempSync(join(tmpdir(), "verin-corpus-duplicate-key-"));
    try {
      writeFileSync(
        join(dir, "RD-00112233445566aa.json"),
        '{"subject":"Robert Smith","subject":"tok:0123456789abcdef"}\n',
      );
      const delivery = loadRealDerivedDelivery(dir);
      expect(delivery.files).toEqual([]);
      expect(delivery.problems.join("\n")).toContain(
        "canonical JSON with unique object keys",
      );
      expect(delivery.problems.join("\n")).not.toContain("Robert Smith");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unsafe delivery filenames never enter intake diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "verin-corpus-unsafe-path-"));
    try {
      mkdirSync(join(dir, "Robert-Smith"));
      writeFileSync(
        join(dir, "Robert-Smith", "account-1234.json"),
        canonicalFixtureBytes(realDerivedCase()),
      );
      const diagnostics = loadRealDerivedDelivery(dir).problems.join("\n");
      expect(diagnostics).not.toContain("Robert-Smith");
      expect(diagnostics).not.toContain("account-1234");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("real-derived freshness is derived from evaluation.asOf and the versioned per-kind policy", () => {
    const staleLabel = realDerivedCase();
    (staleLabel.evidence as Array<Record<string, unknown>>)[0]!.freshness =
      "stale";
    expect(
      realDerivedCaseProblems(
        staleLabel,
        classes,
        "real-derived/RD-stale-label.json",
      ).some((problem) => problem.includes('does not match derived "fresh"')),
    ).toBe(true);

    const futureRetrieval = realDerivedCase();
    (futureRetrieval.evidence as Array<Record<string, unknown>>)[0]!.retrievedAt =
      "2026-04-28T13:00:06.000Z";
    expect(
      realDerivedCaseProblems(
        futureRetrieval,
        classes,
        "real-derived/RD-future-retrieval.json",
      ).some((problem) => problem.includes("must not postdate evaluation.asOf")),
    ).toBe(true);

    const invertedObservation = realDerivedCase();
    (invertedObservation.evidence as Array<Record<string, unknown>>)[0]!.observedAt =
      "2026-04-28T13:00:05.000Z";
    expect(
      realDerivedCaseProblems(
        invertedObservation,
        classes,
        "real-derived/RD-inverted-observation.json",
      ).some((problem) => problem.includes("must not postdate retrievedAt")),
    ).toBe(true);

    const unknownPolicy = realDerivedCase();
    (unknownPolicy.evaluation as Record<string, unknown>).freshnessPolicyVersion =
      "verin-real-derived-freshness/9.9.9";
    expect(
      realDerivedCaseProblems(
        unknownPolicy,
        classes,
        "real-derived/RD-unknown-policy.json",
      ).some((problem) => problem.includes("freshnessPolicyVersion")),
    ).toBe(true);
  });

  it("freshness unknown requires the typed missing-observation state", () => {
    const missing = realDerivedCase();
    (missing.evidence as Array<Record<string, unknown>>)[0] = {
      ...(missing.evidence as Array<Record<string, unknown>>)[0],
      observationState: "missing",
      observedAt: null,
      freshness: "unknown",
    };
    expect(
      realDerivedCaseProblems(
        missing,
        classes,
        "real-derived/RD-missing-observation.json",
      ),
    ).toEqual([]);

    const untypedUnknown = realDerivedCase();
    (untypedUnknown.evidence as Array<Record<string, unknown>>)[0]!.freshness =
      "unknown";
    expect(
      realDerivedCaseProblems(
        untypedUnknown,
        classes,
        "real-derived/RD-untyped-unknown.json",
      ).length,
    ).toBeGreaterThan(0);

    const unsupportedKind = realDerivedCase();
    (unsupportedKind.evidence as Array<Record<string, unknown>>)[0]!.evidenceKind =
      "advisor-note";
    expect(
      realDerivedCaseProblems(
        unsupportedKind,
        classes,
        "real-derived/RD-unsupported-kind.json",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("a real-derived derived id cannot hide a name or use an open suffix", () => {
    const named = realDerivedCase();
    (named.evidence as Array<Record<string, unknown>>)[0]!.id =
      "conflict:robert-smith-liquidity";
    expect(
      realDerivedCaseProblems(named, classes, "real-derived/RD-named-id.json").length,
    ).toBeGreaterThan(0);
    const openSuffix = realDerivedCase();
    (openSuffix.evidence as Array<Record<string, unknown>>)[0]!.id =
      "evs:tok:0123456789abcdef:advisor-note";
    expect(
      realDerivedCaseProblems(openSuffix, classes, "real-derived/RD-open-suffix.json").length,
    ).toBeGreaterThan(0);
    const mismatched = realDerivedCase();
    (mismatched.evidence as Array<Record<string, unknown>>)[0]!.evidenceKind =
      "authority";
    expect(
      realDerivedCaseProblems(mismatched, classes, "real-derived/RD-mismatch.json").some(
        (problem) => problem.includes("does not match evidenceKind"),
      ),
    ).toBe(true);
    const dangling = realDerivedCase({ subjects: ["tok:1111222233334444"] });
    expect(
      realDerivedCaseProblems(dangling, classes, "real-derived/RD-dangling.json").some(
        (problem) => problem.includes("resolves to 0 subjects"),
      ),
    ).toBe(true);
  });

  it("the scrub attestation requires an extractor identity and chronological custody", () => {
    const missingExtractor = realDerivedCase();
    delete (missingExtractor.scrubAttestation as Record<string, unknown>).extractedBy;
    expect(
      realDerivedCaseProblems(
        missingExtractor,
        classes,
        "real-derived/RD-no-extractor.json",
      ).some((problem) => problem.includes("extractedBy")),
    ).toBe(true);

    const reversed = realDerivedCase({
      scrubAttestation: {
        ...(realDerivedCase().scrubAttestation as object),
        extractedAt: "2026-05-04T13:00:00.000Z",
      },
    });
    expect(
      realDerivedCaseProblems(
        reversed,
        classes,
        "real-derived/RD-reversed.json",
      ).some((problem) => problem.includes("must not postdate")),
    ).toBe(true);
  });

  it("a real-derived case with FREE TEXT is rejected", () => {
    const problems = realDerivedCaseProblems(
      realDerivedCase({ subjects: ["Robert Smith"] }),
      classes,
      "real-derived/RD-freetext.json",
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("subjects");
    expect(problems.join("\n")).not.toContain("Robert Smith");
  });

  it("a real-derived case with a free-text field in an UNANTICIPATED key is rejected (fail-closed)", () => {
    const unexpected = realDerivedCase();
    unexpected["Robert Smith"] = "call the client back about the wire";
    const problems = realDerivedCaseProblems(
      unexpected,
      classes,
      "real-derived/RD-extra.json",
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).not.toContain(
      "call the client back about the wire",
    );
    expect(problems.join("\n")).not.toContain("Robert Smith");
  });

  it("a real-derived case MISSING its scrub attestation is rejected", () => {
    const withoutAttestation = realDerivedCase();
    delete withoutAttestation.scrubAttestation;
    const problems = realDerivedCaseProblems(withoutAttestation, classes, "real-derived/RD-unattested.json");
    expect(problems.some((p) => p.includes("scrubAttestation"))).toBe(true);
  });

  it("a self-reviewed scrub and an impossible record count are rejected", () => {
    const selfReviewed = realDerivedCase({
      scrubAttestation: { ...(realDerivedCase().scrubAttestation as object), reviewedBy: OPAQUE },
    });
    expect(
      realDerivedCaseProblems(selfReviewed, classes, "real-derived/RD-self.json").some((p) =>
        p.includes("reviewedBy must differ"),
      ),
    ).toBe(true);
    const inflated = realDerivedCase({
      scrubAttestation: { ...(realDerivedCase().scrubAttestation as object), recordsAfter: 999 },
    });
    expect(
      realDerivedCaseProblems(inflated, classes, "real-derived/RD-inflated.json").some((p) =>
        p.includes("scrubbing cannot add records"),
      ),
    ).toBe(true);
  });

  it("a real-derived case carrying the SYNTHETIC provenance label is rejected", () => {
    const problems = realDerivedCaseProblems(
      realDerivedCase({ provenance: "synthetic-fixture" }),
      classes,
      "real-derived/RD-mislabeled.json",
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("signed signoff requires the closed captain authority and canonical signedAt instant", () => {
    const base: CorpusSignoff = {
      corpusVersion: real.spec.world.corpusVersion,
      status: "signed",
      signedBy: CAPTAIN_SIGNING_AUTHORITY,
      signedAt: "2026-07-28T12:00:00.000Z",
      signedDigest: real.corpusDigest,
    };
    expect(
      signoffProblems(base, real.spec.world.corpusVersion, real.corpusDigest),
    ).toEqual([]);
    expect(
      signoffProblems(
        { ...base, signedBy: "agent", signedAt: "not-a-date" },
        real.spec.world.corpusVersion,
        real.corpusDigest,
      ).join("\n"),
    ).toContain("closed captain authority");
    expect(
      signoffProblems(
        { ...base, signedAt: "2026-07-28" },
        real.spec.world.corpusVersion,
        real.corpusDigest,
      ).join("\n"),
    ).toContain("canonical ISO-8601 UTC instant");
    expect(
      signoffProblems(
        { ...base, signedAt: "2026-13-40T12:00:00.000Z" },
        real.spec.world.corpusVersion,
        real.corpusDigest,
      ).join("\n"),
    ).toContain("canonical ISO-8601 UTC instant");
  });

  it("signoff parsing rejects duplicate keys, aliases, unexpected keys, and multiple blocks", () => {
    const yaml = (body: string) => `\`\`\`yaml\n${body}\n\`\`\``;
    const malformed: Array<[string, string]> = [
      [yaml("corpusVersion: x\nstatus: signed\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null"), "parse error"],
      [yaml("corpusVersion: &v x\nstatus: pending-captain\nsignedBy: *v\nsignedAt: null\nsignedDigest: null"), "aliases are forbidden"],
      [yaml("corpusVersion: x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null\nextra: value"), "unexpected top-level keys"],
      [`${yaml("corpusVersion: x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null")}\n${yaml("corpusVersion: x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null")}`, "exactly one YAML signoff block"],
    ];
    for (const [text, expected] of malformed) {
      expect(
        signoffProblems(parseSignoff(text), "x", "digest").join("\n"),
      ).toContain(expected);
    }
  });
});
