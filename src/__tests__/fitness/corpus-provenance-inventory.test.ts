import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  taxonomyExerciseProblems,
  taxonomyProblems,
} from "../../../scripts/corpus/defects";
import { evidenceResolutionProblems } from "../../../scripts/corpus/graph";
import {
  buildInventory,
  corpusDigest,
  currentFreshnessPolicyBinding,
  generatedSignatureProblems,
  REAL_DERIVED_SCHEMA_FILES,
  realDerivedSchemaBindings,
  taxonomySemanticDigest,
} from "../../../scripts/corpus/manifest";
import {
  freshnessPolicySemanticDigest,
  REAL_DERIVED_EVIDENCE_KINDS,
  REAL_DERIVED_FRESHNESS_POLICY,
} from "../../../scripts/corpus/real-derived-policy";
import { caseSchemaVocabularyProblems } from "../../../scripts/corpus/intake-filename";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import { SIGNOFF_FILE } from "../../../scripts/corpus/signoff";
import { parseStrictJson } from "../../../scripts/corpus/strict-json";
import { syntheticSemanticProblems } from "../../../scripts/corpus/synthetic-semantics";
import { readTree, UNTRACKABLE_ENTRY_NAMES } from "../../../scripts/corpus/tree";
import {
  cleanControlProblems,
  CORPUS_ROOT_DOCUMENTATION_FILES,
  corpusRootInventoryProblems,
  labelProblems,
  realDerivedProblems,
  specCoverageProblems,
  specEntryNames,
} from "../../../scripts/corpus/validate";
import {
  CORPUS_DIR,
  SPEC_DIR,
  SPEC_FILES,
} from "../../../scripts/corpus/world";
import {
  CORPUS_MANIFEST,
  goldenIds,
  real,
  refs,
  SCENARIOS,
} from "./_corpus-world";
import { REPO_ROOT } from "./_fence-utils";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE - intake inventory, signed digests, and taxonomy
 * exercise (rules (d), (e) and (f); see corpus-provenance-split.test.ts for the
 * full statement of the six rules).
 */

