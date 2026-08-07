import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  generatorDigest,
  REAL_DERIVED_SCHEMA_FILES,
} from "../../../scripts/corpus/manifest";
import {
  deriveRealDerivedFreshness,
  evidenceKindVocabularyProblems,
  REAL_DERIVED_FRESHNESS_POLICY,
  type RealDerivedEvidenceKind,
} from "../../../scripts/corpus/real-derived-policy";
import {
  canonicalIntakeFilenameRule,
  canonicalIntakePath,
  caseSchemaVocabularyProblems,
  intakeCaseIdPattern,
  isCanonicalIntakePath,
} from "../../../scripts/corpus/scrub-contract";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import { SIGNOFF_FILE } from "../../../scripts/corpus/signoff";
import { parseStrictJson } from "../../../scripts/corpus/strict-json";
import { readTree, UNTRACKABLE_ENTRY_NAMES } from "../../../scripts/corpus/tree";
import {
  corpusRootInventoryProblems,
  readCommittedCorpus,
  specCoverageProblems,
} from "../../../scripts/corpus/validate";
import {
  SPEC_DIR,
  SPEC_FILES,
} from "../../../scripts/corpus/world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - the bound vocabularies: the intake
 * schema's evidence kinds against the executable freshness authority, the
 * accounted-for corpus root, and the hand-owned spec inputs behind the digest.
 */

