import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { Node, Project } from "ts-morph";
import { REPO_ROOT, SRC_ROOT, inMemoryProject, walk } from "./_fence-utils";
import { scanDomainVocabulary, scanImpurity } from "./_module-scan";
import {
  COMPARATORS,
  EVALUABLE_PREDICATE_OPS,
  POLICY_EFFECT_KINDS,
  POLICY_GRAMMAR_VERSION,
  POLICY_GRAMMAR_VERSIONS,
  RESERVED_PREDICATE_OPS,
  VALUE_NODE_KINDS,
  policyAstSchemaFor,
} from "@contracts/decision-core/policy";
import { PRIMITIVE_SET_VERSION } from "@contracts/primitives/catalog";
import { loadPolicy } from "@domain/policy/load";
import { evaluatePolicy, type PolicyPrimitiveInvocation } from "@domain/policy/evaluate";
import type { EvidenceFactSnapshot, PolicyEvaluationFacts } from "@domain/policy/facts";
import { canonicalDigest, worldRegistries } from "../helpers/policy-world";

/**
 * POLICY-AST FENCE (v3 §6.1; prompt 9; ADR-0053; charter #1/#4; the load-time
 * mechanism behind v3 invariant 16). Five invariants, each with companions
 * proving the incomplete form CANNOT pass:
 *  (a) GRAMMAR CLOSURE - the shipped grammar admits EXACTLY the ratified
 *      vocabulary; this fence carries its own hard-coded copy as the pin, so
 *      quietly widening a union in contracts fails the build here. The single
 *      reserved op (`elapsed`, OQ-7) parses only at 1.1.0 and is refused by
 *      the loader - grammar-only, proven both directions.
 *  (b) DOMAIN NEUTRALITY - no domain vocabulary in the policy module's
 *      identifiers or string literals: "no evaluator branch on domain ID"
 *      made structural (v3 orchestrator rule 7; domain words live in config,
 *      fixtures, and tests only).
 *  (c) PURITY - the module never references a clock, randomness, tz/locale
 *      machinery, or scheduling globals; `Date` is banned outright (the
 *      module does its own integer calendar math), or byte-identical replay
 *      dies.
 *  (d) MIGRATION-FIXTURE PIN - the committed 1.0.0 fixture loads and
 *      evaluates to the PINNED digests, identically under both grammar
 *      versions; regenerating the pin is a conscious, reviewed act.
 *  (e) REACHABILITY BY NAME - every value export of the domain policy module
 *      is imported (as a value) by other code or carried as a NAMED deferral
 *      stating which prompt lands its caller (the D-116 ledger precedent -
 *      knip cannot see this, since every export has a test).
 */

const POLICY_DOMAIN_SEGMENT = "src/domain/policy/";
const POLICY_CONTRACT_FILE = "src/contracts/decision-core/policy.ts";

const isPolicyModulePath = (path: string): boolean => {
  const normalized = path.replace(/\\/g, "/");
  return normalized.includes(POLICY_DOMAIN_SEGMENT) || normalized.endsWith(POLICY_CONTRACT_FILE);
};

const EXPECTED_DOMAIN_FILES = [
  "conflict.ts",
  "evaluate-primitives.ts",
  "evaluate.ts",
  "facts.ts",
  "load-checks.ts",
  "load.ts",
  "registries.ts",
  "temporal.ts",
  "trace.ts",
];

/**
 * Named deferrals: module entry points whose shipped callers belong to later
 * prompts. An entry here is a COMMITMENT, not an exemption - when the caller
 * lands, the entry must be removed (a stale deferral fails below).
 */
const NAMED_DEFERRALS: Readonly<Record<string, string>> = {
  "registries.ts:catalogPrimitiveMap": "prompt 10 - the domain-config loader assembles registries from the catalog",
  "registries.ts:evidenceKindDescriptor": "prompt 10 - registries derive from the domain config's evidence dictionary",
  "registries.ts:instructionKindDescriptor": "prompt 10 - registries derive from the instruction-kind taxonomy",
  "registries.ts:deriveContextKeys": "prompt 10 - the config loader derives the closed context-key vocabulary",
  "load.ts:loadPolicy": "prompt 10 (policy references in domain config) and prompt 20 (policy lifecycle activation)",
  "evaluate.ts:evaluatePolicy": "prompt 16 - the complete evaluator over the immutable DecisionInputBundle",
};

