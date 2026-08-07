import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  corpusDigest,
  currentAuthorityBindings,
  taxonomySemanticDigest,
} from "../../../scripts/corpus/manifest";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import {
  REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES,
  REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
  REAL_DERIVED_GENERAL_PURPOSE_DEPENDENCIES,
  realDerivedSemanticContractBinding,
} from "../../../scripts/corpus/semantic-contract";
import {
  committedBytesProblems,
  readCommittedCorpus,
} from "../../../scripts/corpus/validate";
import {
  authorityClosureProblems,
  requiredGatewayRootProblems,
} from "./_corpus-authority-closure";
import { semanticContract } from "./_corpus-case-fixtures";
import { real } from "./_corpus-world";
import {
  REPO_ROOT,
  toolingSourceFiles,
} from "./_fence-utils";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - the executable authority closure:
 * the declared inventory, its general-purpose exclusions, and the signoff the
 * bound semantics invalidate when they change.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("the signed manifest binds the executable real-derived semantic contract", () => {
    const manifest = real.manifest.value as Record<string, unknown>;
    expect(manifest.realDerivedSemanticContractVersion).toBe(
      "verin-real-derived-semantics/1.13.0",
    );
    expect(manifest.realDerivedSemanticContractDigest).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(
      readFileSync(
        join(REPO_ROOT, "fixtures/corpus/spec/SIGNOFF.md"),
        "utf8",
      ),
    ).toContain(
      `It binds \`${semanticContract.contractVersion}\``,
    );
    expect(
      (
        manifest.realDerivedSemanticContractAuthorities as Array<{
          file: string;
        }>
      ).map((entry) => entry.file),
    ).toEqual(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES);
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/pending-actions.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/real-derived-policy.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/evidence-observation.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/selected-funding.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/world-topology.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/real-derived-topology.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/synthetic-semantics.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/synthetic-identity.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/case-spec.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/world.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/graph.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/report.ts",
    );
  });

  it("the bound authority is EXACTLY the declared list, and the exclusions are general-purpose only", () => {
    const bound: readonly string[] = REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES;
    const excluded: readonly string[] = REAL_DERIVED_GENERAL_PURPOSE_DEPENDENCIES;
    // What the manifest publishes, what the digest is taken over, and what is
    // declared here are one list - not three that happen to agree today. The
    // resolved binding is also proven equal to a fresh one, so reusing it
    // instead of re-hashing ~40 files per report test substitutes nothing.
    expect(real.authority).toEqual(currentAuthorityBindings());
    expect(
      real.authority.semanticContract.executableAuthorities.map(
        (entry) => entry.file,
      ),
    ).toEqual(bound);
    expect(new Set(bound).size).toBe(bound.length);
    expect(new Set(excluded).size).toBe(excluded.length);
    expect(bound.filter((file) => excluded.includes(file))).toEqual([]);
    // Every corpus-owned module that carries BEHAVIOUR is bound; the only one
    // left out declares types alone and emits nothing at runtime. The shipped
    // surfaces that join them are named one by one, never swept in by prefix.
    expect(
      toolingSourceFiles(join(REPO_ROOT, "scripts/corpus"))
        .map((file) => relative(REPO_ROOT, file).replace(/\\/g, "/"))
        .filter((file) => !bound.includes(file)),
    ).toEqual(["scripts/corpus/real-derived-types.ts"]);
    expect(bound.filter((file) => !file.startsWith("scripts/corpus/"))).toEqual([
      "scripts/golden-cases.lib.ts",
      "src/contracts/decision-core/normalization.ts",
      "src/contracts/decision-core/serialization.ts",
      "src/contracts/iana-time-zone-links-2026b.json",
      "src/contracts/iana-time-zones-2026b.json",
      "src/contracts/time-zone.ts",
    ]);
    expect(excluded).toEqual([
      "src/contracts/decision-core/actor.ts",
      "src/contracts/decision-core/authority.ts",
      "src/contracts/decision-core/decision.ts",
      "src/contracts/decision-core/execution.ts",
      "src/contracts/decision-core/explanation.ts",
      "src/contracts/decision-core/ids.ts",
      "src/contracts/decision-core/trigger.ts",
      "src/contracts/errors.ts",
      "src/contracts/result.ts",
    ]);
  });

  it("the executable authority inventory plus its declared exclusions equal the complete runtime closure", () => {
    expect(
      requiredGatewayRootProblems(
        REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
      ),
    ).toEqual([]);
    expect(requiredGatewayRootProblems(["scripts/corpus/semantic-contract.ts"]))
      .toEqual([
        "missing executable authority gateway root scripts/corpus/real-derived.ts",
        "missing executable authority gateway root scripts/corpus/validate.ts",
      ]);
    const declared = [
      ...REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES,
      ...REAL_DERIVED_GENERAL_PURPOSE_DEPENDENCIES,
    ];
    expect(
      authorityClosureProblems(
        REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
        declared,
      ),
    ).toEqual([]);
    // A new runtime dependency is a REVIEW DECISION, not a silent omission: it
    // fails here until it is classified into one of the two lists.
    expect(
      authorityClosureProblems(
        REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
        declared.filter((file) => file !== "scripts/corpus/clock.ts"),
      ),
    ).toContain(
      "missing executable authority dependency scripts/corpus/clock.ts",
    );
    expect(
      authorityClosureProblems(
        REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
        declared.filter((file) => file !== "src/contracts/result.ts"),
      ),
    ).toContain(
      "missing executable authority dependency src/contracts/result.ts",
    );
    expect(REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES).toContain(
      "scripts/corpus/subgraph.ts",
    );
  }, 30_000);

  it("the executable authority closure follows import-equals and refuses indirect loaders", () => {
    const root = REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES[0];
    const importEqualsProblems = authorityClosureProblems(
      [root],
      [root],
      {
        [root]:
          'import Probe = require("./conflict-keys");\nvoid Probe;',
      },
    );
    expect(importEqualsProblems).toContain(
      "missing executable authority dependency scripts/corpus/conflict-keys.ts",
    );

    for (const probe of [
      `import { createRequire as makeProbeRequire } from "node:module";\nconst probeRequire = makeProbeRequire(import.meta.url);\nprobeRequire("./conflict-keys");`,
      `const probeRequire = require;\nprobeRequire("./conflict-keys");`,
      `module.require("./conflict-keys");`,
    ]) {
      expect(
        authorityClosureProblems(
          [root],
          [root],
          { [root]: probe },
        ).some((problem) =>
          problem.includes("indirect or non-literal runtime dependency")
        ),
      ).toBe(true);
    }
  });

  it("semantic data or executable authority changes invalidate corpus signoff", () => {
    const dataFile = join(
      REPO_ROOT,
      "fixtures/corpus/spec/real-derived-semantic-contract.json",
    );
    const dataBytes = readFileSync(dataFile, "utf8");
    const authorityBytes = Object.fromEntries(
      REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES.map((file) => [
        file,
        readFileSync(join(REPO_ROOT, file), "utf8"),
      ]),
    );
    const original = realDerivedSemanticContractBinding(
      dataBytes,
      authorityBytes,
    );
    const changedData = realDerivedSemanticContractBinding(
      dataBytes.replace(
        '"authority-boundary"',
        '"authority-boundary-v2"',
      ),
      authorityBytes,
    );
    const changedAuthority = realDerivedSemanticContractBinding(
      dataBytes,
      {
        ...authorityBytes,
        [REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES[0]]:
          `${authorityBytes[REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES[0]]}\n`,
      },
    );
    expect(changedData.digest).not.toBe(original.digest);
    expect(changedAuthority.digest).not.toBe(original.digest);
    expect(
      corpusDigest(
        real.spec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(real.taxonomy),
        real.inventory,
        { ...real.authority, semanticContract: changedAuthority },
      ),
    ).not.toBe(real.corpusDigest);
    // BOTH bound shipped surfaces, not just the first corpus module: the digest
    // moves for the canonical-bytes authority and for the recorded time-zone
    // registry the same way it moves for corpus-owned semantics.
    for (const file of [
      "src/contracts/decision-core/serialization.ts",
      "src/contracts/decision-core/normalization.ts",
      "src/contracts/time-zone.ts",
      "src/contracts/iana-time-zones-2026b.json",
      "scripts/golden-cases.lib.ts",
    ]) {
      expect(
        realDerivedSemanticContractBinding(dataBytes, {
          ...authorityBytes,
          [file]: `${authorityBytes[file]}\n`,
        }).digest,
      ).not.toBe(original.digest);
    }
  });

  it("a change outside the bound set leaves the signature still, and an output-affecting one still fails the byte gate", () => {
    const dataBytes = readFileSync(
      join(REPO_ROOT, "fixtures/corpus/spec/real-derived-semantic-contract.json"),
      "utf8",
    );
    const authorityBytes = Object.fromEntries(
      REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES.map((file) => [
        file,
        readFileSync(join(REPO_ROOT, file), "utf8"),
      ]),
    );
    // The excluded contracts are not in the preimage at all, so editing one
    // cannot invalidate a signature over corpus bytes that did not change.
    const bound: readonly string[] = REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES;
    const unchanged = realDerivedSemanticContractBinding(
      dataBytes,
      authorityBytes,
    ).digest;
    for (const file of REAL_DERIVED_GENERAL_PURPOSE_DEPENDENCIES) {
      expect(bound).not.toContain(file);
      expect(
        realDerivedSemanticContractBinding(dataBytes, {
          ...authorityBytes,
          [file]: "// an unrelated edit\n",
        }).digest,
      ).toBe(unchanged);
    }
    // That is safe only because the blocking gate is byte equality over the
    // REGENERATED tree: whatever moved the output - bound, excluded, or neither
    // - the committed corpus stops matching and the `corpus` job fails.
    const committed = readCommittedCorpus();
    const drifted = real.generated.map((file, index) =>
      index === 0 ? { ...file, bytes: `${file.bytes} ` } : file,
    );
    expect(
      committedBytesProblems([...drifted, real.manifest], committed).join("\n"),
    ).toContain("committed bytes differ from regeneration");
    expect(
      committedBytesProblems([...real.generated, real.manifest], committed),
    ).toEqual([]);
  });
});
