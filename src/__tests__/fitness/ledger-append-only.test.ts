import { describe, expect, it } from "vitest";
import { relative } from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import {
  REPO_ROOT,
  inMemoryProject,
  normalizeSqlExecutorCall,
  realProject,
} from "./_fence-utils";
import { DECISION_LEDGER_SQL } from "@infra/store/decision-ledger-migration";
import { MIGRATIONS } from "@infra/store/migrations";

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
const DYNAMIC_SQL = "\u0000dynamic-sql\u0000";
const INSERT_TARGET = /\bINSERT\s+INTO\s+(?:ONLY\s+)?([^\s(;,]+)/gi;
const MERGE_TARGET = /\bMERGE\s+INTO\s+(?:ONLY\s+)?([^\s(;,]+)/gi;
const COPY_FROM_TARGET = /\bCOPY\s+([^\s(;,]+)(?:\s*\([^;]*?\))?\s+FROM\b/gi;
const REVIEWED_DYNAMIC_SQL_OWNERS = new Map([
  ["src/infrastructure/store/db.ts", new Set(["exec", "query"])],
  [
    "src/infrastructure/store/migrations.ts",
    new Set(["assertPreflightClean", "runMigrations"]),
  ],
]);

interface Violation {
  readonly file: string;
  readonly line: number;
}

interface SqlCandidate {
  readonly text: string;
  readonly complete: boolean;
}

function unwrapExpression(node: Node): Node {
  let expression = node;
  while (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    expression = expression.getExpression();
  }
  return expression;
}

function combine(
  left: readonly SqlCandidate[],
  right: readonly SqlCandidate[],
): SqlCandidate[] {
  return left.flatMap((a) => right.map((b) => ({
    text: a.text + b.text,
    complete: a.complete && b.complete,
  })));
}

function resolvedDeclarations(expression: Node): Node[] {
  const symbol = expression.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return [
    ...(Node.isIdentifier(expression) ? expression.getDefinitionNodes() : []),
    ...(target?.getDeclarations() ?? []),
  ];
}

function returnedValues(declaration: Node): Node[] {
  const callable = Node.isVariableDeclaration(declaration)
    ? declaration.getInitializer()
    : declaration;
  if (
    !callable ||
    (!Node.isFunctionDeclaration(callable) &&
      !Node.isFunctionExpression(callable) &&
      !Node.isArrowFunction(callable) &&
      !Node.isMethodDeclaration(callable) &&
      !Node.isGetAccessorDeclaration(callable))
  ) return [];
  const body = callable.getBody();
  if (!body) return [];
  if (!Node.isBlock(body)) return [body];
  return body.getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) =>
      statement.getFirstAncestor((ancestor) =>
        Node.isFunctionLikeDeclaration(ancestor) ||
        Node.isGetAccessorDeclaration(ancestor)
      ) === callable)
    .flatMap((statement) => {
      const value = statement.getExpression();
      return value ? [value] : [];
    });
}

function sqlCandidates(
  node: Node | undefined,
  seen: ReadonlySet<object> = new Set(),
): SqlCandidate[] {
  if (!node) return [{ text: DYNAMIC_SQL, complete: false }];
  const expression = unwrapExpression(node);
  if (
    Node.isStringLiteral(expression) ||
    Node.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [{ text: expression.getLiteralValue(), complete: true }];
  }
  if (Node.isTemplateExpression(expression)) {
    let values: SqlCandidate[] = [{
      text: expression.getHead().getLiteralText(),
      complete: true,
    }];
    for (const span of expression.getTemplateSpans()) {
      values = combine(values, sqlCandidates(span.getExpression(), seen));
      values = values.map((value) => ({
        ...value,
        text: value.text + span.getLiteral().getLiteralText(),
      }));
    }
    return values;
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (operator === SyntaxKind.PlusToken) {
      return combine(
        sqlCandidates(expression.getLeft(), seen),
        sqlCandidates(expression.getRight(), seen),
      );
    }
    if (operator === SyntaxKind.CommaToken) {
      return sqlCandidates(expression.getRight(), seen);
    }
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...sqlCandidates(expression.getLeft(), seen),
        ...sqlCandidates(expression.getRight(), seen),
      ];
    }
  }
  if (Node.isConditionalExpression(expression)) {
    return [
      ...sqlCandidates(expression.getWhenTrue(), seen),
      ...sqlCandidates(expression.getWhenFalse(), seen),
    ];
  }
  if (Node.isCallExpression(expression)) {
    const declarations = resolvedDeclarations(
      unwrapExpression(expression.getExpression()),
    );
    const values = declarations.flatMap(returnedValues)
      .flatMap((value) => sqlCandidates(value, seen));
    return values.length > 0
      ? values
      : [{ text: DYNAMIC_SQL, complete: false }];
  }
  const type = expression.getType();
  if (
    type.isUnion() &&
    type.getUnionTypes().every((member) => member.isStringLiteral())
  ) {
    return type.getUnionTypes().map((member) => ({
      text: String(member.getLiteralValue()),
      complete: true,
    }));
  }
  if (type.isStringLiteral()) {
    return [{ text: String(type.getLiteralValue()), complete: true }];
  }
  if (Node.isIdentifier(expression)) {
    const symbol = expression.getSymbol()?.getAliasedSymbol() ??
      expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return [{ text: DYNAMIC_SQL, complete: false }];
    const nested = new Set(seen).add(key);
    const sources = resolvedDeclarations(expression).flatMap((declaration) =>
      Node.isVariableDeclaration(declaration) && declaration.getInitializer()
        ? [declaration.getInitializer()!]
        : []);
    const assignments = expression.getSourceFile()
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter((candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < expression.getStart() &&
        Node.isIdentifier(unwrapExpression(candidate.getLeft())) &&
        unwrapExpression(candidate.getLeft()).getSymbol() === symbol)
      .map((candidate) => candidate.getRight());
    const values = [...sources, ...assignments]
      .flatMap((source) => sqlCandidates(source, nested));
    return values.length > 0
      ? values
      : [{ text: DYNAMIC_SQL, complete: false }];
  }
  return [{ text: DYNAMIC_SQL, complete: false }];
}

