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
const INSERT_TARGET = /\bINSERT\s+INTO\s+([^\s(;,]+)/gi;

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
  const type = expression.getType();
  if (type.isStringLiteral()) {
    return [{ text: String(type.getLiteralValue()), complete: true }];
  }
  if (Node.isIdentifier(expression)) {
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return [{ text: DYNAMIC_SQL, complete: false }];
    const nested = new Set(seen).add(key);
    const sources = (symbol?.getDeclarations() ?? []).flatMap((declaration) =>
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

function insertedTable(candidate: SqlCandidate): ImmutableTable | "dynamic" | null {
  for (const match of candidate.text.matchAll(INSERT_TARGET)) {
    const token = match[1] ?? "";
    if (!candidate.complete && token.includes(DYNAMIC_SQL)) return "dynamic";
    const table = token
      .split(".")
      .at(-1)
      ?.replace(/^["'`]|["'`]$/g, "")
      .toLowerCase() as ImmutableTable | undefined;
    if (table && IMMUTABLE_TABLES.includes(table)) return table;
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
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const normalized = normalizeSqlExecutorCall(call);
      if (!normalized) continue;
      for (const candidate of sqlCandidates(normalized.arguments[0])) {
        const table = insertedTable(candidate);
        if (!table || (table !== "dynamic" && INSERT_ALLOWLIST[table] === rel)) {
          continue;
        }
        const key = `${rel}:${call.getStartLineNumber()}:${table}`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({ file: rel, line: call.getStartLineNumber() });
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
