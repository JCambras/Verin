import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  Node,
  Project,
  SyntaxKind,
  type SourceFile,
} from "ts-morph";
import { ciJobRunProblem, parseCiJobs, type CiJob } from "../../../scripts/v3-gates.lib";
import { fitnessInventoryProblems } from "../../../scripts/fitness-tests.lib";

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
  ["14", "ci-gate", "test", "pnpm exec vitest run", "enforced"],
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
  { entryId: "14", ref: "test", command: "pnpm exec vitest run" },
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
}

function vitestCallablePaths(
  node: Node,
  seen = new Set<Node>(),
): VitestCallablePath[] {
  const normalized = unwrapRegistrationExpression(node);
  if (seen.has(normalized)) return [];
  seen.add(normalized);
  if (Node.isCallExpression(normalized)) {
    const paths = vitestCallablePaths(
      normalized.getExpression(),
      new Set(seen),
    );
    return paths.map((path) => {
      const modifier = path.members.at(-1);
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
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  const imported = declarations.flatMap(
    (declaration): VitestCallablePath[] => {
    if (Node.isImportSpecifier(declaration)) {
      const moduleName = declaration
        .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
        ?.getModuleSpecifierValue();
      return moduleName === "vitest"
        ? [{ members: [declaration.getName()], conditions: [] }]
        : [];
    }
    if (Node.isNamespaceImport(declaration)) {
      const moduleName = declaration
        .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
        ?.getModuleSpecifierValue();
      return moduleName === "vitest"
        ? [{ members: [], conditions: [] }]
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
  ];
}

function disabledVitestRegistrationProblemsInFile(
  file: SourceFile,
  fileName: string,
): string[] {
  const base = new Set(["it", "test", "describe"]);
  const disabled = new Set(["skip", "only", "todo", "fails"]);
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
        const isDisabled =
          (members.length === 1 && xPrefixed.has(members[0]!)) ||
          (base.has(members[0]!) &&
            (members.slice(1).some((member) => disabled.has(member)) ||
              members.slice(1).includes("*") ||
              conditionallyDisabled));
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

  it("(b) no fitness fence is disabled or focused (this file included)", () => {
    const dir = p("src/__tests__/fitness");
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith(".test.ts"))
      .flatMap((file) =>
        disabledVitestRegistrationProblemsInFile(
          project.createSourceFile(
            `/${file}`,
            readFileSync(`${dir}/${file}`, "utf8"),
          ),
          file,
        ),
      );
    expect(offenders, `disabled/focused fences found:\n${offenders.join("\n")}`).toEqual([]);
  });

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
    const dir = p("src/__tests__/fitness");
    const refs = new Set(allEntries.flatMap((e) => e.mechanisms.map((m) => m.ref)));
    const orphans: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
      const rel = `src/__tests__/fitness/${f}`;
      if (!refs.has(rel)) orphans.push(rel);
    }
    expect(orphans, `fitness fences not referenced by charter-map.json (silently added?):\n${orphans.join("\n")}`).toEqual([]);
  });
});
