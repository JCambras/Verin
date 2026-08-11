import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { Node, Project } from "ts-morph";
import { z } from "zod";
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
 *      vocabulary. This fence carries its own hard-coded copy as the pin and
 *      compares it against the vocabulary READ BACK OFF THE BUILT SCHEMAS
 *      (`policyAstSchemaFor`, the very factory `loadPolicy` parses with), not
 *      against a second declaration list - a hand-written list compared to a
 *      hand-written list would only ever catch an edit to the list. The
 *      contracts vocabulary constants are then held to that same introspection,
 *      so declaration and schema cannot drift apart either. The single reserved
 *      op (`elapsed`, OQ-7) parses only at 1.1.0 and is refused by the loader -
 *      grammar-only, proven both directions.
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
  "load-effects.ts",
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
  "load.ts:loadPolicy": "prompt 20 (policy lifecycle activation) - prompt 10 landed the registries this loads against (domain/config/registries.ts), but nothing authors a firm policy until the lifecycle exists",
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

// ── Reading the vocabulary back off the BUILT schemas ───────────────────────────

/**
 * Zod introspection, in the house style of `parameterSchemaKeys`: every step
 * THROWS on an unexpected node instead of returning nothing, so a schema
 * refactor that moves the grammar out of reach fails loudly rather than
 * emptying the extracted vocabulary into a vacuous pass.
 */
const unwrapSchema = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  while (current instanceof z.ZodReadonly || current instanceof z.ZodLazy) {
    current = (current as unknown as { unwrap: () => z.ZodType }).unwrap();
  }
  return current;
};

const expectNode = <T>(schema: z.ZodType, guard: (value: z.ZodType) => boolean, what: string): T => {
  const unwrapped = unwrapSchema(schema);
  if (!guard(unwrapped)) {
    throw new Error(`${what}: unexpected schema node ${unwrapped.constructor.name}`);
  }
  return unwrapped as unknown as T;
};

const shapeOf = (schema: z.ZodType, what: string): Record<string, z.ZodType> =>
  expectNode<z.ZodObject>(schema, (value) => value instanceof z.ZodObject, what).shape as Record<
    string,
    z.ZodType
  >;

const optionsOf = (schema: z.ZodType, what: string): readonly z.ZodType[] =>
  expectNode<{ options: readonly z.ZodType[] }>(
    schema,
    (value) => value instanceof z.ZodUnion || value instanceof z.ZodDiscriminatedUnion,
    what,
  ).options;

const elementOf = (schema: z.ZodType, what: string): z.ZodType =>
  expectNode<{ element: z.ZodType }>(schema, (value) => value instanceof z.ZodArray, what).element;

const literalOf = (schema: z.ZodType, what: string): string => {
  const values = [
    ...expectNode<{ values: Set<unknown> }>(
      schema,
      (value) => value instanceof z.ZodLiteral,
      what,
    ).values,
  ];
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new Error(`${what}: expected exactly one string literal, got ${JSON.stringify(values)}`);
  }
  return values[0];
};

const enumOf = (schema: z.ZodType, what: string): readonly string[] =>
  expectNode<{ options: readonly string[] }>(schema, (value) => value instanceof z.ZodEnum, what)
    .options;

type SchemaVocabulary = {
  readonly versionLiteral: string;
  readonly predicateOps: readonly string[];
  readonly valueKinds: readonly string[];
  readonly comparators: readonly string[];
  readonly effectKinds: readonly string[];
};

/** The vocabulary one built policy-AST schema ACTUALLY admits, arm by arm. */
export function schemaVocabularyOf(astSchema: z.ZodType): SchemaVocabulary {
  const ast = shapeOf(astSchema, "policy AST");
  const rule = shapeOf(elementOf(ast["rules"]!, "ast.rules"), "policy rule");
  const predicateOps: string[] = [];
  let valueKinds: readonly string[] = [];
  let comparators: readonly string[] = [];
  for (const arm of optionsOf(rule["when"]!, "rule.when")) {
    const shape = shapeOf(arm, "predicate arm");
    const op = literalOf(shape["op"]!, "predicate arm op");
    predicateOps.push(op);
    if (op !== "compare") continue;
    comparators = enumOf(shape["comparator"]!, "compare.comparator");
    valueKinds = optionsOf(shape["left"]!, "compare.left").map((option) =>
      literalOf(shapeOf(option, "value node")["kind"]!, "value node kind"),
    );
  }
  return {
    versionLiteral: literalOf(ast["schemaVersion"]!, "ast.schemaVersion"),
    predicateOps,
    valueKinds,
    comparators,
    effectKinds: optionsOf(elementOf(rule["effects"]!, "rule.effects"), "effect").map((option) =>
      literalOf(shapeOf(option, "effect")["kind"]!, "effect kind"),
    ),
  };
}