describe("corpus-provenance-split fence", () => {

  it("(d) enforces: the real-derived intake README is a regular file", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-readme-"));
    try {
      const intake = join(root, "real-derived");
      const target = join(root, "intake-contract.md");
      mkdirSync(intake, { recursive: true });
      writeFileSync(target, "intake\n");
      symlinkSync(target, join(intake, "README.md"));
      expect(existsSync(join(intake, "README.md"))).toBe(true);
      expect(
        realDerivedProblems(
          real.taxonomy,
          real.spec.world.corpusVersion,
          intake,
        ).join("\n"),
      ).toContain("real-derived/README.md must be a regular file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("(d) enforces: the real-derived intake root is a regular directory", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-intake-root-"));
    try {
      const target = join(root, "target");
      const intake = join(root, "real-derived");
      mkdirSync(target);
      writeFileSync(join(target, "README.md"), "intake\n");
      symlinkSync(target, intake);
      expect(
        realDerivedProblems(
          real.taxonomy,
          real.spec.world.corpusVersion,
          intake,
        ).join("\n"),
      ).toContain("real-derived intake root must be a regular directory");
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

  it("taxonomy citations must resolve to regular files inside the repository", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-taxonomy-citations-"));
    const repo = join(root, "repo");
    const local = join(repo, "source.md");
    const outside = join(root, "outside.md");
    const escape = join(repo, "escape.md");
    try {
      mkdirSync(repo);
      writeFileSync(local, "local\n");
      writeFileSync(outside, "outside\n");
      symlinkSync(outside, escape);
      const taxonomy = structuredClone(real.taxonomy);
      taxonomy.cleanControlLabel.sourceCitation.file = "source.md";
      for (const entry of taxonomy.defectClasses) {
        entry.sourceCitation.file = "source.md";
      }
      taxonomy.defectClasses[0]!.sourceCitation.file = "escape.md";
      expect(taxonomyProblems(taxonomy, repo).join("\n")).toContain(
        "is not a regular file contained in this repository",
      );
      taxonomy.defectClasses[0]!.sourceCitation.file = "../outside.md";
      expect(taxonomyProblems(taxonomy, repo).join("\n")).toContain(
        "is not a regular file contained in this repository",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
        { ...real.authority, freshnessPolicy: changed },
      ),
    ).not.toBe(real.corpusDigest);
  });

  it("(f) enforces: the intake schema, the freshness windows, and the executable vocabulary are ONE list", () => {
    expect(caseSchemaVocabularyProblems()).toEqual([]);
    expect(Object.keys(REAL_DERIVED_FRESHNESS_POLICY.freshnessWindowDays).sort())
      .toEqual([...REAL_DERIVED_EVIDENCE_KINDS].sort());
    const schemaEnum = (
      parseStrictJson(
        readFileSync(join(SPEC_DIR, "real-derived-case-schema.json"), "utf8"),
        "real-derived-case-schema.json",
      ) as { $defs: { evidenceKind: { enum: string[] } } }
    ).$defs.evidenceKind.enum;
    expect([...schemaEnum].sort()).toEqual([...REAL_DERIVED_EVIDENCE_KINDS].sort());
  });

  it("(f) enforces: every hand-owned spec file is bound by a digest", () => {
    const entries = readTree(SPEC_DIR).map((entry) => entry.relPath);
    expect(specCoverageProblems(entries)).toEqual([]);
    expect(entries.sort()).toEqual(
      [...SPEC_FILES, ...REAL_DERIVED_SCHEMA_FILES, SIGNOFF_FILE].sort(),
    );
    // `validateCorpus` names the spec off the ONE tree walk it already took
    // rather than re-reading the subtree. That projection is held equal to this
    // independent walk, and it selects the spec subtree ALONE - a projection
    // that quietly returned nothing would make an unbound spec file invisible.
    expect(specEntryNames(readTree(CORPUS_DIR)).sort()).toEqual(entries.sort());
    expect(
      specEntryNames([
        { relPath: "spec/world.json", kind: "file", bytes: "{}\n" },
        { relPath: "spec/nested/extra.json", kind: "file", bytes: "{}\n" },
        { relPath: "specious.json", kind: "file", bytes: "{}\n" },
        { relPath: "manifest.json", kind: "file", bytes: "{}\n" },
        { relPath: "synthetic/CS-a.json", kind: "file", bytes: "{}\n" },
      ]),
    ).toEqual(["world.json", "nested/extra.json"]);
  });

  it("(f) enforces: the committed corpus root is an EXACT inventory of accounted-for buckets", () => {
    const entries = readTree(CORPUS_DIR);
    expect(
      corpusRootInventoryProblems(entries),
      "committed corpus entries nothing accounts for",
    ).toEqual([]);
    expect(
      entries
        .filter(
          (entry) =>
            entry.relPath !== "manifest.json" &&
            !/^(real-derived|spec|synthetic)\//.test(entry.relPath),
        )
        .map((entry) => entry.relPath),
    ).toEqual([...CORPUS_ROOT_DOCUMENTATION_FILES]);
    // The inventory refuses COMMITTED entries, so the walk may drop an entry
    // only once git confirms it untracked, and only under a name git refuses to
    // track by default. Held against `.gitignore`: the name list cannot invent
    // an exemption of its own, and trackedness decides the rest.
    const ignoreRules = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    for (const name of UNTRACKABLE_ENTRY_NAMES) {
      expect(
        ignoreRules,
        `"${name}" is dropped from the corpus walk but .gitignore would still track it`,
      ).toContain(name);
    }
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
      "verin-real-derived-case/1.4.0",
      "verin-real-derived-replay/1.11.0",
    ]);
    expect(
      corpusDigest(
        real.spec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(real.taxonomy),
        real.inventory,
        { ...real.authority, realDerivedSchemas: changed },
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

  it.each(
    real.cases
      .filter((item) => item.label.kind === "defect")
      .map((item) => [item.caseId, item.label.defectClassId] as const),
  )("a defect case relabeled as a clean control is caught: %s", (caseId, expected) => {
    const problems = cleanControlProblems(relabeledAsControl(caseId));
    expect(problems.join("\n"), `${caseId} passed as a control`).toContain(expected);
  });

  it("a synthetic defect without its typed treatment mismatch fails closed", () => {
    const defect = structuredClone(
      real.cases.find((item) => item.label.kind === "defect")!,
    );
    const outcome = defect.outcomes.find(
      (candidate) =>
        candidate.defectClassId === defect.label.defectClassId,
    )!;
    outcome.observedTreatment = outcome.expectedTreatment;
    expect(syntheticSemanticProblems([defect]).join("\n")).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );
  });

  it("correctly treated awkward controls stay clean while dangling graph evidence is rejected", () => {
    const awkwardControls = real.cases.filter((item) =>
      [
        "CS-cross-household-signer",
        "CS-trust-owner-and-beneficiary",
      ].includes(item.caseId)
    );
    expect(awkwardControls).toHaveLength(2);
    expect(cleanControlProblems(awkwardControls)).toEqual([]);

    const control = JSON.parse(JSON.stringify(real.cases.find((c) => c.caseId === "CS-clean-fresh-authority"))) as
      (typeof real.cases)[number];
    control.records.authorizedSigners = [];
    expect(
      evidenceResolutionProblems([control]).some((problem) =>
        problem.includes("/evidence.") && problem.includes("resolves to 0")
      ),
    ).toBe(true);
  });
});