function enclosingCallableName(node: Node): string | null {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      return ancestor.getName() ?? null;
    }
    if (Node.isMethodDeclaration(ancestor)) return ancestor.getName();
  }
  return null;
}

function isReviewedDynamicSql(call: Node, file: string): boolean {
  const owner = enclosingCallableName(call);
  return owner !== null &&
    (REVIEWED_DYNAMIC_SQL_OWNERS.get(file)?.has(owner) ?? false);
}

function immutableWriteTargets(
  candidate: SqlCandidate,
): Array<ImmutableTable | "dynamic"> {
  if (!candidate.complete) return ["dynamic"];
  const targets: ImmutableTable[] = [];
  let matchedWrite = false;
  for (const pattern of [INSERT_TARGET, MERGE_TARGET, COPY_FROM_TARGET]) {
    for (const match of candidate.text.matchAll(pattern)) {
      matchedWrite = true;
      const token = match[1] ?? "";
      const table = token
        .split(".")
        .at(-1)
        ?.replace(/^["'`]|["'`]$/g, "")
        .toLowerCase() as ImmutableTable | undefined;
      if (table && IMMUTABLE_TABLES.includes(table)) targets.push(table);
    }
  }
  if (targets.length > 0) return [...new Set(targets)];
  if (matchedWrite) return [];
  const unmatchedInsertOrMerge = /\b(?:INSERT|MERGE)\b/i.test(
    candidate.text.replace(
      /\bWHEN\s+NOT\s+MATCHED(?:\s+BY\s+TARGET)?\s+THEN\s+INSERT\b/gi,
      "",
    ),
  );
  const unmatchedCopyFrom = /\bCOPY\s+(?!\s*\()[\s\S]*?\bFROM\b/i.test(
    candidate.text,
  );
  return unmatchedInsertOrMerge || unmatchedCopyFrom ? ["dynamic"] : [];
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
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const normalized = normalizeSqlExecutorCall(call);
      if (!normalized) continue;
      for (const candidate of sqlCandidates(normalized.arguments[0])) {
        for (const table of immutableWriteTargets(candidate)) {
          if (table === "dynamic" && isReviewedDynamicSql(call, rel)) continue;
          if (table !== "dynamic" && INSERT_ALLOWLIST[table] === rel) continue;
          const key = `${rel}:${call.getStartLineNumber()}:${table}`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push({ file: rel, line: call.getStartLineNumber() });
          }
        }
      }
    }
  }
  return violations;
}

