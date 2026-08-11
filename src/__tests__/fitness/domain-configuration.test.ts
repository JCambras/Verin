import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LineCounter, parseDocument, visit } from "yaml";
import { Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT, inMemoryProject, moduleReferences, normalizedPath, realProject, stripComments } from "./_fence-utils";
import { canonicalConfigJson } from "@domain/config/document";
import { loadDomainConfig } from "@domain/config/load";
import { bindDomainConfig, type FirmRegistry } from "@domain/config/bind";

/**
 * DOMAIN-CONFIGURATION FENCE (v3 prompt 10, ADR-0056; the PINNED activation
 * mechanism of v3 invariant 3 - "no core module, directory, or evaluator branch
 * is named for a decision domain").
 *
 * Five machine-enforced rules. The first is the invariant; the rest are what
 * stop it being flipped on a document nobody reads:
 *
 *  RULE A - NO DOMAIN NAME IN DECISION-CORE. The forbidden vocabulary is DERIVED
 *    from `config/domains/*.yaml`'s own `domainConfigId` values (plus their word
 *    variants), so adding a third domain cannot leave the fence stale. Scope is
 *    the decision-core modules, per the captain's `invariant-3-scope` ruling
 *    (2026-07-28): shipped house-CRM record vocabulary, table names, audit
 *    codes, public routes and established observability names stay, on a small
 *    enumerated allow-list justified in ADR-0056. An anti-vacuity companion
 *    proves an EMPTIED vocabulary fails rather than silently passing.
 *
 *  RULE B - BOTH DOCUMENTS LOAD AND BIND THROUGH THE SHARED ENGINE. File
 *    existence proves nothing (the invariant registry says so in as many words),
 *    so this runs the REAL loader and the REAL binder over the shipped bytes,
 *    for two firms, and proves the binding differs only by firmId.
 *
 *  RULE C - THE DOCUMENTS ARE INERT AND FIRM-NEUTRAL. Tags, anchors, aliases and
 *    merge keys are the four ways YAML stops being data; a `firmId` anywhere in
 *    the graph would make invariant 26 unprovable.
 *
 *  RULE D - A PUBLISHED VERSION IS IMMUTABLE. The SHA-256 over each document's
 *    canonical bytes must equal the hash `config/domains/versions.json` pins, so
 *    editing a published document without bumping its version fails the build
 *    (the arch-version doc-pin mechanism, applied to configuration).
 *
 *  RULE E - ONLY THE CONFIG SOURCE ADAPTER READS `config/domains/`. v3 §16: no
 *    module imports from `config/`. The single-allowed-module idiom, exactly as
 *    `no-process-env` uses it for the environment.
 *
 * NAMED DEFERRALS. `policyRegistriesFor` derives prompt 9's four pinned
 * registries from a loaded configuration and has no SHIPPED caller yet: nothing
 * authors a firm policy until the policy lifecycle lands (prompt 20). It is
 * listed below rather than left silent, because knip cannot see the difference
 * between "waiting for its prompt" and "dead".
 */
const CONFIG_DIRECTORY = "config/domains";
const DOMAIN_FILES = readdirSync(join(REPO_ROOT, CONFIG_DIRECTORY))
  .filter((name) => name.endsWith(".yaml"))
  .sort();

const NAMED_DEFERRALS: Readonly<Record<string, string>> = {
  "src/domain/config/registries.ts :: policyRegistriesFor":
    "prompt 20 - the policy lifecycle is what first loads a firm policy against these derived registries",
};

/**
 * The decision-core scope the captain ruled (`invariant-3-scope`). Everything
 * here is platform substrate: a decision domain may be its DATA, never its
 * module, directory, identifier, or branch.
 */
const DECISION_CORE_ROOTS = [
  "src/contracts/decision-core/",
  "src/contracts/primitives/",
  "src/domain/config/",
  "src/domain/policy/",
] as const;

/**
 * The SMALL, ENUMERATED allow-list the ruling requires, every entry justified in
 * ADR-0056. These are shipped, externally-visible names the ruling explicitly
 * refuses to rename: a public route, a persisted table, audit action codes, and
 * established span names. Growth here is an ADR amendment, and the companion
 * below proves an entry that suppresses nothing fails.
 */
