import { describe, expect, it } from "vitest";
import { join, relative } from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import {
  REPO_ROOT,
  inMemoryProject,
  realProject,
  walk,
} from "./_fence-utils";
import { MIGRATION_SQL } from "@infra/store/migrations";

const IMMUTABLE_TABLES = [
  "evidence_snapshots",
  "decision_input_bundles",
  "decision_input_bundle_evidence",
  "decision_records",
  "decision_replay_source_provenance",
  "decision_ledger",
] as const;
type ImmutableTable = (typeof IMMUTABLE_TABLES)[number];
const INSERT_ALLOWLIST: Record<ImmutableTable, string> = {
  evidence_snapshots: "src/infrastructure/ledger/ledger-sources.ts",
  decision_input_bundles: "src/infrastructure/ledger/ledger-sources.ts",
  decision_input_bundle_evidence:
    "src/infrastructure/ledger/ledger-sources.ts",
  decision_records: "src/infrastructure/ledger/ledger-sources.ts",
  decision_replay_source_provenance:
    "src/infrastructure/ledger/ledger-sources.ts",
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

const RESTRICTED_SOURCE_IMPORTS: Record<string, string> = {
  insertEvidenceSnapshots: "src/infrastructure/ledger/ledger-store.ts",
  insertDecisionSources: "src/infrastructure/ledger/ledger-store.ts",
  bindReplaySourceProvenance: "src/infrastructure/ledger/ledger-store.ts",
  issueValidatedLedgerSourceWrite:
    "src/infrastructure/ledger/ledger-store.ts",
  assertValidatedLedgerSourceWrite:
    "src/infrastructure/ledger/ledger-sources.ts",
};

function staticStringArray(node: Node, seen: Set<Node>): string[] | null {
  if (seen.has(node)) return null;
  seen.add(node);
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node)
  ) {
    return staticStringArray(node.getExpression(), seen);
  }
  if (Node.isArrayLiteralExpression(node)) {
    const values: string[] = [];
    for (const element of node.getElements()) {
      if (Node.isSpreadElement(element)) {
        const spread = staticStringArray(
          element.getExpression(),
          new Set(seen),
        );
        if (spread === null) return null;
        values.push(...spread);
      } else {
        const value = staticString(element, new Set(seen));
        if (value === null) return null;
        values.push(value);
      }
    }
    return values;
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
          ? staticStringArray(initializer, new Set(seen))
          : null;
        return value === null ? [] : [value];
      },
    );
    return values.length > 0 &&
      values.every((value) =>
        value.length === values[0]!.length &&
        value.every((item, index) => item === values[0]![index]))
      ? values[0]!
      : null;
  }
  return null;
}

function callTarget(node: Node): { receiver: Node; name: string } | null {
  if (Node.isPropertyAccessExpression(node)) {
    return { receiver: node.getExpression(), name: node.getName() };
  }
  if (Node.isElementAccessExpression(node)) {
    const argument = node.getArgumentExpression();
    const name = argument ? staticString(argument) : null;
    return name === null
      ? null
      : { receiver: node.getExpression(), name };
  }
  return null;
}