// ── (a) Grammar closure ─────────────────────────────────────────────────────────

/** This fence's OWN copy of the ratified vocabulary - the pin the module is held to. */
const RATIFIED = {
  valueKinds: ["constant", "evidence", "household_instruction", "context"],
  predicateOps: ["all", "any", "not", "exists", "is_fresh", "compare", "in"],
  reservedOps: ["elapsed"],
  effectKinds: [
    "require_evidence",
    "set_parameter",
    "require_approval",
    "block",
    "prohibit",
    "select_candidate",
  ],
  comparators: ["eq", "neq", "gt", "gte", "lt", "lte"],
  grammarVersions: ["1.0.0", "1.1.0"],
  activeVersion: "1.0.0",
} as const;

type ModuleVocabulary = {
  readonly valueKinds: readonly string[];
  readonly predicateOps: readonly string[];
  readonly reservedOps: readonly string[];
  readonly effectKinds: readonly string[];
  readonly comparators: readonly string[];
  readonly grammarVersions: readonly string[];
  readonly activeVersion: string;
};

export function grammarClosureViolations(vocabulary: ModuleVocabulary): string[] {
  const out: string[] = [];
  const diff = (name: keyof ModuleVocabulary & string, actual: readonly string[], ratified: readonly string[]) => {
    const actualSorted = [...actual].sort().join(",");
    const ratifiedSorted = [...ratified].sort().join(",");
    if (actualSorted !== ratifiedSorted) {
      out.push(`${name}: shipped [${actualSorted}] != ratified [${ratifiedSorted}]`);
    }
  };
  diff("valueKinds", vocabulary.valueKinds, RATIFIED.valueKinds);
  diff("predicateOps", vocabulary.predicateOps, RATIFIED.predicateOps);
  diff("reservedOps", vocabulary.reservedOps, RATIFIED.reservedOps);
  diff("effectKinds", vocabulary.effectKinds, RATIFIED.effectKinds);
  diff("comparators", vocabulary.comparators, RATIFIED.comparators);
  diff("grammarVersions", vocabulary.grammarVersions, RATIFIED.grammarVersions);
  if (vocabulary.activeVersion !== RATIFIED.activeVersion) {
    out.push(`active grammar version ${vocabulary.activeVersion} != ratified ${RATIFIED.activeVersion}`);
  }
  return out;
}

const shippedVocabulary: ModuleVocabulary = {
  valueKinds: VALUE_NODE_KINDS,
  predicateOps: EVALUABLE_PREDICATE_OPS,
  reservedOps: RESERVED_PREDICATE_OPS,
  effectKinds: POLICY_EFFECT_KINDS,
  comparators: COMPARATORS,
  grammarVersions: POLICY_GRAMMAR_VERSIONS,
  activeVersion: POLICY_GRAMMAR_VERSION,
};

const probeRule = (when: unknown, effects: readonly unknown[] = [{ kind: "prohibit", prohibitionCode: "probe" }]) => ({
  schemaVersion: "1.0.0",
  primitiveSetVersion: "1.0.0",
  rules: [{ id: "probe", when, effects }],
});

const parses = (version: "1.0.0" | "1.1.0", document: unknown): boolean =>
  policyAstSchemaFor(version).safeParse(
    version === "1.1.0" && typeof document === "object" && document !== null
      ? { ...(document as Record<string, unknown>), schemaVersion: "1.1.0" }
      : document,
  ).success;

// ── (d) Migration fixture pin ───────────────────────────────────────────────────