describe("detects (companion): an unbound vocabulary, an unbound spec input, or an unbound digest preimage CANNOT pass", () => {
  const caseSchema = () =>
    parseStrictJson(
      readFileSync(join(SPEC_DIR, "real-derived-case-schema.json"), "utf8"),
      "real-derived-case-schema.json",
    ) as Record<string, any>;

  it("the canonical intake filename is READ FROM the schema caseId pattern, and an unbound pattern refuses every delivery", () => {
    expect(intakeCaseIdPattern(caseSchema())).not.toBeNull();
    expect(canonicalIntakePath("RD-00112233445566aa")).toBe(
      "real-derived/RD-00112233445566aa.json",
    );
    expect(isCanonicalIntakePath(canonicalIntakePath("RD-00112233445566aa"))).toBe(true);
    expect(isCanonicalIntakePath("real-derived/nested/RD-00112233445566aa.json")).toBe(false);
    expect(isCanonicalIntakePath("real-derived/RD-00112233445566AA.json")).toBe(false);
    // A pattern that is absent, mistyped, unanchored or unparseable binds NO
    // filename rule - it must not degrade into "everything is canonical".
    for (const pattern of [undefined, 42, "RD-[0-9a-f]{16}", "^RD-[0-9a-f]{16}", "^RD-[0-9a-f{16}$"]) {
      expect(intakeCaseIdPattern({ properties: { caseId: { pattern } } })).toBeNull();
    }
    expect(intakeCaseIdPattern({})).toBeNull();
    expect(isCanonicalIntakePath("real-derived/RD-00112233445566aa.json", null)).toBe(false);
    // The refusal an operator READS moves with the rule the predicate tests: a
    // different bound pattern renames the file intake asks for, and an unbound
    // one names the schema that failed to mint it rather than a stale shape.
    expect(canonicalIntakeFilenameRule()).toBe(
      `filename must be ${canonicalIntakePath(
        (caseSchema().properties.caseId.pattern as string).slice(1, -1),
      )}`,
    );
    expect(canonicalIntakeFilenameRule(/^RX-[0-9a-f]{8}$/)).toBe(
      "filename must be real-derived/RX-[0-9a-f]{8}.json",
    );
    expect(canonicalIntakeFilenameRule(null)).toContain("real-derived-case-schema.json");
    expect(caseSchemaVocabularyProblems()).toEqual([]);
  });

  it("an evidence kind the schema admits but no window covers is named, not defaulted", () => {
    const schema = caseSchema();
    schema.$defs.evidenceKind.enum = [
      ...schema.$defs.evidenceKind.enum,
      "custodian-memo",
    ];
    expect(
      evidenceKindVocabularyProblems(schema, "case-schema").join("\n"),
    ).toContain('evidence kind "custodian-memo" has no executable freshness authority');
  });

  it("an executable kind the schema no longer admits is named", () => {
    const schema = caseSchema();
    schema.$defs.evidenceKind.enum = schema.$defs.evidenceKind.enum.filter(
      (kind: string) => kind !== "balance",
    );
    expect(
      evidenceKindVocabularyProblems(schema, "case-schema").join("\n"),
    ).toContain('executable evidence kind "balance" is not admitted by the schema');
  });

  it("a repeated kind and a missing enum are both named instead of passing vacuously", () => {
    const repeated = caseSchema();
    repeated.$defs.evidenceKind.enum = [
      ...repeated.$defs.evidenceKind.enum,
      "balance",
    ];
    expect(
      evidenceKindVocabularyProblems(repeated, "case-schema").join("\n"),
    ).toContain("$defs/evidenceKind repeats a kind");
    for (const shape of [{}, { $defs: {} }, { $defs: { evidenceKind: {} } }]) {
      expect(
        evidenceKindVocabularyProblems(shape, "case-schema"),
      ).toEqual([
        "case-schema: $defs/evidenceKind declares no enum to bind evidence freshness to",
      ]);
    }
  });

  it("deriving freshness for a kind outside the committed windows REFUSES rather than reading fresh", () => {
    const stale = "2020-01-01T00:00:00.000Z";
    const asOf = "2026-04-28T13:00:00.000Z";
    expect(
      deriveRealDerivedFreshness(
        REAL_DERIVED_FRESHNESS_POLICY.version,
        "balance",
        asOf,
        stale,
      ),
    ).toBe("stale");
    for (const observedAt of [stale, null]) {
      expect(() =>
        deriveRealDerivedFreshness(
          REAL_DERIVED_FRESHNESS_POLICY.version,
          "custodian-memo" as RealDerivedEvidenceKind,
          asOf,
          observedAt,
        ),
      ).toThrow('unsupported freshness evidence kind "custodian-memo"');
    }
  });

  it("deriving freshness from a non-canonical instant REFUSES rather than reading fresh", () => {
    const asOf = "2026-04-28T13:00:00.000Z";
    // `garbage.123Z` satisfies the schema's instant PATTERN, so nothing upstream
    // of this call is guaranteed to have rejected it. A subtraction over an
    // unparseable instant is `NaN`, and `NaN > window` is false - evidence of
    // unknown age would read "fresh" in a fail-closed intake path.
    for (const [decided, observed] of [
      ["garbage.123Z", asOf],
      [asOf, "garbage.123Z"],
      [asOf, "2026-04-28T13:00:00Z"],
    ] as const) {
      expect(() =>
        deriveRealDerivedFreshness(
          REAL_DERIVED_FRESHNESS_POLICY.version,
          "balance",
          decided,
          observed,
        ),
      ).toThrow("is not canonical UTC");
    }
    expect(
      deriveRealDerivedFreshness(
        REAL_DERIVED_FRESHNESS_POLICY.version,
        "balance",
        asOf,
        "2026-04-28T12:00:00.000Z",
      ),
    ).toBe("fresh");
  });

  it("a corpus-root file outside every accounted-for bucket is named, not silently ignored", () => {
    const accounted = [
      { relPath: "README.md", kind: "file", bytes: "docs\n" },
      { relPath: "manifest.json", kind: "file", bytes: "{}\n" },
      { relPath: "spec/world.json", kind: "file", bytes: "{}\n" },
      { relPath: "synthetic/CS-a.json", kind: "file", bytes: "{}\n" },
      { relPath: "real-derived/README.md", kind: "file", bytes: "intake\n" },
    ] as const;
    expect(corpusRootInventoryProblems(accounted)).toEqual([]);
    for (const stray of ["extra/x.json", "notes.md", "manifest.json.bak", "."]) {
      expect(
        corpusRootInventoryProblems([
          ...accounted,
          { relPath: stray, kind: "file", bytes: "{}\n" },
        ]).join("\n"),
        `${stray} was accounted for by nothing and passed anyway`,
      ).toContain(`${stray}: committed corpus entry is outside every accounted-for bucket`);
    }
    expect(
      corpusRootInventoryProblems(
        accounted.filter((entry) => entry.relPath !== "README.md"),
      ).join("\n"),
    ).toContain("README.md: allowlisted corpus documentation is missing");
    expect(
      corpusRootInventoryProblems([
        ...accounted.filter((entry) => entry.relPath !== "README.md"),
        { relPath: "README.md", kind: "unsupported", bytes: null },
      ]).join("\n"),
    ).toContain("README.md: allowlisted corpus documentation must be a regular file");
    // A near-miss prefix must not buy accounting: only the real subtrees count.
    expect(
      corpusRootInventoryProblems([
        ...accounted,
        { relPath: "specimen/x.json", kind: "file", bytes: "{}\n" },
      ]).join("\n"),
    ).toContain("specimen/x.json: committed corpus entry is outside every accounted-for bucket");
  });

  it("an UNTRACKED platform dropping never reaches the inventory, but a force-added one does", () => {
    const repo = mkdtempSync(join(tmpdir(), "verin-corpus-untrackable-"));
    const root = join(repo, "corpus");
    const git = (...args: readonly string[]): void => {
      const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
      expect(run.status, `git ${args.join(" ")} failed: ${run.stderr}`).toBe(0);
    };
    try {
      mkdirSync(join(root, "synthetic"), { recursive: true });
      writeFileSync(join(root, "README.md"), "docs\n");
      writeFileSync(join(root, "manifest.json"), "{}\n");
      writeFileSync(join(root, "synthetic", "CS-a.json"), "{}\n");
      // No repository yet, so git cannot answer: an entry nobody can prove
      // untracked is accounted for rather than assumed away.
      expect(
        spawnSync("git", ["-C", root, "rev-parse", "--git-dir"], { encoding: "utf8" }).status,
        "this case needs a temp directory outside any repository",
      ).not.toBe(0);
      for (const name of UNTRACKABLE_ENTRY_NAMES) {
        writeFileSync(join(root, name), "dropping\n");
        expect(corpusRootInventoryProblems(readTree(root)).join("\n")).toContain(
          `${name}: committed corpus entry is outside every accounted-for bucket`,
        );
        rmSync(join(root, name));
      }
      git("init", "--quiet");
      git("add", "corpus/README.md", "corpus/manifest.json", "corpus/synthetic/CS-a.json");
      for (const name of UNTRACKABLE_ENTRY_NAMES) {
        writeFileSync(join(root, name), "dropping\n");
        writeFileSync(join(root, "synthetic", name), "dropping\n");
      }
      // Untracked: neither the exact-inventory closure nor the byte-compare may
      // see it - a file browser opening the corpus directory cannot red a
      // blocking gate.
      expect(readTree(root).map((entry) => entry.relPath)).toEqual([
        "README.md",
        "manifest.json",
        "synthetic/CS-a.json",
      ]);
      expect(corpusRootInventoryProblems(readTree(root))).toEqual([]);
      expect(readCommittedCorpus(root).map((file) => file.relPath)).toEqual([
        "manifest.json",
        "synthetic/CS-a.json",
      ]);
      // Force-added: the NAME buys nothing. A tracked dropping is a committed
      // byte no generator emits and no digest binds, so the walk surfaces it and
      // every closure over it fails closed.
      for (const name of UNTRACKABLE_ENTRY_NAMES) {
        git("add", "-f", `corpus/${name}`, `corpus/synthetic/${name}`);
      }
      const surfaced = readTree(root).map((entry) => entry.relPath);
      const inventory = corpusRootInventoryProblems(readTree(root)).join("\n");
      const committed = readCommittedCorpus(root).map((file) => file.relPath);
      for (const name of UNTRACKABLE_ENTRY_NAMES) {
        expect(surfaced, `a tracked "${name}" was dropped from the walk`).toContain(name);
        expect(surfaced).toContain(`synthetic/${name}`);
        expect(inventory, `a tracked "${name}" was accounted for by nothing and passed anyway`)
          .toContain(`${name}: committed corpus entry is outside every accounted-for bucket`);
        expect(committed).toContain(`synthetic/${name}`);
      }
      // Everything git WOULD track still fails closed, tracked or not.
      writeFileSync(join(root, "notes.md"), "stray\n");
      expect(corpusRootInventoryProblems(readTree(root)).join("\n")).toContain(
        "notes.md: committed corpus entry is outside every accounted-for bucket",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("an unregistered hand-owned spec file and a missing digested input are both named", () => {
    const registered = [...SPEC_FILES, ...REAL_DERIVED_SCHEMA_FILES, SIGNOFF_FILE];
    expect(
      specCoverageProblems([...registered, "extra-policy.json"]).join("\n"),
    ).toContain("spec/extra-policy.json: hand-owned corpus input is bound by no digest");
    expect(
      specCoverageProblems(registered.filter((name) => name !== "world.json")).join("\n"),
    ).toContain("spec/world.json: digested corpus input is missing from the committed spec");
    expect(specCoverageProblems(registered)).toEqual([]);
  });

  it("a spec file missing from the generator preimage REFUSES instead of hashing empty bytes", () => {
    const bytes = Object.fromEntries(
      SPEC_FILES.map((name) => [name, `{"file":"${name}"}`]),
    );
    expect(generatorDigest(CORPUS_SEED, bytes)).toMatch(/^[0-9a-f]{64}$/);
    const missing = Object.fromEntries(
      Object.entries(bytes).filter(([name]) => name !== "world.json"),
    );
    expect(() => generatorDigest(CORPUS_SEED, missing)).toThrow(
      "missing corpus spec bytes for world.json",
    );
    expect(generatorDigest(CORPUS_SEED, { ...bytes, "world.json": "{}" })).not.toBe(
      generatorDigest(CORPUS_SEED, bytes),
    );
  });
});