const REVIEWED_DOMAIN_NAME_USES: ReadonlyArray<{ file: string; token: string; why: string }> = [
  {
    file: "src/contracts/primitives/quantity.ts",
    token:
      "A real reserve or commitment rule needing non-sum aggregation (largest monthly gap, inflation-adjusted projection) or irregular schedules the forward horizon-sum cannot express. Hard kill criterion from the captain's OQ-4 ruling: if no second domain (trading cash-needs, life-event required-distribution projection) has bound this primitive by the trading wave, it was a money-movement one-off.",
    why: "prompt 8's FALSIFICATION CRITERION for horizon-projection: the sentence that says this primitive is WRONG if only one domain ever binds it. Naming that domain is the whole content of the criterion - deleting the name would delete the test. It is prose in a data field, never a branch, never a module name (ADR-0056, invariant-3-scope ruling)",
  },
];

type NameUse = {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  readonly detail: string;
};

/** The domains this repository actually publishes, and the word forms of each. */
export function domainVocabulary(files: readonly string[] = DOMAIN_FILES): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const id = file.replace(/\.yaml$/, "");
    out.add(id);
    out.add(id.split("-").join(""));
    out.add(id.split("-").map((part, index) => (index === 0 ? part : part[0]!.toUpperCase() + part.slice(1))).join(""));
    out.add(id.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(""));
    out.add(id.split("_").join(""));
  }
  return [...out].filter((word) => word.length > 3).sort();
}

/**
 * Every place a decision-core file NAMES a domain: its path, an identifier it
 * declares, or a string literal it contains. Pure so the companion can feed it
 * synthetic trees and an emptied vocabulary.
 */
export function domainNameUses(
  project: Project,
  vocabulary: readonly string[],
  roots: readonly string[] = DECISION_CORE_ROOTS,
): NameUse[] {
  const out: NameUse[] = [];
  const matches = (text: string): string | null =>
    vocabulary.find((word) => text.toLowerCase().includes(word.toLowerCase())) ?? null;
  for (const sourceFile of project.getSourceFiles()) {
    const file = normalizedPath(sourceFile.getFilePath());
    if (!roots.some((root) => file.startsWith(root))) continue;
    const inPath = matches(file);
    if (inPath !== null) {
      out.push({ file, line: 1, token: file, detail: `file or directory name contains the domain name "${inPath}"` });
    }
    for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const hit = matches(identifier.getText());
      if (hit === null) continue;
      out.push({
        file,
        line: identifier.getStartLineNumber(),
        token: identifier.getText(),
        detail: `identifier "${identifier.getText()}" contains the domain name "${hit}"`,
      });
    }
    for (const kind of [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral] as const) {
      for (const literal of sourceFile.getDescendantsOfKind(kind)) {
        const hit = matches(literal.getLiteralText());
        if (hit === null) continue;
        out.push({
          file,
          line: literal.getStartLineNumber(),
          token: literal.getLiteralText(),
          detail: `string literal contains the domain name "${hit}"`,
        });
      }
    }
  }
  return out;
}

/** Tags, anchors, aliases and merge keys - the four ways a YAML document stops being data. */
export function inertnessProblems(text: string): string[] {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, merge: false });
  const problems: string[] = [];
  for (const problem of [...document.errors, ...document.warnings]) {
    problems.push(problem.message.split("\n")[0] ?? problem.message);
  }
  visit(document, {
    Node(_key, node) {
      const at = node.range ? lineCounter.linePos(node.range[0]).line : "?";
      if ("tag" in node && node.tag !== undefined) problems.push(`line ${at}: tag ${node.tag}`);
      if ("anchor" in node && node.anchor !== undefined) problems.push(`line ${at}: anchor ${node.anchor}`);
    },
    Alias(_key, node) {
      problems.push(`alias *${node.source}`);
    },
    Pair(_key, pair) {
      const key = pair.key;
      if (typeof key === "object" && key !== null && "value" in key && key.value === "<<") {
        problems.push("merge key '<<'");
      }
    },
  });
  return problems;
}

const documentText = (file: string): string => readFileSync(join(REPO_ROOT, CONFIG_DIRECTORY, file), "utf8");

