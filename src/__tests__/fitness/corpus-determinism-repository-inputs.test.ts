import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTaxonomy } from "../../../scripts/corpus/defects";
import { loadSignoff } from "../../../scripts/corpus/signoff";
import { readRepositoryFile } from "../../../scripts/corpus/tree";
import { generatorProject } from "./_corpus-determinism-fixtures";
import { bannedNondeterminismUses } from "./_corpus-nondeterminism-scan";
import { CORPUS_SRC } from "./_corpus-repository-inputs";
import { REPO_ROOT } from "./_fence-utils";

/**
 * CORPUS-DETERMINISM FENCE companions - the approved repository-input
 * boundaries: an external root, a redirectable alias, and symlinks whose target
 * leaves the repository are all refused (see corpus-determinism.test.ts for the
 * full statement of the five properties).
 */

describe("detects (companion): a non-deterministic generator or a drifted corpus CANNOT pass", () => {

  it("rejects approved repository loaders called with external roots", () => {
    const project = generatorProject();
    project.createSourceFile(
      join(CORPUS_SRC, "external-root-probe.ts"),
      'import { loadSpec } from "./world";\nexport const external = loadSpec("/tmp/external-corpus");\n',
    );
    project.createSourceFile(
      join(CORPUS_SRC, "shadowed-path-probe.ts"),
      'import { loadSpec, REPO_ROOT } from "./world";\nconst join = (_root: string) => "/tmp/external-corpus";\nexport const external = loadSpec(join(REPO_ROOT));\n',
    );
    project.createSourceFile(
      join(CORPUS_SRC, "traversal-root-probe.ts"),
      'import { resolve } from "node:path";\nimport { loadSpec, REPO_ROOT } from "./world";\nexport const external = loadSpec(resolve(REPO_ROOT, ".."));\n',
    );
    project.createSourceFile(
      join(CORPUS_SRC, "forwarded-root-probe.ts"),
      'import { loadSpec } from "./world";\nconst load = (root: string) => loadSpec(root);\nexport const external = load("/tmp/external-corpus");\n',
    );
    expect(
      bannedNondeterminismUses(project, REPO_ROOT).filter(
        (use) => use.api === "repository input outside REPO_ROOT",
      ),
    ).toHaveLength(4);
  });

  it("rejects a mutable alias that can redirect an approved repository loader", () => {
    const project = generatorProject();
    project.createSourceFile(
      join(CORPUS_SRC, "mutable-root-probe.ts"),
      'import { loadSpec, REPO_ROOT } from "./world";\nlet dir = REPO_ROOT;\ndir = "/tmp/external-corpus";\nexport const external = loadSpec(dir);\n',
    );
    expect(
      bannedNondeterminismUses(project, REPO_ROOT).some(
        (use) => use.api === "repository input outside REPO_ROOT",
      ),
    ).toBe(true);
  });

  const PENDING_SIGNOFF_BYTES =
    "```yaml\ncorpusVersion: 2026.07.0\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null\n```\n";

  // The proof roots live in the OS temp tree, never inside this repository.
  // Containment is a property of the root a read is made against, so planting
  // the fixtures here would buy nothing - and a transient directory under
  // REPO_ROOT races every fence that walks the repository (`no-secret-fallback`
  // reads every committed text file), which is a flake this suite would then
  // have to hide behind serial execution.
  const proofRepository = (): { root: string; spec: string } => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-input-proof-"));
    const spec = join(root, "spec");
    mkdirSync(spec);
    return { root, spec };
  };

  it("repository readers reject symlinked files whose target leaves the repository root", () => {
    const externalDir = mkdtempSync(join(tmpdir(), "verin-corpus-external-"));
    const { root, spec } = proofRepository();
    try {
      const externalSignoff = join(externalDir, "SIGNOFF.md");
      writeFileSync(externalSignoff, PENDING_SIGNOFF_BYTES);
      symlinkSync(externalSignoff, join(spec, "SIGNOFF.md"));
      expect(() => loadSignoff(spec, root)).toThrow(
        /"[^"]*SIGNOFF\.md" resolves outside this repository/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  // A refusal that names neither the input nor the reason is unusable in the
  // blocking `corpus` job, and "reject every symlink" is not the containment
  // rule - the canonical target is what is checked and what is read.
  it("repository readers name the missing input and accept an in-repository symlink", () => {
    const { root, spec } = proofRepository();
    try {
      expect(() => loadSignoff(spec, root)).toThrow(
        /"[^"]*SIGNOFF\.md" does not exist/,
      );
      const target = join(spec, "signoff-source.md");
      writeFileSync(target, PENDING_SIGNOFF_BYTES);
      symlinkSync(target, join(spec, "SIGNOFF.md"));
      expect(loadSignoff(spec, root).status).toBe("pending-captain");
      rmSync(join(spec, "SIGNOFF.md"));
      mkdirSync(join(spec, "SIGNOFF.md"));
      expect(() => loadSignoff(spec, root)).toThrow(
        /"[^"]*SIGNOFF\.md" is not a regular file/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The ROOT is an input too. An unresolvable one used to escape the reader's
  // naming rule entirely, and a repository reached through a symlinked root
  // named every file by absolute path - the exact case naming exists to fix.
  it("repository readers name an unresolvable root and stay repo-relative under a symlinked one", () => {
    const externalDir = mkdtempSync(join(tmpdir(), "verin-corpus-root-proof-"));
    const localDir = proofRepository().root;
    try {
      expect(() => loadTaxonomy(localDir, join(externalDir, "absent-root"))).toThrow(
        /repository root "[^"]*absent-root" does not exist/,
      );
      const linkedRoot = join(externalDir, "linked-root");
      symlinkSync(realpathSync(localDir), linkedRoot);
      expect(() =>
        readRepositoryFile(join(realpathSync(localDir), "absent-input.md"), linkedRoot),
      ).toThrow(/repository input "absent-input\.md" does not exist/);
    } finally {
      rmSync(localDir, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });
});
