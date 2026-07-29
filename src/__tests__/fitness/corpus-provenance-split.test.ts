import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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
  taxonomySemanticDigest,
} from "../../../scripts/corpus/manifest";
import {
  buildCorpusReport,
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

const PARTITION_ACCESSORS = ["synthetic", "realDerived"] as const;

export function blendingViolations(project: Project, root = ""): string[] {
  const violations: string[] = [];
  type TrackedSymbol = NonNullable<ReturnType<Node["getSymbol"]>>;
  const directReads = (text: string): Set<string> =>
    new Set(
      PARTITION_ACCESSORS.filter(
        (accessor) =>
          new RegExp(`\\.${accessor}\\b`).test(text) ||
          new RegExp(`\\b${accessor}(Outcomes|PartitionReport)\\b`).test(text),
      ),
    );
  const symbolReads = (symbol: TrackedSymbol): Set<string> => {
    try {
      const aliased = symbol.getAliasedSymbol();
      if (aliased !== undefined) {
        return directReads(
          aliased.getDeclarations().map((declaration) => declaration.getText()).join("\n"),
        );
      }
    } catch {
      return new Set();
    }
    return new Set();
  };
  for (const sf of project.getSourceFiles()) {
    const taints = new Map<TrackedSymbol, Set<string>>();
    for (let pass = 0; pass < 8; pass += 1) {
      let changed = false;
      for (const declaration of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const symbol = declaration.getNameNode().getSymbol();
        const initializer = declaration.getInitializer();
        if (initializer === undefined || symbol === undefined) continue;
        if (
          Node.isCallExpression(initializer) &&
          initializer.getExpression().getText() === "buildCorpusReport"
        ) {
          continue;
        }
        const reads = directReads(initializer.getText());
        for (const identifier of initializer.getDescendantsOfKind(SyntaxKind.Identifier)) {
          const referenced = identifier.getSymbol();
          if (referenced === undefined) continue;
          for (const accessor of symbolReads(referenced)) reads.add(accessor);
          for (const accessor of taints.get(referenced) ?? []) reads.add(accessor);
        }
        const before = taints.get(symbol);
        if (reads.size > 0 && (before === undefined || [...reads].some((entry) => !before.has(entry)))) {
          taints.set(symbol, new Set([...(before ?? []), ...reads]));
          changed = true;
        }
      }
      if (!changed) break;
    }
    const candidates: Node[] = [
      ...sf.getDescendantsOfKind(SyntaxKind.BinaryExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.CallExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.NewExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.TemplateExpression),
    ];
    for (const expression of candidates) {
      if (
        Node.isCallExpression(expression) &&
        expression.getExpression().getText() === "buildCorpusReport"
      ) {
        continue;
      }
      const reads = directReads(expression.getText());
      for (const identifier of expression.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const referenced = identifier.getSymbol();
        if (referenced === undefined) continue;
        for (const accessor of symbolReads(referenced)) reads.add(accessor);
        for (const accessor of taints.get(referenced) ?? []) reads.add(accessor);
      }
      if (PARTITION_ACCESSORS.every((accessor) => reads.has(accessor))) {
        violations.push(
          `${sf.getFilePath().replace(root, "")}:${expression.getStartLineNumber()}: combines the synthetic and real-derived partitions into one figure`,
        );
      }
    }
  }
  return violations;
}

/**
 * (f) Agents never sign. A signature is ORIGINATED when a signature field is
 * given a literal value in source; PARSING one out of the hand-owned signoff
 * file (`signedBy: asStringOrNull(data.signedBy)`) is reading, not signing, and
 * stays legal. That distinction is why this is an AST rule over initializers
 * rather than a grep for the field name.
 */
const SIGNATURE_FIELDS = ["signedBy", "signedAt", "signedDigest"];

export function agentSignatureViolations(project: Project, root = ""): string[] {
  const violations: string[] = [];
  const isLiteral = (node: Node): boolean =>
    Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isTemplateExpression(node);
  for (const sf of project.getSourceFiles()) {
    for (const property of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
      const name = property.getName().replace(/["']/g, "");
      const initializer = property.getInitializer();
      if (!SIGNATURE_FIELDS.includes(name) || initializer === undefined) continue;
      if (!isLiteral(initializer)) continue;
      violations.push(
        `${sf.getFilePath().replace(root, "")}:${property.getStartLineNumber()}: originates ${name} - agents never sign the corpus`,
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

/** Corpus-owning code only. `signedAt` is a generic field name (the e-sign load
 * harness uses it too), so the signature rule is scoped to the code that owns
 * the corpus rather than flagging every module that happens to share a word. */
const corpusProject = (): Project =>
  projectOf((file) => /scripts[/\\]corpus([/\\]|-)/.test(file));

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
  subjects: [OPAQUE],
  evidence: [
    {
      id: "evs:tok:0123456789abcdef:balance",
      evidenceKind: "balance",
      subjectRef: OPAQUE,
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

  it("(c) enforces: no code in src/ or scripts/ blends the two provenance partitions", () => {
    const violations = blendingViolations(measuredCodeProject(), REPO_ROOT);
    expect(violations, `blended provenance figures:\n${violations.join("\n")}`).toEqual([]);
  });

  it("(c) enforces: the report type has no aggregate key and the two figures have different names", () => {
    const report = buildCorpusReport({
      corpusVersion: "x",
      corpusDigest: "y",
      signoffStatus: "signed",
      signed: true,
      syntheticOutcomes: outcomes(2, 1, true),
      realDerivedOutcomes: [],
    });
    for (const banned of ["overall", "blended", "combined", "total", "all", "rate"]) {
      expect(Object.keys(report)).not.toContain(banned);
    }
    expect(Object.keys(report.synthetic)).toContain("syntheticDefectCoverage");
    expect(Object.keys(report.synthetic)).not.toContain("detectionRate");
    expect(Object.keys(report.realDerived)).toContain("detectionRate");
    expect(Object.keys(report.realDerived)).not.toContain("syntheticDefectCoverage");
  });

  it("(d) enforces: with an empty real-derived partition the reporter withholds detectionRate", () => {
    const report = buildCorpusReport({
      corpusVersion: real.spec.world.corpusVersion,
      corpusDigest: real.corpusDigest,
      signoffStatus: "signed",
      signed: true,
      syntheticOutcomes: outcomes(3, 2, true),
      realDerivedOutcomes: [],
    });
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
    expect(realDerivedProblems(real.taxonomy)).toEqual([]);
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

  it("(f) enforces: no corpus code path originates a signature", () => {
    const project = corpusProject();
    expect(project.getSourceFiles().length, "the signature scan must cover a non-empty corpus tree").toBeGreaterThanOrEqual(10);
    const violations = agentSignatureViolations(project, REPO_ROOT);
    expect(violations, `agent-authored signatures:\n${violations.join("\n")}`).toEqual([]);
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

    const world = structuredClone(real.spec.world);
    world.modelAssignments.push(structuredClone(world.modelAssignments[0]!));
    expect(
      specReferenceProblems(world, real.spec.cases).some((problem) =>
        problem.includes('modelAssignments: duplicate key "smiths-joint-model"'),
      ),
    ).toBe(true);
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
    const report = buildCorpusReport({
      corpusVersion: "x",
      corpusDigest: "y",
      signoffStatus: "signed",
      signed: true,
      syntheticOutcomes: outcomes(2, 1, true),
      realDerivedOutcomes: [
        { caseId: "RD-a", labelKind: "defect", flagged: true, provenance: "real-derived-fixture" },
        { caseId: "RD-b", labelKind: "defect", flagged: false, provenance: "real-derived-fixture" },
        { caseId: "RD-c", labelKind: "clean-control", flagged: false, provenance: "real-derived-fixture" },
      ],
    });
    expect(report.realDerived.detectionRate).toEqual({ value: 0.5, reasonCode: null });
    expect(report.realDerived.falsePositiveRate).toEqual({ value: 0, reasonCode: null });
    expect(report.realDerived.interpretable).toBe(true);
  });

  it("a detector that flags EVERYTHING cannot claim success: 1.0 coverage arrives with 1.0 false positives", () => {
    const report = buildCorpusReport({
      corpusVersion: "x",
      corpusDigest: "y",
      signoffStatus: "signed",
      signed: true,
      syntheticOutcomes: outcomes(5, 5, true),
      realDerivedOutcomes: [],
    });
    expect(report.synthetic.syntheticDefectCoverage.value).toBe(1);
    expect(report.synthetic.falsePositiveRate.value).toBe(1);
  });

  it("an unsigned corpus and an unevaluated corpus both withhold every figure with a reason code", () => {
    const unsigned = buildCorpusReport({
      corpusVersion: "x", corpusDigest: "y", signoffStatus: "pending-captain", signed: false,
      syntheticOutcomes: outcomes(5, 5, true), realDerivedOutcomes: [],
    });
    expect(unsigned.synthetic.syntheticDefectCoverage).toEqual({ value: null, reasonCode: "corpus-signoff-pending" });
    const unevaluated = buildCorpusReport({
      corpusVersion: "x", corpusDigest: "y", signoffStatus: "signed", signed: true,
      syntheticOutcomes: outcomes(5, 5, null), realDerivedOutcomes: [],
    });
    expect(unevaluated.synthetic.syntheticDefectCoverage).toEqual({ value: null, reasonCode: "detector-outcomes-absent" });
  });

  it("a partially evaluated corpus withholds both figures instead of reporting the favorable subset", () => {
    const partial = outcomes(2, 2, null);
    partial[0] = { ...partial[0]!, flagged: true };
    partial[2] = { ...partial[2]!, flagged: false };
    const report = buildCorpusReport({
      corpusVersion: "x",
      corpusDigest: "y",
      signoffStatus: "signed",
      signed: true,
      syntheticOutcomes: partial,
      realDerivedOutcomes: [],
    });
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

  it("coverage measured with NO clean controls is marked uninterpretable", () => {
    const report = buildCorpusReport({
      corpusVersion: "x", corpusDigest: "y", signoffStatus: "signed", signed: true,
      syntheticOutcomes: outcomes(4, 0, true), realDerivedOutcomes: [],
    });
    expect(report.synthetic.syntheticDefectCoverage.value).toBe(1);
    expect(report.synthetic.falsePositiveRate).toEqual({ value: null, reasonCode: "no-clean-controls" });
    expect(report.synthetic.interpretable).toBe(false);
  });

  it("a blending function is caught by the AST rule", () => {
    const violations = blendingViolations(
      inMemoryProject({
        "/src/contracts/blend.ts":
          "declare const r: any;\nexport const overall = r.synthetic.defectCases + r.realDerived.defectCases;\n",
      }),
    );
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("combines the synthetic and real-derived partitions");
  });

  it.each([
    [
      "division",
      "declare const r: any;\nexport const overall = r.synthetic.defectCases / r.realDerived.defectCases;\n",
    ],
    [
      "reducer",
      "declare const r: any;\nexport const overall = [r.synthetic.defectCases, r.realDerived.defectCases].reduce((a, b) => a + b, 0);\n",
    ],
    [
      "helper aliases",
      "declare const r: any; declare const combine: (...n: number[]) => number;\nconst s = r.synthetic.defectCases; const d = r.realDerived.defectCases;\nexport const overall = combine(s, d);\n",
    ],
    [
      "array concatenation",
      "declare const r: any;\nexport const overall = [r.synthetic.defectCases].concat([r.realDerived.defectCases]);\n",
    ],
  ])("the blending detector catches %s in product source", (_name, source) => {
    expect(blendingViolations(inMemoryProject({ "/src/domain/blend.ts": source })).length).toBeGreaterThan(0);
  });

  it("the blending detector follows partition values through imported aliases", () => {
    const project = inMemoryProject({
      "/src/domain/synthetic.ts":
        "declare const r: any;\nexport const value = r.synthetic.defectCases;\n",
      "/src/domain/real.ts":
        "declare const r: any;\nexport const value = r.realDerived.defectCases;\n",
      "/src/domain/blend.ts":
        'import { value as left } from "./synthetic";\nimport { value as right } from "./real";\nexport const total = left + right;\n',
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("the measurement boundary rejects outcomes from the wrong provenance partition", () => {
    expect(() =>
      buildCorpusReport({
        corpusVersion: "x",
        corpusDigest: "y",
        signoffStatus: "signed",
        signed: true,
        syntheticOutcomes: [
          {
            caseId: "RD-wrong",
            labelKind: "defect",
            flagged: true,
            provenance: "real-derived-fixture",
          },
        ] as any,
        realDerivedOutcomes: [],
      }),
    ).toThrow("received 1 outcome(s) from another provenance partition");
  });

  it("the blending rule does NOT flag arithmetic inside one partition", () => {
    expect(
      blendingViolations(
        inMemoryProject({
          "/src/contracts/ok.ts": "declare const r: any;\nexport const n = r.synthetic.defectCases + r.synthetic.cleanControls;\n",
        }),
      ),
    ).toEqual([]);
  });

  it("a code path ORIGINATING a signature is caught; null and a parsed read are allowed", () => {
    expect(
      agentSignatureViolations(
        inMemoryProject({
          "/src/contracts/sign.ts":
            'export const s = { signedBy: "captain", signedAt: "2026-07-28", signedDigest: `${"a".repeat(64)}` };\n',
        }),
      ).length,
    ).toBe(3);
    expect(
      agentSignatureViolations(
        inMemoryProject({
          "/src/contracts/sign.ts":
            "declare const read: (k: string) => string | null;\nexport const s = { signedBy: null, signedAt: read('signedAt') };\n",
        }),
      ),
    ).toEqual([]);
  });

  it("a VALID real-derived case is accepted (the intake contract is not a blanket reject)", () => {
    expect(realDerivedCaseProblems(realDerivedCase(), classes, "real-derived/RD-ok.json")).toEqual([]);
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