const parsed = (file: string): unknown =>
  parseDocument(documentText(file), { merge: false }).toJS() as unknown;

/** A registry supplying every class the shipped documents reference. */
const registryFor = (firmId: string): FirmRegistry => ({
  firmId,
  executionTargets: new Map([
    ["custodian-transfer", `${firmId}-custodian`],
    ["house-crm", `${firmId}-crm`],
    ["esign", `${firmId}-esign`],
  ]),
  evidenceSources: new Map([
    ["house-crm", `${firmId}-crm-source`],
    ["applicant-identity", `${firmId}-identity-source`],
  ]),
  approvalTemplates: new Map([
    ["ops-dual-approval", `${firmId}-ops-dual`],
    ["bank-change-specialist", `${firmId}-bank-specialist`],
    ["elevated-approval", `${firmId}-elevated`],
    ["new-account-review", `${firmId}-new-account-review`],
  ]),
  roles: new Map([
    ["operations", "operations"],
    ["advisor", "advisor"],
    ["bank-change-specialist", "bank-change-specialist"],
  ]),
});

/** Modules permitted to name the configuration directory (RULE E). */
const CONFIG_READERS = ["src/infrastructure/config/domain-config-source.ts"] as const;

/**
 * A module ACCESSES the configuration directory when it names the path in a
 * filesystem or module-resolution position. Naming it in a message a human
 * reads ("restore config/domains/account-opening.yaml") is not access - it is
 * the opposite, an instruction to the operator - so the rule keys on the verb,
 * not on the mention.
 */
const ACCESS_VERBS = /\b(?:readFileSync|readdirSync|readFile|createReadStream|import|require|join|resolve)\b/;

export function configDirectoryReaders(files: ReadonlyArray<{ rel: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    if (CONFIG_READERS.includes(rel as (typeof CONFIG_READERS)[number])) continue;
    text.split("\n").forEach((line, index) => {
      const code = stripComments(line);
      if (code.includes(CONFIG_DIRECTORY) && ACCESS_VERBS.test(code)) out.push(`${rel}:${index + 1}`);
    });
  }
  return out;
}

