import { describe, expect, it } from "vitest";
import { join, relative } from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import {
  REPO_ROOT,
  inMemoryProject,
  realProject,
  walk,
} from "./_fence-utils";
import { DECISION_LEDGER_SQL } from "@infra/store/decision-ledger-migration";

const IMMUTABLE_TABLES = [
  "evidence_snapshots",
  "decision_input_bundles",
  "decision_input_bundle_evidence",
  "decision_records",
  "decision_ledger",
] as const;
type ImmutableTable = (typeof IMMUTABLE_TABLES)[number];
const INSERT_ALLOWLIST: Record<ImmutableTable, string> = {
  evidence_snapshots: "src/infrastructure/ledger/ledger-sources.ts",
  decision_input_bundles: "src/infrastructure/ledger/ledger-sources.ts",
  decision_input_bundle_evidence:
    "src/infrastructure/ledger/ledger-sources.ts",
  decision_records: "src/infrastructure/ledger/ledger-sources.ts",
  decision_ledger: "src/infrastructure/ledger/ledger-store.ts",
};
const RAW_INSERT = new RegExp(
  `\\bINSERT\\s+INTO\\s+(${IMMUTABLE_TABLES.join("|")})\\b`,
  "gi",
);

interface Violation {
  readonly file: string;
  readonly line: number;
}

function staticString(node: Node, seen = new Set<Node>()): string | null {
  if (seen.has(node)) return null;
  seen.add(node);
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.getLiteralText();
  }
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node)
  ) {
    return staticString(node.getExpression(), seen);
  }
  if (
    Node.isBinaryExpression(node) &&
    node.getOperatorToken().getKind() === SyntaxKind.PlusToken
  ) {
    const left = staticString(node.getLeft(), new Set(seen));
    const right = staticString(node.getRight(), new Set(seen));
    return left === null || right === null ? null : left + right;
  }
  if (Node.isTemplateExpression(node)) {
    let value = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) {
      const expression = staticString(span.getExpression(), new Set(seen));
      if (expression === null) return null;
      value += expression + span.getLiteral().getLiteralText();
    }
    return value;
  }
  if (
    Node.isIdentifier(node) ||
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node)
  ) {
    const symbol = node.getSymbol();
    const resolved = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
    const values = (resolved?.getDeclarations() ?? []).flatMap(
      (declaration) => {
        const initializer =
          Node.isVariableDeclaration(declaration) ||
          Node.isPropertyAssignment(declaration)
            ? declaration.getInitializer()
            : undefined;
        const value = initializer
          ? staticString(initializer, new Set(seen))
          : null;
        return value === null ? [] : [value];
      },
    );
    return values.length > 0 && values.every((value) => value === values[0])
      ? values[0]!
      : null;
  }
  return null;
}

function ledgerInsertViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const absolute = file.getFilePath().replace(/\\/g, "/");
    const sourceIndex = absolute.lastIndexOf("/src/");
    const rel = sourceIndex >= 0
      ? absolute.slice(sourceIndex + 1)
      : relative(REPO_ROOT, absolute).replace(/\\/g, "/");
    for (const expression of [
      ...file.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...file.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
      ...file.getDescendantsOfKind(SyntaxKind.TemplateExpression),
      ...file.getDescendantsOfKind(SyntaxKind.BinaryExpression),
      ...file.getDescendantsOfKind(SyntaxKind.Identifier),
      ...file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
      ...file.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ]) {
      const value = staticString(expression);
      if (value === null) continue;
      for (const match of value.matchAll(RAW_INSERT)) {
        const table = match[1]?.toLowerCase() as ImmutableTable | undefined;
        const key = `${rel}:${table}`;
        if (table && INSERT_ALLOWLIST[table] !== rel && !seen.has(key)) {
          seen.add(key);
          violations.push({ file: rel, line: expression.getStartLineNumber() });
        }
      }
      if (RAW_INSERT.lastIndex !== 0) {
        RAW_INSERT.lastIndex = 0;
      }
    }
  }
  return violations;
}

function ledgerFenceFiles(): SourceFile[] {
  const project = realProject();
  for (const file of walk(
    join(REPO_ROOT, "scripts"),
    (path) => path.endsWith(".ts") || path.endsWith(".tsx"),
  )) {
    project.addSourceFileAtPath(file);
  }
  return project.getSourceFiles();
}

