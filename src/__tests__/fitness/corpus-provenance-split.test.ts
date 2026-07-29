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
import { Node, Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT, inMemoryProject, walk } from "./_fence-utils";
import { loadGoldenCases, loadScenarioRefs } from "../../../scripts/golden-cases.lib";
import { defectClassIds, taxonomyExerciseProblems } from "../../../scripts/corpus/defects";
import { evidenceResolutionProblems } from "../../../scripts/corpus/graph";
import {
  buildInventory,
  buildManifest,
  corpusDigest,
  currentFreshnessPolicyBinding,
  generatedSignatureProblems,
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
  buildCorpusReport,
  type RealDerivedCaseOutcome,
  type ReportInput,
  type SyntheticCaseOutcome,
} from "../../../scripts/corpus/report";
import { realDerivedCaseProblems } from "../../../scripts/corpus/scrub-contract";
import {
  CAPTAIN_SIGNING_AUTHORITY,
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

// ── (c) the no-blending rule ───────────────────────────────────────────────────

const isReportModule = (specifier: string): boolean =>
  /(?:^|\/)corpus\/report$/.test(specifier.replace(/\\/g, "/"));

export function measurementBoundaryViolations(
  project: Project,
  root = "",
): string[] {
  const violations: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = sf.getFilePath().replace(/\\/g, "/");
    const isCli = file.endsWith("/scripts/corpus-report.ts");
    for (const declaration of sf.getImportDeclarations()) {
      if (!isReportModule(declaration.getModuleSpecifierValue())) continue;
      const valueNames = declaration
        .getNamedImports()
        .filter((specifier) => !specifier.isTypeOnly())
        .map((specifier) => specifier.getName());
      const allowed =
        isCli &&
        declaration.getDefaultImport() === undefined &&
        declaration.getNamespaceImport() === undefined &&
        valueNames.length === 1 &&
        valueNames[0] === "renderCorpusReport";
      if (!allowed) {
        violations.push(
          `${sf.getFilePath().replace(root, "")}:${declaration.getStartLineNumber()}: structured corpus measurement is private to scripts/corpus/report.ts`,
        );
      }
    }
    for (const declaration of sf.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier === undefined || !isReportModule(specifier)) continue;
      violations.push(
        `${sf.getFilePath().replace(root, "")}:${declaration.getStartLineNumber()}: corpus measurement cannot be re-exported`,
      );
    }
    for (const declaration of sf.getDescendantsOfKind(
      SyntaxKind.ImportEqualsDeclaration,
    )) {
      if (!/corpus[/\\]report/.test(declaration.getModuleReference().getText())) {
        continue;
      }
      violations.push(
        `${sf.getFilePath().replace(root, "")}:${declaration.getStartLineNumber()}: corpus measurement cannot use import-equals`,
      );
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const argument = call.getArguments()[0];
      if (
        argument === undefined ||
        !Node.isStringLiteral(argument) ||
        !isReportModule(argument.getLiteralValue())
      ) {
        continue;
      }
      violations.push(
        `${sf.getFilePath().replace(root, "")}:${call.getStartLineNumber()}: corpus measurement cannot use dynamic or CommonJS loading`,
      );
    }
  }
  return violations;
}

const projectOf = (filter: (file: string) => boolean): Project => {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of walk(join(REPO_ROOT, "scripts"), (f) => f.endsWith(".ts") && filter(f))) {
    project.addSourceFileAtPath(file);
  }
  return project;
};

const measuredCodeProject = (): Project => {
  const project = projectOf(() => true);
  for (const file of walk(
    join(REPO_ROOT, "src"),
    (candidate) =>
      /\.(?:ts|tsx)$/.test(candidate) &&
      !candidate.includes(`${join("src", "__tests__")}`),
  )) {
    project.addSourceFileAtPath(file);
  }
  return project;
};

// ── shared fixtures for the companions ─────────────────────────────────────────

const OPAQUE = "tok:0123456789abcdef";
const OPAQUE_REVIEWER = "tok:fedcba9876543210";

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