describe("domain-configuration fence (v3 invariant 3, prompt 10)", () => {
  const vocabulary = domainVocabulary();

  it("enforces: the repository publishes both ratified domains as configuration", () => {
    expect(DOMAIN_FILES).toEqual(["account-opening.yaml", "money-movement.yaml"]);
    expect(vocabulary).toContain("account-opening");
    expect(vocabulary).toContain("money-movement");
  });

  it("(A) enforces: no decision-core module, directory, identifier, or literal names a domain", () => {
    const reviewed = new Set(REVIEWED_DOMAIN_NAME_USES.map((entry) => `${entry.file}\u0000${entry.token}`));
    const uses = domainNameUses(realProject(), vocabulary)
      .filter((use) => !reviewed.has(`${use.file}\u0000${use.token}`));
    expect(
      uses,
      `decision-core names a decision domain (invariant 3):\n${uses.map((use) => `${use.file}:${use.line} ${use.detail}`).join("\n")}`,
    ).toEqual([]);
  });

  it("(A') enforces: every reviewed domain-name escape is justified and load-bearing", () => {
    for (const entry of REVIEWED_DOMAIN_NAME_USES) {
      expect(entry.why.trim().length, `${entry.file} needs a reason`).toBeGreaterThan(20);
    }
    const detected = new Set(domainNameUses(realProject(), vocabulary).map((use) => `${use.file}\u0000${use.token}`));
    const stale = REVIEWED_DOMAIN_NAME_USES
      .filter((entry) => !detected.has(`${entry.file}\u0000${entry.token}`))
      .map((entry) => entry.file);
    expect(stale, `escapes that suppress nothing:\n${stale.join("\n")}`).toEqual([]);
  });

  it.each(DOMAIN_FILES)("(B) enforces: %s loads through the REAL shared engine loader", (file) => {
    const result = loadDomainConfig(parsed(file));
    expect(
      result.ok,
      result.ok ? "" : result.error.map((error) => `${error.code} at ${error.path}: ${error.message}`).join("\n"),
    ).toBe(true);
  });

  it.each(DOMAIN_FILES)("(B) enforces: %s binds for two firms and differs only by firmId", (file) => {
    const loaded = loadDomainConfig(parsed(file));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const project = (firmId: string): string => {
      const bound = bindDomainConfig(loaded.value, registryFor(firmId));
      expect(bound.ok, bound.ok ? "" : JSON.stringify(bound.error)).toBe(true);
      if (!bound.ok) return "";
      return JSON.stringify({
        versionRef: bound.value.domainConfigVersionRef,
        executionTargets: [...bound.value.executionTargets].sort(),
        approvalTemplates: [...bound.value.approvalTemplates].sort(),
        evidenceSupplierRoles: [...bound.value.evidenceSupplierRoles].sort(),
        boundParameters: [...bound.value.boundParameters].sort(),
      });
    };
    const one = project("tenant-one");
    const two = project("tenant-two");
    expect(one.length).toBeGreaterThan(0);
    expect(two.split("tenant-two").join("F")).toEqual(one.split("tenant-one").join("F"));
  });

  it.each(DOMAIN_FILES)("(C) enforces: %s is inert data and carries no firm identity", (file) => {
    expect(inertnessProblems(documentText(file))).toEqual([]);
    expect(documentText(file)).not.toMatch(/^\s*firmId\s*:/m);
  });

  it("(D) enforces: every published version's canonical bytes match its pinned hash", () => {
    const pins = JSON.parse(readFileSync(join(REPO_ROOT, CONFIG_DIRECTORY, "versions.json"), "utf8")) as {
      versions: Array<{ domainConfigId: string; version: string; configHash: string }>;
    };
    const drift: string[] = [];
    for (const file of DOMAIN_FILES) {
      const loaded = loadDomainConfig(parsed(file));
      if (!loaded.ok) continue;
      const canonical = canonicalConfigJson(loaded.value.document);
      if (!canonical.ok) continue;
      const hash = createHash("sha256").update(canonical.value, "utf8").digest("hex");
      const pin = pins.versions.find(
        (entry) =>
          entry.domainConfigId === loaded.value.document.domainConfigId &&
          entry.version === loaded.value.document.version,
      );
      if (!pin) drift.push(`${loaded.value.domainConfigVersionId} is not a published version`);
      else if (pin.configHash !== hash) {
        drift.push(`${loaded.value.domainConfigVersionId} changed without a version bump (pinned ${pin.configHash}, computed ${hash})`);
      }
    }
    expect(drift, drift.join("\n")).toEqual([]);
    expect(pins.versions.length).toBe(DOMAIN_FILES.length);
  });

  it("(E) enforces: only the config source adapter names config/domains/", () => {
    const files = realProject()
      .getSourceFiles()
      .map((sourceFile) => ({
        rel: normalizedPath(sourceFile.getFilePath()),
        text: sourceFile.getFullText(),
      }));
    const offenders = configDirectoryReaders(files);
    expect(offenders, `only ${CONFIG_READERS.join(", ")} may read the configuration directory:\n${offenders.join("\n")}`).toEqual([]);
    expect(
      files.some((file) => CONFIG_READERS.includes(file.rel as (typeof CONFIG_READERS)[number])),
      "the allowed reader must exist, or this rule passes vacuously",
    ).toBe(true);
  });

  it("enforces: every named deferral still has no shipped caller", () => {
    const stale: string[] = [];
    for (const [entry, reason] of Object.entries(NAMED_DEFERRALS)) {
      expect(reason.length).toBeGreaterThan(20);
      const [file, name] = entry.split(" :: ");
      const importers = realProject()
        .getSourceFiles()
        .filter((sourceFile) => {
          const rel = normalizedPath(sourceFile.getFilePath());
          return rel !== file && !rel.startsWith("src/__tests__/");
        })
        .filter((sourceFile) =>
          moduleReferences(sourceFile).some((reference) =>
            (reference.specifier ?? "").includes("config/registries"),
          ) && sourceFile.getFullText().includes(name!),
        );
      if (importers.length > 0) stale.push(`${entry} now has a caller - remove the deferral`);
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  describe("detects (companion): incomplete or dishonest work CANNOT pass", () => {
    it("catches a domain-named evaluator branch inside decision-core", () => {
      const project = inMemoryProject({
        "/src/domain/config/bind.ts": `export const f = (id: string): boolean => id === "money-movement";`,
      });
      const uses = domainNameUses(project, ["money-movement"], ["src/domain/config/"]);
      expect(uses.some((use) => use.detail.includes("string literal"))).toBe(true);
    });

    it("catches a domain-named module file inside decision-core", () => {
      const project = inMemoryProject({
        "/src/domain/config/money-movement-defaults.ts": `export const x = 1;`,
      });
      expect(domainNameUses(project, ["money-movement"], ["src/domain/config/"]).some(
        (use) => use.detail.includes("file or directory name"),
      )).toBe(true);
    });

    it("catches a domain-named identifier inside decision-core", () => {
      const project = inMemoryProject({
        "/src/domain/config/load.ts": `export const accountOpeningDefaults = 1;`,
      });
      expect(domainNameUses(project, ["accountOpening"], ["src/domain/config/"]).some(
        (use) => use.detail.includes("identifier"),
      )).toBe(true);
    });

    it("ANTI-VACUITY: an emptied vocabulary can never be reported as clean", () => {
      // The derivation must come from real published documents. An empty
      // vocabulary would make RULE A pass over any tree at all, which is the
      // exact false-pass this fence exists to refuse.
      expect(domainVocabulary([])).toEqual([]);
      expect(domainVocabulary()).not.toEqual([]);
      const project = inMemoryProject({
        "/src/domain/config/money-movement.ts": `export const x = "money-movement";`,
      });
      expect(domainNameUses(project, [], ["src/domain/config/"])).toEqual([]);
      expect(domainNameUses(project, domainVocabulary(), ["src/domain/config/"]).length).toBeGreaterThan(0);
    });

    it("catches a configuration that does not load (the REAL loader is the judge)", () => {
      const broken = parsed(DOMAIN_FILES[0]!) as Record<string, unknown>;
      broken["intents"] = [];
      expect(loadDomainConfig(broken).ok).toBe(false);
    });

    it("catches a configuration that cannot bind because the firm supplies nothing", () => {
      const loaded = loadDomainConfig(parsed(DOMAIN_FILES[0]!));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const bound = bindDomainConfig(loaded.value, {
        firmId: "tenant-one",
        executionTargets: new Map(),
        evidenceSources: new Map(),
        approvalTemplates: new Map(),
        roles: new Map(),
      });
      expect(bound.ok).toBe(false);
    });

    it("catches every non-inert YAML feature", () => {
      expect(inertnessProblems("a: !!js/function 'x'").length).toBeGreaterThan(0);
      expect(inertnessProblems("a: &anchor 1\nb: *anchor").length).toBeGreaterThan(0);
      expect(inertnessProblems("base: &b { x: 1 }\nchild:\n  <<: *b").length).toBeGreaterThan(0);
      expect(inertnessProblems("a: 1\nb: two")).toEqual([]);
    });

    it("catches a module other than the config source naming the configuration directory", () => {
      expect(configDirectoryReaders([{ rel: "src/domain/config/load.ts", text: `readFileSync("config/domains/x.yaml")` }]))
        .toEqual(["src/domain/config/load.ts:1"]);
      expect(configDirectoryReaders([{ rel: "src/domain/config/load.ts", text: `// reads config/domains/ elsewhere` }]))
        .toEqual([]);
      // A user-facing message naming the file is an INSTRUCTION, not access.
      expect(configDirectoryReaders([
        { rel: "src/app/page.tsx", text: `<p>Restore config/domains/account-opening.yaml and reload.</p>` },
      ])).toEqual([]);
      expect(configDirectoryReaders([{ rel: CONFIG_READERS[0], text: `join("config/domains", id)` }])).toEqual([]);
    });

    it("catches a published document edited without a version bump", () => {
      const loaded = loadDomainConfig(parsed(DOMAIN_FILES[0]!));
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const edited = {
        ...loaded.value.document,
        presentation: {
          ...loaded.value.document.presentation,
          domainLabel: `${loaded.value.document.presentation.domainLabel} (edited)`,
        },
      };
      const before = canonicalConfigJson(loaded.value.document);
      const after = canonicalConfigJson(edited);
      expect(before.ok && after.ok && before.value !== after.value).toBe(true);
    });
  });
});
