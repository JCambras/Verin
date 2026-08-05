import { describe, it, expect } from "vitest";
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
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { parseDocument } from "yaml";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  inMemoryProject,
  moduleReferences,
  REPO_ROOT,
  shippedSourceFiles,
  toolingSourceFiles,
} from "./_fence-utils";
import { canonicalJson } from "../../../src/contracts/decision-core/serialization";
import { loadGoldenCases, loadScenarioRefs } from "../../../scripts/golden-cases.lib";
import {
  defectClassIds,
  taxonomyExerciseProblems,
  taxonomyProblems,
} from "../../../scripts/corpus/defects";
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
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import {
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATES,
  pendingActionLiquidityTreatment,
  pendingAvailabilityAdjustmentMinor,
  pendingAvailabilitySelector,
} from "../../../scripts/corpus/pending-actions";
import {
  freshnessPolicySemanticDigest,
  REAL_DERIVED_FRESHNESS_POLICY,
} from "../../../scripts/corpus/real-derived-policy";
import {
  REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES,
  REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
  loadRealDerivedSemanticContract,
  realDerivedSemanticContractBinding,
  semanticTreatment,
  type SemanticDefectRule,
} from "../../../scripts/corpus/semantic-contract";
import {
  instructionConflictAnalysis,
} from "../../../scripts/corpus/instruction-conflicts";
import { parseStrictJson } from "../../../scripts/corpus/strict-json";
import {
  evidenceObservationAuthorityProblems,
} from "../../../scripts/corpus/evidence-observation";
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
import {
  syntheticSemanticProblems,
  type EmittedCase,
} from "../../../scripts/corpus/synthetic-semantics";
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

const PARTITION_ACCESSORS = ["synthetic", "realDerived"] as const;

export function blendingViolations(project: Project, root = ""): string[] {
  const violations: string[] = [];
  type TrackedSymbol = NonNullable<ReturnType<Node["getSymbol"]>>;
  const directReads = (text: string): Set<string> =>
    new Set(
      PARTITION_ACCESSORS.filter(
        (accessor) =>
          new RegExp(`\\.${accessor}\\b`).test(text) ||
          new RegExp(`\\[\\s*["'\`]${accessor}["'\`]\\s*\\]`).test(text) ||
          new RegExp(`\\b${accessor}(?:Outcomes|PartitionReport)\\b`).test(text),
      ),
    );
  const staticStringValues = (node: Node | undefined): Set<string> => {
    if (node === undefined) return new Set();
    const type = node.getType();
    const alternatives = type.isUnion() ? type.getUnionTypes() : [type];
    return new Set(
      alternatives.flatMap((alternative) => {
        if (!alternative.isStringLiteral()) return [];
        const value = alternative.getLiteralValue();
        return typeof value === "string" ? [value] : [];
      }),
    );
  };
  const staticPartitionAccessors = (node: Node | undefined): Set<string> =>
    new Set(
      [...staticStringValues(node)].filter((value) =>
        PARTITION_ACCESSORS.includes(
          value as typeof PARTITION_ACCESSORS[number],
        )
      ),
    );
  const resolvedSymbol = (symbol: TrackedSymbol): TrackedSymbol => {
    try {
      return symbol.getAliasedSymbol() ?? symbol;
    } catch {
      return symbol;
    }
  };
  const symbolReads = (symbol: TrackedSymbol): Set<string> => {
    try {
      const resolved = resolvedSymbol(symbol);
      const reads = directReads(
        resolved.getDeclarations().map((declaration) => declaration.getText()).join("\n"),
      );
      for (const declaration of resolved.getDeclarations()) {
        if (!Node.isBindingElement(declaration)) continue;
        const name = declaration.getPropertyNameNode()?.getText() ??
          declaration.getNameNode().getText();
        if (PARTITION_ACCESSORS.includes(name as typeof PARTITION_ACCESSORS[number])) {
          reads.add(name);
        }
      }
      return reads;
    } catch {
      return new Set();
    }
  };
  const isReportBoundaryCall = (node: Node): boolean => {
    if (!Node.isCallExpression(node)) return false;
    const symbol = node.getExpression().getSymbol();
    if (symbol === undefined) return false;
    let resolved: TrackedSymbol;
    try {
      resolved = resolvedSymbol(symbol);
    } catch {
      return false;
    }
    return ["buildCorpusReport", "renderCorpusReport"].includes(
      resolved.getName(),
    ) && resolved.getDeclarations().every((declaration) =>
      declaration.getSourceFile().getFilePath().replace(/\\/g, "/")
        .endsWith("/scripts/corpus/report.ts")
    );
  };
  const unwrap = (input: Node): Node => {
    let node = input;
    while (
      Node.isParenthesizedExpression(node) ||
      Node.isAsExpression(node) ||
      Node.isTypeAssertion(node) ||
      Node.isNonNullExpression(node)
    ) {
      node = node.getExpression();
    }
    return node;
  };
  type TaintTarget = {
    readonly symbol: TrackedSymbol;
    readonly path: readonly string[] | null;
  };
  const taintTargets = (input: Node): TaintTarget[] => {
    const node = unwrap(input);
    if (Node.isIdentifier(node)) {
      const symbol = node.getSymbol();
      return symbol === undefined
        ? []
        : [{ symbol: resolvedSymbol(symbol), path: [] }];
    }
    if (Node.isPropertyAccessExpression(node)) {
      return taintTargets(node.getExpression()).map((target) => ({
        symbol: target.symbol,
        path: target.path === null
          ? null
          : [...target.path, node.getName()],
      }));
    }
    if (Node.isElementAccessExpression(node)) {
      const targets = taintTargets(node.getExpression());
      const members = staticStringValues(node.getArgumentExpression());
      return members.size === 0
        ? targets.map((target) => ({ ...target, path: null }))
        : targets.flatMap((target) => [...members].map((member) => ({
            symbol: target.symbol,
            path: target.path === null
              ? null
              : [...target.path, member],
          })));
    }
    return [];
  };
  const taints = new Map<TrackedSymbol, Set<string>>();
  const memberTaints = new Map<TrackedSymbol, Map<string, Set<string>>>();
  const addTaints = (
    target: TaintTarget,
    reads: ReadonlySet<string>,
  ): boolean => {
    if (reads.size === 0) return false;
    if (target.path === null || target.path.length === 0) {
      const before = taints.get(target.symbol);
      if (before !== undefined && [...reads].every((entry) => before.has(entry))) {
        return false;
      }
      taints.set(target.symbol, new Set([...(before ?? []), ...reads]));
      return true;
    }
    const members = memberTaints.get(target.symbol) ?? new Map();
    memberTaints.set(target.symbol, members);
    const key = JSON.stringify(target.path);
    const before = members.get(key);
    if (before !== undefined && [...reads].every((entry) => before.has(entry))) {
      return false;
    }
    members.set(key, new Set([...(before ?? []), ...reads]));
    return true;
  };
  const pathsOverlap = (
    left: readonly string[],
    right: readonly string[],
  ): boolean => {
    const length = Math.min(left.length, right.length);
    return left.slice(0, length).every((part, index) => part === right[index]);
  };
  const memberReads = (target: TaintTarget): Set<string> => {
    const reads = new Set<string>();
    const members = memberTaints.get(target.symbol);
    if (members === undefined) return reads;
    for (const [key, values] of members) {
      const assignedPath = JSON.parse(key) as string[];
      if (
        target.path === null ||
        target.path.length === 0 ||
        pathsOverlap(assignedPath, target.path)
      ) {
        for (const value of values) reads.add(value);
      }
    }
    return reads;
  };
  const readsOf = (node: Node): Set<string> => {
    if (isReportBoundaryCall(node)) return new Set();
    const reads = directReads(node.getText());
    const elementAccesses = Node.isElementAccessExpression(node)
      ? [node]
      : node.getDescendantsOfKind(SyntaxKind.ElementAccessExpression);
    for (const access of elementAccesses) {
      for (const accessor of staticPartitionAccessors(
        access.getArgumentExpression(),
      )) {
        reads.add(accessor);
      }
    }
    const memberAccesses = [
      ...(Node.isPropertyAccessExpression(node) ||
          Node.isElementAccessExpression(node) ? [node] : []),
      ...node.getDescendants().filter((descendant) =>
        Node.isPropertyAccessExpression(descendant) ||
        Node.isElementAccessExpression(descendant)
      ),
    ];
    for (const access of memberAccesses) {
      for (const target of taintTargets(access)) {
        for (const accessor of memberReads(target)) reads.add(accessor);
      }
    }
    for (const identifier of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const symbol = identifier.getSymbol();
      if (symbol === undefined) continue;
      for (const accessor of symbolReads(symbol)) reads.add(accessor);
      for (const accessor of taints.get(resolvedSymbol(symbol)) ?? []) {
        reads.add(accessor);
      }
    }
    if (Node.isIdentifier(node)) {
      const symbol = node.getSymbol();
      if (symbol !== undefined) {
        for (const accessor of symbolReads(symbol)) reads.add(accessor);
        const target = { symbol: resolvedSymbol(symbol), path: [] };
        for (const accessor of taints.get(target.symbol) ?? []) reads.add(accessor);
        for (const accessor of memberReads(target)) reads.add(accessor);
      }
    }
    return reads;
  };
  const assignmentOperators = new Set([
    SyntaxKind.EqualsToken,
    SyntaxKind.PlusEqualsToken,
    SyntaxKind.MinusEqualsToken,
    SyntaxKind.AsteriskEqualsToken,
    SyntaxKind.AsteriskAsteriskEqualsToken,
    SyntaxKind.SlashEqualsToken,
    SyntaxKind.PercentEqualsToken,
    SyntaxKind.LessThanLessThanEqualsToken,
    SyntaxKind.GreaterThanGreaterThanEqualsToken,
    SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    SyntaxKind.AmpersandEqualsToken,
    SyntaxKind.BarEqualsToken,
    SyntaxKind.CaretEqualsToken,
    SyntaxKind.BarBarEqualsToken,
    SyntaxKind.AmpersandAmpersandEqualsToken,
    SyntaxKind.QuestionQuestionEqualsToken,
  ]);
  for (;;) {
    let changed = false;
    for (const sf of project.getSourceFiles()) {
      for (const declaration of sf.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration,
      )) {
        const initializer = declaration.getInitializer();
        if (initializer === undefined || isReportBoundaryCall(initializer)) {
          continue;
        }
        const target = taintTargets(declaration.getNameNode())[0];
        if (target !== undefined) {
          changed = addTaints(target, readsOf(initializer)) || changed;
        }
      }
      for (const assignment of sf.getDescendantsOfKind(
        SyntaxKind.BinaryExpression,
      )) {
        const operator = assignment.getOperatorToken().getKind();
        if (!assignmentOperators.has(operator)) continue;
        const reads = readsOf(assignment.getRight());
        if (operator !== SyntaxKind.EqualsToken) {
          for (const accessor of readsOf(assignment.getLeft())) {
            reads.add(accessor);
          }
        }
        for (const target of taintTargets(assignment.getLeft())) {
          changed = addTaints(target, reads) || changed;
        }
      }
    }
    if (!changed) break;
  }
  for (const sf of project.getSourceFiles()) {
    const record = (expression: Node): void => {
      violations.push(
        `${sf.getFilePath().replace(root, "")}:${expression.getStartLineNumber()}: combines the synthetic and real-derived partitions into one figure`,
      );
    };
    for (const expression of sf.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )) {
      if (
        [
          SyntaxKind.PlusToken,
          SyntaxKind.MinusToken,
          SyntaxKind.AsteriskToken,
          SyntaxKind.SlashToken,
          SyntaxKind.PercentToken,
          SyntaxKind.AsteriskAsteriskToken,
        ].includes(expression.getOperatorToken().getKind()) &&
        PARTITION_ACCESSORS.every((accessor) => readsOf(expression).has(accessor))
      ) {
        record(expression);
      }
    }
    for (const expression of sf.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      if (isReportBoundaryCall(expression)) continue;
      const argumentsRead = new Set(
        expression.getArguments().flatMap((argument) => [...readsOf(argument)]),
      );
      const target = expression.getExpression();
      if (
        Node.isPropertyAccessExpression(target) &&
        ["reduce", "reduceRight", "concat"].includes(target.getName())
      ) {
        for (const accessor of readsOf(target.getExpression())) {
          argumentsRead.add(accessor);
        }
      }
      if (
        PARTITION_ACCESSORS.every((accessor) => argumentsRead.has(accessor))
      ) {
        record(expression);
      }
    }
    for (const expression of sf.getDescendantsOfKind(
      SyntaxKind.NewExpression,
    )) {
      const reads = new Set(
        expression.getArguments().flatMap((argument) => [...readsOf(argument)]),
      );
      if (PARTITION_ACCESSORS.every((accessor) => reads.has(accessor))) {
        record(expression);
      }
    }
    for (const expression of [
      ...sf.getDescendantsOfKind(SyntaxKind.TemplateExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression),
    ]) {
      if (PARTITION_ACCESSORS.every((accessor) => readsOf(expression).has(accessor))) {
        record(expression);
      }
    }
  }
  return violations;
}