const outcomes = (defects: number, controls: number, flagged: boolean | null): SyntheticCaseOutcome[] => [
  ...Array.from({ length: defects }, (_, i) => ({
    caseId: `d${i}`,
    labelKind: "defect" as const,
    flagged,
    provenance: "synthetic-fixture" as const,
  })),
  ...Array.from({ length: controls }, (_, i) => ({
    caseId: `c${i}`,
    labelKind: "clean-control" as const,
    flagged,
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
    labelKind: outcome.labelKind,
    labelId:
      outcome.labelKind === "defect" ? "test-defect" : "clean-control",
  })),
  ...realDerived.map((outcome) => ({
    caseId: outcome.caseId,
    file: `real-derived/${outcome.caseId}.json`,
    digest: outcome.caseId,
    partition: "real-derived" as const,
    labelKind: outcome.labelKind,
    labelId:
      outcome.labelKind === "defect" ? "test-defect" : "clean-control",
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
    const violations = measurementBoundaryViolations(
      measuredCodeProject(),
      REPO_ROOT,
    );
    expect(
      violations,
      `measurement boundary violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("(c) enforces: the report type has no aggregate key and the two figures have different names", () => {
    const report = buildCorpusReport(reportInput(outcomes(2, 1, true)));
    for (const banned of ["overall", "blended", "combined", "total", "all", "rate"]) {
      expect(Object.keys(report)).not.toContain(banned);
    }
    expect(Object.keys(report.synthetic)).toContain("syntheticDefectCoverage");
    expect(Object.keys(report.synthetic)).not.toContain("detectionRate");
    expect(Object.keys(report.realDerived)).toContain("detectionRate");
    expect(Object.keys(report.realDerived)).not.toContain("syntheticDefectCoverage");
  });

  it("(d) enforces: with an empty real-derived partition the reporter withholds detectionRate", () => {
    const synthetic = outcomes(3, 2, true);
    const report = buildCorpusReport(reportInput(synthetic));
    expect(report.realDerived.detectionRate).toEqual({ value: null, reasonCode: "real-derived-corpus-absent" });
    expect(report.realDerived.interpretable).toBe(false);
    expect(report.synthetic.syntheticDefectCoverage.value).toBe(1);
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
    expect(crossHousehold.records.bankInstructions.map((row) => row.id)).toContain(
      "bank-instruction:mira-primary",
    );
    expect(crossHousehold.records.accounts.map((row) => row.id)).toContain(
      "subject:mira-roth",
    );
    expect(crossHousehold.records.parties.map((row) => row.id)).toContain(
      "subject:mira-smith",
    );
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
      crossHousehold.records.accounts.find(
        (row) => row.id === "subject:mira-roth",
      )?.householdRef,
    ).toBe("subject:smith-mira");
    expect(
      crossHousehold.records.bankInstructions.find(
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
        `${JSON.stringify(realDerivedCase())}\n`,
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
          problem.includes("real-derived/.hidden: only JSON"),
        ),
      ).toBe(true);
      expect(
        problems.some((problem) =>
          problem.includes("canonical filename"),
        ),
      ).toBe(true);
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
    destinationCase.records.accounts = destinationCase.records.accounts.filter(
      (row) => row.id !== "subject:mira-roth",
    );
    expect(
      evidenceResolutionProblems([destinationCase]).some((problem) =>
        problem.includes("records.bankInstructions.bank-instruction:mira-primary.accountRefs"),
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
          "records.accounts.subject:mira-roth.householdRef",
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
        labelKind: "defect",
        flagged: true,
        provenance: "real-derived-fixture",
      },
      {
        caseId: "RD-b",
        labelKind: "defect",
        flagged: false,
        provenance: "real-derived-fixture",
      },
      {
        caseId: "RD-c",
        labelKind: "clean-control",
        flagged: false,
        provenance: "real-derived-fixture",
      },
    ];
    const report = buildCorpusReport(
      reportInput(outcomes(2, 1, true), realDerivedOutcomes),
    );
    expect(report.realDerived.detectionRate).toEqual({ value: 0.5, reasonCode: null });
    expect(report.realDerived.falsePositiveRate).toEqual({ value: 0, reasonCode: null });
    expect(report.realDerived.interpretable).toBe(true);
  });

  it("a detector that flags EVERYTHING cannot claim success: 1.0 coverage arrives with 1.0 false positives", () => {
    const report = buildCorpusReport(reportInput(outcomes(5, 5, true)));
    expect(report.synthetic.syntheticDefectCoverage.value).toBe(1);
    expect(report.synthetic.falsePositiveRate.value).toBe(1);
  });

  it("an unsigned corpus and an unevaluated corpus both withhold every figure with a reason code", () => {
    const evaluated = outcomes(5, 5, true);
    const unsigned = buildCorpusReport(
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
    expect(unsigned.synthetic.syntheticDefectCoverage).toEqual({ value: null, reasonCode: "corpus-signoff-pending" });
    const unevaluated = buildCorpusReport(
      reportInput(outcomes(5, 5, null)),
    );
    expect(unevaluated.synthetic.syntheticDefectCoverage).toEqual({ value: null, reasonCode: "detector-outcomes-absent" });
  });

  it("a partially evaluated corpus withholds both figures instead of reporting the favorable subset", () => {
    const partial = outcomes(2, 2, null);
    partial[0] = { ...partial[0]!, flagged: true };
    partial[2] = { ...partial[2]!, flagged: false };
    const report = buildCorpusReport(reportInput(partial));
    expect(report.synthetic.syntheticDefectCoverage).toEqual({
      value: null,
      reasonCode: "detector-outcomes-incomplete",
    });
    expect(report.synthetic.falsePositiveRate).toEqual({
      value: null,
      reasonCode: "detector-outcomes-incomplete",
    });
    expect(report.synthetic.interpretable).toBe(false);
  });

  it("omitting unevaluated manifest cases cannot turn a favorable subset into a complete run", () => {
    const completeInventory = outcomes(2, 2, true);
    const favorableSubset = [completeInventory[0]!, completeInventory[2]!];
    const report = buildCorpusReport(
      reportInput(favorableSubset, [], {
        inventory: inventoryOf(completeInventory),
      }),
    );
    expect(report.synthetic.totalCases).toBe(4);
    expect(report.synthetic.evaluatedCases).toBe(2);
    expect(report.synthetic.syntheticDefectCoverage).toEqual({
      value: null,
      reasonCode: "detector-outcomes-incomplete",
    });
    expect(report.synthetic.falsePositiveRate).toEqual({
      value: null,
      reasonCode: "detector-outcomes-incomplete",
    });
  });

  it("duplicate or non-inventoried outcomes are rejected at the measurement boundary", () => {
    const complete = outcomes(1, 1, true);
    expect(() =>
      buildCorpusReport(
        reportInput(
          [complete[0]!, complete[0]!, complete[1]!],
          [],
          { inventory: inventoryOf(complete) },
        ),
      ),
    ).toThrow("duplicate outcome");
    expect(() =>
      buildCorpusReport(
        reportInput(
          [
            ...complete,
            {
              caseId: "not-in-manifest",
              labelKind: "defect",
              flagged: true,
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
      buildCorpusReport({
        ...input,
        inventory: input.inventory.slice(0, 2),
        syntheticOutcomes: input.syntheticOutcomes.slice(0, 2),
      }),
    ).toThrow("manifest inventory digest");
  });

  it("the report validates signoff instead of trusting a caller-supplied signed flag", () => {
    expect(() =>
      buildCorpusReport(
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
    const report = buildCorpusReport(reportInput(outcomes(4, 0, true)));
    expect(report.synthetic.syntheticDefectCoverage.value).toBe(1);
    expect(report.synthetic.falsePositiveRate).toEqual({ value: null, reasonCode: "no-clean-controls" });
    expect(report.synthetic.interpretable).toBe(false);
  });

  it.each([
    [
      "named alias and later assignment",
      'import { buildCorpusReport as make } from "../../scripts/corpus/report";\nlet report; report = make({} as any);\nexport const use = report;\n',
    ],
    [
      "namespace and bracket access",
      'import * as reporting from "../../scripts/corpus/report";\nexport const use = reporting["buildCorpusReport"]({} as any);\n',
    ],
    [
      "dynamic import and destructuring",
      'export async function use() { const { buildCorpusReport } = await import("../../scripts/corpus/report"); return buildCorpusReport({} as any); }\n',
    ],
    [
      "re-export",
      'export { buildCorpusReport } from "../../scripts/corpus/report";\n',
    ],
  ])(
    "the partition-safe ownership boundary rejects %s",
    (_name, source) => {
      expect(
        measurementBoundaryViolations(
          inMemoryProject({ "/src/domain/blend.ts": source }),
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it("the measurement boundary rejects outcomes from the wrong provenance partition", () => {
    expect(() =>
      buildCorpusReport(
        reportInput(
          [
          {
            caseId: "RD-wrong",
            labelKind: "defect",
            flagged: true,
            provenance: "real-derived-fixture",
          },
          ] as any,
        ),
      ),
    ).toThrow("received 1 outcome(s) from another provenance partition");
  });

  it("the report CLI can import only the string-rendering boundary", () => {
    expect(
      measurementBoundaryViolations(
        inMemoryProject({
          "/scripts/corpus-report.ts":
            'import { renderCorpusReport } from "./corpus/report";\nexport const output = renderCorpusReport({} as any);\n',
        }),
      ),
    ).toEqual([]);
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
  });

  it("a real-derived case with a free-text field in an UNANTICIPATED key is rejected (fail-closed)", () => {
    const problems = realDerivedCaseProblems(
      realDerivedCase({ advisorNote: "call the client back about the wire" }),
      classes,
      "real-derived/RD-extra.json",
    );
    expect(problems.length).toBeGreaterThan(0);
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
});