type MigrationFixture = {
  readonly policy: Record<string, unknown>;
  readonly bundle: {
    readonly asOf: string;
    readonly intent: Readonly<Record<string, string | number | boolean | null>>;
    readonly evidence: Readonly<Record<string, EvidenceFactSnapshot>>;
    readonly invocations: readonly PolicyPrimitiveInvocation[];
  };
  readonly expectations: {
    readonly loadedCanonicalDigest: string;
    readonly traceCanonicalDigest: string;
  };
};

const FIXTURE_PATH = join(REPO_ROOT, "fixtures", "policy", "migration-1.0.0.json");

export function migrationPinViolations(fixture: MigrationFixture): string[] {
  const out: string[] = [];
  const registries = worldRegistries();
  const facts: PolicyEvaluationFacts = {
    asOf: fixture.bundle.asOf,
    evidence: new Map(Object.entries(fixture.bundle.evidence)),
    instructions: new Map(),
    intent: new Map(Object.entries(fixture.bundle.intent)),
  };
  for (const version of ["1.0.0", "1.1.0"] as const) {
    const document = { ...fixture.policy, schemaVersion: version };
    const loaded = loadPolicy(document, registries);
    if (!loaded.ok) {
      out.push(`${version}: fixture policy fails to load: ${JSON.stringify(loaded.error)}`);
      continue;
    }
    const loadedDigest = canonicalDigest({
      primitiveSetVersion: loaded.value.primitiveSetVersion,
      rules: loaded.value.rules,
    });
    if (loadedDigest !== fixture.expectations.loadedCanonicalDigest) {
      out.push(`${version}: loaded canonical digest ${loadedDigest} != pinned ${fixture.expectations.loadedCanonicalDigest}`);
    }
    const evaluated = evaluatePolicy(
      loaded.value,
      { facts, invocations: fixture.bundle.invocations },
      registries,
    );
    if (!evaluated.ok) {
      out.push(`${version}: fixture bundle refuses to evaluate: ${JSON.stringify(evaluated.error)}`);
      continue;
    }
    const rest: Record<string, unknown> = { ...evaluated.value };
    delete rest["grammarVersion"];
    const traceDigest = canonicalDigest(rest);
    if (traceDigest !== fixture.expectations.traceCanonicalDigest) {
      out.push(`${version}: trace canonical digest ${traceDigest} != pinned ${fixture.expectations.traceCanonicalDigest}`);
    }
  }
  return out;
}

// ── (e) Reachability by name ────────────────────────────────────────────────────

type ExportViolation = { readonly kind: "orphan" | "stale-deferral"; readonly detail: string };

export function policyExportViolations(
  project: Project,
  deferrals: Readonly<Record<string, string>>,
): ExportViolation[] {
  const moduleFiles = project
    .getSourceFiles()
    .filter((file) => file.getFilePath().replace(/\\/g, "/").includes(POLICY_DOMAIN_SEGMENT));
  const consumed = new Set<string>();
  for (const file of project.getSourceFiles()) {
    for (const declaration of file.getImportDeclarations()) {
      if (declaration.isTypeOnly()) continue;
      const specifier = declaration.getModuleSpecifierValue();
      const target = specifier.startsWith("@domain/policy/")
        ? specifier.slice("@domain/policy/".length)
        : specifier.startsWith("./") &&
            file.getFilePath().replace(/\\/g, "/").includes(POLICY_DOMAIN_SEGMENT)
          ? specifier.slice(2)
          : null;
      if (target === null) continue;
      for (const named of declaration.getNamedImports()) {
        if (named.isTypeOnly()) continue;
        consumed.add(`${basename(target)}.ts:${named.getName()}`.replace(/\.ts\.ts:/, ".ts:"));
      }
    }
  }
  const out: ExportViolation[] = [];
  const orphanKeys = new Set<string>();
  for (const file of moduleFiles) {
    const base = basename(file.getFilePath());
    for (const [name, declarations] of file.getExportedDeclarations()) {
      const isValueExport = declarations.some(
        (declaration) =>
          Node.isFunctionDeclaration(declaration) || Node.isVariableDeclaration(declaration),
      );
      if (!isValueExport) continue;
      const key = `${base}:${name}`;
      if (consumed.has(key)) continue;
      orphanKeys.add(key);
      if (!(key in deferrals)) {
        out.push({
          kind: "orphan",
          detail: `${key} has no value importer and no named deferral - dead vocabulary or a missing deferral entry`,
        });
      }
    }
  }
  for (const key of Object.keys(deferrals)) {
    if (!orphanKeys.has(key)) {
      out.push({
        kind: "stale-deferral",
        detail: `${key} is deferred but now has a caller (or vanished) - remove the deferral entry`,
      });
    }
  }
  return out;
}