const measuredCodeProject = (): Project => {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of [...shippedSourceFiles(), ...toolingSourceFiles()]) {
    project.addSourceFileAtPath(file);
  }
  return project;
};

// ── shared fixtures for the companions ─────────────────────────────────────────

const TOKEN = "tok:0123456789abcdef";
const TOKEN_ALT = "tok:fedcba9876543210";
const OPAQUE = TOKEN;
const OPAQUE_REVIEWER = TOKEN_ALT;
const FIRM_REF = `firm:${TOKEN}`;
const FIRM_REF_ALT = `firm:${TOKEN_ALT}`;
const REQUEST_REF = `request:${TOKEN}`;
const HOUSEHOLD_REF = `household:${TOKEN}`;
const HOUSEHOLD_REF_ALT = `household:${TOKEN_ALT}`;
const ACCOUNT_REF = `account:${TOKEN}`;
const ACCOUNT_REF_ALT = `account:${TOKEN_ALT}`;
const INSTRUCTION_REF = `instruction:${TOKEN}`;
const INSTRUCTION_REF_ALT = `instruction:${TOKEN_ALT}`;
const OWNER_REF = `owner:${TOKEN}`;
const OWNER_REF_ALT = `owner:${TOKEN_ALT}`;
const ACTOR_REF = `actor:${TOKEN}`;
const ACTOR_REF_ALT = `actor:${TOKEN_ALT}`;
const GRANT_REF = `grant:${TOKEN}`;
const POLICY_REF = `policy:${TOKEN}`;
const POLICY_VERSION_REF = `policy-version:${TOKEN}`;
const RESTRICTION_REF = `restriction:${TOKEN}`;
const LEGAL_HOLD_REF = `legal-hold:${TOKEN}`;
const PENDING_ACTION_REF = `pending-action:${TOKEN}`;
const TIME_ZONE_RULE_REF = `time-zone-rule:${TOKEN}`;
const EVIDENCE_SOURCE_REF = `evidence-source:${TOKEN}`;
const EVIDENCE_SOURCE_REF_ALT = `evidence-source:${TOKEN_ALT}`;
const semanticContract = loadRealDerivedSemanticContract();
const treatmentSelectorValue = (
  rule: SemanticDefectRule,
  payload: Record<string, any>,
): string => {
  switch (rule.treatmentSelector) {
    case "fixed":
      return "fixed";
    case "authority-state":
      return payload.authority.authorityState === "effective"
        ? "effective"
        : "ineffective";
    case "reserve-state":
      return payload.liquidity.reserveState;
    case "pending-availability":
      return payload.liquidity.pendingAction.actionKind === null
        ? "unchanged"
        : pendingAvailabilitySelector(
            payload.liquidity.pendingAction.actionKind,
            payload.liquidity.pendingAction.actionState,
            payload.liquidity.pendingAction.availableMinorIncludesAction,
          );
    case "threshold-comparator":
      return payload.policy.thresholdComparator;
  }
};
const treatmentOutcomes = (
  payload: Record<string, any>,
  defectClassId?: string,
): Array<Record<string, string>> =>
  semanticContract.defectRules.map((entry) => {
    const treatment = semanticTreatment(
      entry,
      treatmentSelectorValue(entry, payload),
    );
    return {
      defectClassId: entry.id,
      expectedTreatment: treatment.expectedTreatment,
      observedTreatment:
        entry.id === defectClassId
          ? treatment.defectTreatment
          : treatment.expectedTreatment,
    };
  });
const canonicalFixtureBytes = (value: unknown): string => {
  const result = canonicalJson(value as any);
  if (!result.ok) throw result.error;
  return `${result.value}\n`;
};

const tsConfig = ts.readConfigFile(
  join(REPO_ROOT, "tsconfig.json"),
  ts.sys.readFile,
);
const compilerOptions = ts.parseJsonConfigFileContent(
  tsConfig.config,
  ts.sys,
  REPO_ROOT,
).options;
const authorityClosureCache = new Map<
  string,
  { closure: readonly string[]; problems: readonly string[] }
>();

const authorityClosureProblems = (
  roots: readonly string[],
  inventory: readonly string[],
  sourceOverrides: Readonly<Record<string, string>> = {},
): string[] => {
  const cacheKey = Object.keys(sourceOverrides).length === 0
    ? JSON.stringify(roots)
    : null;
  const cached = cacheKey === null
    ? undefined
    : authorityClosureCache.get(cacheKey);
  const problems: string[] = [...(cached?.problems ?? [])];
  const closure = new Set(cached?.closure ?? []);
  const pending = cached === undefined ? [...roots] : [];
  const project = pending.length === 0
    ? null
    : new Project({
      tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (closure.has(file)) continue;
    closure.add(file);
    const absolute = join(REPO_ROOT, file);
    const bytes = sourceOverrides[file] ?? readFileSync(absolute, "utf8");
    const source = ts.createSourceFile(
      absolute,
      bytes,
      ts.ScriptTarget.Latest,
      true,
    );
    const runtimeStaticSpecifiers = new Set<string>();
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const clause = statement.importClause;
        const runtime =
          clause === undefined ||
          (
            !clause.isTypeOnly &&
            (
              clause.name !== undefined ||
              clause.namedBindings === undefined ||
              ts.isNamespaceImport(clause.namedBindings) ||
              clause.namedBindings.elements.some(
                (element) => !element.isTypeOnly,
              )
            )
          );
        if (runtime) {
          runtimeStaticSpecifiers.add(statement.moduleSpecifier.text);
        }
      }
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        !statement.isTypeOnly &&
        (
          statement.exportClause === undefined ||
          !ts.isNamedExports(statement.exportClause) ||
          statement.exportClause.elements.some(
            (element) => !element.isTypeOnly,
          )
        )
      ) {
        runtimeStaticSpecifiers.add(statement.moduleSpecifier.text);
      }
      if (
        ts.isImportEqualsDeclaration(statement) &&
        !statement.isTypeOnly &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression !== undefined &&
        ts.isStringLiteralLike(statement.moduleReference.expression)
      ) {
        runtimeStaticSpecifiers.add(
          statement.moduleReference.expression.text,
        );
      }
    }
    const sourceFile = project!.createSourceFile(
      absolute,
      bytes,
      { overwrite: true },
    );
    const runtimeReferences = moduleReferences(sourceFile).filter(
      (reference) => {
        if (
          reference.kind === "import" ||
          reference.kind === "export" ||
          reference.kind === "import-equals"
        ) {
          return (
            reference.specifier !== null &&
            runtimeStaticSpecifiers.has(reference.specifier)
          );
        }
        return ![
          "import-type",
          "reference-types",
          "reference-path",
          "reference-lib",
        ].includes(reference.kind);
      },
    );
    const runtimeSpecifiers = new Set<string>();
    for (const reference of runtimeReferences) {
      if (reference.specifier === null) {
        problems.push(
          `${file}: indirect or non-literal runtime dependency (${reference.kind})`,
        );
      } else {
        runtimeSpecifiers.add(reference.specifier);
      }
    }
    for (const specifier of runtimeSpecifiers) {
      const resolved = ts.resolveModuleName(
        specifier,
        absolute,
        compilerOptions,
        ts.sys,
      ).resolvedModule;
      if (resolved === undefined) continue;
      const target = resolve(resolved.resolvedFileName);
      const pathFromRoot = relative(REPO_ROOT, target);
      if (
        pathFromRoot === ".." ||
        pathFromRoot.startsWith(`..${sep}`) ||
        isAbsolute(pathFromRoot) ||
        pathFromRoot.split(/[\\/]/).includes("node_modules")
      ) {
        continue;
      }
      pending.push(pathFromRoot.replace(/\\/g, "/"));
    }
  }
  if (cacheKey !== null && cached === undefined) {
    authorityClosureCache.set(cacheKey, {
      closure: [...closure],
      problems: [...problems],
    });
  }
  const inventoried = new Set(inventory);
  for (const file of closure) {
    if (!inventoried.has(file)) {
      problems.push(`missing executable authority dependency ${file}`);
    }
  }
  for (const file of inventoried) {
    if (!closure.has(file)) {
      problems.push(`extraneous executable authority ${file}`);
    }
  }
  if (inventoried.size !== inventory.length) {
    problems.push("duplicate executable authority inventory entry");
  }
  return problems;
};

const requiredGatewayRootProblems = (roots: readonly string[]): string[] =>
  ["scripts/corpus/real-derived.ts", "scripts/corpus/validate.ts"]
    .filter((file) => !roots.includes(file))
    .map((file) => `missing executable authority gateway root ${file}`);

const observedEvidence = (
  evidenceKind: string,
  subjectRef: string,
  sourceRef: string = EVIDENCE_SOURCE_REF,
  token: string = TOKEN,
): Record<string, unknown> => ({
  id: `evs:${token}:${evidenceKind}`,
  evidenceKind,
  subjectRef,
  sourceRef,
  observationState: "observed",
  observedAt: "2026-04-28T05:00:00.000Z",
  retrievedAt: "2026-04-28T13:00:04.000Z",
  freshness: "fresh",
});

const baselineEvidence = (): Array<Record<string, unknown>> => [
  observedEvidence("request", REQUEST_REF),
  observedEvidence("identity-resolution", ACTOR_REF),
  observedEvidence("bank-instruction", INSTRUCTION_REF),
  observedEvidence("balance", ACCOUNT_REF),
  observedEvidence("planned-withdrawals", HOUSEHOLD_REF),
  observedEvidence("authority", GRANT_REF),
  observedEvidence("policy", POLICY_VERSION_REF),
  observedEvidence("household-instruction", HOUSEHOLD_REF),
  observedEvidence("tax-review", REQUEST_REF),
  observedEvidence("time-zone-rule", TIME_ZONE_RULE_REF),
  observedEvidence("execution-precondition", REQUEST_REF),
];

