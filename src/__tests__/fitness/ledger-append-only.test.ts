import { describe, expect, it } from "vitest";
import { relative } from "node:path";
import { SyntaxKind, type SourceFile } from "ts-morph";
import {
  REPO_ROOT,
  inMemoryProject,
  realProject,
} from "./_fence-utils";
import { DECISION_LEDGER_SQL } from "@infra/store/decision-ledger-migration";

const APPEND_PATHS = new Set([
  "src/infrastructure/ledger/ledger-store.ts",
  "src/infrastructure/ledger/ledger-sources.ts",
  "src/infrastructure/store/decision-ledger-migration.ts",
]);
const IMMUTABLE_TABLES = [
  "evidence_snapshots",
  "decision_input_bundles",
  "decision_input_bundle_evidence",
  "decision_records",
  "decision_ledger",
] as const;
const RAW_INSERT = new RegExp(
  `\\bINSERT\\s+INTO\\s+(${IMMUTABLE_TABLES.join("|")})\\b`,
  "i",
);

interface Violation {
  readonly file: string;
  readonly line: number;
}

function ledgerInsertViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file.getFilePath()).replace(/\\/g, "/");
    if (APPEND_PATHS.has(rel)) continue;
    for (const literal of [
      ...file.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...file.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
      ...file.getDescendantsOfKind(SyntaxKind.TemplateExpression),
    ]) {
      if (RAW_INSERT.test(literal.getText())) {
        violations.push({ file: rel, line: literal.getStartLineNumber() });
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
  it("anti-fork: only the ledger repository and migration contain raw immutable-source INSERTs", () => {
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
