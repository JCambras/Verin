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
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type CallExpression,
  type SourceFile,
} from "ts-morph";
import { ciJobRunProblem, parseCiJobs, type CiJob } from "../../../scripts/v3-gates.lib";
import {
  completeTestRunArguments,
  fitnessInventoryProblems,
  fitnessTestFiles,
  isVitestTestFile,
  VITEST_TEST_INCLUDE,
} from "../../../scripts/fitness-tests.lib";
import { isProvablyReachable } from "./_ast-control-flow";
import {
  callableExpressionAlternatives,
  localFunctionParameterValues,
  precedingCallableAssignmentValues,
  reflectApplyResolution,
  reflectGetResolution,
} from "./_callable-indirection";
import { moduleReferences } from "./_fence-utils";

/**
 * CHARTER-DRIFT FENCE (charter operating model: "the constitution enforces its
 * own enforcement"). Fails the build if:
 *  (a) any 'enforced' mapping in charter-map.json points at a mechanism (file,
 *      config, fitness test, or CI gate) that no longer exists or is disabled;
 *  (a') any enforced ci-gate is not a real, blocking job of ci.yml specifically —
 *      a name surviving only in the non-blocking scheduled.yml does not count, nor
 *      does one surviving as a comment, a path, or a job that cannot fail the build;
 *  (b) any fitness fence — INCLUDING this one — is disabled or focused
 *      (skip/only/x-prefixed variants);
 *  (c) any of the 16 charter non-negotiables is missing from the map;
 *  (d) any active fitness fence file is NOT referenced by the map (a silently
 *      added/orphaned fence);
 *  (e) any entry that has ever shipped as 'enforced' is flipped back to
 *      'planned' (a ratchet — enforcement is monotonic).
 *
 * Companion (detection-is-not-verification) lives in
 * detection-not-verification.test.ts and proves this fence FAILS when a mapped
 * mechanism is removed — so a green charter-drift check cannot be vacuous.
 *
 * @companion:proof-log — adversarial proof PF-001 in docs/fences/proof-log.md
 * (a self-referential meta fence proves itself via the log, not an inline fixture).
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const p = (rel: string) => root + rel;
const fitnessFiles = fitnessTestFiles(root);

interface Mechanism {
  type: string;
  ref: string;
  command?: string;
  status?: "enforced" | "planned";
}
interface Entry {
  id: number | string;
  title: string;
  status: "enforced" | "planned";
  mechanisms: Mechanism[];
}
interface CharterMap {
  nonNegotiables: Entry[];
  operatingModel: Entry[];
}

const map = JSON.parse(readFileSync(p("charter-map.json"), "utf8")) as CharterMap;
const allEntries = [...map.nonNegotiables, ...map.operatingModel];

const isPathLike = (ref: string) => ref.includes("/") || ref.includes(".");
const effectiveStatus = (entry: Entry, m: Mechanism) => m.status ?? entry.status;

// The RATCHET (e): every id that has shipped as 'enforced'. Flipping one of these
// back to 'planned' in charter-map.json would silently skip its existence checks
// and orphan detection — enforcement is monotonic; removal needs a charter ADR
// AND an edit here, in the fence, where review sees it.
const RATCHETED_ENFORCED_IDS = [
  ...Array.from({ length: 16 }, (_, i) => i + 1),
  "charter-as-code",
  "charter-amended-by-adr-only",
  "charter-drift-fence",
  "non-utc-clock",
  "dependency-rule",
  "v3-direction-ratified",
  "v3-invariants-phase-gated",
  "v3-gate-ordering",
  "demo-contract-as-data",
  "golden-cases-truth-set",
  "demo-skeleton-honesty",
  "decision-core-type-system",
  "primitive-vocabulary-versioned",
  "replay-corpus-substrate",
];

type EnforcedMechanismTuple = readonly [
  entryId: string,
  type: string,
  ref: string,
  command: string,
  status: "enforced",
];

const RATCHETED_ENFORCED_MECHANISMS = [
  ["1", "procedure", "docs/fences/proof-log.md", "", "enforced"],
  ["1", "fitness", "src/__tests__/fitness/no-bare-throw.test.ts", "", "enforced"],
  ["2", "fitness", "src/__tests__/fitness/provenance-required.test.ts", "", "enforced"],
  ["3", "fitness", "src/__tests__/fitness/no-unlabeled-synthetic.test.ts", "", "enforced"],
  ["3", "fitness", "src/__tests__/fitness/metric-provenance.test.ts", "", "enforced"],
  ["3", "fitness", "src/__tests__/fitness/derived-provenance.test.ts", "", "enforced"],
  ["3", "adr", "docs/adr/0022-derived-compliance-artifacts-demonstration.md", "", "enforced"],
  [
    "3",
    "ci-gate",
    "provenance-trace",
    "pnpm exec vitest run src/__tests__/fitness/provenance-required.test.ts src/__tests__/fitness/no-unlabeled-synthetic.test.ts src/__tests__/fitness/metric-provenance.test.ts src/__tests__/fitness/derived-provenance.test.ts src/__tests__/fitness/no-pii-in-audit-store.test.ts",
    "enforced",
  ],
  ["4", "fitness", "src/__tests__/fitness/detection-not-verification.test.ts", "", "enforced"],
  ["5", "ci-gate", "knip", "pnpm exec knip", "enforced"],
  ["5", "config", "knip.json", "", "enforced"],
  ["6", "adr", "docs/adr/0011-flowstep-suspend-resume.md", "", "enforced"],
  ["6", "fitness", "src/__tests__/fitness/flowstep-suspend-resume.test.ts", "", "enforced"],
  ["7", "fitness", "src/__tests__/fitness/no-process-env.test.ts", "", "enforced"],
  ["7", "fitness", "src/__tests__/fitness/no-secret-fallback.test.ts", "", "enforced"],
  ["7", "fitness", "src/__tests__/fitness/org-id-required.test.ts", "", "enforced"],
  ["7", "fitness", "src/__tests__/fitness/decision-core-tenant-scope.test.ts", "", "enforced"],
  ["7", "fitness", "src/__tests__/fitness/no-client-role-header.test.ts", "", "enforced"],
  ["7", "fitness", "src/__tests__/fitness/tenant-context-required.test.ts", "", "enforced"],
  ["8", "ci-gate", "e2e", "pnpm exec playwright test", "enforced"],
  ["8", "config", "playwright.config.ts", "", "enforced"],
  ["9", "ci-gate", "e2e", "pnpm exec playwright test", "enforced"],
  ["9", "fitness", "src/__tests__/fitness/axe-required.test.ts", "", "enforced"],
  ["10", "adr", "docs/adr/0012-presentation-tier-and-budgets.md", "", "enforced"],
  ["10", "fitness", "src/__tests__/fitness/line-budget.test.ts", "", "enforced"],
  ["10", "fitness", "src/__tests__/fitness/max-file-size.test.ts", "", "enforced"],
  ["11", "ci-gate", "load-smoke", "pnpm exec tsx scripts/load-smoke.ts", "enforced"],
  ["11", "procedure", "docs/runbooks/backup-and-restore.md", "", "enforced"],
  ["11", "fitness", "src/__tests__/fitness/bounded-request-body.test.ts", "", "enforced"],
  ["12", "fitness", "src/__tests__/fitness/auth-enforcement.test.ts", "", "enforced"],
  ["12", "fitness", "src/__tests__/fitness/governed-actions.test.ts", "", "enforced"],
  ["13", "fitness", "src/__tests__/fitness/audited-write-required.test.ts", "", "enforced"],
  ["13", "fitness", "src/__tests__/fitness/no-pii-in-audit-store.test.ts", "", "enforced"],
  ["13", "ci-gate", "audit-chain-verify", "pnpm exec tsx scripts/audit-chain-verify.ts", "enforced"],
  ["13", "fitness", "src/__tests__/fitness/llm-pii-boundary.test.ts", "", "enforced"],
  ["13", "fitness", "src/__tests__/fitness/tokenized-factory-only.test.ts", "", "enforced"],
  ["14", "fitness", "src/__tests__/fitness/no-console.test.ts", "", "enforced"],
  ["14", "fitness", "src/__tests__/fitness/observability-coverage.test.ts", "", "enforced"],
  ["14", "fitness", "src/__tests__/fitness/observability-vocabulary.test.ts", "", "enforced"],
  [
    "14",
    "ci-gate",
    "test",
    "pnpm exec tsx scripts/fitness-tests.ts",
    "enforced",
  ],
  [
    "15",
    "ci-gate",
    "secret-scan",
    "gitleaks git --config .gitleaks.toml --redact --no-banner --exit-code 1 .",
    "enforced",
  ],
  [
    "15",
    "ci-gate",
    "sast",
    "semgrep scan --config p/typescript --config p/react --config p/nodejsscan --config p/secrets --exclude-rule ajinabraham.njsscan.dos.regex_dos.regex_dos --error",
    "enforced",
  ],
  ["15", "ci-gate", "dependency-audit", "pnpm audit --audit-level=high", "enforced"],
  ["15", "ci-gate", "dependency-audit", "pnpm exec tsx scripts/license-audit.ts", "enforced"],
  ["15", "config", ".gitleaks.toml", "", "enforced"],
  ["16", "fitness", "src/__tests__/fitness/idempotency-exactly-once.test.ts", "", "enforced"],
  ["16", "fitness", "src/__tests__/fitness/decision-core-external-action-safety.test.ts", "", "enforced"],
  ["charter-as-code", "file", "CHARTER.md", "", "enforced"],
  ["charter-as-code", "fitness", "src/__tests__/fitness/charter-drift.test.ts", "", "enforced"],
  ["charter-amended-by-adr-only", "procedure", ".github/pull_request_template.md", "", "enforced"],
  ["charter-drift-fence", "fitness", "src/__tests__/fitness/charter-drift.test.ts", "", "enforced"],
  ["charter-drift-fence", "file", "scripts/fitness-tests.lib.ts", "", "enforced"],
  ["charter-drift-fence", "file", "scripts/fitness-tests.ts", "", "enforced"],
  [
    "charter-drift-fence",
    "ci-gate",
    "test",
    "pnpm exec tsx scripts/fitness-tests.ts",
    "enforced",
  ],
  ["non-utc-clock", "config", "vitest.config.ts", "", "enforced"],
  ["non-utc-clock", "file", "src/__tests__/setup.ts", "", "enforced"],
  ["dependency-rule", "config", "eslint.config.mjs", "", "enforced"],
  ["dependency-rule", "fitness", "src/__tests__/fitness/dependency-rule.test.ts", "", "enforced"],
  ["v3-direction-ratified", "adr", "docs/adr/0023-adopt-v3-decision-layer-direction.md", "", "enforced"],
  ["v3-direction-ratified", "file", "docs/v3/verin-architecture-v3.md", "", "enforced"],
  ["v3-direction-ratified", "fitness", "src/__tests__/fitness/arch-version.test.ts", "", "enforced"],
  ["v3-invariants-phase-gated", "config", "v3-invariants.json", "", "enforced"],
  ["v3-invariants-phase-gated", "fitness", "src/__tests__/fitness/v3-invariants.test.ts", "", "enforced"],
  [
    "v3-invariants-phase-gated",
    "ci-gate",
    "v3-invariants",
    "pnpm exec tsx scripts/v3-invariants.ts",
    "enforced",
  ],
  ["v3-gate-ordering", "adr", "docs/adr/0055-gate-a-invariant-ordering.md", "", "enforced"],
  ["v3-gate-ordering", "config", "v3-invariants.json", "", "enforced"],
  ["v3-gate-ordering", "file", "scripts/v3-gates.lib.ts", "", "enforced"],
  ["v3-gate-ordering", "fitness", "src/__tests__/fitness/v3-gate-ordering.test.ts", "", "enforced"],
  [
    "v3-gate-ordering",
    "ci-gate",
    "v3-invariants",
    "pnpm exec tsx scripts/v3-invariants.ts",
    "enforced",
  ],
  ["demo-contract-as-data", "config", "config/demo/scenarios.yaml", "", "enforced"],
  ["demo-contract-as-data", "fitness", "src/__tests__/fitness/demo-scenarios-contract.test.ts", "", "enforced"],
  ["golden-cases-truth-set", "file", "docs/golden-cases.md", "", "enforced"],
  ["golden-cases-truth-set", "fitness", "src/__tests__/fitness/golden-cases.test.ts", "", "enforced"],
  [
    "golden-cases-truth-set",
    "ci-gate",
    "golden-cases",
    "pnpm exec tsx scripts/golden-cases-validate.ts",
    "enforced",
  ],
  ["demo-skeleton-honesty", "fitness", "src/__tests__/fitness/demo-skeleton-honesty.test.ts", "", "enforced"],
  ["demo-skeleton-honesty", "fitness", "src/__tests__/fitness/demo-surface-completeness.test.ts", "", "enforced"],
  ["decision-core-type-system", "adr", "docs/adr/0029-decision-core-contracts.md", "", "enforced"],
  ["decision-core-type-system", "fitness", "src/__tests__/fitness/decision-core-illegal-states.test.ts", "", "enforced"],
  ["decision-core-type-system", "config", "v3-invariants.json", "", "enforced"],
] as const satisfies readonly EnforcedMechanismTuple[];

const RATCHETED_CI_COMMANDS = [
  {
    entryId: "3",
    ref: "provenance-trace",
    command:
      "pnpm exec vitest run src/__tests__/fitness/provenance-required.test.ts src/__tests__/fitness/no-unlabeled-synthetic.test.ts src/__tests__/fitness/metric-provenance.test.ts src/__tests__/fitness/derived-provenance.test.ts src/__tests__/fitness/no-pii-in-audit-store.test.ts",
  },
  { entryId: "5", ref: "knip", command: "pnpm exec knip" },
  { entryId: "8", ref: "e2e", command: "pnpm exec playwright test" },
  { entryId: "9", ref: "e2e", command: "pnpm exec playwright test" },
  { entryId: "11", ref: "load-smoke", command: "pnpm exec tsx scripts/load-smoke.ts" },
  { entryId: "13", ref: "audit-chain-verify", command: "pnpm exec tsx scripts/audit-chain-verify.ts" },
  {
    entryId: "14",
    ref: "test",
    command: "pnpm exec tsx scripts/fitness-tests.ts",
  },
  {
    entryId: "15",
    ref: "secret-scan",
    command: "gitleaks git --config .gitleaks.toml --redact --no-banner --exit-code 1 .",
  },
  {
    entryId: "15",
    ref: "sast",
    command:
      "semgrep scan --config p/typescript --config p/react --config p/nodejsscan --config p/secrets --exclude-rule ajinabraham.njsscan.dos.regex_dos.regex_dos --error",
  },
  { entryId: "15", ref: "dependency-audit", command: "pnpm audit --audit-level=high" },
  { entryId: "15", ref: "dependency-audit", command: "pnpm exec tsx scripts/license-audit.ts" },
  { entryId: "v3-invariants-phase-gated", ref: "v3-invariants", command: "pnpm exec tsx scripts/v3-invariants.ts" },
  { entryId: "v3-gate-ordering", ref: "v3-invariants", command: "pnpm exec tsx scripts/v3-invariants.ts" },
  { entryId: "golden-cases-truth-set", ref: "golden-cases", command: "pnpm exec tsx scripts/golden-cases-validate.ts" },
  {
    entryId: "charter-drift-fence",
    ref: "test",
    command: "pnpm exec tsx scripts/fitness-tests.ts",
  },
] as const;

function blockingCiJobs(): Map<string, CiJob> {
  const f = p(".github/workflows/ci.yml");
  return parseCiJobs(existsSync(f) ? readFileSync(f, "utf8") : "");
}

function completeSuiteEntryCommands(
  job: CiJob | undefined,
): string[] {
  return (job?.commands ?? []).filter(
    (command) =>
      command.includes("vitest") ||
      command.includes("scripts/fitness-tests.ts"),
  );
}

function mechanismRatchetProblems(entries: readonly Entry[]): string[] {
  const expected = new Set(
    RATCHETED_ENFORCED_MECHANISMS.map((tuple) => JSON.stringify(tuple)),
  );
  const actual = new Set(
    entries.flatMap((entry) =>
      entry.mechanisms
        .filter((mechanism) => effectiveStatus(entry, mechanism) === "enforced")
        .map((mechanism) =>
          JSON.stringify([
            String(entry.id),
            mechanism.type,
            mechanism.ref,
            mechanism.command ?? "",
            "enforced",
          ]),
        ),
    ),
  );
  return [
    ...[...expected]
      .filter((tuple) => !actual.has(tuple))
      .map((tuple) => `ratcheted enforced mechanism missing: ${tuple}`),
    ...[...actual]
      .filter((tuple) => !expected.has(tuple))
      .map((tuple) => `enforced mechanism is absent from the ratchet: ${tuple}`),
  ];
}

function unwrapRegistrationExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function staticRegistrationString(
  node: Node | undefined,
  seen = new Set<Node>(),
): string | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapRegistrationExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (Node.isStringLiteral(normalized)) return normalized.getLiteralText();
  if (!Node.isIdentifier(normalized)) return undefined;
  return normalized
    .getSymbol()
    ?.getDeclarations()
    .flatMap((declaration) => {
      if (!Node.isVariableDeclaration(declaration)) return [];
      const initializer = declaration.getInitializer();
      const value = staticRegistrationString(
        initializer,
        new Set(seen),
      );
      return value === undefined ? [] : [value];
    })[0];
}

function staticRegistrationBoolean(
  node: Node | undefined,
  seen = new Set<Node>(),
): boolean | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapRegistrationExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (normalized.getKind() === SyntaxKind.TrueKeyword) return true;
  if (normalized.getKind() === SyntaxKind.FalseKeyword) return false;
  if (
    Node.isPrefixUnaryExpression(normalized) &&
    normalized.getOperatorToken() === SyntaxKind.ExclamationToken
  ) {
    const value = staticRegistrationBoolean(
      normalized.getOperand(),
      new Set(seen),
    );
    return value === undefined ? undefined : !value;
  }
  if (!Node.isIdentifier(normalized)) return undefined;
  const sources = [
    ...(normalized
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return [];
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }) ?? []),
    ...precedingCallableAssignmentValues(normalized),
  ];
  const values = sources.map((source) =>
    staticRegistrationBoolean(source, new Set(seen)),
  );
  if (
    values.length === 0 ||
    values.some((value) => value === undefined) ||
    new Set(values).size !== 1
  ) {
    return undefined;
  }
  return values[0];
}

function staticRegistrationMember(
  node: Node,
): { receiver: Node; name?: string } | undefined {
  const normalized = unwrapRegistrationExpression(node);
  const reflected = reflectGetResolution(normalized);
  if (
    reflected?.complete === true &&
    reflected.values.length === 1
  ) {
    return reflected.values[0];
  }
  if (Node.isPropertyAccessExpression(normalized)) {
    return {
      receiver: normalized.getExpression(),
      name: normalized.getName(),
    };
  }
  if (!Node.isElementAccessExpression(normalized)) return undefined;
  return {
    receiver: normalized.getExpression(),
    name: staticRegistrationString(normalized.getArgumentExpression()),
  };
}

interface VitestCallablePath {
  members: string[];
  conditions: Array<{
    modifier: "skipIf" | "runIf";
    value?: boolean;
  }>;
  caseCollections: Array<boolean | undefined>;
}

const VITEST_REGISTRATION_BASES = new Set([
  "it",
  "test",
  "describe",
  "suite",
]);

function isVitestGlobalObject(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapRegistrationExpression(node);
  if (!Node.isIdentifier(normalized) || seen.has(normalized)) return false;
  seen.add(normalized);
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (
    ["globalThis", "global"].includes(normalized.getText()) &&
    !declarations.some(
      (declaration) =>
        declaration.getSourceFile() === normalized.getSourceFile(),
    )
  ) {
    return true;
  }
  const sources = [
    ...declarations.flatMap((declaration) => {
      if (!Node.isVariableDeclaration(declaration)) return [];
      const initializer = declaration.getInitializer();
      return initializer === undefined ? [] : [initializer];
    }),
    ...precedingCallableAssignmentValues(normalized),
  ];
  return sources.some((source) =>
    isVitestGlobalObject(source, new Set(seen)),
  );
}

const vitestParameterPathCache = new WeakMap<
  object,
  readonly VitestCallablePath[]
>();
const vitestParameterPathInProgress = new WeakSet<object>();

function vitestCallablePaths(
  node: Node,
  seen = new Set<Node>(),
): VitestCallablePath[] {
  const normalized = unwrapRegistrationExpression(node);
  if (seen.has(normalized)) return [];
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (
    alternatives.length !== 1 ||
    alternatives[0] !== normalized
  ) {
    const resolved = alternatives.map((alternative) =>
      vitestCallablePaths(alternative, new Set(seen)),
    );
    const paths = resolved.flat();
    return resolved.some((branch) => branch.length === 0) &&
      paths.length > 0
      ? [
          ...paths,
          {
            members: ["*", "*"],
            conditions: [],
            caseCollections: [],
          },
        ]
      : paths;
  }
  const reflected = reflectGetResolution(normalized);
  if (reflected !== undefined) {
    const paths = reflected.values.flatMap((access) =>
      vitestCallablePaths(
        access.receiver,
        new Set(seen),
      ).map((path) => ({
        ...path,
        members: [...path.members, access.name ?? "*"],
      })),
    );
    return reflected.complete
      ? paths
      : [
          ...paths,
          {
            members: ["*", "*"],
            conditions: [],
            caseCollections: [],
          },
        ];
  }
  if (Node.isTaggedTemplateExpression(normalized)) {
    const paths = vitestCallablePaths(
      normalized.getTag(),
      new Set(seen),
    );
    const template = normalized.getTemplate();
    const literalText = Node.isNoSubstitutionTemplateLiteral(template)
      ? template.getLiteralText()
      : `${template.getHead().getLiteralText()}${template
          .getTemplateSpans()
          .map((span) => `value${span.getLiteral().getLiteralText()}`)
          .join("")}`;
    return paths.map((path) => {
      const modifier = path.members.at(-1);
      if (modifier !== "each" && modifier !== "for") return path;
      const rows = literalText
        .split(/\r?\n/)
        .filter((row) => row.trim() !== "");
      return {
        ...path,
        caseCollections: [
          ...path.caseCollections,
          rows.length >= 2,
        ],
      };
    });
  }
  if (Node.isCallExpression(normalized)) {
    const paths = vitestCallablePaths(
      normalized.getExpression(),
      new Set(seen),
    );
    return paths.map((path) => {
      const modifier = path.members.at(-1);
      if (modifier === "each" || modifier === "for") {
        return {
          ...path,
          caseCollections: [
            ...path.caseCollections,
            staticRegistrationCaseCollection(
              normalized.getArguments()[0],
            ),
          ],
        };
      }
      if (modifier !== "skipIf" && modifier !== "runIf") return path;
      return {
        ...path,
        conditions: [
          ...path.conditions,
          {
            modifier,
            value: staticRegistrationBoolean(
              normalized.getArguments()[0],
            ),
          },
        ],
      };
    });
  }
  const member = staticRegistrationMember(normalized);
  if (member !== undefined) {
    return vitestCallablePaths(member.receiver, new Set(seen)).map(
      (path) => ({
        ...path,
        members: [...path.members, member.name ?? "*"],
      }),
    );
  }
  if (!Node.isIdentifier(normalized)) return [];
  const parameterKey = normalized.getSymbol()?.compilerSymbol;
  if (parameterKey !== undefined) {
    const cached = vitestParameterPathCache.get(parameterKey);
    if (cached !== undefined) return [...cached];
    if (vitestParameterPathInProgress.has(parameterKey)) return [];
  }
  const parameterValues = localFunctionParameterValues(normalized);
  if (parameterValues !== undefined) {
    if (parameterKey !== undefined) {
      vitestParameterPathInProgress.add(parameterKey);
    }
    const paths = parameterValues.values.flatMap((value) =>
      vitestCallablePaths(value, new Set(seen)),
    );
    const resolved = !parameterValues.complete && paths.length > 0
      ? [
          ...paths,
          {
            members: ["*", "*"],
            conditions: [],
            caseCollections: [],
          },
        ]
      : paths;
    if (parameterKey !== undefined) {
      vitestParameterPathInProgress.delete(parameterKey);
      vitestParameterPathCache.set(parameterKey, resolved);
    }
    return resolved;
  }
  if (isVitestGlobalObject(normalized)) {
    return [{ members: [], conditions: [], caseCollections: [] }];
  }
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  const imported = declarations.flatMap(
    (declaration): VitestCallablePath[] => {
    if (Node.isImportSpecifier(declaration)) {
      const moduleName = declaration
        .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
        ?.getModuleSpecifierValue();
      return moduleName === "vitest"
        ? [{
            members: [declaration.getName()],
            conditions: [],
            caseCollections: [],
          }]
        : [];
    }
    if (Node.isNamespaceImport(declaration)) {
      const moduleName = declaration
        .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
        ?.getModuleSpecifierValue();
      return moduleName === "vitest"
        ? [{ members: [], conditions: [], caseCollections: [] }]
        : [];
    }
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      return initializer === undefined
        ? []
        : vitestCallablePaths(initializer, new Set(seen));
    }
    if (!Node.isBindingElement(declaration)) return [];
    const property =
      declaration.getPropertyNameNode() ?? declaration.getNameNode();
    const name = Node.isIdentifier(property)
      ? property.getText()
      : Node.isStringLiteral(property)
        ? property.getLiteralText()
        : undefined;
    const variable = declaration.getFirstAncestorByKind(
      SyntaxKind.VariableDeclaration,
    );
    const initializer = variable?.getInitializer();
    return initializer === undefined
      ? []
      : vitestCallablePaths(initializer, new Set(seen)).map((path) => ({
          ...path,
          members: [...path.members, name ?? "*"],
        }));
    },
  );
  return [
    ...imported,
    ...precedingCallableAssignmentValues(normalized).flatMap((source) =>
      vitestCallablePaths(source, new Set(seen)),
    ),
    ...(VITEST_REGISTRATION_BASES.has(normalized.getText()) &&
    !declarations.some(
      (declaration) =>
        declaration.getSourceFile() === normalized.getSourceFile(),
    )
      ? [
          {
            members: [normalized.getText()],
            conditions: [],
            caseCollections: [],
          },
        ]
      : []),
  ];
}

function vitestCallablePathsForCall(
  call: CallExpression,
): VitestCallablePath[] {
  const reflected = reflectApplyResolution(call);
  if (reflected === undefined) {
    return vitestCallablePaths(call.getExpression());
  }
  const paths = reflected.values.flatMap((target) =>
    vitestCallablePaths(target),
  );
  return reflected.complete
    ? paths
    : [
        ...paths,
        {
          members: ["*", "*"],
          conditions: [],
          caseCollections: [],
        },
      ];
}

const NEUTRALIZING_VITEST_OPTIONS = new Set([
  "skip",
  "only",
  "todo",
  "fails",
]);

function staticRegistrationCaseCollection(
  node: Node | undefined,
  seen = new Set<Node>(),
): boolean | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapRegistrationExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (Node.isArrayLiteralExpression(normalized)) {
    return normalized.getElements().some(Node.isSpreadElement)
      ? undefined
      : normalized.getElements().length > 0;
  }
  if (Node.isCallExpression(normalized)) {
    const member = staticRegistrationMember(normalized.getExpression());
    if (
      member?.name === "freeze" &&
      Node.isIdentifier(member.receiver) &&
      member.receiver.getText() === "Object" &&
      !member.receiver
        .getSymbol()
        ?.getDeclarations()
        .some(
          (declaration) =>
            declaration.getSourceFile() === normalized.getSourceFile(),
        )
    ) {
      return staticRegistrationCaseCollection(
        normalized.getArguments()[0],
        new Set(seen),
      );
    }
    return undefined;
  }
  return undefined;
}

function registrationOptionPropertyName(node: Node): string | undefined {
  if (Node.isIdentifier(node) || Node.isStringLiteral(node)) {
    return Node.isIdentifier(node) ? node.getText() : node.getLiteralText();
  }
  if (!Node.isComputedPropertyName(node)) return undefined;
  return staticRegistrationString(node.getExpression());
}

function registrationOptionsState(
  node: Node,
  seen = new Set<Node>(),
): "safe" | "unsafe" | "not-options" | "unknown" {
  const normalized = unwrapRegistrationExpression(node);
  if (seen.has(normalized)) return "unknown";
  seen.add(normalized);
  if (
    Node.isArrowFunction(normalized) ||
    Node.isFunctionExpression(normalized) ||
    Node.isNumericLiteral(normalized)
  ) {
    return "not-options";
  }
  if (Node.isObjectLiteralExpression(normalized)) {
    for (const property of normalized.getProperties()) {
      if (Node.isSpreadAssignment(property)) return "unsafe";
      if (
        !Node.isPropertyAssignment(property) &&
        !Node.isShorthandPropertyAssignment(property) &&
        !Node.isMethodDeclaration(property) &&
        !Node.isGetAccessorDeclaration(property) &&
        !Node.isSetAccessorDeclaration(property)
      ) {
        return "unsafe";
      }
      const name = registrationOptionPropertyName(property.getNameNode());
      if (name === undefined) return "unsafe";
      if (!NEUTRALIZING_VITEST_OPTIONS.has(name)) continue;
      const value = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
          ? property.getNameNode()
          : undefined;
      if (staticRegistrationBoolean(value) !== false) return "unsafe";
    }
    return "safe";
  }
  if (Node.isCallExpression(normalized)) {
    const member = staticRegistrationMember(normalized.getExpression());
    if (
      member?.name === "freeze" &&
      Node.isIdentifier(member.receiver) &&
      member.receiver.getText() === "Object" &&
      !member.receiver
        .getSymbol()
        ?.getDeclarations()
        .some(
          (declaration) =>
            declaration.getSourceFile() === normalized.getSourceFile(),
        )
    ) {
      const frozen = normalized.getArguments()[0];
      return frozen === undefined
        ? "unknown"
        : registrationOptionsState(frozen, new Set(seen));
    }
    return "unknown";
  }
  if (!Node.isIdentifier(normalized)) return "unknown";
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (declarations.some(Node.isFunctionDeclaration)) return "not-options";
  const sources = [
    ...declarations.flatMap((declaration) => {
      if (!Node.isVariableDeclaration(declaration)) return [];
      const initializer = declaration.getInitializer();
      return initializer === undefined ? [] : [initializer];
    }),
    ...precedingCallableAssignmentValues(normalized),
  ];
  return sources.length > 0 &&
    sources.every(
      (source) =>
        registrationOptionsState(source, new Set(seen)) ===
        "not-options",
    )
    ? "not-options"
    : "unknown";
}

function registrationOptionsAreUnsafe(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const options = call.getArguments()[1];
  if (options === undefined) return false;
  const state = registrationOptionsState(options);
  return state === "unsafe" || state === "unknown";
}

function isVitestRegistrationPath(path: VitestCallablePath): boolean {
  const [base] = path.members;
  if (base === undefined) return false;
  if (["xit", "xtest", "xdescribe"].includes(base)) return true;
  if (!VITEST_REGISTRATION_BASES.has(base) && base !== "*") return false;
  if (path.members.length === 1) return true;
  return (
    path.conditions.length > 0 ||
    path.caseCollections.length > 0 ||
    path.members
      .slice(1)
      .some(
        (member) =>
          member === "*" || NEUTRALIZING_VITEST_OPTIONS.has(member),
      )
  );
}

function vitestRegistrationPathIsDisabled(
  call: Node,
  path: VitestCallablePath,
): boolean {
  const conditionallyDisabled = path.conditions.some(
    ({ modifier, value }) =>
      (modifier === "skipIf" && value !== false) ||
      (modifier === "runIf" && value !== true),
  );
  const emptyOrUnresolvedCases = path.caseCollections.some(
    (nonEmpty) => nonEmpty !== true,
  );
  return (
    ["xit", "xtest", "xdescribe"].includes(path.members[0] ?? "") ||
    path.members
      .slice(1)
      .some((member) => NEUTRALIZING_VITEST_OPTIONS.has(member)) ||
    path.members.slice(1).includes("*") ||
    conditionallyDisabled ||
    emptyOrUnresolvedCases ||
    registrationOptionsAreUnsafe(call)
  );
}

function directRegistrationContainer(call: Node): Node | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const statement = call.getFirstAncestorByKind(
    SyntaxKind.ExpressionStatement,
  );
  return statement?.getExpression() === call
    ? statement.getParent()
    : undefined;
}

function registrationCallbackOwner(
  callback: Node,
): Node | undefined {
  const owner = callback.getParent();
  return Node.isCallExpression(owner) &&
    owner.getArguments().includes(callback)
    ? owner
    : undefined;
}

function vitestRegistrationIsReachable(
  call: Node,
  file: SourceFile,
  seen = new Set<Node>(),
): boolean {
  if (!Node.isCallExpression(call) || seen.has(call)) return false;
  seen.add(call);
  const container = directRegistrationContainer(call);
  if (container === file) {
    return isProvablyReachable(call, file);
  }
  if (!Node.isBlock(container)) return false;
  const callback = container.getParent();
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionExpression(callback)
  ) {
    return false;
  }
  const owner = registrationCallbackOwner(callback);
  if (!Node.isCallExpression(owner)) return false;
  const ownerPaths = vitestCallablePaths(owner.getExpression()).filter(
    (path) =>
      isVitestRegistrationPath(path) &&
      ["describe", "suite"].includes(path.members[0] ?? "") &&
      !vitestRegistrationPathIsDisabled(owner, path),
  );
  return (
    ownerPaths.length > 0 &&
    isProvablyReachable(call, callback) &&
    vitestRegistrationIsReachable(owner, file, seen)
  );
}

function disabledVitestRegistrationProblemsInFile(
  file: SourceFile,
  fileName: string,
): string[] {
  return file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .flatMap((call) =>
      vitestCallablePathsForCall(call)
        .filter(isVitestRegistrationPath)
        .flatMap((path) => {
          const members = path.members;
          if (vitestRegistrationPathIsDisabled(call, path)) {
            return [
              `${fileName}:${call.getStartLineNumber()} disabled/focused Vitest registration ${members.join(".")}`,
            ];
          }
          return vitestRegistrationIsReachable(call, file)
            ? []
            : [
                `${fileName}:${call.getStartLineNumber()} unreachable Vitest registration ${members.join(".")}`,
              ];
        }),
    );
}

const registrationAnalysisProject = new Project({
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
});
const registrationGraphProject = new Project({
  tsConfigFilePath: p("tsconfig.json"),
  skipAddingFilesFromTsConfig: true,
});
const registrationFilesystemAnalysisProject = new Project({
  useInMemoryFileSystem: true,
  skipAddingFilesFromTsConfig: true,
});
let registrationAnalysisSequence = 0;

type RegistrationImportSources =
  | true
  | Readonly<Record<string, string>>;

interface RegistrationRuntimeReference {
  readonly specifier?: string;
  readonly line: number;
}

function registrationRuntimeReferences(
  file: SourceFile,
): RegistrationRuntimeReference[] {
  const references: RegistrationRuntimeReference[] = [];
  for (const declaration of file.getImportDeclarations()) {
    const clause = declaration.getImportClause();
    const namedImports = declaration.getNamedImports();
    if (
      clause === undefined ||
      (!declaration.isTypeOnly() &&
        (declaration.getDefaultImport() !== undefined ||
          declaration.getNamespaceImport() !== undefined ||
          namedImports.length === 0 ||
          namedImports.some((specifier) => !specifier.isTypeOnly())))
    ) {
      references.push({
        specifier: declaration.getModuleSpecifierValue(),
        line: declaration.getStartLineNumber(),
      });
    }
  }
  for (const declaration of file.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const namedExports = declaration.getNamedExports();
    if (
      specifier !== undefined &&
      !declaration.isTypeOnly() &&
      !(
        namedExports.length > 0 &&
        namedExports.every((named) => named.isTypeOnly())
      )
    ) {
      references.push({
        specifier,
        line: declaration.getStartLineNumber(),
      });
    }
  }
  for (const declaration of file.getDescendantsOfKind(
    SyntaxKind.ImportEqualsDeclaration,
  )) {
    if (declaration.isTypeOnly()) continue;
    const moduleReference = declaration.getModuleReference();
    if (!Node.isExternalModuleReference(moduleReference)) continue;
    const expression = moduleReference.getExpression();
    references.push({
      ...(Node.isStringLiteral(expression) ||
      Node.isNoSubstitutionTemplateLiteral(expression)
        ? { specifier: expression.getLiteralText() }
        : {}),
      line: declaration.getStartLineNumber(),
    });
  }
  for (const reference of moduleReferences(file)) {
    if (
      ![
        "dynamic-import",
        "require",
        "require-reference",
        "create-require",
      ].includes(reference.kind)
    ) {
      continue;
    }
    references.push({
      ...(reference.specifier === null
        ? {}
        : { specifier: reference.specifier }),
      line: reference.line,
    });
  }
  return references;
}

const REGISTRATION_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
] as const;

function normalizedRegistrationPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function inlineRegistrationModulePath(
  importer: string,
  specifier: string,
  sources: Readonly<Record<string, string>>,
): string | undefined | null {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalizedRegistrationPath(
    posix.join(posix.dirname(importer), specifier),
  );
  const extension = posix.extname(base);
  const sourceBase = [".js", ".jsx", ".mjs", ".cjs"].includes(extension)
    ? base.slice(0, -extension.length)
    : base;
  const candidates = REGISTRATION_SOURCE_EXTENSIONS.includes(
    extension as (typeof REGISTRATION_SOURCE_EXTENSIONS)[number],
  )
    ? [base]
    : [
        ...REGISTRATION_SOURCE_EXTENSIONS.map(
          (candidate) => `${sourceBase}${candidate}`,
        ),
        ...REGISTRATION_SOURCE_EXTENSIONS.map((candidate) =>
          posix.join(sourceBase, `index${candidate}`),
        ),
      ];
  return candidates.find((candidate) => sources[candidate] !== undefined) ??
    null;
}

const filesystemRegistrationResolutionCache = new Map<
  string,
  string | undefined | null
>();

function filesystemRegistrationModulePath(
  importer: string,
  specifier: string,
): string | undefined | null {
  const cacheKey = `${importer}\0${specifier}`;
  if (filesystemRegistrationResolutionCache.has(cacheKey)) {
    return filesystemRegistrationResolutionCache.get(cacheKey);
  }
  const importerPath = resolve(root, importer);
  const resolvedModule = ts.resolveModuleName(
    specifier,
    importerPath,
    registrationGraphProject.getCompilerOptions(),
    registrationGraphProject.getModuleResolutionHost(),
  ).resolvedModule;
  if (resolvedModule === undefined) {
    const result = specifier.startsWith(".") ||
      specifier.startsWith("@/") ||
      specifier.startsWith("@app/") ||
      specifier.startsWith("@contracts/") ||
      specifier.startsWith("@domain/") ||
      specifier.startsWith("@infra/")
      ? null
      : undefined;
    filesystemRegistrationResolutionCache.set(cacheKey, result);
    return result;
  }
  const resolvedPath = resolve(resolvedModule.resolvedFileName);
  if (
    resolvedModule.isExternalLibraryImport ||
    resolvedPath.split(sep).includes("node_modules") ||
    resolvedPath.endsWith(".d.ts")
  ) {
    filesystemRegistrationResolutionCache.set(cacheKey, undefined);
    return undefined;
  }
  const fromRoot = relative(root, resolvedPath);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    filesystemRegistrationResolutionCache.set(cacheKey, null);
    return null;
  }
  const result = normalizedRegistrationPath(fromRoot);
  filesystemRegistrationResolutionCache.set(cacheKey, result);
  return result;
}

interface RegistrationModuleAnalysis {
  readonly references: readonly RegistrationRuntimeReference[];
}

const filesystemRegistrationAnalysisCache = new Map<
  string,
  RegistrationModuleAnalysis
>();

function analyzeRegistrationModule(
  project: Project,
  path: string,
  source: string,
): RegistrationModuleAnalysis {
  const file = project.createSourceFile(`/${path}`, source, {
    overwrite: true,
  });
  return {
    references: registrationRuntimeReferences(file),
  };
}

function filesystemRegistrationModuleAnalysis(
  path: string,
): RegistrationModuleAnalysis | undefined {
  const cached = filesystemRegistrationAnalysisCache.get(path);
  if (cached !== undefined) return cached;
  if (!existsSync(p(path))) return undefined;
  const analysis = analyzeRegistrationModule(
    registrationFilesystemAnalysisProject,
    path,
    readFileSync(p(path), "utf8"),
  );
  filesystemRegistrationAnalysisCache.set(path, analysis);
  return analysis;
}

function importedFilesystemVitestRegistrationProblems(
  entrySource: string,
  entryName: string,
): string[] {
  const normalizedEntry = normalizedRegistrationPath(entryName);
  const diskEntrySource = existsSync(p(normalizedEntry))
    ? readFileSync(p(normalizedEntry), "utf8")
    : undefined;
  const usesTransientProject = entrySource !== diskEntrySource;
  const project = usesTransientProject
    ? new Project({
        tsConfigFilePath: p("tsconfig.json"),
        skipAddingFilesFromTsConfig: true,
      })
    : registrationFilesystemAnalysisProject;
  const problems: string[] = [];
  const registrationProblems: string[] = [];
  const reachable = new Set<string>();
  const pending = [normalizedEntry];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reachable.has(path)) continue;
    const source = path === normalizedEntry
      ? entrySource
      : existsSync(p(path))
        ? readFileSync(p(path), "utf8")
        : undefined;
    const analysis = source === undefined
      ? undefined
      : usesTransientProject
        ? analyzeRegistrationModule(project, path, source)
        : filesystemRegistrationModuleAnalysis(path);
    if (analysis === undefined) {
      problems.push(`${path}:1 imported fitness module cannot be read`);
      continue;
    }
    reachable.add(path);
    for (const reference of analysis.references) {
      if (reference.specifier === undefined) {
        problems.push(
          `${path}:${reference.line} imported fitness graph requires literal runtime module references`,
        );
        continue;
      }
      if (path !== normalizedEntry && reference.specifier === "vitest") {
        problems.push(
          `${path}:${reference.line} imported fitness helper must not import the Vitest runtime`,
        );
      }
      const resolved = filesystemRegistrationModulePath(
        path,
        reference.specifier,
      );
      if (resolved === null) {
        problems.push(
          `${path}:${reference.line} local runtime import '${reference.specifier}' cannot be resolved`,
        );
      } else if (resolved !== undefined) {
        pending.push(resolved);
      }
    }
  }
  for (const path of reachable) {
    if (path === normalizedEntry) continue;
    const file = project.getSourceFile(`/${path}`);
    if (file === undefined) {
      problems.push(`${path}:1 imported fitness module cannot be read`);
      continue;
    }
    const registrations = file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .flatMap((call) =>
        vitestCallablePathsForCall(call)
          .filter(isVitestRegistrationPath)
          .map(
            (registration) =>
              `${path}:${call.getStartLineNumber()} imported fitness helper must not register Vitest ${registration.members.join(".")}`,
          ),
      );
    registrationProblems.push(...registrations);
  }
  return [...registrationProblems, ...problems];
}

function importedVitestRegistrationProblems(
  entrySource: string,
  entryName: string,
  importSources: RegistrationImportSources,
): string[] {
  if (importSources === true) {
    return importedFilesystemVitestRegistrationProblems(
      entrySource,
      entryName,
    );
  }
  const inlineSources = Object.fromEntries(
    Object.entries(importSources).map(([path, source]) => [
      normalizedRegistrationPath(path),
      source,
    ]),
  );
  const sources = new Map<string, string>([
    [normalizedRegistrationPath(entryName), entrySource],
  ]);
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const problems: string[] = [];
  const registrationProblems: string[] = [];
  const reachable = new Set<string>();
  const pending = [normalizedRegistrationPath(entryName)];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reachable.has(path)) continue;
    const source =
      sources.get(path) ??
      inlineSources[path];
    if (source === undefined) {
      problems.push(
        `${path}:1 imported fitness module cannot be read`,
      );
      continue;
    }
    sources.set(path, source);
    reachable.add(path);
    const file = project.createSourceFile(`/${path}`, source);
    for (const reference of registrationRuntimeReferences(file)) {
      if (reference.specifier === undefined) {
        problems.push(
          `${path}:${reference.line} imported fitness graph requires literal runtime module references`,
        );
        continue;
      }
      if (
        path !== normalizedRegistrationPath(entryName) &&
        reference.specifier === "vitest"
      ) {
        problems.push(
          `${path}:${reference.line} imported fitness helper must not import the Vitest runtime`,
        );
      }
      const resolved = inlineRegistrationModulePath(
        path,
        reference.specifier,
        inlineSources,
      );
      if (resolved === null) {
        problems.push(
          `${path}:${reference.line} local runtime import '${reference.specifier}' cannot be resolved`,
        );
      } else if (resolved !== undefined) {
        pending.push(resolved);
      }
    }
  }
  for (const path of reachable) {
    if (path === normalizedRegistrationPath(entryName)) continue;
    const file = project.getSourceFile(`/${path}`);
    if (file === undefined) {
      problems.push(`${path}:1 imported fitness module cannot be read`);
      continue;
    }
    const registrations = file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .flatMap((call) =>
        vitestCallablePathsForCall(call)
          .filter(isVitestRegistrationPath)
          .map(
            (registration) =>
              `${path}:${call.getStartLineNumber()} imported fitness helper must not register Vitest ${registration.members.join(".")}`,
          ),
      );
    registrationProblems.push(...registrations);
  }
  return [...registrationProblems, ...problems];
}

export function disabledVitestRegistrationProblems(
  source: string,
  fileName = "fitness.test.ts",
  importSources?: RegistrationImportSources,
): string[] {
  registrationAnalysisSequence += 1;
  const file = registrationAnalysisProject.createSourceFile(
    `/fitness-${registrationAnalysisSequence}.test.ts`,
    source,
  );
  try {
    return [
      ...disabledVitestRegistrationProblemsInFile(file, fileName),
      ...(importSources === undefined
        ? []
        : importedVitestRegistrationProblems(
            source,
            fileName,
            importSources,
          )),
    ];
  } finally {
    registrationAnalysisProject.removeSourceFile(file);
  }
}

describe("charter-drift fence", () => {
  it("(a) every enforced file/config/fitness mechanism exists on disk", () => {
    const missing: string[] = [];
    for (const entry of allEntries) {
      for (const m of entry.mechanisms) {
        if (effectiveStatus(entry, m) !== "enforced") continue;
        if (["file", "config", "fitness", "adr", "procedure"].includes(m.type) && isPathLike(m.ref)) {
          if (!existsSync(p(m.ref))) missing.push(`${entry.id} -> ${m.type}:${m.ref}`);
        }
      }
    }
    expect(missing, `enforced mappings point at missing mechanisms:\n${missing.join("\n")}`).toEqual([]);
  });

  it("(a') every enforced ci-gate binds an exact command in a dedicated blocking step", () => {
    const jobs = blockingCiJobs();
    const missing: string[] = [];
    for (const entry of allEntries) {
      for (const m of entry.mechanisms) {
        if (effectiveStatus(entry, m) !== "enforced") continue;
        if (m.type !== "ci-gate") continue;
        if (m.command === undefined || m.command.trim() === "") {
          missing.push(`${entry.id} -> ci-gate:${m.ref} does not bind an exact command`);
          continue;
        }
        const problem = ciJobRunProblem(jobs, m.ref, m.command);
        if (problem !== undefined) missing.push(`${entry.id} -> ${problem}`);
      }
    }
    expect(missing, `enforced CI gates are not proven by .github/workflows/ci.yml:\n${missing.join("\n")}`).toEqual([]);
  });

  it("(a') the blocking test job enters the complete suite exactly once", () => {
    expect(
      completeSuiteEntryCommands(blockingCiJobs().get("test")),
    ).toEqual(["pnpm exec tsx scripts/fitness-tests.ts"]);
    const duplicated = parseCiJobs(`
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm exec vitest run
      - run: pnpm exec tsx scripts/fitness-tests.ts
`);
    expect(
      completeSuiteEntryCommands(duplicated.get("test")),
    ).toEqual([
      "pnpm exec vitest run",
      "pnpm exec tsx scripts/fitness-tests.ts",
    ]);
  });

  it("(b) no fitness fence is disabled or focused (this file included)", () => {
    const offenders = fitnessFiles.flatMap((file) =>
      disabledVitestRegistrationProblems(
        readFileSync(p(file), "utf8"),
        file,
        true,
      ),
    );
    expect(offenders, `disabled/focused fences found:\n${offenders.join("\n")}`).toEqual([]);
  }, 60_000);

  it("(b companion) detects every supported Vitest neutralizer through aliases and computed chains", () => {
    const disabled = [
      `import { describe as suite } from "vitest";
const off = suite["skip"];
off("disabled", () => {});`,
      `import * as vitest from "vitest";
const mode = "only";
vitest.test[mode]("focused", () => {});`,
      `import { xit as check } from "vitest";
check("disabled", () => {});`,
      `import { describe } from "vitest";
let off: typeof describe.skip;
off = describe.skip;
off("disabled", () => {});`,
      `import { it } from "vitest";
it.todo("disabled");`,
      `import { test } from "vitest";
const inverted = test.fails;
inverted("expected failure", () => {});`,
      `import * as vitest from "vitest";
const condition = true;
vitest.test["skipIf"](condition)("disabled", () => {});`,
      `import { describe } from "vitest";
const never = false;
const disabledSuite = describe.runIf(never);
disabledSuite("disabled", () => {});`,
      `import { it } from "vitest";
const unknown = Math.random() > 0.5;
it.skipIf(unknown)("conditionally disabled", () => {});`,
      `describe.skip("global suite disabled", () => {});`,
      `suite["only"]("global suite focused", () => {});`,
      `test.todo("global test disabled");`,
      `import { suite } from "vitest";
suite.skip("imported suite disabled", () => {});`,
      `describe("disabled by options", { skip: true }, () => {});`,
      `suite("focused by options", { only: true }, () => {});`,
      `test("todo by options", { todo: true }, () => {});`,
      `it("expected failure by options", { fails: true }, () => {});`,
      `const flag = Math.random() > 0.5;
describe("dynamically disabled", { skip: flag }, () => {});`,
      `const options = { only: true };
test("focused through options alias", options, () => {});`,
      `const mode = "todo";
it("computed option", { [mode]: true }, () => {});`,
      `const base = { fails: true };
test("spread options", { ...base }, () => {});`,
      `const root = globalThis;
root.describe.skip("global alias disabled", () => {});`,
      `(globalThis as any).suite["only"]("global object focused", () => {});`,
      `(global as any).describe.skip("node global disabled", () => {});`,
      `const root = global;
root.suite.only("node global alias focused", () => {});`,
      `const registration = Math.random() > 0.5 ? "describe" : "suite";
(globalThis as any)[registration].skip("dynamic global registration", () => {});`,
      `describe.each([])("empty parameterized suite", () => {});`,
      `test.for([])("empty parameterized test", () => {});`,
      `const cases: unknown[] = [];
suite.each(cases)("empty aliased cases", () => {});`,
      `const cases = [1];
it.each([...cases])("spread cases", () => {});`,
      `const cases = Math.random() > 0.5 ? [1] : [];
test.for(cases)("dynamic parameterized test", () => {});`,
      `const options = { skip: false };
options.skip = true;
describe("mutated options", options, () => {});`,
      `const cases = [1];
cases.pop();
describe.each(cases)("mutated cases", () => {});`,
      `const options = { skip: false };
describe("mutable option alias", options, () => {});`,
      `const cases = [1];
describe.each(cases)("mutable case alias", () => {});`,
      "describe.each``(\"empty tagged suite\", () => {});",
      `import { describe } from "vitest";
Reflect.apply(describe.skip, describe, ["reflectively disabled", () => {}]);`,
      `import { describe } from "vitest";
const R = Reflect;
R.apply(describe.skip, describe, ["reflect alias disabled", () => {}]);`,
      `import { describe } from "vitest";
Reflect["ap" + "ply"](describe.skip, describe, ["computed reflect disabled", () => {}]);`,
      `import { describe } from "vitest";
const R = globalThis.Reflect;
R.get(describe, "skip")("global reflect alias disabled", () => {});`,
      `import { describe } from "vitest";
const R = globalThis["Ref" + "lect"];
R.apply(describe.skip, describe, ["computed global reflect disabled", () => {}]);`,
      `import { describe } from "vitest";
const intrinsics = { R: Reflect };
intrinsics.R.apply(describe.skip, describe, ["property-held reflect disabled", () => {}]);`,
      `import { describe } from "vitest";
const intrinsics = { R: Reflect };
const key = Boolean(Date.now()) ? "R" : "R";
intrinsics[key].apply(describe.skip, describe, ["computed property-held reflect disabled", () => {}]);`,
      `import { it } from "vitest";
function register(fn) {
  fn("higher-order disabled", () => {});
}
register(it.skip);`,
      `import { describe } from "vitest";
(true ? describe.skip : describe)("conditionally disabled", () => {});`,
      `import { describe } from "vitest";
(describe.skip || describe)("logically disabled", () => {});`,
      `import { describe } from "vitest";
(0, describe.skip)("sequence disabled", () => {});`,
      `import { describe } from "vitest";
let invoke = Reflect.apply.bind(Reflect, () => undefined, undefined);
invoke = Reflect.apply.bind(Reflect, describe.skip, describe);
invoke(["assignment-shadowed apply", () => {}]);`,
      `import { describe } from "vitest";
Reflect.get(describe, "skip")("reflected member", () => {});`,
      `import { describe } from "vitest";
const safe = { noop: () => undefined };
let select = Reflect.get.bind(Reflect, safe, "noop");
select = Reflect.get.bind(Reflect, describe, "skip");
select()("assignment-shadowed get", () => {});`,
      `import { describe } from "vitest";
const member = Math.random() > 0.5 ? "skip" : "noop";
Reflect.get(describe, member)("unresolved reflected member", () => {});`,
      `if (false) {
  describe("dead suite", () => {
    it("never registers", () => {});
  });
}`,
      `function registerFence() {
  describe("uncalled suite", () => {
    it("never registers", () => {});
  });
}`,
    ];
    for (const source of disabled) {
      expect(
        disabledVitestRegistrationProblems(source),
        source,
      ).not.toEqual([]);
    }
    expect(
      disabledVitestRegistrationProblems(
        `import { describe as suite, it as check } from "vitest";
suite("enabled", () => { check("runs", () => {}); });`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `import { test } from "vitest";
test.skipIf(false)("runs", () => {});
test.runIf(true)("runs too", () => {});`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `describe("enabled", { skip: false, only: false, todo: false, fails: false }, () => {});`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `describe("enabled", Object.freeze({ skip: false, only: false, todo: false, fails: false }), () => {});
const callback = () => {};
test("enabled callback alias", callback);`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `describe.each([[1], [2]])("enabled cases", () => {});
test.for([{ value: 1 }])("enabled case", () => {});
it.each(Object.freeze([[1]]))("frozen enabled case", () => {});`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        "it.each`value\n${1}`(\"enabled tagged case\", () => {});",
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `const suite = { skip: (_name: string, fn: () => void) => fn() };
suite.skip("application suite", () => {});`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `function register(describe: { skip: (name: string) => void }) {
  describe.skip("application callback");
}`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `function register(globalThis: {
  describe: { skip: (name: string, fn: () => void) => void };
}) {
  globalThis.describe.skip("application suite", () => {});
}`,
      ),
    ).toEqual([]);
    expect(
      disabledVitestRegistrationProblems(
        `function register(global: {
  describe: { skip: (name: string, fn: () => void) => void };
}) {
  global.describe.skip("application suite", () => {});
}`,
      ),
    ).toEqual([]);
  });

  it("(b companion) detects disabled Vitest registration passed into an imported helper", () => {
    const source = `import { it } from "vitest";
import { register } from "./registration-barrel";
register(it.skip);`;
    expect(
      disabledVitestRegistrationProblems(
        source,
        "src/__tests__/fitness/example.test.ts",
        {
          "src/__tests__/fitness/registration-barrel.ts":
            `export { register } from "./registration-helper";`,
          "src/__tests__/fitness/registration-helper.ts":
            `export function register(fn: (...args: unknown[]) => unknown) {
  fn("disabled", () => undefined);
}`,
        },
      ),
    ).not.toEqual([]);
  });

  it("(b companion) rejects Vitest registrations in local runtime imports", () => {
    expect(
      disabledVitestRegistrationProblems(
        `import "./nested-fence";\nimport { it } from "vitest";\nit("live companion", () => {});`,
        "fitness.test.ts",
        {
          "nested-fence.ts":
            `import { describe } from "vitest";\ndescribe.skip("disabled enforcement", () => {});`,
        },
      ),
    ).toEqual([
      "nested-fence.ts:2 imported fitness helper must not register Vitest describe.skip",
      "nested-fence.ts:1 imported fitness helper must not import the Vitest runtime",
    ]);
    expect(
      disabledVitestRegistrationProblems(
        `import "./nested-fence";\nimport { it } from "vitest";\nit("live companion", () => {});`,
        "fitness.test.ts",
        {
          "nested-fence.ts":
            `import { describe } from "vitest";\nReflect.apply(describe.skip, describe, ["disabled enforcement", () => {}]);`,
        },
      ),
    ).toEqual([
      "nested-fence.ts:2 imported fitness helper must not register Vitest describe.skip",
      "nested-fence.ts:1 imported fitness helper must not import the Vitest runtime",
    ]);
  });

  it("(b' companion) rejects a missing fitness result even when Vitest exits successfully", () => {
    const expected = [
      "src/__tests__/fitness/axe-required.test.ts",
      "src/__tests__/fitness/charter-drift.test.ts",
    ];
    expect(
      fitnessInventoryProblems(
        expected,
        [
          {
            name: "/repo/src/__tests__/fitness/axe-required.test.ts",
            status: "passed",
          },
        ],
        0,
      ),
    ).toContain(
      "src/__tests__/fitness/charter-drift.test.ts produced no result",
    );
    expect(
      fitnessInventoryProblems(
        expected,
        expected.map((name) => ({ name, status: "passed" })),
        0,
      ),
    ).toEqual([]);
    expect(
      fitnessInventoryProblems(
        ["src/__tests__/fitness/charter-drift.test.ts"],
        [
          {
            name: "src/shadow/src/__tests__/fitness/charter-drift.test.ts",
            status: "passed",
          },
        ],
        0,
      ),
    ).toContain(
      "src/__tests__/fitness/charter-drift.test.ts produced no result",
    );
    expect(
      fitnessInventoryProblems(
        ["src/__tests__/fitness/charter-drift.test.ts"],
        [
          {
            name: "src/__tests__/fitness/charter-drift.test.ts",
            status: "passed",
          },
          {
            name: `${process.cwd()}/src/__tests__/fitness/charter-drift.test.ts`,
            status: "passed",
          },
        ],
        0,
      ),
    ).toContain(
      "src/__tests__/fitness/charter-drift.test.ts produced duplicate results",
    );
  });

  it("(b' companion) recursively inventories nested fitness tests", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "verin-fitness-inventory-"),
    );
    try {
      const fixtureDirectory = join(
        fixtureRoot,
        "src",
        "__tests__",
        "fitness",
      );
      mkdirSync(join(fixtureDirectory, "nested", "deeper"), {
        recursive: true,
      });
      writeFileSync(join(fixtureDirectory, "top.test.ts"), "");
      writeFileSync(
        join(fixtureDirectory, "nested", "deeper", "component.test.tsx"),
        "",
      );
      writeFileSync(
        join(fixtureDirectory, "nested", "deeper", "policy.spec.ts"),
        "",
      );
      writeFileSync(
        join(fixtureDirectory, "nested", "deeper", "surface.spec.tsx"),
        "",
      );
      writeFileSync(
        join(fixtureDirectory, "nested", "deeper", "helper.ts"),
        "",
      );
      writeFileSync(
        join(fixtureDirectory, "nested", "deeper", "legacy.test.js"),
        "",
      );
      expect(fitnessTestFiles(fixtureRoot)).toEqual([
        "src/__tests__/fitness/nested/deeper/component.test.tsx",
        "src/__tests__/fitness/nested/deeper/policy.spec.ts",
        "src/__tests__/fitness/nested/deeper/surface.spec.tsx",
        "src/__tests__/fitness/top.test.ts",
      ]);
      expect(
        [
          "rule.test.ts",
          "component.test.tsx",
          "policy.spec.ts",
          "surface.spec.tsx",
        ].every(isVitestTestFile),
      ).toBe(true);
      expect(
        [
          "helper.ts",
          "legacy.test.js",
          "rule.tests.ts",
          "rule.spec.mts",
        ].some(isVitestTestFile),
      ).toBe(false);
      expect(VITEST_TEST_INCLUDE).toBe(
        "src/**/*.{test,spec}.{ts,tsx}",
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("(b' companion) runs the complete test suite without selecting fitness files twice", () => {
    const args = completeTestRunArguments("/work/vitest.json");
    expect(args).toEqual([
      "run",
      "--maxWorkers=1",
      "--fileParallelism=false",
      "--reporter=json",
      "--outputFile=/work/vitest.json",
    ]);
    expect(args.some((argument) => argument.endsWith(".test.ts"))).toBe(
      false,
    );
  });

  it("(e) ratchet: every id that shipped as 'enforced' is still enforced", () => {
    const byId = new Map(allEntries.map((e) => [String(e.id), e]));
    const regressions: string[] = [];
    for (const id of RATCHETED_ENFORCED_IDS) {
      const entry = byId.get(String(id));
      if (!entry) regressions.push(`${id}: removed from charter-map.json`);
      else if (entry.status !== "enforced") regressions.push(`${id}: status flipped to '${entry.status}'`);
    }
    expect(regressions, `enforced charter entries regressed (the ratchet is monotonic):\n${regressions.join("\n")}`).toEqual([]);
  });

  it("(e') ratchet: load-bearing CI mappings stay bound to their exact blocking commands", () => {
    const byId = new Map(allEntries.map((entry) => [String(entry.id), entry]));
    const regressions = RATCHETED_CI_COMMANDS.flatMap(({ entryId, ref, command }) => {
      const entry = byId.get(entryId);
      const bound = entry?.mechanisms.some(
        (mechanism) =>
          mechanism.type === "ci-gate" &&
          mechanism.ref === ref &&
          mechanism.command === command &&
          effectiveStatus(entry, mechanism) === "enforced",
      );
      return bound ? [] : [`${entryId} -> ci-gate:${ref} must run '${command}'`];
    });
    expect(regressions, `charter CI command bindings regressed:\n${regressions.join("\n")}`).toEqual([]);
  });

  it("(e'') ratchet: complete effective enforced mechanism tuples cannot regress", () => {
    const regressions = mechanismRatchetProblems(allEntries);
    expect(
      regressions,
      `charter mechanism ratchet regressed:\n${regressions.join("\n")}`,
    ).toEqual([]);
  });

  it("(e'' companion) detects a planned or removed Axe enforcement mechanism", () => {
    const planned = structuredClone(allEntries);
    const plannedAxe = planned
      .find((entry) => entry.id === 9)
      ?.mechanisms.find(
        (mechanism) =>
          mechanism.type === "fitness" &&
          mechanism.ref === "src/__tests__/fitness/axe-required.test.ts",
      );
    if (plannedAxe !== undefined) plannedAxe.status = "planned";
    expect(mechanismRatchetProblems(planned)).toContain(
      'ratcheted enforced mechanism missing: ["9","fitness","src/__tests__/fitness/axe-required.test.ts","","enforced"]',
    );

    const removed = structuredClone(allEntries);
    const removedEntry = removed.find((entry) => entry.id === 9);
    if (removedEntry !== undefined) {
      removedEntry.mechanisms = removedEntry.mechanisms.filter(
        (mechanism) =>
          mechanism.ref !== "src/__tests__/fitness/axe-required.test.ts",
      );
    }
    expect(mechanismRatchetProblems(removed)).toContain(
      'ratcheted enforced mechanism missing: ["9","fitness","src/__tests__/fitness/axe-required.test.ts","","enforced"]',
    );
  });

  it("(c) all 16 non-negotiables are present in the map", () => {
    const ids = new Set(map.nonNegotiables.map((e) => Number(e.id)));
    const missing = Array.from({ length: 16 }, (_, i) => i + 1).filter((n) => !ids.has(n));
    expect(missing, `non-negotiable IDs missing from charter-map.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("(d) every active fitness fence file is referenced by the map", () => {
    const refs = new Set(allEntries.flatMap((e) => e.mechanisms.map((m) => m.ref)));
    const orphans = fitnessFiles.filter((file) => !refs.has(file));
    expect(orphans, `fitness fences not referenced by charter-map.json (silently added?):\n${orphans.join("\n")}`).toEqual([]);
  });
});