function exportedMutationNames(file: SourceFile): string[] {
  return [...file.getExportedDeclarations().keys()]
    .filter((name) =>
      /(update|delete|remove|rewrite|replace).*(ledger|decision|evidence|bundle)/i.test(name) ||
      /(ledger|decision|evidence|bundle).*(update|delete|remove|rewrite|replace)/i.test(name));
}

describe("decision-ledger append-only fence", () => {
  it("anti-fork: each immutable table has one exact raw-insert owner", () => {
    const violations = ledgerInsertViolations(ledgerFenceFiles());
    expect(
      violations,
      `raw decision-ledger inserts bypass the repository:\n${violations.map(
        (item) => `${item.file}:${item.line}`,
      ).join("\n")}`,
    ).toEqual([]);
  });

  it("repository exports append/read/rebuild surfaces, never immutable update/delete APIs", () => {
    const file = realProject().getSourceFileOrThrow(
      "src/infrastructure/ledger/ledger-store.ts",
    );
    expect(exportedMutationNames(file)).toEqual([]);
    expect(file.getExportedDeclarations().has("recordDecision")).toBe(true);
    expect(file.getExportedDeclarations().has("appendDecisionEvents")).toBe(true);
  });

  it("database DDL protects every immutable source table against all destructive verbs", () => {
    const missing: string[] = [];
    for (const table of IMMUTABLE_TABLES) {
      for (const verb of ["update", "delete", "truncate"]) {
        if (!DECISION_LEDGER_SQL.includes(`${table}_no_${verb}`)) {
          missing.push(`${table}:${verb}`);
        }
      }
    }
    expect(missing, `missing append-only triggers:\n${missing.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): planted repository violations fail", () => {
    it("detects a planted raw insert with file and line", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `export async function evil(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("INSERT INTO decision_ledger (id) VALUES ('x')");\n` +
          `}`,
      });
      const planted = ledgerInsertViolations(project.getSourceFiles());
      expect(planted).toHaveLength(1);
      expect(planted[0]?.file).toMatch(/src\/infrastructure\/evil\.ts$/);
      expect(planted[0]?.line).toBe(2);
    });

    it("detects a statically composed insert in an operator script", () => {
      const project = inMemoryProject({
        "/scripts/evil.ts":
          `const tables = { records: "decision_" + "records" } as const;\n` +
          "const sql = `INSERT INTO ${tables.records} (id) VALUES ($1)`;\n" +
          "export const run = (db: { query(s: string): unknown }) => db.query(sql);",
      });
      const planted = ledgerInsertViolations(project.getSourceFiles());
      expect(planted).toHaveLength(1);
      expect(planted[0]?.file).toMatch(/scripts\/evil\.ts$/);
    });

    it("detects a planted insert into any immutable source table, not just the chain", () => {
      const project = inMemoryProject(Object.fromEntries(
        IMMUTABLE_TABLES.map((table) => [
          `/src/infrastructure/forked-${table}.ts`,
          `export const sql = "INSERT INTO ${table} (org_id) VALUES ($1)";`,
        ]),
      ));
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(
        IMMUTABLE_TABLES.length,
      );
    });

    it("rejects a ledger insert from the replay-source module", () => {
      const project = inMemoryProject({
        "/src/infrastructure/ledger/ledger-sources.ts":
          `export async function fork(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("INSERT INTO decision_ledger (id) VALUES ('x')");\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(1);
    });

    it("rejects a replay-source insert from the ledger-chain module", () => {
      const project = inMemoryProject({
        "/src/infrastructure/ledger/ledger-store.ts":
          `export async function fork(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("INSERT INTO evidence_snapshots (id) VALUES ('x')");\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(1);
    });

    it("detects a planted immutable mutation export", () => {
      const project = inMemoryProject({
        "/src/infrastructure/ledger-store.ts":
          "export function updateDecisionLedger() {}",
      });
      expect(exportedMutationNames(project.getSourceFiles()[0]!)).toEqual([
        "updateDecisionLedger",
      ]);
    });
  });
});