// ── Project assembly ────────────────────────────────────────────────────────────

function policyProject(): Project {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of walk(join(SRC_ROOT, "domain", "policy"), (f) => f.endsWith(".ts"))) {
    project.addSourceFileAtPath(file);
  }
  project.addSourceFileAtPath(join(SRC_ROOT, "contracts", "decision-core", "policy.ts"));
  return project;
}

/**
 * The module PLUS every shipped file that MENTIONS it, for the reachability
 * scan. The import-declaration walk only ever matches files whose text names
 * the module path, so pre-filtering on that substring keeps this fence from
 * building yet another whole-repository ts-morph program inside the serial
 * fitness fork - the memory headroom there is already spent by the semantic
 * fences, and one more full program is what pushed the fork over it. Cached:
 * the enforce case and its no-broken-baseline companion share one build.
 */
let cachedReachabilityProject: Project | null = null;
function reachabilityProject(): Project {
  if (cachedReachabilityProject !== null) return cachedReachabilityProject;
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of walk(SRC_ROOT, (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes("__tests__"))) {
    if (
      file.replace(/\\/g, "/").includes(POLICY_DOMAIN_SEGMENT) ||
      readFileSync(file, "utf8").includes("domain/policy")
    ) {
      project.addSourceFileAtPath(file);
    }
  }
  cachedReachabilityProject = project;
  return project;
}

const formatViolations = (violations: readonly { file: string; line: number; token: string }[]): string =>
  violations.map((v) => `${v.file}:${v.line}: ${v.token}`).join("\n");