const realDerivedCase = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const evidence = baselineEvidence();
  const label = overrides.label as
    | { kind: "defect"; defectClassId: string }
    | { kind: "clean-control" }
    | undefined;
  const defectClassId =
    label?.kind === "defect"
      ? label.defectClassId
      : label?.kind === "clean-control"
        ? undefined
        : "destination-integrity-defect";
  const item = {
  caseId: "RD-00112233445566aa",
  firmRef: FIRM_REF,
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
  subjects: [
    REQUEST_REF,
    HOUSEHOLD_REF,
    ACCOUNT_REF,
    INSTRUCTION_REF,
    OWNER_REF,
    ACTOR_REF,
    GRANT_REF,
    POLICY_REF,
    POLICY_VERSION_REF,
    TIME_ZONE_RULE_REF,
  ],
  replayPayload: {
    schemaVersion: "verin-real-derived-replay/1.10.0",
    request: {
      firmRef: FIRM_REF,
      requestRef: REQUEST_REF,
      householdRef: HOUSEHOLD_REF,
      action: "distribution",
      actorRef: ACTOR_REF,
      sourceAccountRef: ACCOUNT_REF,
      destinationRef: INSTRUCTION_REF,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
      amountMinor: 10_000,
      currency: "USD",
      deadlineAt: "2026-04-30T13:00:00.000Z",
      settlementEarliestAt: "2026-04-29T13:00:00.000Z",
    },
    identity: {
      subjectRef: ACTOR_REF,
      resolution: "unique",
      candidateRefs: [ACTOR_REF],
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    destination: {
      instructionRef: INSTRUCTION_REF,
      householdRef: HOUSEHOLD_REF,
      ownerRefs: [OWNER_REF],
      ownership: "same-household",
      verificationState: "verified",
      discriminatorState: "collision",
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    liquidity: {
      sources: [
        {
          accountRef: ACCOUNT_REF,
          householdRef: HOUSEHOLD_REF,
          ownerRefs: [OWNER_REF],
          evidenceSourceRef: EVIDENCE_SOURCE_REF,
          availableMinor: 20_000,
          sourceTaxClass: "taxable",
        },
      ],
      selectedFundingRefs: [ACCOUNT_REF],
      reserveState: "modeled-scalar",
      reserveRequiredMinor: 1_000,
      reserveEvidenceSourceRef: EVIDENCE_SOURCE_REF,
      withdrawalSegmentsMinor: [1_000],
      pendingAction: {
        actionRef: null,
        accountRef: null,
        householdRef: null,
        actionKind: null,
        actionState: null,
        direction: null,
        liquidityClass: null,
        availableMinorIncludesAction: null,
        amountMinor: null,
        evidenceSourceRef: null,
        reducesEffectiveLiquidity: false,
        increasesAvailableLiquidity: false,
      },
    },
    authority: {
      grantRef: GRANT_REF,
      actorRef: ACTOR_REF,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
      authorityScope: "distribution-request",
      authorityState: "effective",
      validFrom: "2026-04-01T13:00:00.000Z",
      validTo: null,
    },
    policy: {
      policyRef: POLICY_REF,
      policyVersionRef: POLICY_VERSION_REF,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
      thresholdMinor: 5_000,
      thresholdComparator: "strict",
      thresholdComparison: "above",
      restrictionRef: null,
      restrictionEvidenceSourceRef: null,
      restrictionState: "absent",
      restrictionEffectiveFrom: null,
      restrictionEffectiveTo: null,
      legalHoldRef: null,
      legalHoldEvidenceSourceRef: null,
      legalHoldScope: "none",
    },
    taxReviewState: "not-required",
    taxReviewEvidenceSourceRef: EVIDENCE_SOURCE_REF,
    instructionConflict: {
      conflictState: "none",
      requestRef: REQUEST_REF,
      householdRef: HOUSEHOLD_REF,
      instructions: [],
      impactedSubjectRefs: [],
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    temporal: {
      eventAt: "2026-04-28T13:00:00.000Z",
      timeZoneRuleRef: TIME_ZONE_RULE_REF,
      transitionState: "daylight",
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
    outcomes: [],
    evidenceRefs: evidence.map((entry) => String(entry.id)),
    execution: {
      reservationKeys: [
        "conflict:tok:0123456789abcdef:liquidity",
      ],
      preconditions: ["evidence-fresh"],
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    },
  },
  evidence,
  reservations: [{
    firmRef: FIRM_REF,
    family: "liquidity",
    conflictKey: "conflict:tok:0123456789abcdef:liquidity",
  }],
  ...overrides,
  };
  const payload = item.replayPayload as Record<string, any>;
  payload.outcomes = treatmentOutcomes(payload, defectClassId);
  return item;
};

const realDerivedDefectCase = (defectClassId: string): Record<string, unknown> => {
  const item = realDerivedCase({
    label: { kind: "defect", defectClassId },
  });
  const payload = item.replayPayload as Record<string, any>;
  payload.destination.discriminatorState = "unique";
  switch (defectClassId) {
    case "identity-resolution-ambiguity":
      payload.identity.resolution = "ambiguous";
      payload.identity.candidateRefs.push(ACTOR_REF_ALT);
      (item.subjects as string[]).push(ACTOR_REF_ALT);
      break;
    case "authority-scope-error":
      payload.authority.authorityScope = "other";
      payload.authority.authorityState = "wrong-scope";
      break;
    case "destination-integrity-defect":
      payload.destination.discriminatorState = "collision";
      break;
    case "instruction-conflict-unresolved": {
      payload.instructionConflict = {
        conflictState: "present",
        requestRef: REQUEST_REF,
        householdRef: HOUSEHOLD_REF,
        instructions: [
          {
            instructionRef: INSTRUCTION_REF,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "required",
            },
          },
          {
            instructionRef: INSTRUCTION_REF_ALT,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "forbidden",
            },
          },
        ],
        impactedSubjectRefs: [ACCOUNT_REF],
        evidenceSourceRef: EVIDENCE_SOURCE_REF,
      };
      const unresolvedEvidence =
        item.evidence as Array<Record<string, unknown>>;
      const unresolvedConflictEvidence = unresolvedEvidence.find(
        (entry) => entry.evidenceKind === "household-instruction",
      )!;
      unresolvedConflictEvidence.subjectRef = INSTRUCTION_REF;
      unresolvedEvidence.push(
        observedEvidence(
          "household-instruction",
          INSTRUCTION_REF_ALT,
          EVIDENCE_SOURCE_REF,
          TOKEN_ALT,
        ),
      );
      payload.evidenceRefs = unresolvedEvidence.map((entry) => entry.id);
      (item.subjects as string[]).push(INSTRUCTION_REF_ALT);
      break;
    }
    case "liquidity-reserve-miscalculation":
      payload.liquidity.reserveState = "modeled-segmented";
      payload.liquidity.withdrawalSegmentsMinor = [500, 1_000];
      break;
    case "evidence-staleness-unnoticed":
      (item.evidence as Array<Record<string, unknown>>).find(
        (entry) => entry.evidenceKind === "balance",
      )!.observedAt =
        "2026-04-26T05:00:00.000Z";
      (item.evidence as Array<Record<string, unknown>>).find(
        (entry) => entry.evidenceKind === "balance",
      )!.freshness = "stale";
      break;
    case "evidence-interval-collapse": {
      payload.authority.authorityState = "expired";
      payload.authority.validTo = "2026-04-28T10:00:00.000Z";
      break;
    }
    case "restriction-lifecycle-error":
      payload.policy.restrictionRef = RESTRICTION_REF;
      payload.policy.restrictionEvidenceSourceRef = EVIDENCE_SOURCE_REF;
      payload.policy.restrictionState = "expired";
      payload.policy.restrictionEffectiveFrom =
        "2025-01-01T00:00:00.000Z";
      payload.policy.restrictionEffectiveTo =
        "2026-04-27T00:00:00.000Z";
      (item.subjects as string[]).push(RESTRICTION_REF);
      (item.evidence as Array<Record<string, unknown>>).push(
        observedEvidence("restriction", RESTRICTION_REF),
      );
      payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
        .map((entry) => entry.id);
      break;
    case "hold-scope-error":
      payload.policy.legalHoldRef = LEGAL_HOLD_REF;
      payload.policy.legalHoldEvidenceSourceRef = EVIDENCE_SOURCE_REF;
      payload.policy.legalHoldScope = "position";
      (item.subjects as string[]).push(LEGAL_HOLD_REF);
      (item.evidence as Array<Record<string, unknown>>).push(
        observedEvidence("legal-hold", LEGAL_HOLD_REF),
      );
      payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
        .map((entry) => entry.id);
      break;
    case "pending-activity-miscount":
      payload.liquidity.pendingAction = {
        actionRef: PENDING_ACTION_REF,
        accountRef: ACCOUNT_REF,
        householdRef: HOUSEHOLD_REF,
        actionKind: "outgoing-distribution",
        actionState: "blocked",
        direction: "outgoing",
        liquidityClass: "distribution",
        availableMinorIncludesAction: false,
        amountMinor: 500,
        evidenceSourceRef: EVIDENCE_SOURCE_REF,
        reducesEffectiveLiquidity: false,
        increasesAvailableLiquidity: false,
      };
      (item.subjects as string[]).push(PENDING_ACTION_REF);
      (item.evidence as Array<Record<string, unknown>>).push(
        observedEvidence("pending-actions", PENDING_ACTION_REF),
      );
      payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
        .map((entry) => entry.id);
      break;
    case "temporal-rendering-defect":
      payload.temporal.transitionState = "boundary";
      break;
    case "canonical-identity-defect":
      payload.identity.resolution = "canonical-collision";
      payload.identity.candidateRefs.push(ACTOR_REF_ALT);
      (item.subjects as string[]).push(ACTOR_REF_ALT);
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
        requestRef: REQUEST_REF,
        householdRef: HOUSEHOLD_REF,
        instructions: [
          {
            instructionRef: INSTRUCTION_REF,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "required",
            },
          },
          {
            instructionRef: INSTRUCTION_REF_ALT,
            firmRef: FIRM_REF,
            householdRef: HOUSEHOLD_REF,
            term: {
              governedAction: "distribution",
              sourceAccountRef: ACCOUNT_REF,
              targetKind: "destination-instruction",
              targetRef: INSTRUCTION_REF,
              polarity: "forbidden",
            },
          },
        ],
        impactedSubjectRefs: [ACCOUNT_REF, ACCOUNT_REF_ALT],
        evidenceSourceRef: EVIDENCE_SOURCE_REF_ALT,
      };
      const evidence = item.evidence as Array<Record<string, unknown>>;
      const conflictEvidence = evidence.find(
        (entry) => entry.evidenceKind === "household-instruction",
      )!;
      conflictEvidence.subjectRef = INSTRUCTION_REF;
      conflictEvidence.sourceRef = EVIDENCE_SOURCE_REF_ALT;
      evidence.push(
        observedEvidence(
          "household-instruction",
          INSTRUCTION_REF_ALT,
          EVIDENCE_SOURCE_REF_ALT,
          TOKEN_ALT,
        ),
        {
          ...observedEvidence(
            "recent-change",
            ACCOUNT_REF,
            EVIDENCE_SOURCE_REF_ALT,
          ),
          retrievedAt: "2026-04-28T13:00:03.000Z",
        },
        {
          ...observedEvidence(
            "recent-change",
            ACCOUNT_REF_ALT,
            EVIDENCE_SOURCE_REF_ALT,
            TOKEN_ALT,
          ),
          retrievedAt: "2026-04-28T13:00:03.000Z",
        },
      );
      payload.evidenceRefs = evidence.map((entry) => entry.id);
      (item.subjects as string[]).push(
        INSTRUCTION_REF_ALT,
        ACCOUNT_REF_ALT,
      );
      break;
    }
    case "tax-consequence-blindness":
      payload.liquidity.sources[0].sourceTaxClass = "retirement";
      payload.taxReviewState = "required-pending";
      break;
  }
  payload.outcomes = treatmentOutcomes(payload, defectClassId);
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

  it("(c) enforces: product and tooling code never blend provenance partitions", () => {
    const violations = blendingViolations(measuredCodeProject(), REPO_ROOT);
    expect(
      violations,
      `blended provenance figures:\n${violations.join("\n")}`,
    ).toEqual([]);
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
    expect(report).toContain("No detection rate is claimed");
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
        titledTo: "subject:mira-smith",
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
      "verin-real-derived-case/1.4.0",
      "verin-real-derived-replay/1.10.0",
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
  it.each([
    [
      "arithmetic",
      "declare const r: any; export const score = r.synthetic.defectCases + r.realDerived.defectCases;",
    ],
    [
      "a reducer",
      "declare const r: any; export const score = [r.synthetic.defectCases, r.realDerived.defectCases].reduce((a, b) => a + b, 0);",
    ],
    [
      "a helper call",
      "declare const r: any; declare const combine: (...values: number[]) => number; const left = r.synthetic.defectCases; const right = r.realDerived.defectCases; export const score = combine(left, right);",
    ],
    [
      "array concatenation",
      "declare const r: any; export const score = [r.synthetic.defectCases].concat([r.realDerived.defectCases]);",
    ],
    [
      "a shadow named like the report boundary",
      "declare const r: any; const renderCorpusReport = (...values: number[]) => values.length; export const score = renderCorpusReport(r.synthetic.defectCases, r.realDerived.defectCases);",
    ],
    [
      "a rendered template",
      "declare const r: any; export const score = `${r.synthetic.defectCases}/${r.realDerived.defectCases}`;",
    ],
    [
      "a tagged template",
      "declare const r: any; export const score = String.raw`${r.synthetic.defectCases}/${r.realDerived.defectCases}`;",
    ],
    [
      "a constructor",
      "declare const r: any; declare class Combined { constructor(...values: number[]); } export const score = new Combined(r.synthetic.defectCases, r.realDerived.defectCases);",
    ],
  ])("a blended figure through %s is caught", (_name, source) => {
    expect(
      blendingViolations(
        inMemoryProject({ "/src/domain/blend.ts": source }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("partition values remain tainted through imported aliases", () => {
    const project = inMemoryProject({
      "/src/domain/synthetic.ts":
        "declare const r: any; export const value = r.synthetic.defectCases;",
      "/src/domain/real.ts":
        "declare const r: any; export const value = r.realDerived.defectCases;",
      "/src/domain/blend.ts":
        'import { value as left } from "./synthetic"; import { value as right } from "./real"; export const score = left + right;',
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("partition values remain tainted through computed and destructured access", () => {
    const project = inMemoryProject({
      "/src/domain/blend.ts":
        'declare const r: any; const { synthetic: left, realDerived: right } = r; export const score = left.defectCases + r["realDerived"].defectCases + right.cleanControls;',
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("partition values remain tainted through constant computed keys", () => {
    const project = inMemoryProject({
      "/src/domain/blend.ts":
        'declare const r: any; const leftKey = "synthetic"; const rightKey = "realDerived"; export const score = r[leftKey].defectCases + r[rightKey].defectCases;',
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("partition values remain tainted through assignments", () => {
    const project = inMemoryProject({
      "/src/domain/blend.ts":
        "declare const r: any; let left; let right; left = r.synthetic.defectCases; right = r.realDerived.defectCases; export const score = left + right;",
      "/src/domain/member-blend.ts":
        "declare const r: any; const values: any = {}; values.left = r.synthetic.defectCases; values.right = r.realDerived.defectCases; export const score = values.left + values.right;",
      "/src/domain/assigned-synthetic.ts":
        "declare const r: any; export let value; value = r.synthetic.defectCases;",
      "/src/domain/assigned-real.ts":
        "declare const r: any; export let value; value = r.realDerived.defectCases;",
      "/src/domain/imported-blend.ts":
        'import { value as left } from "./assigned-synthetic"; import { value as right } from "./assigned-real"; export const score = left + right;',
    });
    expect(blendingViolations(project)).toHaveLength(3);
  });

  it("member assignment taint stays on the assigned path", () => {
    expect(
      blendingViolations(
        inMemoryProject({
          "/src/domain/synthetic.ts":
            "declare const r: any; const values: any = {}; values.left = r.synthetic.defectCases; export const score = values.right + r.realDerived.defectCases;",
        }),
      ),
    ).toEqual([]);
  });

  it("arithmetic confined to one partition remains legal", () => {
    expect(
      blendingViolations(
        inMemoryProject({
          "/src/domain/synthetic.ts":
            "declare const r: any; export const score = r.synthetic.defectCases + r.synthetic.cleanControls;",
        }),
      ),
    ).toEqual([]);
  });

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

  it("a request source account must belong to the request household", () => {
    const world = structuredClone(real.spec.world);
    const cases = structuredClone(real.spec.cases);
    const corpusCase = cases.cases[0]!;
    const foreignAccount = world.accounts.find(
      (account) => account.householdRef !== corpusCase.householdRef,
    )!;
    corpusCase.request.sourceAccountRef = foreignAccount.key;
    expect(specReferenceProblems(world, cases).join("\n")).toContain(
      `belongs to household "${foreignAccount.householdRef}", not request household "${corpusCase.householdRef}"`,
    );
  });

  it("AS-04 requires its cited signer to remain outside the request household membership", () => {
    const world = structuredClone(real.spec.world);
    const cases = structuredClone(real.spec.cases);
    expect(specReferenceProblems(world, cases)).toEqual([]);
    const emitted = real.cases.find(
      (item) => item.caseId === "CS-llc-signer-outside-household",
    )!;
    expect(
      emitted.records.parties.filter(
        (party) => party.id === "subject:kessa-varn",
      ),
    ).toHaveLength(1);
    expect(emitted.records.household.memberRefs).not.toContain(
      "subject:kessa-varn",
    );

    world.households.find(
      (household) => household.key === "varn",
    )!.memberRefs.push("kessa-varn");
    expect(specReferenceProblems(world, cases).join("\n")).toContain(
      "AS-04 outside-household signer",
    );
  });

  it("foreign destination owners use an opaque projection while local parties stay complete", () => {
    const spec = structuredClone(real.spec);
    spec.world.bankInstructions.find(
      (instruction) => instruction.key === "mira-primary",
    )!.titledTo = "kessa-varn";
    const foreignDestination = generateSyntheticCases(spec, CORPUS_SEED)
      .find(
        (file) =>
          file.relPath ===
            "synthetic/CS-beneficiary-versus-destination-restriction.json",
      )!.value as unknown as EmittedCase;
    expect(foreignDestination.records.parties).not.toContainEqual(
      expect.objectContaining({ id: "subject:kessa-varn" }),
    );
    expect(foreignDestination.records.referencedOwners).toEqual([
      { id: "subject:kessa-varn" },
    ]);

    const localDestination = real.cases.find(
      (item) => item.caseId === "CS-clean-verified-destination",
    )!;
    const localOwner = localDestination.records.bankInstructions.find(
      (instruction) => instruction.id === localDestination.request.destinationRef,
    )!.titledTo;
    expect(localDestination.records.parties).toContainEqual(
      expect.objectContaining({ id: localOwner }),
    );
    expect(localDestination.records.referencedOwners).not.toContainEqual({
      id: localOwner,
    });
  });

  it("bank-instruction and pending-action account edges must match their declared households", () => {
    const bankWorld = structuredClone(real.spec.world);
    bankWorld.bankInstructions[0]!.householdRef = "smith-mira";
    expect(
      specReferenceProblems(bankWorld, real.spec.cases).join("\n"),
    ).toContain("bank instruction account belongs to household");

    const pendingWorld = structuredClone(real.spec.world);
    pendingWorld.pendingActions[0]!.accountRef = "mira-roth";
    expect(
      specReferenceProblems(pendingWorld, real.spec.cases).join("\n"),
    ).toContain("pending action account belongs to household");
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

  it("reconciles settled outgoing debits exactly once", () => {
    expect(
      pendingAvailabilitySelector("outgoing-debit", "settled", true),
    ).toBe("settled-outgoing-included");
    expect(
      pendingAvailabilitySelector("outgoing-debit", "settled", false),
    ).toBe("settled-outgoing-excluded");
    expect(
      pendingAvailabilityAdjustmentMinor(
        "outgoing-debit",
        "settled",
        true,
        500n,
      ),
    ).toBe(0n);
    expect(
      pendingAvailabilityAdjustmentMinor(
        "outgoing-debit",
        "settled",
        false,
        500n,
      ),
    ).toBe(-500n);
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
    expect(report).toContain(
      "The detection rate above is claimed only for the real-derived partition",
    );
    expect(report).not.toContain("No detection rate is claimed");
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

    const extraAttribution = outcomes(2, 1, false);
    extraAttribution[0] = {
      ...extraAttribution[0]!,
      attributedDefectClassIds: ["test-defect", "other-defect"],
    };
    const extraInventory = inventoryOf(extraAttribution).map((entry) =>
      entry.caseId === "d1"
        ? { ...entry, labelId: "other-defect" }
        : entry,
    );
    expect(() =>
      renderCorpusReport(
        reportInput(extraAttribution, [], {
          inventory: extraInventory,
        }),
      ),
    ).toThrow("must be empty or the exact signed defect singleton");
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
      "label.defectClassId does not match replay expected-versus-observed semantics",
    );
  });

  it("a real-derived defect label must equal the only semantic defect", () => {
    const item = realDerivedDefectCase("destination-integrity-defect");
    const payload = item.replayPayload as Record<string, any>;
    payload.request.amountMinor = payload.policy.thresholdMinor;
    payload.policy.thresholdComparison = "equal";
    const thresholdRule = semanticContract.defectRules.find(
      (rule) => rule.id === "threshold-boundary-error",
    )!;
    const thresholdTreatment = semanticTreatment(thresholdRule, "strict");
    const thresholdOutcome = payload.outcomes.find(
      (outcome: Record<string, string>) =>
        outcome.defectClassId === "threshold-boundary-error",
    );
    thresholdOutcome.observedTreatment =
      thresholdTreatment.defectTreatment;
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-extra-semantic-defect.json",
      ).join("\n"),
    ).toContain("exactly one replay semantic defect");
  });

  it("awkward context is clean when the recorded treatment is correct", () => {
    const control = realDerivedCase({
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    });
    const payload = control.replayPayload as Record<string, any>;
    payload.destination.discriminatorState = "unique";
    payload.destination.householdRef = HOUSEHOLD_REF_ALT;
    payload.destination.ownership = "cross-household";
    (control.subjects as string[]).push(HOUSEHOLD_REF_ALT);
    expect(
      realDerivedCaseProblems(
        control,
        classes,
        "real-derived/RD-correct-cross-household.json",
      ),
    ).toEqual([]);
  });

  it("a defect claim requires a typed expected-versus-observed mismatch", () => {
    const contextOnly = realDerivedDefectCase(
      "destination-integrity-defect",
    );
    const outcome = (
      (contextOnly.replayPayload as Record<string, any>).outcomes as Array<
        Record<string, string>
      >
    ).find(
      (candidate) =>
        candidate.defectClassId === "destination-integrity-defect",
    )!;
    outcome.observedTreatment = outcome.expectedTreatment!;
    expect(
      realDerivedCaseProblems(
        contextOnly,
        classes,
        "real-derived/RD-context-only.json",
      ).join("\n"),
    ).toContain("expected-versus-observed");
  });

  it.each([...classes])(
    "%s context remains clean under its expected treatment",
    (defectClassId) => {
      const control = realDerivedDefectCase(defectClassId);
      control.label = {
        kind: "clean-control",
        controlRationaleId: "resolved-before-execution",
      };
      const outcome = (
        (control.replayPayload as Record<string, any>).outcomes as Array<
          Record<string, string>
        >
      ).find((candidate) => candidate.defectClassId === defectClassId)!;
      outcome.observedTreatment = outcome.expectedTreatment!;
      expect(
        realDerivedCaseProblems(
          control,
          classes,
          `real-derived/RD-${defectClassId}-correct-treatment.json`,
        ),
      ).toEqual([]);
    },
  );

  it("the signed manifest binds the executable real-derived semantic contract", () => {
    const manifest = real.manifest.value as Record<string, unknown>;
    expect(manifest.realDerivedSemanticContractVersion).toBe(
      "verin-real-derived-semantics/1.11.0",
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

  it("the executable authority inventory equals its complete runtime dependency closure", () => {
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
    expect(
      authorityClosureProblems(
        REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
        REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES,
      ),
    ).toEqual([]);
    expect(
      authorityClosureProblems(
        REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES,
        REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES.filter(
          (file) => file !== "scripts/corpus/clock.ts",
        ),
      ),
    ).toContain(
      "missing executable authority dependency scripts/corpus/clock.ts",
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
        currentFreshnessPolicyBinding(),
        realDerivedSchemaBindings(),
        changedAuthority,
      ),
    ).not.toBe(real.corpusDigest);
  });

  it("a material replay plane requires evidence with matching kind, subject, and source", () => {
    const item = realDerivedCase();
    item.evidence = (item.evidence as Array<Record<string, unknown>>).filter(
      (entry) => entry.evidenceKind !== "bank-instruction",
    );
    (item.replayPayload as Record<string, any>).evidenceRefs = (
      item.evidence as Array<Record<string, unknown>>
    ).map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-unsupported-destination.json",
      ).join("\n"),
    ).toContain("destination evidence");
  });

  it("entity-kind-scoped references prevent one token from satisfying the replay topology", () => {
    const item = realDerivedCase();
    (item.replayPayload as Record<string, any>).request.requestRef = OPAQUE;
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-token-reuse.json",
      ).join("\n"),
    ).toContain("schema validation failed");
  });

  it("unique identity resolution binds its sole candidate to the resolved subject", () => {
    const item = realDerivedCase();
    const payload = item.replayPayload as Record<string, any>;
    payload.identity.candidateRefs = [ACTOR_REF_ALT];
    (item.subjects as string[]).push(ACTOR_REF_ALT);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-unrelated-identity-candidate.json",
      ).join("\n"),
    ).toContain("unique identity candidate must equal identity.subjectRef");

    const empty = realDerivedCase();
    (empty.replayPayload as Record<string, any>).identity.candidateRefs = [];
    expect(
      realDerivedCaseProblems(
        empty,
        classes,
        "real-derived/RD-empty-identity-candidate.json",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("instruction conflicts bind to the governed request and its actual subjects", () => {
    const item = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    );
    const payload = item.replayPayload as Record<string, any>;
    payload.instructionConflict.instructions = [
      {
        instructionRef: INSTRUCTION_REF_ALT,
        firmRef: FIRM_REF,
        householdRef: HOUSEHOLD_REF,
        term: {
          governedAction: "distribution",
          sourceAccountRef: ACCOUNT_REF,
          targetKind: "destination-instruction",
          targetRef: INSTRUCTION_REF,
          polarity: "required",
        },
      },
      {
        instructionRef: `instruction:tok:0011223344556677`,
        firmRef: FIRM_REF,
        householdRef: HOUSEHOLD_REF,
        term: {
          governedAction: "distribution",
          sourceAccountRef: ACCOUNT_REF,
          targetKind: "destination-instruction",
          targetRef: INSTRUCTION_REF,
          polarity: "forbidden",
        },
      },
    ];
    payload.instructionConflict.impactedSubjectRefs = [OWNER_REF_ALT];
    (item.subjects as string[]).push(
      `instruction:tok:0011223344556677`,
      OWNER_REF_ALT,
    );
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-disconnected-conflict.json",
      ).join("\n"),
    ).toContain("instruction conflict");
  });

  it("instruction conflict topology rejects wrong request, household, and instruction ownership", () => {
    const mutations: Array<(item: Record<string, any>) => void> = [
      (item) => {
        item.replayPayload.instructionConflict.requestRef =
          "request:tok:0011223344556677";
        item.subjects.push("request:tok:0011223344556677");
      },
      (item) => {
        item.replayPayload.instructionConflict.householdRef =
          HOUSEHOLD_REF_ALT;
        item.subjects.push(HOUSEHOLD_REF_ALT);
      },
      (item) => {
        item.replayPayload.instructionConflict.instructions[0].householdRef =
          HOUSEHOLD_REF_ALT;
        item.subjects.push(HOUSEHOLD_REF_ALT);
      },
      (item) => {
        item.replayPayload.instructionConflict.instructions[0].firmRef =
          FIRM_REF_ALT;
      },
    ];
    for (const mutate of mutations) {
      const item = realDerivedDefectCase(
        "instruction-conflict-unresolved",
      ) as Record<string, any>;
      mutate(item);
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-wrong-conflict-topology.json",
        ).join("\n"),
      ).toContain("instruction conflict");
    }
  });

  it("real-derived instruction conflict truth requires connected typed terms", () => {
    const termless = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    ) as Record<string, any>;
    delete termless.replayPayload.instructionConflict.instructions[0].term;
    expect(
      realDerivedCaseProblems(
        termless,
        classes,
        "real-derived/RD-termless-conflict.json",
      ).join("\n"),
    ).toContain("instructionConflict.instructions.0.term");

    const unconnected = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    ) as Record<string, any>;
    for (const instruction of unconnected.replayPayload
      .instructionConflict.instructions) {
      instruction.term.sourceAccountRef = ACCOUNT_REF_ALT;
    }
    unconnected.subjects.push(ACCOUNT_REF_ALT);
    expect(
      realDerivedCaseProblems(
        unconnected,
        classes,
        "real-derived/RD-unconnected-conflict.json",
      ).join("\n"),
    ).toContain(
      "instruction conflict state does not match the signed typed instruction terms",
    );

    const governed = realDerivedCase({
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    }) as Record<string, any>;
    governed.replayPayload.destination.discriminatorState = "unique";
    governed.replayPayload.instructionConflict.instructions = [{
      instructionRef: INSTRUCTION_REF_ALT,
      firmRef: FIRM_REF,
      householdRef: HOUSEHOLD_REF,
      term: {
        governedAction: "distribution",
        sourceAccountRef: ACCOUNT_REF,
        targetKind: "destination-instruction",
        targetRef: INSTRUCTION_REF,
        polarity: "required",
      },
    }];
    governed.subjects.push(INSTRUCTION_REF_ALT);
    (governed.evidence as Array<Record<string, unknown>>).find(
      (entry) => entry.evidenceKind === "household-instruction",
    )!.subjectRef = INSTRUCTION_REF_ALT;
    governed.replayPayload.outcomes = treatmentOutcomes(
      governed.replayPayload,
    );
    expect(
      realDerivedCaseProblems(
        governed,
        classes,
        "real-derived/RD-governed-instruction.json",
      ),
    ).toEqual([]);
  });

  it("selected funding is explicit and aggregate sufficiency supports tax outcome attribution", () => {
    const defect = realDerivedDefectCase("tax-consequence-blindness");
    const payload = defect.replayPayload as Record<string, any>;
    payload.taxReviewState = "required-pending";
    payload.liquidity.sources = [
      {
        accountRef: ACCOUNT_REF,
        householdRef: HOUSEHOLD_REF,
        ownerRefs: [OWNER_REF],
        evidenceSourceRef: EVIDENCE_SOURCE_REF,
        availableMinor: 6_000,
        sourceTaxClass: "retirement",
      },
      {
        accountRef: ACCOUNT_REF_ALT,
        householdRef: HOUSEHOLD_REF,
        ownerRefs: [OWNER_REF],
        evidenceSourceRef: EVIDENCE_SOURCE_REF_ALT,
        availableMinor: 6_000,
        sourceTaxClass: "retirement",
      },
    ];
    payload.liquidity.selectedFundingRefs = [ACCOUNT_REF, ACCOUNT_REF_ALT];
    (defect.subjects as string[]).push(ACCOUNT_REF_ALT);
    const evidence = defect.evidence as Array<Record<string, unknown>>;
    evidence.push(
      observedEvidence(
        "balance",
        ACCOUNT_REF_ALT,
        EVIDENCE_SOURCE_REF_ALT,
        TOKEN_ALT,
      ),
    );
    payload.evidenceRefs = evidence.map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        defect,
        classes,
        "real-derived/RD-aggregate-funding.json",
      ),
    ).toEqual([]);
  });

  it("selected funding rejects missing, duplicate, unsupported, insufficient, cross-household, and unknown-tax selections", () => {
    const invalid = [
      (payload: Record<string, any>) => {
        delete payload.liquidity.selectedFundingRefs;
      },
      (payload: Record<string, any>) => {
        payload.liquidity.selectedFundingRefs.push(ACCOUNT_REF);
      },
      (payload: Record<string, any>) => {
        payload.liquidity.selectedFundingRefs = [ACCOUNT_REF_ALT];
      },
      (payload: Record<string, any>) => {
        payload.liquidity.sources[0].availableMinor = 10;
      },
      (payload: Record<string, any>) => {
        payload.liquidity.sources[0].householdRef = HOUSEHOLD_REF_ALT;
      },
      (payload: Record<string, any>) => {
        payload.liquidity.sources[0].sourceTaxClass = "unknown";
      },
    ];
    for (const mutate of invalid) {
      const item = realDerivedCase();
      mutate(item.replayPayload as Record<string, any>);
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-invalid-funding.json",
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("selected funding rejects an additional source owned outside the request source ownership", () => {
    const item = realDerivedCase();
    const payload = item.replayPayload as Record<string, any>;
    payload.liquidity.sources.push({
      accountRef: ACCOUNT_REF_ALT,
      householdRef: HOUSEHOLD_REF,
      ownerRefs: [OWNER_REF_ALT],
      evidenceSourceRef: EVIDENCE_SOURCE_REF_ALT,
      availableMinor: 10_000,
      sourceTaxClass: "taxable",
    });
    payload.liquidity.selectedFundingRefs.push(ACCOUNT_REF_ALT);
    (item.subjects as string[]).push(ACCOUNT_REF_ALT, OWNER_REF_ALT);
    (item.evidence as Array<Record<string, unknown>>).push(
      observedEvidence(
        "balance",
        ACCOUNT_REF_ALT,
        EVIDENCE_SOURCE_REF_ALT,
        TOKEN_ALT,
      ),
    );
    payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
      .map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-cross-owner.json",
      ).join("\n"),
    ).toContain(
      "selected funding sources must share an owner with the request source account",
    );
  });

  it("request source accounts and evidence tuples resolve at their exact ownership edges", () => {
    const missingSource = realDerivedCase();
    (missingSource.replayPayload as Record<string, any>).request.sourceAccountRef =
      ACCOUNT_REF_ALT;
    expect(
      realDerivedCaseProblems(
        missingSource,
        classes,
        "real-derived/RD-missing-source.json",
      ).join("\n"),
    ).toContain("sourceAccountRef resolves to 0");

    for (const mutate of [
      (evidence: Record<string, unknown>) => {
        evidence.evidenceKind = "request";
        evidence.id = `evs:${TOKEN_ALT}:request`;
      },
      (evidence: Record<string, unknown>) => {
        evidence.subjectRef = INSTRUCTION_REF_ALT;
      },
      (evidence: Record<string, unknown>) => {
        evidence.sourceRef = EVIDENCE_SOURCE_REF_ALT;
      },
    ]) {
      const item = realDerivedCase();
      const evidence = (
        item.evidence as Array<Record<string, unknown>>
      ).find((entry) => entry.evidenceKind === "bank-instruction")!;
      mutate(evidence);
      (item.replayPayload as Record<string, any>).evidenceRefs = (
        item.evidence as Array<Record<string, unknown>>
      ).map((entry) => entry.id);
      if (evidence.subjectRef === INSTRUCTION_REF_ALT) {
        (item.subjects as string[]).push(INSTRUCTION_REF_ALT);
      }
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-mismatched-evidence.json",
        ).join("\n"),
      ).toContain("destination evidence");
    }

    const authority = realDerivedCase();
    (
      authority.evidence as Array<Record<string, unknown>>
    ).find((entry) => entry.evidenceKind === "authority")!.subjectRef =
      ACTOR_REF;
    expect(
      realDerivedCaseProblems(
        authority,
        classes,
        "real-derived/RD-wrong-authority-subject.json",
      ).join("\n"),
    ).toContain("authority evidence");
  });

  it.each([
    ["request", "request"],
    ["balance", "liquidity-source"],
    ["identity-resolution", "identity"],
  ])(
    "missing %s evidence cannot support a concrete replay plane",
    (evidenceKind, plane) => {
      const item = realDerivedCase();
      const evidence = (
        item.evidence as Array<Record<string, unknown>>
      ).find((entry) => entry.evidenceKind === evidenceKind)!;
      evidence.observationState = "missing";
      evidence.observedAt = null;
      evidence.freshness = "unknown";
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-missing-material-evidence.json",
        ).join("\n"),
      ).toContain(`${plane} evidence requires observed support`);
    },
  );

  it("real-derived cases require one exact firm scope across case, request, and reservations", () => {
    const absent = realDerivedCase();
    delete (absent as Record<string, unknown>).firmRef;
    expect(
      realDerivedCaseProblems(
        absent,
        classes,
        "real-derived/RD-missing-firm.json",
      ).join("\n"),
    ).toContain("firmRef");

    const mismatchedRequest = realDerivedCase();
    (
      mismatchedRequest.replayPayload as Record<string, any>
    ).request.firmRef = FIRM_REF_ALT;
    expect(
      realDerivedCaseProblems(
        mismatchedRequest,
        classes,
        "real-derived/RD-mismatched-request-firm.json",
      ).join("\n"),
    ).toContain("request firmRef must equal the case firmRef");

    const crossFirmReservation = realDerivedCase();
    (
      crossFirmReservation.reservations as Array<Record<string, unknown>>
    )[0]!.firmRef = FIRM_REF_ALT;
    expect(
      realDerivedCaseProblems(
        crossFirmReservation,
        classes,
        "real-derived/RD-cross-firm-reservation.json",
      ).join("\n"),
    ).toContain("every reservation firmRef must equal the case firmRef");

    const impactedSubject = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    );
    (
      impactedSubject.replayPayload as Record<string, any>
    ).instructionConflict.impactedSubjectRefs = [FIRM_REF_ALT];
    expect(
      realDerivedCaseProblems(
        impactedSubject,
        classes,
        "real-derived/RD-firm-impacted-subject.json",
      ).join("\n"),
    ).toContain("schema validation failed");

    const subjectInventory = realDerivedCase();
    (subjectInventory.subjects as string[]).push(FIRM_REF_ALT);
    expect(
      realDerivedCaseProblems(
        subjectInventory,
        classes,
        "real-derived/RD-firm-subject-inventory.json",
      ).join("\n"),
    ).toContain("schema validation failed");
  });

  it("real-derived funding aggregates preserve exact minor-unit arithmetic", () => {
    const precision = realDerivedCase();
    const payload = precision.replayPayload as Record<string, any>;
    payload.request.amountMinor = Number.MAX_SAFE_INTEGER;
    payload.liquidity.reserveRequiredMinor = 2;
    payload.liquidity.withdrawalSegmentsMinor = [2];
    payload.liquidity.sources[0].availableMinor =
      Number.MAX_SAFE_INTEGER;
    payload.liquidity.sources.push({
      ...payload.liquidity.sources[0],
      accountRef: ACCOUNT_REF_ALT,
      availableMinor: 1,
    });
    payload.liquidity.selectedFundingRefs.push(ACCOUNT_REF_ALT);
    (precision.subjects as string[]).push(ACCOUNT_REF_ALT);
    (precision.evidence as Array<Record<string, unknown>>).push(
      observedEvidence("balance", ACCOUNT_REF_ALT, EVIDENCE_SOURCE_REF, TOKEN_ALT),
    );
    payload.evidenceRefs = (
      precision.evidence as Array<Record<string, unknown>>
    ).map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        precision,
        classes,
        "real-derived/RD-exact-funding.json",
      ).join("\n"),
    ).toContain(
      "selected funding aggregate does not cover request and reserve after exact-once pending-action accounting",
    );

    const expectUnsafe = (
      mutate: (payload: Record<string, any>) => void,
    ): void => {
      const unsafe = realDerivedCase();
      mutate(unsafe.replayPayload as Record<string, any>);
      expect(
        realDerivedCaseProblems(
          unsafe,
          classes,
          "real-derived/RD-unsafe-funding.json",
        ).join("\n"),
      ).toContain("schema validation failed");
    };
    const unsafeMinor = Number.MAX_SAFE_INTEGER + 1;
    expectUnsafe((item) => { item.request.amountMinor = unsafeMinor; });
    expectUnsafe((item) => {
      item.liquidity.sources[0].availableMinor = unsafeMinor;
    });
    expectUnsafe((item) => {
      item.liquidity.reserveRequiredMinor = unsafeMinor;
    });
    expectUnsafe((item) => {
      item.liquidity.withdrawalSegmentsMinor = [unsafeMinor];
    });
    expectUnsafe((item) => {
      item.liquidity.pendingAction.amountMinor = unsafeMinor;
    });
  });

  it("every semantic evidence plane has an explicit observation-state authority", () => {
    expect(
      evidenceObservationAuthorityProblems(
        semanticContract.evidencePlanes.map((entry) => entry.plane),
      ),
    ).toEqual([]);
    expect(
      evidenceObservationAuthorityProblems([
        ...semanticContract.evidencePlanes.map((entry) => entry.plane),
        "later-material-plane",
      ]).join("\n"),
    ).toContain(
      'evidence plane "later-material-plane" has no observation-state authority',
    );
  });

  it("pending actions bind to the request household, selected account, and exact evidence", () => {
    const mutations: Array<(item: Record<string, any>) => void> = [
      (item) => {
        item.replayPayload.liquidity.pendingAction.householdRef =
          HOUSEHOLD_REF_ALT;
        item.subjects.push(HOUSEHOLD_REF_ALT);
      },
      (item) => {
        item.replayPayload.liquidity.pendingAction.accountRef =
          ACCOUNT_REF_ALT;
        item.subjects.push(ACCOUNT_REF_ALT);
      },
      (item) => {
        const evidence = item.evidence.find(
          (entry: Record<string, unknown>) =>
            entry.evidenceKind === "pending-actions",
        );
        evidence.subjectRef = ACCOUNT_REF;
      },
      (item) => {
        const evidence = item.evidence.find(
          (entry: Record<string, unknown>) =>
            entry.evidenceKind === "pending-actions",
        );
        evidence.sourceRef = EVIDENCE_SOURCE_REF_ALT;
      },
    ];
    for (const mutate of mutations) {
      const item = realDerivedDefectCase(
        "pending-activity-miscount",
      ) as Record<string, any>;
      mutate(item);
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-invalid-pending-topology.json",
        ).join("\n"),
      ).toMatch(/pending action|pending-action evidence/);
    }
  });

  it("synthetic selected funding is explicit, unique, and owned by the request household", () => {
    for (const item of real.cases) {
      const selected = (item.request as Record<string, unknown>)
        .selectedFundingRefs;
      expect(Array.isArray(selected)).toBe(true);
      expect((selected as string[]).length).toBeGreaterThan(0);
      expect(new Set(selected as string[]).size).toBe(
        (selected as string[]).length,
      );
      for (const accountRef of selected as string[]) {
        expect(
          item.records.accounts.filter(
            (account) =>
              account.id === accountRef &&
              account.householdRef === item.request.householdRef,
          ),
        ).toHaveLength(1);
      }
    }

    const duplicate = structuredClone(real.spec.cases) as Record<
      string,
      any
    >;
    duplicate.cases[0].request.selectedFundingRefs = [
      "smiths-joint-taxable",
      "smiths-joint-taxable",
    ];
    expect(
      specReferenceProblems(real.spec.world, duplicate as any).join("\n"),
    ).toContain("selectedFundingRefs: duplicate reference");

    const crossHousehold = structuredClone(real.spec.cases) as Record<
      string,
      any
    >;
    crossHousehold.cases[0].request.selectedFundingRefs = ["mira-roth"];
    expect(
      specReferenceProblems(
        real.spec.world,
        crossHousehold as any,
      ).join("\n"),
    ).toContain("selected funding account belongs to household");
  });

  it("synthetic identity context derives from exact emitted inputs and bindings", () => {
    const ambiguous = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-identity-trust-name-collision",
      )!,
    ) as any;
    expect(ambiguous.identityInput.candidates).toHaveLength(2);
    expect(
      ambiguous.records.referencedHouseholds,
    ).toContainEqual({
      id: "subject:smith-mira",
      relationshipReasons: ["identity-candidate"],
    });
    expect(syntheticSemanticProblems([ambiguous])).toEqual([]);

    const assumptionOnly = structuredClone(ambiguous);
    delete assumptionOnly.identityInput;
    expect(
      syntheticSemanticProblems([assumptionOnly]).join("\n"),
    ).toContain("identity context requires typed identity input");

    const singleCandidate = structuredClone(ambiguous);
    singleCandidate.identityInput.candidates.pop();
    expect(
      syntheticSemanticProblems([singleCandidate]).join("\n"),
    ).toContain("must resolve to multiple exact candidates");

    const unboundCandidate = structuredClone(ambiguous);
    unboundCandidate.identityInput.candidates[1].householdRef =
      "subject:unknown-household";
    expect(
      syntheticSemanticProblems([unboundCandidate]).join("\n"),
    ).toContain("resolve to its bound household entity");

    const mismatchedSpec = structuredClone(real.spec.cases) as any;
    const identityCase = mismatchedSpec.cases.find(
      (item: Record<string, unknown>) =>
        item.key === "identity-trust-name-collision",
    );
    identityCase.identityInput.candidates[1] = {
      entityKind: "party",
      entityRef: "mira-smith",
      householdRef: "smiths",
      rawUtf8Hex: "536d697468",
    };
    expect(
      specReferenceProblems(
        real.spec.world,
        mismatchedSpec,
      ).join("\n"),
    ).toContain("party candidate is not a member");

    const canonical = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-non-ascii-roster-identity",
      )!,
    ) as any;
    expect(canonical.identityInput.unresolvedRawUtf8Hex).not.toBe(
      canonical.identityInput.candidates[0].rawUtf8Hex,
    );
    expect(canonical.identityInput.canonicalValue).toBe(
      canonical.identityInput.candidates[0].canonicalValue,
    );
    expect(syntheticSemanticProblems([canonical])).toEqual([]);

    canonical.identityInput.candidates[0].rawUtf8Hex =
      canonical.identityInput.unresolvedRawUtf8Hex;
    expect(
      syntheticSemanticProblems([canonical]).join("\n"),
    ).toContain("do not reproduce a canonical collision");
  });

  it("synthetic pending semantics use only the exact selected funding set", () => {
    const pendingAction = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-blocked-pending-action",
      )!,
    );
    pendingAction.records.pendingActions.find(
      (row) => row.id === "pending:smiths-blocked-transfer",
    )!.accountRef = "subject:smiths-ira";
    expect(
      syntheticSemanticProblems([pendingAction]).join("\n"),
    ).toContain("selected funding");

    const pendingModel = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-pending-rebalance-during-evaluation",
      )!,
    );
    pendingModel.records.modelAssignments.find(
      (row) => row.pendingRebalance,
    )!.accountRef = "subject:smiths-ira";
    expect(
      syntheticSemanticProblems([pendingModel]).join("\n"),
    ).toContain("selected funding");

    const liveOutgoing = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-segmented-withdrawal-schedule",
      )!,
    );
    liveOutgoing.records.pendingActions.find(
      (row) => row.id === "pending:smiths-transfer",
    )!.accountRef = "subject:smiths-ira";
    expect(
      syntheticSemanticProblems([liveOutgoing]).join("\n"),
    ).toContain("selected funding");
  });

  it("synthetic instruction conflicts derive only from request-bound typed terms", () => {
    const conflict = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-joint-owners-conflicting-instructions",
      )!,
    ) as any;
    expect(syntheticSemanticProblems([conflict])).toEqual([]);

    const assumptionOnly = structuredClone(conflict);
    for (const restriction of assumptionOnly.records.restrictions) {
      restriction.term = null;
    }
    expect(
      syntheticSemanticProblems([assumptionOnly]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const unconnected = structuredClone(conflict);
    for (const restriction of unconnected.records.restrictions) {
      if (restriction.term !== null) {
        restriction.term.sourceAccountRef = "subject:smiths-ira";
      }
    }
    expect(
      syntheticSemanticProblems([unconnected]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const expired = structuredClone(conflict);
    for (const restriction of expired.records.restrictions) {
      restriction.inForceAtAsOf = false;
    }
    expect(
      syntheticSemanticProblems([expired]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const governed = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-clean-in-force-instruction",
      )!,
    );
    expect(syntheticSemanticProblems([governed])).toEqual([]);
  });

  it("synthetic DST context requires exact zone-bound records crossing a declared transition", () => {
    const original = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-dst-straddling-observations",
    )!,
    ) as any;
    expect(syntheticSemanticProblems([original])).toEqual([]);
    expect(original.trigger.timeZoneTransitions).toEqual(
      real.spec.world.clock.transitions,
    );

    const sameOffset = structuredClone(original);
    const standard = sameOffset.trigger.timeZoneTransitions.find(
      (transition: any) =>
        transition.at === "2025-11-02T06:00:00.000Z",
    );
    standard.offsetMinutes = -240;
    sameOffset.evidence.find(
      (evidence: any) =>
        evidence.subjectRef === "change:smiths-review-est",
    ).recordChangedAtLocal = "2025-11-02T05:00:00.000-04:00";
    expect(
      syntheticSemanticProblems([sameOffset]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const missingZone = structuredClone(original);
    delete missingZone.evidence.find(
      (evidence: any) => evidence.kind === "recent-change",
    ).localZone;
    expect(
      syntheticSemanticProblems([missingZone]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const assumptionOnly = structuredClone(original);
    assumptionOnly.evidence = assumptionOnly.evidence.filter(
      (evidence: any) => evidence.kind !== "recent-change",
    );
    assumptionOnly.records.recentChanges = [];
    expect(
      syntheticSemanticProblems([assumptionOnly]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );
  });

  it("synthetic blast radius requires one cited changed instruction with multiple governed accounts", () => {
    const original = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId ===
            "CS-shared-instruction-change-blast-radius",
      )!,
    ) as any;
    expect(syntheticSemanticProblems([original])).toEqual([]);

    const unconnected = structuredClone(original);
    unconnected.records.bankInstructions.find(
      (instruction: any) =>
        instruction.id === unconnected.request.destinationRef,
    ).accountRefs = [unconnected.request.sourceAccountRef];
    expect(
      syntheticSemanticProblems([unconnected]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const distinctInstruction = structuredClone(original);
    distinctInstruction.records.recentChanges[0].subjectRef =
      "bank-instruction:smiths-trust-alt";
    expect(
      syntheticSemanticProblems([distinctInstruction]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const mismatchedChange = structuredClone(original);
    mismatchedChange.records.bankInstructions.find(
      (instruction: any) =>
        instruction.id === mismatchedChange.request.destinationRef,
    ).changedAt = "2026-07-21T18:12:00.000Z";
    expect(
      syntheticSemanticProblems([mismatchedChange]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const correctlyTreated = structuredClone(original);
    correctlyTreated.label = {
      kind: "clean-control",
      controlRationale: "all impacted accounts are reevaluated",
    };
    correctlyTreated.outcomes[0].observedTreatment =
      correctlyTreated.outcomes[0].expectedTreatment;
    expect(syntheticSemanticProblems([correctlyTreated])).toEqual([]);
  });

  it("instruction owner cardinality is target-specific for joint destinations", () => {
    const request = {
      firmRef: FIRM_REF,
      requestRef: REQUEST_REF,
      householdRef: HOUSEHOLD_REF,
      action: "distribution" as const,
      sourceAccountRef: ACCOUNT_REF,
      destinationRef: INSTRUCTION_REF,
      destinationSubjectRefs: [OWNER_REF_ALT, OWNER_REF],
    };
    const witness = (
      targetKind:
        | "source-account"
        | "destination-instruction"
        | "destination-subject"
        | "request",
      targetRef: string,
      polarity: "required" | "forbidden",
    ) => [{
      instructionRef: INSTRUCTION_REF_ALT,
      firmRef: FIRM_REF,
      householdRef: HOUSEHOLD_REF,
      term: {
        governedAction: "distribution" as const,
        sourceAccountRef: ACCOUNT_REF,
        targetKind,
        targetRef,
        polarity,
      },
    }];

    expect(
      instructionConflictAnalysis(
        request,
        witness("source-account", ACCOUNT_REF, "required"),
      ),
    ).toEqual({ present: false, problems: [] });
    expect(
      instructionConflictAnalysis(
        request,
        witness("destination-subject", OWNER_REF_ALT, "forbidden"),
      ),
    ).toEqual({ present: true, problems: [] });
    expect(
      instructionConflictAnalysis(
        request,
        witness("destination-subject", ACTOR_REF, "forbidden"),
      ),
    ).toEqual({ present: false, problems: [] });

    expect(
      instructionConflictAnalysis(
        {
          ...request,
          destinationSubjectRefs: [OWNER_REF, OWNER_REF],
        },
        witness("request", REQUEST_REF, "required"),
      ).problems,
    ).toContain("instruction conflict request is incomplete or ambiguous");

    const realDerivedJoint = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    );
    (
      (realDerivedJoint.replayPayload as Record<string, any>)
        .destination.ownerRefs as string[]
    ).push(OWNER_REF_ALT);
    (realDerivedJoint.subjects as string[]).push(OWNER_REF_ALT);
    expect(
      realDerivedCaseProblems(
        realDerivedJoint,
        classes,
        "real-derived/RD-joint-destination.json",
      ),
    ).toEqual([]);
  });

  it("the Mira prohibition resolves the exact request destination subject", () => {
    const item = structuredClone(
      real.cases.find(
        (candidate) =>
          candidate.caseId ===
            "CS-beneficiary-versus-destination-restriction",
      )!,
    ) as any;
    const restriction = item.records.restrictions.find(
      (entry: any) => entry.id === "restriction:smiths-destination",
    );
    const destination = item.records.referencedBankInstructions.find(
      (entry: any) => entry.id === item.request.destinationRef,
    );
    expect(restriction.term.targetRef).toBe("subject:mira-smith");
    expect(destination.titledTo).toBe("subject:mira-smith");
    expect(syntheticSemanticProblems([item])).toEqual([]);

    restriction.term.targetRef = "subject:robert-smith";
    expect(
      syntheticSemanticProblems([item]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );
  });

  it("synthetic tax semantics and defaults use all and only selected funding", () => {
    const item = structuredClone(
      real.cases.find(
        (candidate) => candidate.caseId === "CS-cross-household-signer",
      )!,
    );
    item.request.selectedFundingRefs.push("subject:smiths-ira");
    item.taxReviewState = "not-required";
    expect(
      syntheticSemanticProblems([item]).join("\n"),
    ).toContain(
      'active "tax-consequence-blindness" context lacks a typed treatment',
    );

    const spec = structuredClone(real.spec);
    const input = spec.cases.cases.find(
      (candidate) => candidate.key === "cross-household-signer",
    )!;
    input.request.selectedFundingRefs.push("smiths-ira");
    const generated = generateSyntheticCases(spec).find(
      (file) => file.relPath ===
        "synthetic/CS-cross-household-signer.json",
    )!.value as Record<string, unknown>;
    expect(generated.taxReviewState).toBe("completed");
  });

  it("synthetic reserve state comes from emitted schedules", () => {
    const item = structuredClone(
      real.cases.find(
        (candidate) =>
          candidate.caseId === "CS-absent-withdrawal-schedule",
      )!,
    );
    item.records.plannedWithdrawals.push({
      id: "withdrawal:contradiction",
      householdRef: item.request.householdRef,
      segments: [{ monthlyMinor: 1 }],
    });
    expect(
      syntheticSemanticProblems([item]).join("\n"),
    ).toContain("AS-12 contradicts emitted withdrawal schedules");

    const segmented = structuredClone(
      real.cases.find(
        (candidate) =>
          candidate.caseId === "CS-segmented-withdrawal-schedule",
      )!,
    );
    segmented.evidence = segmented.evidence.filter(
      (entry) => entry.kind !== "planned-withdrawals",
    );
    segmented.label = { kind: "clean-control" };
    const outcome = segmented.outcomes.find(
      (candidate) =>
        candidate.defectClassId === "liquidity-reserve-miscalculation",
    )!;
    outcome.expectedTreatment = "calculate-scalar-reserve";
    outcome.observedTreatment = "calculate-scalar-reserve";
    expect(
      syntheticSemanticProblems([segmented]).join("\n"),
    ).toContain(
      'outcome "liquidity-reserve-miscalculation" has no single treatment selector',
    );
  });

  it("a settling incoming transfer uses the shared nonreducing pending authority", () => {
    const item = realDerivedDefectCase(
      "pending-activity-miscount",
    );
    const action = (item.replayPayload as Record<string, any>).liquidity
      .pendingAction;
    Object.assign(action, {
      actionKind: "incoming-transfer",
      actionState: "settling",
      direction: "incoming",
      liquidityClass: "credit",
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: false,
    });
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-settling-incoming.json",
      ),
    ).toEqual([]);
  });

  it("reconciles zero-effect actions already reflected in reported availability", () => {
    const incoming = realDerivedDefectCase("pending-activity-miscount");
    const incomingPayload = incoming.replayPayload as Record<string, any>;
    Object.assign(incomingPayload.liquidity.pendingAction, {
      actionKind: "incoming-transfer",
      actionState: "settling",
      direction: "incoming",
      liquidityClass: "credit",
      availableMinorIncludesAction: true,
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: false,
    });
    incomingPayload.liquidity.sources[0].availableMinor = 11_000;
    incomingPayload.outcomes = treatmentOutcomes(
      incomingPayload,
      "pending-activity-miscount",
    );
    expect(
      realDerivedCaseProblems(
        incoming,
        classes,
        "real-derived/RD-included-settling-incoming.json",
      ).join("\n"),
    ).toContain("exact-once pending-action accounting");

    const outgoing = realDerivedDefectCase("pending-activity-miscount");
    const outgoingPayload = outgoing.replayPayload as Record<string, any>;
    outgoingPayload.liquidity.pendingAction.availableMinorIncludesAction = true;
    outgoingPayload.liquidity.sources[0].availableMinor = 10_500;
    expect(
      realDerivedCaseProblems(
        outgoing,
        classes,
        "real-derived/RD-included-blocked-outgoing.json",
      ),
    ).toEqual([]);

    const unknown = realDerivedDefectCase("pending-activity-miscount");
    const unknownPayload = unknown.replayPayload as Record<string, any>;
    Object.assign(unknownPayload.liquidity.pendingAction, {
      actionKind: "unknown",
      actionState: "blocked",
      direction: "unknown",
      liquidityClass: "unclassified",
      availableMinorIncludesAction: true,
    });
    unknownPayload.outcomes = treatmentOutcomes(
      unknownPayload,
      "pending-activity-miscount",
    );
    expect(
      realDerivedCaseProblems(
        unknown,
        classes,
        "real-derived/RD-included-unknown-direction.json",
      ).join("\n"),
    ).toContain("requires a known liquidity direction");
  });

  it("a settled incoming credit has a distinct availability treatment in both partitions", () => {
    const realDerived = realDerivedDefectCase("pending-activity-miscount");
    const payload = realDerived.replayPayload as Record<string, any>;
    Object.assign(payload.liquidity.pendingAction, {
      actionKind: "incoming-credit",
      actionState: "settled",
      direction: "incoming",
      liquidityClass: "credit",
      availableMinorIncludesAction: true,
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: true,
    });
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-incoming-generic.json",
      ).join("\n"),
    ).toContain(
      'outcome "pending-activity-miscount" is outside its closed treatment vocabulary',
    );
    payload.outcomes = treatmentOutcomes(
      payload,
      "pending-activity-miscount",
    );
    const realDerivedOutcome = payload.outcomes.find(
      (outcome: Record<string, string>) =>
        outcome.defectClassId === "pending-activity-miscount",
    );
    expect(realDerivedOutcome).toEqual({
      defectClassId: "pending-activity-miscount",
      expectedTreatment: "preserve-settled-incoming-availability",
      observedTreatment: "omit-settled-incoming-availability",
    });
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-incoming.json",
      ),
    ).toEqual([]);

    const synthetic = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-blocked-pending-action",
      )!,
    );
    const syntheticAction = synthetic.records.pendingActions.find(
      (action) => action.state === "blocked",
    )!;
    Object.assign(syntheticAction, {
      kind: "incoming-credit",
      state: "settled",
      direction: "incoming",
      liquidityClass: "credit",
      availableMinorIncludesAction: true,
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: true,
    });
    const syntheticOutcome = synthetic.outcomes.find(
      (outcome) => outcome.defectClassId === "pending-activity-miscount",
    )!;
    expect(syntheticSemanticProblems([synthetic]).join("\n")).toContain(
      'outcome "pending-activity-miscount" is outside its closed treatment vocabulary',
    );
    syntheticOutcome.expectedTreatment =
      "preserve-settled-incoming-availability";
    syntheticOutcome.observedTreatment =
      "omit-settled-incoming-availability";
    expect(syntheticSemanticProblems([synthetic])).toEqual([]);

    payload.liquidity.pendingAction.availableMinorIncludesAction = false;
    payload.outcomes = treatmentOutcomes(
      payload,
      "pending-activity-miscount",
    );
    expect(
      payload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "pending-activity-miscount",
      ),
    ).toEqual({
      defectClassId: "pending-activity-miscount",
      expectedTreatment: "credit-settled-incoming-availability",
      observedTreatment: "omit-settled-incoming-availability",
    });
    payload.liquidity.sources[0].availableMinor = 10_500;
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-credit-not-included.json",
      ),
    ).toEqual([]);
    payload.liquidity.pendingAction.availableMinorIncludesAction = true;
    payload.outcomes = treatmentOutcomes(
      payload,
      "pending-activity-miscount",
    );
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-credit-included.json",
      ).join("\n"),
    ).toContain("exact-once pending-action accounting");

    const ambiguous = structuredClone(realDerived);
    const ambiguousPayload = ambiguous.replayPayload as Record<string, any>;
    delete ambiguousPayload.liquidity.pendingAction
      .availableMinorIncludesAction;
    expect(
      realDerivedCaseProblems(
        ambiguous,
        classes,
        "real-derived/RD-settled-credit-ambiguous.json",
      ).join("\n"),
    ).toContain("schema validation failed");

    syntheticAction.availableMinorIncludesAction = false;
    syntheticOutcome.expectedTreatment =
      "credit-settled-incoming-availability";
    expect(syntheticSemanticProblems([synthetic])).toEqual([]);
  });

  it("retirement treatment requires a completed review or an explicit mismatch", () => {
    const defect = realDerivedDefectCase("tax-consequence-blindness");
    expect(
      realDerivedCaseProblems(
        defect,
        classes,
        "real-derived/RD-tax-pending.json",
      ),
    ).toEqual([]);

    const contradicted = structuredClone(defect);
    (contradicted.replayPayload as Record<string, any>).taxReviewState =
      "completed";
    expect(
      realDerivedCaseProblems(
        contradicted,
        classes,
        "real-derived/RD-tax-completed-mismatch.json",
      ).join("\n"),
    ).toContain("claims a defect treatment without its required context");

    const impossible = structuredClone(defect);
    (impossible.replayPayload as Record<string, any>).taxReviewState =
      "not-required";
    expect(
      realDerivedCaseProblems(
        impossible,
        classes,
        "real-derived/RD-tax-not-required.json",
      ).join("\n"),
    ).toContain("selected retirement funding cannot declare tax review not required");
  });

  it("reserve treatments distinguish scalar, segmented, and missing schedules", () => {
    const segmented = realDerivedDefectCase(
      "liquidity-reserve-miscalculation",
    );
    const segmentedOutcome = (
      (segmented.replayPayload as Record<string, any>).outcomes as Array<
        Record<string, string>
      >
    ).find(
      (outcome) =>
        outcome.defectClassId === "liquidity-reserve-miscalculation",
    )!;
    expect(segmentedOutcome).toMatchObject({
      expectedTreatment: "calculate-segmented-reserve",
      observedTreatment: "calculate-scalar-reserve",
    });
    expect(
      realDerivedCaseProblems(
        segmented,
        classes,
        "real-derived/RD-segmented-reserve.json",
      ),
    ).toEqual([]);

    const missing = structuredClone(segmented);
    const missingPayload = missing.replayPayload as Record<string, any>;
    missingPayload.liquidity.reserveState = "missing";
    missingPayload.liquidity.reserveRequiredMinor = null;
    missingPayload.liquidity.withdrawalSegmentsMinor = [];
    missingPayload.outcomes = treatmentOutcomes(
      missingPayload,
      "liquidity-reserve-miscalculation",
    );
    expect(
      missingPayload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "liquidity-reserve-miscalculation",
      ),
    ).toMatchObject({
      expectedTreatment: "mark-reserve-unavailable",
      observedTreatment: "invent-reserve-from-missing-schedule",
    });
    expect(
      realDerivedCaseProblems(
        missing,
        classes,
        "real-derived/RD-missing-reserve.json",
      ),
    ).toEqual([]);
  });

  it("threshold treatment follows the signed strict or inclusive comparator", () => {
    const strict = realDerivedDefectCase("threshold-boundary-error");
    const strictPayload = strict.replayPayload as Record<string, any>;
    expect(
      strictPayload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "threshold-boundary-error",
      ),
    ).toMatchObject({
      expectedTreatment: "apply-strict-threshold-boundary",
      observedTreatment: "apply-inclusive-threshold-boundary",
    });
    expect(
      realDerivedCaseProblems(
        strict,
        classes,
        "real-derived/RD-strict-threshold.json",
      ),
    ).toEqual([]);

    const inclusive = structuredClone(strict);
    const inclusivePayload = inclusive.replayPayload as Record<string, any>;
    inclusivePayload.policy.thresholdComparator = "inclusive";
    inclusivePayload.outcomes = treatmentOutcomes(
      inclusivePayload,
      "threshold-boundary-error",
    );
    expect(
      inclusivePayload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "threshold-boundary-error",
      ),
    ).toMatchObject({
      expectedTreatment: "apply-inclusive-threshold-boundary",
      observedTreatment: "apply-strict-threshold-boundary",
    });
    expect(
      realDerivedCaseProblems(
        inclusive,
        classes,
        "real-derived/RD-inclusive-threshold.json",
      ),
    ).toEqual([]);

    const unsignedComparator = structuredClone(strict);
    delete (unsignedComparator.replayPayload as Record<string, any>).policy
      .thresholdComparator;
    expect(
      realDerivedCaseProblems(
        unsignedComparator,
        classes,
        "real-derived/RD-missing-threshold-comparator.json",
      ).join("\n"),
    ).toContain("schema validation failed");
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

  it("recomputes restriction lifecycle from effective instants", () => {
    const defect = realDerivedDefectCase("restriction-lifecycle-error");
    const policy = (defect.replayPayload as Record<string, any>).policy;
    policy.restrictionEffectiveFrom = "2026-01-01T00:00:00.000Z";
    policy.restrictionEffectiveTo = null;
    expect(
      realDerivedCaseProblems(
        defect,
        classes,
        "real-derived/RD-forged-restriction-state.json",
      ).join("\n"),
    ).toContain("restriction lifecycle state");
  });

  it("replay states require coherent supporting facts", () => {
    const uniqueWithTwoCandidates = realDerivedCase();
    (uniqueWithTwoCandidates.replayPayload as Record<string, any>)
      .identity.candidateRefs.push(ACTOR_REF_ALT);

    const ambiguousWithOneCandidate = realDerivedCase();
    (ambiguousWithOneCandidate.replayPayload as Record<string, any>)
      .identity.resolution = "ambiguous";

    const authorityWithoutGrant = realDerivedCase();
    Object.assign(
      (authorityWithoutGrant.replayPayload as Record<string, any>).authority,
      { grantRef: null, validFrom: null },
    );

    const absentHoldWithScope = realDerivedCase();
    (absentHoldWithScope.replayPayload as Record<string, any>)
      .policy.legalHoldScope = "position";

    const missingReserveWithSchedule = realDerivedCase();
    (missingReserveWithSchedule.replayPayload as Record<string, any>)
      .liquidity.reserveState = "missing";

    const segmentedReserveWithoutSegments = realDerivedCase();
    Object.assign(
      (segmentedReserveWithoutSegments.replayPayload as Record<string, any>)
        .liquidity,
      { reserveState: "modeled-segmented", withdrawalSegmentsMinor: [] },
    );

    for (const candidate of [
      uniqueWithTwoCandidates,
      ambiguousWithOneCandidate,
      authorityWithoutGrant,
      absentHoldWithScope,
      missingReserveWithSchedule,
      segmentedReserveWithoutSegments,
    ]) {
      expect(
        realDerivedCaseProblems(
          candidate,
          classes,
          "real-derived/RD-incoherent-state.json",
        ).join("\n"),
      ).toContain("schema validation failed");
    }
  });

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

    const nestedExtra = realDerivedCase();
    (nestedExtra.replayPayload as Record<string, any>).request.accountNumber =
      "tok:1111222233334444";
    expect(
      realDerivedCaseProblems(
        nestedExtra,
        classes,
        "real-derived/RD-extra-request.json",
      ).length,
    ).toBeGreaterThan(0);

    const ambiguous = realDerivedCase();
    (
      (ambiguous.replayPayload as Record<string, any>).identity
        .candidateRefs as string[]
    ).push(ACTOR_REF_ALT);
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
      actionRef: PENDING_ACTION_REF,
      actionKind: "incoming-transfer",
      actionState: "pending",
      direction: "outgoing",
      liquidityClass: "credit",
      amountMinor: 500,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
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
      (payload) => { payload.policy.restrictionRef = RESTRICTION_REF; },
      (payload) => { payload.request.destinationRef = INSTRUCTION_REF_ALT; },
      (payload) => { payload.policy.thresholdComparison = "below"; },
      (payload) => { payload.destination.ownerRefs.push(OWNER_REF); },
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

  it("every schema-declared uniqueItems collection is enforced recursively", () => {
    const item = realDerivedCase();
    const payload = item.replayPayload as Record<string, any>;
    payload.liquidity.sources[0].ownerRefs.push(OWNER_REF);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-duplicate-source-owner.json",
      ).join("\n"),
    ).toContain("replayPayload.liquidity.sources.0.ownerRefs.1");
  });

  it("outcome assertions are complete, unique, and class-compatible", () => {
    const duplicate = realDerivedCase();
    const duplicateOutcomes = (
      duplicate.replayPayload as Record<string, any>
    ).outcomes as Array<Record<string, string>>;
    duplicateOutcomes[1]!.defectClassId =
      duplicateOutcomes[0]!.defectClassId!;
    expect(
      realDerivedCaseProblems(
        duplicate,
        classes,
        "real-derived/RD-duplicate-outcome.json",
      ).join("\n"),
    ).toContain("exactly one expected-versus-observed");

    const incompatible = realDerivedCase();
    const outcome = (
      (incompatible.replayPayload as Record<string, any>).outcomes as Array<
        Record<string, string>
      >
    )[0]!;
    outcome.expectedTreatment = "render-with-time-zone-rules";
    expect(
      realDerivedCaseProblems(
        incompatible,
        classes,
        "real-derived/RD-incompatible-outcome.json",
      ).join("\n"),
    ).toContain("closed treatment vocabulary");
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

  it("duplicate keys in hand-owned corpus schemas are rejected before parsing or hashing", () => {
    expect(() =>
      realDerivedSchemaBindings({
        "real-derived-case-schema.json":
          '{"$id":"verin-real-derived-case/1.0.0","$id":"verin-real-derived-case/9.9.9"}',
        "real-derived-replay-schema.json":
          '{"$id":"verin-real-derived-replay/1.0.0"}',
      }),
    ).toThrow(/duplicate/i);
    for (const name of [
      "world.json",
      "cases.json",
      "defect-taxonomy.json",
      "real-derived-semantic-contract.json",
      ...REAL_DERIVED_SCHEMA_FILES,
    ]) {
      const bytes = readFileSync(
        join(REPO_ROOT, "fixtures/corpus/spec", name),
        "utf8",
      );
      expect(() =>
        parseStrictJson(
          bytes.replace(
            /^\{/,
            '{"duplicate-probe":1,"duplicate-probe":2,',
          ),
          name,
        ),
      ).toThrow(/duplicate/i);
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
    const payload = missing.replayPayload as Record<string, any>;
    payload.liquidity.reserveState = "missing";
    payload.liquidity.reserveRequiredMinor = null;
    payload.liquidity.withdrawalSegmentsMinor = [];
    payload.outcomes = treatmentOutcomes(
      payload,
      "destination-integrity-defect",
    );
    const reserveEvidence = (
      missing.evidence as Array<Record<string, unknown>>
    ).find(
      (entry) => entry.evidenceKind === "planned-withdrawals",
    )!;
    Object.assign(reserveEvidence, {
      observationState: "missing",
      observedAt: null,
      freshness: "unknown",
    });
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
    const dangling = realDerivedCase({ subjects: [REQUEST_REF] });
    expect(
      realDerivedCaseProblems(dangling, classes, "real-derived/RD-dangling.json").some(
        (problem) => problem.includes("resolves to 0 subjects") ||
          problem.includes("exactly inventory"),
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

  it("signoff parsing rejects warnings, tags, duplicate keys, aliases, unexpected keys, and multiple blocks", () => {
    const yaml = (body: string) => `\`\`\`yaml\n${body}\n\`\`\``;
    const malformed: Array<[string, string]> = [
      [yaml("corpusVersion: x\nstatus: signed\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null"), "parse error"],
      [yaml("corpusVersion: &v x\nstatus: pending-captain\nsignedBy: *v\nsignedAt: null\nsignedDigest: null"), "aliases are forbidden"],
      [yaml("corpusVersion: !unresolved x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null"), "YAML warning"],
      [yaml("corpusVersion: !!str x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null"), "tags are forbidden"],
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