const activeGrammar = schemaVocabularyOf(policyAstSchemaFor(POLICY_GRAMMAR_VERSION));
const wideGrammar = schemaVocabularyOf(policyAstSchemaFor("1.1.0"));

/**
 * What the SHIPPED schemas admit. `reservedOps` is the difference the additive
 * minor version actually introduces, so an op quietly added to BOTH versions
 * would show up as an evaluable op instead of hiding in the reserved list.
 */
const shippedVocabulary: ModuleVocabulary = {
  valueKinds: activeGrammar.valueKinds,
  predicateOps: activeGrammar.predicateOps,
  reservedOps: wideGrammar.predicateOps.filter((op) => !activeGrammar.predicateOps.includes(op)),
  effectKinds: activeGrammar.effectKinds,
  comparators: activeGrammar.comparators,
  grammarVersions: POLICY_GRAMMAR_VERSIONS.map(
    (version) => schemaVocabularyOf(policyAstSchemaFor(version)).versionLiteral,
  ),
  activeVersion: activeGrammar.versionLiteral,
};

/** The contracts DECLARATION lists, held to the same introspection. */
const declaredVocabulary: ModuleVocabulary = {
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

  it("enforces: the vocabulary the BUILT schemas admit equals the ratified pin exactly", () => {
    const violations = grammarClosureViolations(shippedVocabulary);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("enforces: the contracts vocabulary constants declare exactly what the schemas admit", () => {
    const violations = grammarClosureViolations(declaredVocabulary);
    expect(violations, violations.join("\n")).toEqual([]);
    for (const dimension of ["valueKinds", "predicateOps", "reservedOps", "effectKinds", "comparators", "grammarVersions"] as const) {
      expect([...declaredVocabulary[dimension]].sort(), dimension).toEqual(
        [...shippedVocabulary[dimension]].sort(),
      );
    }
    expect(declaredVocabulary.activeVersion).toBe(shippedVocabulary.activeVersion);
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

    it("the extraction reads REAL schema arms, so a widened schema cannot pass behind an unchanged list", () => {
      // A schema shaped like the real one but carrying one extra predicate arm
      // and one extra effect kind - exactly the widening a second hand-written
      // list would miss, and what the pin must reject.
      const valueNode = z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("constant"), value: z.string() }),
      ]);
      const widened = z.strictObject({
        schemaVersion: z.literal("1.0.0"),
        rules: z
          .array(
            z.strictObject({
              when: z.lazy(() =>
                z.union([
                  z
                    .strictObject({
                      op: z.literal("compare"),
                      comparator: z.enum(["eq", "like"]),
                      left: valueNode,
                      right: valueNode,
                    })
                    .readonly(),
                  z.strictObject({ op: z.literal("regex_match"), pattern: z.string() }).readonly(),
                ]),
              ),
              effects: z
                .array(
                  z.discriminatedUnion("kind", [
                    z.strictObject({ kind: z.literal("prohibit") }),
                    z.strictObject({ kind: z.literal("execute_webhook") }),
                  ]),
                )
                .readonly(),
            }),
          )
          .readonly(),
      });
      const extracted = schemaVocabularyOf(widened);
      expect(extracted.predicateOps).toContain("regex_match");
      expect(extracted.effectKinds).toContain("execute_webhook");
      expect(extracted.comparators).toContain("like");
      expect(extracted.valueKinds).toEqual(["constant"]);
      const violations = grammarClosureViolations({
        ...extracted,
        reservedOps: RESERVED_PREDICATE_OPS,
        grammarVersions: POLICY_GRAMMAR_VERSIONS,
        activeVersion: extracted.versionLiteral,
      });
      expect(violations.join("\n")).toContain("regex_match");
      expect(violations.join("\n")).toContain("execute_webhook");
      expect(violations.join("\n")).toContain("like");
    });

    it("a schema whose grammar moved out of reach THROWS rather than extracting nothing", () => {
      expect(() => schemaVocabularyOf(z.strictObject({ rules: z.string() }))).toThrow(
        /unexpected schema node/,
      );
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
