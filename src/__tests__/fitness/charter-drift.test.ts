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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Node,
  Project,
  SyntaxKind,
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
  ["13", "fitness", "src/__tests__/fitness/audited-write-required.test.ts", "", "enforced"],
  ["13", "fitness", "src/__tests__/fitness/no-pii-in-audit-store.test.ts", "", "enforced"],
  ["13", "ci-gate", "audit-chain-verify", "pnpm exec tsx scripts/audit-chain-verify.ts", "enforced"],
  ["14", "fitness", "src/__tests__/fitness/no-console.test.ts", "", "enforced"],
  ["14", "fitness", "src/__tests__/fitness/observability-coverage.test.ts", "", "enforced"],
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
  ["v3-gate-ordering", "adr", "docs/adr/0030-gate-a-invariant-ordering.md", "", "enforced"],
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
    ...precedingRegistrationAssignments(normalized),
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

function precedingRegistrationAssignments(node: Node): Node[] {
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (symbol === undefined) return [];
  return node
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(
      (candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < node.getStart() &&
        Node.isIdentifier(candidate.getLeft()) &&
        candidate.getLeft().getSymbol() === symbol,
    )
    .map((candidate) => candidate.getRight());
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
    ...precedingRegistrationAssignments(normalized),
  ];
  return sources.some((source) =>
    isVitestGlobalObject(source, new Set(seen)),
  );
}

function vitestCallablePaths(
  node: Node,
  seen = new Set<Node>(),
): VitestCallablePath[] {
  const normalized = unwrapRegistrationExpression(node);
  if (seen.has(normalized)) return [];
  seen.add(normalized);
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
    ...precedingRegistrationAssignments(normalized).flatMap((source) =>
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
    ...precedingRegistrationAssignments(normalized),
  ];
  const values = sources.map((source) =>
    staticRegistrationCaseCollection(source, new Set(seen)),
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
  if (!Node.isIdentifier(normalized)) return "unknown";
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (declarations.some(Node.isFunctionDeclaration)) return "not-options";
  const sources = [
    ...declarations.flatMap((declaration) => {
      if (!Node.isVariableDeclaration(declaration)) return [];
      const initializer = declaration.getInitializer();
      return initializer === undefined ? [] : [initializer];
    }),
    ...precedingRegistrationAssignments(normalized),
  ];
  if (sources.length === 0) return "unknown";
  const states = sources.map((source) =>
    registrationOptionsState(source, new Set(seen)),
  );
  if (states.some((state) => state === "unsafe")) return "unsafe";
  return new Set(states).size === 1 ? states[0]! : "unknown";
}

function registrationOptionsAreUnsafe(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const options = call.getArguments()[1];
  if (options === undefined) return false;
  const state = registrationOptionsState(options);
  return state === "unsafe" || state === "unknown";
}

function disabledVitestRegistrationProblemsInFile(
  file: SourceFile,
  fileName: string,
): string[] {
  const xPrefixed = new Set(["xit", "xtest", "xdescribe"]);
  return file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .flatMap((call) =>
      vitestCallablePaths(call.getExpression()).flatMap((path) => {
        const members = path.members;
        const conditionallyDisabled = path.conditions.some(
          ({ modifier, value }) =>
            (modifier === "skipIf" && value !== false) ||
            (modifier === "runIf" && value !== true),
        );
        const emptyOrUnresolvedCases = path.caseCollections.some(
          (nonEmpty) => nonEmpty !== true,
        );
        const isDisabled =
          (members.length === 1 && xPrefixed.has(members[0]!)) ||
          ((VITEST_REGISTRATION_BASES.has(members[0]!) ||
            members[0] === "*") &&
            (members
              .slice(1)
              .some((member) =>
                NEUTRALIZING_VITEST_OPTIONS.has(member),
              ) ||
              members.slice(1).includes("*") ||
              conditionallyDisabled ||
              emptyOrUnresolvedCases ||
              registrationOptionsAreUnsafe(call)));
        return isDisabled
          ? [
              `${fileName}:${call.getStartLineNumber()} disabled/focused Vitest registration ${members.join(".")}`,
            ]
          : [];
      }),
    );
}

export function disabledVitestRegistrationProblems(
  source: string,
  fileName = "fitness.test.ts",
): string[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile(`/${fileName}`, source);
  return disabledVitestRegistrationProblemsInFile(file, fileName);
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
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const offenders = fitnessFiles.flatMap((file) =>
      disabledVitestRegistrationProblemsInFile(
        project.createSourceFile(
          `/${file}`,
          readFileSync(p(file), "utf8"),
        ),
        file,
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
      "describe.each``(\"empty tagged suite\", () => {});",
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