function staticNumber(node: Node, seen = new Set<Node>()): number | null {
  if (seen.has(node)) return null;
  seen.add(node);
  if (Node.isNumericLiteral(node)) return Number(node.getLiteralText());
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node)
  ) {
    return staticNumber(node.getExpression(), seen);
  }
  if (Node.isPrefixUnaryExpression(node)) {
    const value = staticNumber(node.getOperand(), new Set(seen));
    if (value === null) return null;
    if (node.getOperatorToken() === SyntaxKind.MinusToken) return -value;
    if (node.getOperatorToken() === SyntaxKind.PlusToken) return value;
    return null;
  }
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    const resolved = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
    const values = (resolved?.getDeclarations() ?? []).flatMap(
      (declaration) => {
        const initializer = Node.isVariableDeclaration(declaration)
          ? declaration.getInitializer()
          : undefined;
        const value = initializer
          ? staticNumber(initializer, new Set(seen))
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
  if (Node.isCallExpression(node)) {
    const target = callTarget(node.getExpression());
    if (!target) return null;
    if (target.name === "concat") {
      const receiver = staticString(target.receiver, new Set(seen));
      if (receiver === null) return null;
      let value = receiver;
      for (const argument of node.getArguments()) {
        const next = staticString(argument, new Set(seen));
        if (next === null) return null;
        value += next;
      }
      return value;
    }
    if (target.name === "join" && node.getArguments().length <= 1) {
      const values = staticStringArray(target.receiver, new Set(seen));
      if (values === null) return null;
      const argument = node.getArguments()[0];
      const separator = argument === undefined
        ? ","
        : staticString(argument, new Set(seen));
      return separator === null ? null : values.join(separator);
    }
    const receiver = staticString(target.receiver, new Set(seen));
    if (receiver === null) return null;
    if (
      (target.name === "replace" || target.name === "replaceAll") &&
      node.getArguments().length === 2
    ) {
      const search = staticString(node.getArguments()[0]!, new Set(seen));
      const replacement = staticString(
        node.getArguments()[1]!,
        new Set(seen),
      );
      if (search === null || replacement === null) return null;
      return target.name === "replace"
        ? receiver.replace(search, replacement)
        : receiver.replaceAll(search, replacement);
    }
    if (node.getArguments().length === 0) {
      if (target.name === "trim") return receiver.trim();
      if (target.name === "trimStart") return receiver.trimStart();
      if (target.name === "trimEnd") return receiver.trimEnd();
      if (target.name === "toLowerCase") return receiver.toLowerCase();
      if (target.name === "toUpperCase") return receiver.toUpperCase();
    }
    if (
      (target.name === "slice" || target.name === "substring") &&
      node.getArguments().length >= 1 &&
      node.getArguments().length <= 2
    ) {
      const start = staticNumber(node.getArguments()[0]!, new Set(seen));
      const endNode = node.getArguments()[1];
      const end = endNode === undefined
        ? undefined
        : staticNumber(endNode, new Set(seen));
      if (start === null || (endNode !== undefined && end === null)) {
        return null;
      }
      const resolvedEnd = end ?? undefined;
      return target.name === "slice"
        ? receiver.slice(start, resolvedEnd)
        : receiver.substring(start, resolvedEnd);
    }
    if (target.name === "repeat" && node.getArguments().length === 1) {
      const count = staticNumber(node.getArguments()[0]!, new Set(seen));
      return count !== null && Number.isInteger(count) && count >= 0
        ? receiver.repeat(count)
        : null;
    }
    return null;
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

function hasStaticStringRoot(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    Node.isTemplateExpression(node)
  ) {
    return true;
  }
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node)
  ) {
    return hasStaticStringRoot(node.getExpression(), seen);
  }
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().some((element) =>
      hasStaticStringRoot(
        Node.isSpreadElement(element) ? element.getExpression() : element,
        new Set(seen),
      ));
  }
  if (Node.isBinaryExpression(node)) {
    return hasStaticStringRoot(node.getLeft(), new Set(seen)) ||
      hasStaticStringRoot(node.getRight(), new Set(seen));
  }
  if (Node.isCallExpression(node)) {
    const target = callTarget(node.getExpression());
    return (
      hasStaticStringRoot(node.getExpression(), new Set(seen)) ||
      (target !== null &&
        hasStaticStringRoot(target.receiver, new Set(seen))) ||
      node.getArguments().some((argument) =>
        hasStaticStringRoot(argument, new Set(seen)))
    );
  }
  if (
    Node.isIdentifier(node) ||
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node)
  ) {
    const symbol = node.getSymbol();
    const resolved = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
    return (resolved?.getDeclarations() ?? []).some((declaration) => {
      if (
        Node.isFunctionDeclaration(declaration) ||
        Node.isMethodDeclaration(declaration)
      ) {
        const body = declaration.getBody();
        return body !== undefined &&
          body.getDescendantsOfKind(SyntaxKind.ReturnStatement).some(
            (statement) => {
              const expression = statement.getExpression();
              return expression !== undefined &&
                hasStaticStringRoot(expression, new Set(seen));
            },
          );
      }
      const initializer =
        Node.isVariableDeclaration(declaration) ||
          Node.isPropertyAssignment(declaration)
          ? declaration.getInitializer()
          : undefined;
      if (
        initializer &&
        (Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer))
      ) {
        const body = initializer.getBody();
        if (!Node.isBlock(body)) {
          return hasStaticStringRoot(body, new Set(seen));
        }
        return body.getDescendantsOfKind(SyntaxKind.ReturnStatement).some(
          (statement) => {
            const expression = statement.getExpression();
            return expression !== undefined &&
              hasStaticStringRoot(expression, new Set(seen));
          },
        );
      }
      return initializer
        ? hasStaticStringRoot(initializer, new Set(seen))
        : false;
    });
  }
  return false;
}