function exportedMutationNames(file: SourceFile): string[] {
  return [...file.getExportedDeclarations().keys()]
    .filter((name) =>
      /(update|delete|remove|rewrite|replace).*(ledger|decision|evidence|bundle)/i.test(name) ||
      /(ledger|decision|evidence|bundle).*(update|delete|remove|rewrite|replace)/i.test(name));
}

describe("decision-ledger append-only fence", () => {
  it("anti-fork: each immutable table has one exact raw-insert owner", () => {
    const violations = ledgerInsertViolations(realProject().getSourceFiles());
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

  it("reviewed dynamic migration SQL cannot insert immutable rows", () => {
    const violations = MIGRATIONS.flatMap((migration) => [
      migration.sql,
      ...(migration.preflight ?? []).map((probe) => probe.sql),
    ]).flatMap((sql) => {
      return immutableWriteTargets({ text: sql, complete: true });
    });
    expect(violations).toEqual([]);
    expect(
      MIGRATIONS.flatMap((migration) => migration.preflight ?? [])
        .every((probe) => /^\s*SELECT\b/i.test(probe.sql)),
    ).toBe(true);
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

    it("detects an immutable insert assembled from concatenated fragments", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `export async function evil(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("INSERT " + "INTO decision_" + "ledger (id) VALUES ('x')");\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 2,
      }]);
    });

    it("detects INSERT INTO ONLY against an immutable table", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `export function evil(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("INSERT INTO ONLY decision_ledger (id) VALUES ('x')");\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 2,
      }]);
    });

    it("detects COPY FROM against an immutable table", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `export function evil(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("COPY decision_ledger (id) FROM STDIN");\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 2,
      }]);
    });

    it("detects MERGE against an immutable table", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `export function evil(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("MERGE INTO decision_ledger AS target USING source ON false WHEN NOT MATCHED THEN INSERT (id) VALUES ('x')");\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 2,
      }]);
    });

    it("detects an immutable insert imported from another module", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `import { insertSql } from "./sql";\n` +
          `export function evil(db: { query(sql: string): unknown }) {\n` +
          `  return db.query(insertSql);\n` +
          `}`,
        "/src/infrastructure/sql.ts":
          `export const insertSql: string = "INSERT INTO decision_ledger (id) VALUES ('x')";`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 3,
      }]);
    });

    it("detects an immutable insert returned by a helper", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `function buildInsert() {\n` +
          `  return "INSERT INTO decision_ledger (id) VALUES ('x')";\n` +
          `}\n` +
          `export function evil(db: { query(sql: string): unknown }) {\n` +
          `  return db.query(buildInsert());\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 5,
      }]);
    });

    it("fails closed when executor SQL cannot be resolved", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `export function evil(db: { query(sql: string): unknown }, sql: string) {\n` +
          `  return db.query(sql);\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 2,
      }]);
    });

    it("fails closed when an INSERT uses a dynamic table identifier", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `export async function evil(db: { query(sql: string): unknown }, table: string) {\n` +
          "  return db.query(`INSERT INTO ${table} (id) VALUES ('x')`);\n" +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([{
        file: "src/infrastructure/evil.ts",
        line: 2,
      }]);
    });

    it("detects a planted insert into any immutable source table, not just the chain", () => {
      const project = inMemoryProject(Object.fromEntries(
        IMMUTABLE_TABLES.map((table) => [
          `/src/infrastructure/forked-${table}.ts`,
          `export function fork(db: { query(sql: string): unknown }) {\n` +
          `  return db.query("INSERT INTO ${table} (org_id) VALUES ($1)");\n` +
          `}`,
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