describe("policy-ast fence", () => {
  const project = policyProject();

  it("enforces: the shipped grammar vocabulary equals the ratified pin exactly", () => {
    const violations = grammarClosureViolations(shippedVocabulary);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("enforces: parse probes - every ratified variant parses, nothing else does", () => {
    // Every ratified effect kind has a minimal parsing form.
    const effectProbes: Record<string, unknown> = {
      require_evidence: { kind: "require_evidence", evidenceKind: "k", absence: "block" },
      set_parameter: {
        kind: "set_parameter",
        primitiveId: "p",
        parameter: "x",
        value: { kind: "constant", value: 1 },
      },
      require_approval: { kind: "require_approval", templateId: "t" },
      block: { kind: "block", blockerCode: "c", resolvingEvidenceKinds: [] },
      prohibit: { kind: "prohibit", prohibitionCode: "c" },
      select_candidate: { kind: "select_candidate", primitiveId: "p", strategy: "s" },
    };
    expect(Object.keys(effectProbes).sort()).toEqual([...RATIFIED.effectKinds].sort());
    for (const [kind, probe] of Object.entries(effectProbes)) {
      expect(parses("1.0.0", probeRule({ op: "all", nodes: [] }, [probe])), `effect ${kind}`).toBe(true);
    }
    expect(parses("1.0.0", probeRule({ op: "all", nodes: [] }, [{ kind: "execute_shell", command: "true" }]))).toBe(false);
    // Every ratified comparator parses; an alien one does not.
    for (const comparator of RATIFIED.comparators) {
      expect(
        parses(
          "1.0.0",
          probeRule({
            op: "compare",
            comparator,
            left: { kind: "constant", value: 1 },
            right: { kind: "constant", value: 2 },
          }),
        ),
        comparator,
      ).toBe(true);
    }
    expect(
      parses(
        "1.0.0",
        probeRule({ op: "compare", comparator: "like", left: { kind: "constant", value: 1 }, right: { kind: "constant", value: 2 } }),
      ),
    ).toBe(false);
    // Strict objects: an extra property is a parse error, not an extension seam.
    expect(
      parses("1.0.0", probeRule({ op: "exists", value: { kind: "constant", value: 1 }, hook: "x" })),
    ).toBe(false);
    // An unknown op fails under BOTH grammars; elapsed parses ONLY at 1.1.0.
    const elapsed = {
      op: "elapsed",
      value: { kind: "constant", value: "2026-01-01" },
      minimumAge: "P30D",
    };
    expect(parses("1.0.0", probeRule(elapsed))).toBe(false);
    expect(parses("1.1.0", probeRule(elapsed))).toBe(true);
    expect(parses("1.0.0", probeRule({ op: "regex_match", value: { kind: "constant", value: "x" }, pattern: ".*" }))).toBe(false);
    expect(parses("1.1.0", probeRule({ op: "regex_match", value: { kind: "constant", value: "x" }, pattern: ".*" }))).toBe(false);
  });

  it("enforces: the reserved op never LOADS even where it parses (grammar-only, OQ-7)", () => {
    const registries = worldRegistries();
    const document = {
      schemaVersion: "1.1.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "uses-elapsed",
          when: {
            op: "elapsed",
            value: { kind: "evidence", evidenceKind: "account-balance", path: "amountMinor" },
            minimumAge: "P30D",
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ],
    };
    const loaded = loadPolicy(document, registries);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) throw new Error("unreachable");
    expect(loaded.error.every((issue) => issue.code === "reserved-op-not-evaluable")).toBe(true);
  });

  it("enforces: the policy module is domain-neutral (no evaluator branch on domain vocabulary)", () => {
    const violations = scanDomainVocabulary(project, isPolicyModulePath);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("enforces: the policy module is pure (no clock, randomness, tz, locale, scheduling)", () => {
    const violations = scanImpurity(project, isPolicyModulePath);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("enforces: the migration fixture matches its pinned digests under both grammars", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as MigrationFixture;
    const violations = migrationPinViolations(fixture);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("enforces: every module value export is reachable or a NAMED deferral", () => {
    const violations = policyExportViolations(reachabilityProject(), NAMED_DEFERRALS);
    expect(violations, violations.map((v) => v.detail).join("\n")).toEqual([]);
  });

  it("enforces: the scanned module is the real one, not a stale path (charter #4)", () => {
    const files = project
      .getSourceFiles()
      .map((file) => basename(file.getFilePath()))
      .sort();
    expect(files).toEqual([...EXPECTED_DOMAIN_FILES, "policy.ts"].sort());
  });

  describe("detects (companion): incomplete or dishonest work CANNOT pass", () => {
    it("a widened vocabulary fails the closure pin in every dimension", () => {
      expect(
        grammarClosureViolations({
          ...shippedVocabulary,
          predicateOps: [...shippedVocabulary.predicateOps, "regex_match"],
        }).some((violation) => violation.includes("regex_match")),
      ).toBe(true);
      expect(
        grammarClosureViolations({
          ...shippedVocabulary,
          effectKinds: [...shippedVocabulary.effectKinds, "execute_webhook"],
        }).some((violation) => violation.includes("execute_webhook")),
      ).toBe(true);
      expect(
        grammarClosureViolations({
          ...shippedVocabulary,
          reservedOps: [...shippedVocabulary.reservedOps, "age_at"],
        }).some((violation) => violation.includes("age_at")),
      ).toBe(true);
      expect(
        grammarClosureViolations({ ...shippedVocabulary, activeVersion: "1.1.0" }).some((violation) =>
          violation.includes("active grammar version"),
        ),
      ).toBe(true);
      expect(grammarClosureViolations(shippedVocabulary)).toEqual([]);
    });

    it("a domain-named identifier or literal in the policy module is caught with file:line", () => {
      const violations = scanDomainVocabulary(
        inMemoryProject({
          "src/domain/policy/evil.ts": `export const wireTransferReserveFloor = "cash-reserve";`,
        }),
        isPolicyModulePath,
      );
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toMatchObject({ line: 1 });
      expect(violations.map((violation) => violation.token)).toEqual(
        expect.arrayContaining(["wire", "reserve", "cash"]),
      );
      // The CONTRACTS grammar file is scanned too, not only domain/policy.
      const contractViolation = scanDomainVocabulary(
        inMemoryProject({
          "src/contracts/decision-core/policy.ts": `export const iraDistributionOp = 1;`,
        }),
        isPolicyModulePath,
      );
      expect(contractViolation.map((violation) => violation.token)).toEqual(
        expect.arrayContaining(["ira", "distribution"]),
      );
    });

    it("a clock read, randomness, locale member, or scheduling global is caught", () => {
      const clock = scanImpurity(
        inMemoryProject({ "src/domain/policy/evil.ts": `export const now = Date.now();` }),
        isPolicyModulePath,
      );
      expect(clock.map((violation) => violation.token)).toContain("Date");
      const random = scanImpurity(
        inMemoryProject({ "src/domain/policy/evil.ts": `export const roll = Math.random();` }),
        isPolicyModulePath,
      );
      expect(random.length).toBeGreaterThan(0);
      const locale = scanImpurity(
        inMemoryProject({
          "src/domain/policy/evil.ts": `export const order = (a: string, b: string) => a.localeCompare(b);`,
        }),
        isPolicyModulePath,
      );
      expect(locale.map((violation) => violation.token)).toContain("localeCompare");
      const pure = scanImpurity(
        inMemoryProject({
          "src/domain/policy/ok.ts": `export const clamp = (v: number) => Math.max(0, Math.trunc(v));`,
        }),
        isPolicyModulePath,
      );
      expect(pure).toEqual([]);
    });

    it("a tampered migration fixture fails the pin (the pin binds bytes, not intent)", () => {
      const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as MigrationFixture;
      const tampered: MigrationFixture = JSON.parse(
        JSON.stringify(fixture).replace('"value":6', '"value":7'),
      );
      expect(JSON.stringify(tampered)).not.toBe(JSON.stringify(fixture));
      const violations = migrationPinViolations(tampered);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join("\n")).toContain("digest");
    });

    it("an orphan export without a deferral fails; a stale deferral fails too", () => {
      const orphanProject = inMemoryProject({
        "src/domain/policy/extra.ts": `export const orphanHelper = 1;`,
      });
      const orphan = policyExportViolations(orphanProject, {});
      expect(orphan.some((violation) => violation.detail.includes("extra.ts:orphanHelper"))).toBe(true);
      const named = policyExportViolations(orphanProject, {
        "extra.ts:orphanHelper": "prompt 99 - hypothetical",
      });
      expect(named).toEqual([]);
      const consumedProject = inMemoryProject({
        "src/domain/policy/extra.ts": `export const orphanHelper = 1;`,
        "src/app/uses.ts": `import { orphanHelper } from "@domain/policy/extra";\nexport const use = orphanHelper;`,
      });
      const stale = policyExportViolations(consumedProject, {
        "extra.ts:orphanHelper": "prompt 99 - hypothetical",
      });
      expect(stale.some((violation) => violation.kind === "stale-deferral")).toBe(true);
      // A type-only import does NOT count as a caller.
      const typeOnlyProject = inMemoryProject({
        "src/domain/policy/extra.ts": `export const orphanHelper = 1;`,
        "src/app/uses.ts": `import type { orphanHelper } from "@domain/policy/extra";\nexport type Use = typeof orphanHelper;`,
      });
      expect(
        policyExportViolations(typeOnlyProject, {}).some((violation) => violation.kind === "orphan"),
      ).toBe(true);
    });

    it("the real registry of deferrals matches reality (no broken baseline)", () => {
      expect(policyExportViolations(reachabilityProject(), NAMED_DEFERRALS)).toEqual([]);
    });
  });
});