function symbolOf(node: Node) {
  const symbol = node.getSymbol();
  return symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
}

function assignedValueBefore(
  node: Node,
  before: number,
): Node | null {
  const symbol = symbolOf(node);
  if (!symbol) return null;
  const values: Array<{ position: number; value: Node }> = [];
  for (const declaration of symbol.getDeclarations()) {
    if (Node.isFunctionDeclaration(declaration)) {
      values.push({ position: declaration.getStart(), value: declaration });
      continue;
    }
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer) {
      values.push({ position: declaration.getStart(), value: initializer });
    }
  }
  const source = node.getSourceFile();
  for (const assignment of source.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    if (
      assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken ||
      assignment.getStart() >= before ||
      symbolOf(assignment.getLeft()) !== symbol
    ) {
      continue;
    }
    values.push({
      position: assignment.getStart(),
      value: assignment.getRight(),
    });
  }
  return values
    .filter(({ position }) => position < before)
    .sort((left, right) => right.position - left.position)[0]?.value ?? null;
}

function sqlCallableParameter(
  node: Node,
  before: number,
  seen = new Set<Node>(),
): number | null {
  if (seen.has(node)) return null;
  seen.add(node);
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node)
  ) {
    return sqlCallableParameter(node.getExpression(), before, seen);
  }
  const target = callTarget(node);
  if (target?.name === "query" || target?.name === "exec") return 0;
  if (Node.isCallExpression(node)) {
    const bind = callTarget(node.getExpression());
    return bind?.name === "bind"
      ? sqlCallableParameter(bind.receiver, before, seen)
      : null;
  }
  if (Node.isIdentifier(node)) {
    const value = assignedValueBefore(node, before);
    return value ? sqlCallableParameter(value, before, seen) : null;
  }
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node)
  ) {
    const parameters = node.getParameters();
    const body = node.getBody();
    if (!body) return null;
    const calls = [
      ...(Node.isCallExpression(body) ? [body] : []),
      ...body.getDescendantsOfKind(SyntaxKind.CallExpression),
    ];
    for (const call of calls) {
      const argument = sqlTextArgument(call, new Set(seen));
      if (!argument || !Node.isIdentifier(argument)) continue;
      const parameter = parameters.findIndex(
        (candidate) => symbolOf(candidate.getNameNode()) === symbolOf(argument),
      );
      if (parameter >= 0) return parameter;
    }
  }
  return null;
}

function sqlTextArgument(
  call: Node,
  seen = new Set<Node>(),
): Node | null {
  if (!Node.isCallExpression(call)) return null;
  const parameter = sqlCallableParameter(
    call.getExpression(),
    call.getStart(),
    seen,
  );
  return parameter === null ? null : call.getArguments()[parameter] ?? null;
}

function hasSqlCallableRoot(
  node: Node,
  before: number,
  seen = new Set<Node>(),
): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node)
  ) {
    return hasSqlCallableRoot(node.getExpression(), before, seen);
  }
  const target = callTarget(node);
  if (target?.name === "query" || target?.name === "exec") return true;
  if (Node.isCallExpression(node)) {
    return hasSqlCallableRoot(node.getExpression(), before, new Set(seen)) ||
      node.getArguments().some((argument) =>
        hasSqlCallableRoot(argument, before, new Set(seen)));
  }
  if (Node.isIdentifier(node)) {
    const value = assignedValueBefore(node, before);
    return value
      ? hasSqlCallableRoot(value, before, new Set(seen))
      : false;
  }
  if (
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node)
  ) {
    return hasSqlCallableRoot(node.getExpression(), before, new Set(seen));
  }
  if (Node.isConditionalExpression(node)) {
    return hasSqlCallableRoot(node.getWhenTrue(), before, new Set(seen)) ||
      hasSqlCallableRoot(node.getWhenFalse(), before, new Set(seen));
  }
  return false;
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
      const expression = sqlTextArgument(call);
      if (expression === null) {
        const rooted = call.getArguments().find((argument) =>
          hasStaticStringRoot(argument));
        if (
          rooted &&
          hasSqlCallableRoot(
            call.getExpression(),
            call.getStart(),
          )
        ) {
          const key = `${rel}:${rooted.getStartLineNumber()}:sql-alias`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push({
              file: rel,
              line: rooted.getStartLineNumber(),
            });
          }
        }
        continue;
      }
      const value = staticString(expression);
      if (value === null) {
        if (hasStaticStringRoot(expression)) {
          const key = `${rel}:${expression.getStartLineNumber()}:unresolved`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push({
              file: rel,
              line: expression.getStartLineNumber(),
            });
          }
        }
        continue;
      }
      for (const match of value.matchAll(RAW_INSERT)) {
        const table = match[1]?.toLowerCase() as ImmutableTable | undefined;
        const key = `${rel}:${table}`;
        if (table && INSERT_ALLOWLIST[table] !== rel && !seen.has(key)) {
          seen.add(key);
          violations.push({
            file: rel,
            line: expression.getStartLineNumber(),
          });
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

function sourceWriteBoundaryViolations(
  files: readonly SourceFile[],
): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const absolute = file.getFilePath().replace(/\\/g, "/");
    const sourceIndex = absolute.lastIndexOf("/src/");
    const rel = sourceIndex >= 0
      ? absolute.slice(sourceIndex + 1)
      : relative(REPO_ROOT, absolute).replace(/\\/g, "/");
    for (const declaration of file.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      const restrictedModule =
        /(?:^|\/)ledger-sources$/.test(specifier) ||
        /(?:^|\/)ledger-source-capability$/.test(specifier);
      if (
        restrictedModule &&
        declaration.getNamespaceImport()
      ) {
        violations.push({
          file: rel,
          line: declaration.getStartLineNumber(),
        });
      }
      for (const imported of declaration.getNamedImports()) {
        const name = imported.getName();
        const owner = RESTRICTED_SOURCE_IMPORTS[name];
        if (owner && owner !== rel) {
          violations.push({
            file: rel,
            line: imported.getStartLineNumber(),
          });
        }
      }
    }
    for (const declaration of file.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (
        specifier &&
        (
          /(?:^|\/)ledger-sources$/.test(specifier) ||
          /(?:^|\/)ledger-source-capability$/.test(specifier)
        )
      ) {
        violations.push({
          file: rel,
          line: declaration.getStartLineNumber(),
        });
      }
    }
    for (const declaration of file.getDescendantsOfKind(
      SyntaxKind.ImportEqualsDeclaration,
    )) {
      const moduleReference = declaration.getModuleReference();
      if (!Node.isExternalModuleReference(moduleReference)) continue;
      const expression = moduleReference.getExpression();
      const value =
        Node.isStringLiteral(expression) ||
          Node.isNoSubstitutionTemplateLiteral(expression)
          ? expression.getLiteralText()
          : null;
      if (
        value &&
        (
          /(?:^|\/)ledger-sources$/.test(value) ||
          /(?:^|\/)ledger-source-capability$/.test(value)
        )
      ) {
        violations.push({
          file: rel,
          line: declaration.getStartLineNumber(),
        });
      }
    }
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const moduleLoader =
        expression.getKind() === SyntaxKind.ImportKeyword ||
        (Node.isIdentifier(expression) && expression.getText() === "require");
      if (!moduleLoader) continue;
      const specifier = call.getArguments()[0];
      const value = specifier ? staticString(specifier) : null;
      if (
        value &&
        (
          /(?:^|\/)ledger-sources$/.test(value) ||
          /(?:^|\/)ledger-source-capability$/.test(value)
        )
      ) {
        violations.push({
          file: rel,
          line: call.getStartLineNumber(),
        });
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
    const violations = ledgerInsertViolations(ledgerFenceFiles());
    expect(
      violations,
      `raw decision-ledger inserts bypass the repository:\n${violations.map(
        (item) => `${item.file}:${item.line}`,
      ).join("\n")}`,
    ).toEqual([]);
  });

  it("immutable source writers require the validated ledger-store capability", () => {
    expect(sourceWriteBoundaryViolations(ledgerFenceFiles())).toEqual([]);
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
        if (!MIGRATION_SQL.includes(`${table}_no_${verb}`)) {
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

    it("detects deterministic join and concat composition", () => {
      const project = inMemoryProject({
        "/scripts/join.ts":
          `const parts = ["INSERT", " INTO ", "decision_ledger"];\n` +
          `const method = "join";\n` +
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query(parts[method](""));`,
        "/scripts/concat.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("INSERT INTO ".concat("decision_records"));`,
      });
      const planted = ledgerInsertViolations(project.getSourceFiles());
      expect(planted).toHaveLength(2);
      expect(planted.some(({ file }) => file.endsWith("scripts/concat.ts")))
        .toBe(true);
      expect(planted.some(({ file }) => file.endsWith("scripts/join.ts")))
        .toBe(true);
    });

    it("detects replace and chained literal transformations", () => {
      const project = inMemoryProject({
        "/scripts/replace.ts":
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query(" insert inx decision_ledger ".trim()` +
          `.replace("inx", "into").toUpperCase());`,
        "/scripts/slice.ts":
          `const source = "__INSERT INTO decision_records__";\n` +
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec(source.slice(2, -2));`,
      });
      const planted = ledgerInsertViolations(project.getSourceFiles());
      expect(planted).toHaveLength(2);
    });

    it("fails closed when rooted SQL cannot be resolved", () => {
      const project = inMemoryProject({
        "/scripts/unresolved.ts":
          `declare function transform(value: string): string;\n` +
          `const prefix = "INSERT INTO ";\n` +
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query(transform(prefix) + "decision_ledger");`,
        "/scripts/helper.ts":
          `function sql() { return "INSERT INTO decision_ledger"; }\n` +
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query(sql());`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(2);
    });

    it("detects bound query aliases, wrappers, and the latest reassignment", () => {
      const project = inMemoryProject({
        "/scripts/bound.ts":
          `export const run = (db: { query(s: string): unknown }) => {\n` +
          `  const execute = db.query.bind(db);\n` +
          `  return execute("INSERT INTO decision_ledger (id) VALUES ('x')");\n` +
          `};`,
        "/scripts/wrapper.ts":
          `export const run = (db: { exec(s: string): unknown }) => {\n` +
          `  const execute = (sql: string) => db.exec(sql);\n` +
          `  return execute("INSERT INTO decision_records (id) VALUES ('x')");\n` +
          `};`,
        "/scripts/reassigned.ts":
          `export const run = (db: { query(s: string): unknown }) => {\n` +
          `  let execute = (value: string) => value;\n` +
          `  execute = db.query.bind(db);\n` +
          `  return execute("INSERT INTO evidence_snapshots (id) VALUES ('x')");\n` +
          `};`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(3);
    });

    it("fails closed on an unresolved SQL-bearing alias", () => {
      const project = inMemoryProject({
        "/scripts/unresolved-alias.ts":
          `declare function wrap<T>(value: T): T;\n` +
          `export const run = (db: { query(s: string): unknown }) => {\n` +
          `  const execute = wrap(db.query.bind(db));\n` +
          `  return execute("INSERT INTO decision_ledger (id) VALUES ('x')");\n` +
          `};`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(1);
    });

    it("does not interpret dynamic bound values as SQL text", () => {
      const project = inMemoryProject({
        "/scripts/parameters.ts":
          `export const run = (` +
          `db: { query(s: string, p: unknown[]): unknown }, value: string) => ` +
          `db.query("SELECT $1::text", [value, "INSERT INTO decision_ledger"]);`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toEqual([]);
    });

    it("detects a planted insert into any immutable source table, not just the chain", () => {
      const project = inMemoryProject(Object.fromEntries(
        IMMUTABLE_TABLES.map((table) => [
          `/src/infrastructure/forked-${table}.ts`,
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query("INSERT INTO ${table} (org_id) VALUES ($1)");`,
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

    it("rejects immutable source writer and capability imports outside their owners", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `import { insertEvidenceSnapshots } from "./ledger/ledger-sources";\n` +
          `import { issueValidatedLedgerSourceWrite } from "./ledger/ledger-source-capability";`,
        "/src/infrastructure/namespace.ts":
          `import * as sources from "./ledger/ledger-sources";\n` +
          `void sources;`,
        "/src/infrastructure/dynamic.ts":
          `export const load = () => import("./ledger/ledger-source-capability");`,
        "/src/infrastructure/require.ts":
          `export const load = () => require("./ledger/ledger-sources");`,
        "/src/infrastructure/import-equals.ts":
          `import sources = require("./ledger/ledger-sources");\n` +
          `void sources;`,
        "/src/infrastructure/reexport.ts":
          `export * from "./ledger/ledger-sources";`,
      });
      expect(
        sourceWriteBoundaryViolations(project.getSourceFiles()),
      ).toHaveLength(7);
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
