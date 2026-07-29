import { describe, expect, it } from "vitest";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import {
  REPO_ROOT,
  inMemoryProject,
  moduleReferences,
  realProject,
  walk,
} from "./_fence-utils";
import { MIGRATION_SQL } from "@infra/store/migrations";
import {
  DECISION_LEDGER_BUNDLE_IDENTITY_SQL,
} from "@infra/store/decision-ledger-migration";

const IMMUTABLE_TABLES = [
  "evidence_snapshots",
  "decision_input_bundles",
  "decision_input_bundle_evidence",
  "decision_records",
  "decision_replay_source_provenance",
  "decision_ledger",
] as const;
type ImmutableTable = (typeof IMMUTABLE_TABLES)[number];
type ImmutableMutationKind =
  | "insert"
  | "merge"
  | "copy"
  | "update"
  | "delete"
  | "truncate"
  | "trigger";
type ImmutableWriteTarget =
  | `${ImmutableMutationKind}:${ImmutableTable}`
  | "unresolved";
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
const IMMUTABLE_TABLE_SET = new Set<string>(IMMUTABLE_TABLES);
const REVIEWED_IMMUTABLE_MIGRATIONS = [
  {
    version: 3,
    name: "decision-ledger-foundation",
    sha256: "b63ee91ed6c81fa9f48bb67cee37311e698a6c53b3234488e2c94160c46128bd",
  },
  {
    version: 6,
    name: "decision-replay-source-provenance",
    sha256: "90eede11f7c297c033e465a196d72dc22f8d94cfe49c78364b2e46542e1a5aac",
  },
  {
    version: 8,
    name: "decision-ledger-bundle-identity",
    sha256: "a9968958afe5c2147897c964dea3d7a742744bd04a49e26a3144ad3eef98e2d9",
  },
] as const;
const REVIEWED_UNRESOLVED_SQL_ESCAPE = Object.freeze({
  file: "src/infrastructure/store/migrations.ts",
  functionName: "runMigrations",
  loopVariable: "m",
  collection: "MIGRATIONS",
  sink: "tx.exec",
  argument: "m.sql",
});
const REVIEWED_SQL_FORWARDING_ESCAPE = Object.freeze({
  file: "src/infrastructure/store/db.ts",
  methods: new Set(["query", "exec"]),
  sinks: new Set(["pg.query", "pg.exec", "tx.query", "tx.exec"]),
  argument: "sql",
});

interface SqlToken {
  readonly kind: "identifier" | "dot" | "string" | "body" | "other";
  readonly value?: string;
}

function immutableWriteTarget(
  kind: ImmutableMutationKind,
  table: ImmutableTable,
): ImmutableWriteTarget {
  return `${kind}:${table}`;
}

function immutableWriteTargetParts(target: Exclude<ImmutableWriteTarget, "unresolved">): {
  readonly kind: ImmutableMutationKind;
  readonly table: ImmutableTable;
} {
  const separator = target.indexOf(":");
  return {
    kind: target.slice(0, separator) as ImmutableMutationKind,
    table: target.slice(separator + 1) as ImmutableTable,
  };
}

function immutableMutationRoot(value: string): boolean {
  return /\b(?:insert\s+into|merge\s+into|copy|update|delete\s+from|truncate|alter\s+table|drop\s+trigger|session_replication_role)\b/i
    .test(value);
}

function sqlTokens(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (sql.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (char === "'") {
      let value = "";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "\\") {
          value += sql[index + 1] ?? "";
          index += 2;
        } else if (sql[index] === "'" && sql[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          break;
        } else {
          value += sql[index]!;
          index += 1;
        }
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (char === "$") {
      const tag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        const value = end < 0
          ? sql.slice(index + tag.length)
          : sql.slice(index + tag.length, end);
        index = end < 0 ? sql.length : end + tag.length;
        tokens.push({ kind: "body", value });
        continue;
      }
    }
    if (char === "\"") {
      let value = "";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "\"" && sql[index + 1] === "\"") {
          value += "\"";
          index += 2;
        } else if (sql[index] === "\"") {
          index += 1;
          break;
        } else {
          value += sql[index]!;
          index += 1;
        }
      }
      tokens.push({ kind: "identifier", value });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (
        index < sql.length &&
        /[A-Za-z0-9_$]/.test(sql[index]!)
      ) {
        index += 1;
      }
      tokens.push({
        kind: "identifier",
        value: sql.slice(start, index).toLowerCase(),
      });
      continue;
    }
    tokens.push({
      kind: char === "." ? "dot" : "other",
      value: char,
    });
    index += 1;
  }
  return tokens;
}

function immutableTargetAt(
  tokens: readonly SqlToken[],
  start: number,
): ImmutableTable | null {
  let targetIndex = start;
  if (
    tokens[targetIndex]?.kind === "identifier" &&
    tokens[targetIndex]?.value === "if" &&
    tokens[targetIndex + 1]?.kind === "identifier" &&
    tokens[targetIndex + 1]?.value === "exists"
  ) {
    targetIndex += 2;
  }
  if (
    tokens[targetIndex]?.kind === "identifier" &&
    tokens[targetIndex]?.value === "only"
  ) {
    targetIndex += 1;
  }
  const firstTarget = tokens[targetIndex];
  if (firstTarget?.kind !== "identifier") return null;
  let targetValue = firstTarget.value;
  while (
    tokens[targetIndex + 1]?.kind === "dot" &&
    tokens[targetIndex + 2]?.kind === "identifier"
  ) {
    targetIndex += 2;
    targetValue = tokens[targetIndex]!.value;
  }
  return targetValue && IMMUTABLE_TABLE_SET.has(targetValue)
    ? targetValue as ImmutableTable
    : null;
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "'" && quote && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (char === "'") {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (
      depth === 0 &&
      value.slice(index, index + separator.length) === separator
    ) {
      parts.push(value.slice(start, index).trim());
      start = index + separator.length;
      index += separator.length - 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function plpgsqlLiteral(value: string): string | null {
  const trimmed = value.trim();
  if (!/^'(?:''|[^'])*'$/.test(trimmed)) return null;
  return trimmed.slice(1, -1).replace(/''/g, "'");
}

function formatPlpgsql(
  format: string,
  values: readonly string[],
): string | null {
  let index = 0;
  let output = "";
  for (let cursor = 0; cursor < format.length; cursor += 1) {
    const char = format[cursor]!;
    if (char !== "%") {
      output += char;
      continue;
    }
    const kind = format[++cursor];
    if (kind === "%") {
      output += "%";
      continue;
    }
    const value = values[index++];
    if (value === undefined || !kind || !["I", "L", "s"].includes(kind)) {
      return null;
    }
    output += kind === "I"
      ? `"${value.replace(/"/g, "\"\"")}"`
      : kind === "L"
        ? `'${value.replace(/'/g, "''")}'`
        : value;
  }
  return index === values.length ? output : null;
}

function evaluatePlpgsqlExpression(
  expression: string,
  variables: ReadonlyMap<string, string>,
): string | null {
  const trimmed = expression.trim().replace(/;\s*$/, "");
  const concatenated = splitTopLevel(trimmed, "||");
  if (concatenated.length > 1) {
    const values = concatenated.map((part) =>
      evaluatePlpgsqlExpression(part, variables));
    return values.some((value) => value === null)
      ? null
      : values.join("");
  }
  const literal = plpgsqlLiteral(trimmed);
  if (literal !== null) return literal;
  if (/^[a-z_][a-z0-9_$]*$/i.test(trimmed)) {
    return variables.get(trimmed.toLowerCase()) ?? null;
  }
  const call = trimmed.match(/^([a-z_][a-z0-9_$]*)\s*\(([\s\S]*)\)$/i);
  if (!call) return null;
  const name = call[1]!.toLowerCase();
  const argumentsList = splitTopLevel(call[2]!, ",");
  const values = argumentsList.map((part) =>
    evaluatePlpgsqlExpression(part, variables));
  if (values.some((value) => value === null)) return null;
  const resolved = values as string[];
  if (name === "format" && resolved.length > 0) {
    return formatPlpgsql(resolved[0]!, resolved.slice(1));
  }
  if (name === "quote_ident" && resolved.length === 1) {
    return `"${resolved[0]!.replace(/"/g, "\"\"")}"`;
  }
  if (name === "quote_literal" && resolved.length === 1) {
    return `'${resolved[0]!.replace(/'/g, "''")}'`;
  }
  return null;
}

function proceduralWriteTargets(
  body: string,
  seen: Set<string>,
): ImmutableWriteTarget[] {
  const targets = new Set<ImmutableWriteTarget>();
  const variables = new Map<string, string>();
  const unresolvedWrites = new Set<string>();
  for (const part of splitTopLevel(body, ";")) {
    const statement = part.replace(/^\s*(?:declare|begin)\b/i, "").trim();
    const assignment = statement.match(
      /^([a-z_][a-z0-9_$]*)(?:\s+[a-z_][a-z0-9_$]*(?:\s*\([^)]*\))?)?\s*:=\s*([\s\S]+)$/i,
    );
    if (assignment) {
      const value = evaluatePlpgsqlExpression(assignment[2]!, variables);
      const name = assignment[1]!.toLowerCase();
      if (value !== null) {
        variables.set(name, value);
        unresolvedWrites.delete(name);
      } else if (immutableMutationRoot(assignment[2]!)) {
        unresolvedWrites.add(name);
      }
      continue;
    }
    const execute = statement.match(/^execute\s+([\s\S]+)$/i);
    if (!execute) continue;
    const expression = execute[1]!.replace(/\s+using\b[\s\S]*$/i, "");
    const value = evaluatePlpgsqlExpression(expression, variables);
    if (value !== null) {
      immutableWriteTargets(value, seen).forEach((target) =>
        targets.add(target));
    } else if (
      immutableMutationRoot(expression) ||
      [...unresolvedWrites].some((name) =>
        new RegExp(`\\b${name}\\b`, "i").test(expression))
    ) {
      targets.add("unresolved");
    }
  }
  return [...targets];
}

function immutableWriteTargets(
  sql: string,
  seen = new Set<string>(),
): ImmutableWriteTarget[] {
  if (seen.has(sql)) return [];
  seen.add(sql);
  const tokens = sqlTokens(sql);
  const targets = new Set<ImmutableWriteTarget>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind === "body" && token.value !== undefined) {
      immutableWriteTargets(token.value, seen).forEach((target) =>
        targets.add(target));
      proceduralWriteTargets(token.value, seen).forEach((target) =>
        targets.add(target));
    }
    if (
      token?.kind === "identifier" &&
      token.value === "set_config"
    ) {
      const callEnd = tokens.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          candidate.kind === "other" &&
          candidate.value === ")",
      );
      const call = tokens.slice(
        index,
        callEnd < 0 ? tokens.length : callEnd,
      );
      if (
        call.some((candidate) =>
          candidate.kind === "string" &&
          candidate.value?.toLowerCase() === "session_replication_role")
      ) {
        targets.add("unresolved");
      }
    }
    let targetIndex: number | null = null;
    let mutationKind: ImmutableMutationKind | null = null;
    if (
      token?.kind === "identifier" &&
      (token.value === "insert" || token.value === "merge") &&
      tokens[index + 1]?.kind === "identifier" &&
      tokens[index + 1]?.value === "into"
    ) {
      targetIndex = index + 2;
      mutationKind = token.value;
    } else if (
      token?.kind === "identifier" &&
      token.value === "copy"
    ) {
      mutationKind = "copy";
      targetIndex = tokens[index + 1]?.value === "binary"
        ? index + 2
        : index + 1;
      let writesRows = false;
      for (let part = targetIndex + 1; part < tokens.length; part += 1) {
        const candidate = tokens[part]!;
        if (candidate.kind === "other" && candidate.value === ";") break;
        if (candidate.kind === "identifier" && candidate.value === "from") {
          writesRows = true;
          break;
        }
      }
      if (!writesRows) targetIndex = null;
    } else if (
      token?.kind === "identifier" &&
      token.value === "update"
    ) {
      targetIndex = index + 1;
      mutationKind = "update";
    } else if (
      token?.kind === "identifier" &&
      token.value === "delete" &&
      tokens[index + 1]?.kind === "identifier" &&
      tokens[index + 1]?.value === "from"
    ) {
      targetIndex = index + 2;
      mutationKind = "delete";
    } else if (
      token?.kind === "identifier" &&
      token.value === "truncate" &&
      tokens[index - 1]?.value !== "before"
    ) {
      for (let part = index + 1; part < tokens.length; part += 1) {
        const candidate = tokens[part]!;
        if (candidate.kind === "other" && candidate.value === ";") break;
        if (
          candidate.kind === "identifier" &&
          candidate.value &&
          IMMUTABLE_TABLE_SET.has(candidate.value)
        ) {
          targets.add(immutableWriteTarget(
            "truncate",
            candidate.value as ImmutableTable,
          ));
        }
        if (
          candidate.kind === "identifier" &&
          ["cascade", "continue", "identity", "restart", "restrict"].includes(
            candidate.value ?? "",
          )
        ) {
          break;
        }
      }
    } else if (
      token?.kind === "identifier" &&
      token.value === "alter" &&
      tokens[index + 1]?.kind === "identifier" &&
      tokens[index + 1]?.value === "table"
    ) {
      const table = immutableTargetAt(tokens, index + 2);
      if (table) {
        for (let part = index + 3; part < tokens.length; part += 1) {
          const candidate = tokens[part]!;
          if (candidate.kind === "other" && candidate.value === ";") break;
          if (
            candidate.kind === "identifier" &&
            candidate.value === "disable" &&
            tokens[part + 1]?.kind === "identifier" &&
            tokens[part + 1]?.value === "trigger"
          ) {
            targets.add(immutableWriteTarget("trigger", table));
            break;
          }
        }
      }
    } else if (
      token?.kind === "identifier" &&
      token.value === "drop" &&
      tokens[index + 1]?.kind === "identifier" &&
      tokens[index + 1]?.value === "trigger"
    ) {
      for (let part = index + 2; part < tokens.length; part += 1) {
        const candidate = tokens[part]!;
        if (candidate.kind === "other" && candidate.value === ";") break;
        if (
          candidate.kind === "identifier" &&
          candidate.value === "on"
        ) {
          const table = immutableTargetAt(tokens, part + 1);
          if (table) targets.add(immutableWriteTarget("trigger", table));
          break;
        }
      }
    } else if (
      token?.kind === "identifier" &&
      token.value === "set"
    ) {
      const statementEnd = tokens.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          candidate.kind === "other" &&
          candidate.value === ";",
      );
      const statement = tokens.slice(
        index,
        statementEnd < 0 ? tokens.length : statementEnd,
      );
      if (
        statement.some((candidate) =>
          candidate.kind === "identifier" &&
          candidate.value === "session_replication_role") &&
        statement.some((candidate) =>
          (candidate.kind === "identifier" || candidate.kind === "string") &&
          candidate.value?.toLowerCase() === "replica")
      ) {
        targets.add("unresolved");
      }
    } else if (
      token?.kind === "identifier" &&
      token.value === "execute"
    ) {
      let composed = "";
      for (let nested = index + 1; nested < tokens.length; nested += 1) {
        const candidate = tokens[nested]!;
        if (candidate.kind === "other" && candidate.value === ";") break;
        if (
          (candidate.kind === "string" || candidate.kind === "body") &&
          candidate.value !== undefined
        ) {
          composed += candidate.value;
          immutableWriteTargets(candidate.value, seen).forEach((target) =>
            targets.add(target));
        }
      }
      immutableWriteTargets(composed, seen).forEach((target) =>
        targets.add(target));
    }
    if (targetIndex === null) continue;
    const target = immutableTargetAt(tokens, targetIndex);
    if (target && mutationKind) {
      targets.add(immutableWriteTarget(mutationKind, target));
    }
  }
  return [...targets];
}

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

function restrictedSourceModule(
  specifier: string,
  resolved?: SourceFile,
): boolean {
  const resolvedPath = resolved?.getFilePath().replace(/\\/g, "/") ?? "";
  const normalized = specifier
    .split(/[?#]/, 1)[0]!
    .replace(/\.(?:[cm]?[jt]sx?)$/i, "");
  return /\/ledger-(?:sources|source-capability)\.(?:[cm]?[jt]sx?)$/i.test(
    resolvedPath,
  ) ||
    /(?:^|\/)ledger-(?:sources|source-capability)$/.test(normalized);
}

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

function staticArrayNodes(
  node: Node,
  seen = new Set<Node>(),
): Node[] | null {
  if (seen.has(node)) return null;
  seen.add(node);
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isSatisfiesExpression(node) ||
    Node.isNonNullExpression(node) ||
    Node.isTypeAssertion(node)
  ) {
    return staticArrayNodes(node.getExpression(), seen);
  }
  if (Node.isArrayLiteralExpression(node)) {
    const values: Node[] = [];
    for (const element of node.getElements()) {
      if (Node.isSpreadElement(element)) {
        const spread = staticArrayNodes(
          element.getExpression(),
          new Set(seen),
        );
        if (spread === null) return null;
        values.push(...spread);
      } else {
        values.push(element);
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
          ? staticArrayNodes(initializer, new Set(seen))
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
  if (Node.isSpreadElement(node)) {
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

const binaryAssignments = new WeakMap<SourceFile, readonly Node[]>();

function assignmentsIn(file: SourceFile): readonly Node[] {
  const cached = binaryAssignments.get(file);
  if (cached) return cached;
  const assignments = file.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  );
  binaryAssignments.set(file, assignments);
  return assignments;
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
    if (Node.isMethodDeclaration(declaration)) {
      values.push({ position: declaration.getStart(), value: declaration });
      continue;
    }
    if (Node.isPropertyAssignment(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer) {
        values.push({
          position: declaration.getStart(),
          value: initializer,
        });
      }
      continue;
    }
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer) {
      values.push({ position: declaration.getStart(), value: initializer });
    }
  }
  const source = node.getSourceFile();
  for (const assignment of assignmentsIn(source)) {
    if (!Node.isBinaryExpression(assignment)) continue;
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

function destructuredSqlCallableParameter(
  node: Node,
  before: number,
  seen: Set<Node>,
): number | null {
  const symbol = symbolOf(node);
  if (!symbol) return null;
  for (const declaration of symbol.getDeclarations()) {
    if (!Node.isBindingElement(declaration)) continue;
    const propertyNode =
      declaration.getPropertyNameNode() ?? declaration.getNameNode();
    const propertyName =
      Node.isIdentifier(propertyNode)
        ? propertyNode.getText()
        : Node.isStringLiteral(propertyNode) ||
            Node.isNoSubstitutionTemplateLiteral(propertyNode)
          ? propertyNode.getLiteralText()
          : staticString(propertyNode);
    if (propertyName === "query" || propertyName === "exec") return 0;
    const variable = declaration.getFirstAncestorByKind(
      SyntaxKind.VariableDeclaration,
    );
    const initializer = variable?.getInitializer();
    if (!initializer || propertyName === null) continue;
    const source = Node.isIdentifier(initializer)
      ? assignedValueBefore(initializer, before)
      : initializer;
    if (!source || !Node.isObjectLiteralExpression(source)) continue;
    for (const property of source.getProperties()) {
      if (
        (
          Node.isPropertyAssignment(property) ||
          Node.isMethodDeclaration(property)
        ) &&
        property.getName() === propertyName
      ) {
        const parameter = sqlCallableParameter(
          Node.isPropertyAssignment(property)
            ? property.getInitializerOrThrow()
            : property,
          before,
          new Set(seen),
        );
        if (parameter !== null) return parameter;
      }
    }
  }
  return null;
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
    const destructured = destructuredSqlCallableParameter(
      node,
      before,
      seen,
    );
    if (destructured !== null) return destructured;
    const value = assignedValueBefore(node, before);
    return value ? sqlCallableParameter(value, before, seen) : null;
  }
  if (
    Node.isPropertyAccessExpression(node) ||
    Node.isElementAccessExpression(node)
  ) {
    const target = callTarget(node);
    const receiver = target?.receiver;
    const source = receiver && Node.isIdentifier(receiver)
      ? assignedValueBefore(receiver, before)
      : receiver;
    if (target && source && Node.isObjectLiteralExpression(source)) {
      for (const property of source.getProperties()) {
        if (
          (
            Node.isPropertyAssignment(property) ||
            Node.isMethodDeclaration(property)
          ) &&
          property.getName() === target.name
        ) {
          const parameter = sqlCallableParameter(
            Node.isPropertyAssignment(property)
              ? property.getInitializerOrThrow()
              : property,
            before,
            new Set(seen),
          );
          if (parameter !== null) return parameter;
        }
      }
    }
    const value = assignedValueBefore(node, before);
    return value ? sqlCallableParameter(value, before, seen) : null;
  }
  if (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node)
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
      if (!argument) continue;
      const forwarded = Node.isSpreadElement(argument)
        ? argument.getExpression()
        : argument;
      if (!Node.isIdentifier(forwarded)) continue;
      const parameter = parameters.findIndex(
        (candidate) =>
          symbolOf(candidate.getNameNode()) === symbolOf(forwarded),
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
  if (parameter === null) return null;
  let position = 0;
  for (const argument of call.getArguments()) {
    if (Node.isSpreadElement(argument)) {
      const spread = staticArrayNodes(argument.getExpression());
      if (spread === null) {
        return position === parameter ? argument : null;
      }
      if (parameter < position + spread.length) {
        return spread[parameter - position] ?? null;
      }
      position += spread.length;
    } else {
      if (position === parameter) return argument;
      position += 1;
    }
  }
  return null;
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
  if (Node.isElementAccessExpression(node) && callTarget(node) === null) {
    const receiverType = node.getExpression().getType();
    if (
      receiverType.isAny() ||
      receiverType.isUnknown() ||
      receiverType.getProperty("query") !== undefined ||
      receiverType.getProperty("exec") !== undefined
    ) return true;
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

function isReviewedUnresolvedSql(
  call: Node,
  expression: Node,
  rel: string,
): boolean {
  if (!Node.isCallExpression(call)) return false;
  const method = call.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
  if (
    rel === REVIEWED_SQL_FORWARDING_ESCAPE.file &&
    method &&
    REVIEWED_SQL_FORWARDING_ESCAPE.methods.has(method.getName()) &&
    REVIEWED_SQL_FORWARDING_ESCAPE.sinks.has(call.getExpression().getText()) &&
    expression.getText() === REVIEWED_SQL_FORWARDING_ESCAPE.argument
  ) {
    return true;
  }
  const declaration = call.getFirstAncestorByKind(
    SyntaxKind.FunctionDeclaration,
  );
  const loop = call.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
  return rel === REVIEWED_UNRESOLVED_SQL_ESCAPE.file &&
    declaration?.getName() === REVIEWED_UNRESOLVED_SQL_ESCAPE.functionName &&
    loop?.getInitializer().getText() ===
      `const ${REVIEWED_UNRESOLVED_SQL_ESCAPE.loopVariable}` &&
    loop.getExpression().getText() ===
      REVIEWED_UNRESOLVED_SQL_ESCAPE.collection &&
    call.getExpression().getText() === REVIEWED_UNRESOLVED_SQL_ESCAPE.sink &&
    expression.getText() === REVIEWED_UNRESOLVED_SQL_ESCAPE.argument;
}

function isReviewedImmutableMigration(
  version: number,
  name: string,
  sql: string,
): boolean {
  return REVIEWED_IMMUTABLE_MIGRATIONS.some((migration) =>
    migration.version === version &&
    migration.name === name &&
    migration.sha256 ===
      createHash("sha256").update(sql).digest("hex"));
}

function relativeFencePath(file: SourceFile): string {
  const absolute = file.getFilePath().replace(/\\/g, "/");
  const sourceIndex = absolute.lastIndexOf("/src/");
  return sourceIndex >= 0
    ? absolute.slice(sourceIndex + 1)
    : relative(REPO_ROOT, absolute).replace(/\\/g, "/");
}

function migrationMutationViolations(
  files: readonly SourceFile[],
): Violation[] {
  const file = files.find((candidate) =>
    relativeFencePath(candidate) ===
      REVIEWED_UNRESOLVED_SQL_ESCAPE.file);
  if (!file) return [];
  const declaration = file.getVariableDeclaration("MIGRATIONS");
  const initializer = declaration?.getInitializer();
  if (!declaration || !initializer) {
    return [{ file: relativeFencePath(file), line: 1 }];
  }
  const migrations = staticArrayNodes(initializer);
  if (migrations === null) {
    return [{
      file: relativeFencePath(file),
      line: initializer.getStartLineNumber(),
    }];
  }
  const violations: Violation[] = [];
  for (const migration of migrations) {
    if (!Node.isObjectLiteralExpression(migration)) {
      violations.push({
        file: relativeFencePath(file),
        line: migration.getStartLineNumber(),
      });
      continue;
    }
    const versionProperty = migration.getProperty("version");
    const nameProperty = migration.getProperty("name");
    const sqlProperty = migration.getProperty("sql");
    if (
      !Node.isPropertyAssignment(versionProperty) ||
      !Node.isPropertyAssignment(nameProperty) ||
      !Node.isPropertyAssignment(sqlProperty)
    ) {
      violations.push({
        file: relativeFencePath(file),
        line: migration.getStartLineNumber(),
      });
      continue;
    }
    const version = staticNumber(versionProperty.getInitializerOrThrow());
    const name = staticString(nameProperty.getInitializerOrThrow());
    const sql = staticString(sqlProperty.getInitializerOrThrow());
    if (
      version === null ||
      name === null ||
      sql === null ||
      (
        immutableWriteTargets(sql).length > 0 &&
        !isReviewedImmutableMigration(version, name, sql)
      )
    ) {
      violations.push({
        file: relativeFencePath(file),
        line: sqlProperty.getStartLineNumber(),
      });
    }
  }
  return violations;
}

function hasAllowedImmutableOwner(
  target: ImmutableWriteTarget,
  rel: string,
): boolean {
  if (target === "unresolved") return false;
  const { kind, table } = immutableWriteTargetParts(target);
  return kind === "insert" && INSERT_ALLOWLIST[table] === rel;
}

function ledgerInsertViolations(files: readonly SourceFile[]): Violation[] {
  const violations = migrationMutationViolations(files);
  const seen = new Set(
    violations.map((violation) =>
      `${violation.file}:${violation.line}:migration`),
  );
  for (const file of files) {
    const rel = relativeFencePath(file);
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = sqlTextArgument(call);
      if (expression === null) {
        const rooted = call.getArguments().find((argument) =>
          hasStaticStringRoot(argument));
        const possibleSqlSink = hasSqlCallableRoot(
          call.getExpression(),
          call.getStart(),
        );
        const unresolvedSqlSelector =
          Node.isElementAccessExpression(call.getExpression()) &&
          callTarget(call.getExpression()) === null;
        const candidate = rooted ??
          (unresolvedSqlSelector ? call.getArguments()[0] : undefined);
        if (
          candidate &&
          possibleSqlSink
        ) {
          const key = `${rel}:${candidate.getStartLineNumber()}:sql-alias`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push({
              file: rel,
              line: candidate.getStartLineNumber(),
            });
          }
        }
        continue;
      }
      if (isReviewedUnresolvedSql(call, expression, rel)) continue;
      const value = staticString(expression);
      if (value === null) {
        const key = `${rel}:${expression.getStartLineNumber()}:unresolved`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({
            file: rel,
            line: expression.getStartLineNumber(),
          });
        }
        continue;
      }
      for (const target of immutableWriteTargets(value)) {
        const key = `${rel}:${target}`;
        if (
          !hasAllowedImmutableOwner(target, rel) &&
          !seen.has(key)
        ) {
          seen.add(key);
          violations.push({
            file: rel,
            line: expression.getStartLineNumber(),
          });
        }
      }
    }
    for (const tagged of file.getDescendantsOfKind(
      SyntaxKind.TaggedTemplateExpression,
    )) {
      if (!hasSqlCallableRoot(
        tagged.getTag(),
        tagged.getStart(),
      )) {
        continue;
      }
      const template = tagged.getTemplate();
      const value = staticString(template);
      if (value === null) {
        const key =
          `${rel}:${template.getStartLineNumber()}:unresolved-tagged`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({
            file: rel,
            line: template.getStartLineNumber(),
          });
        }
        continue;
      }
      for (const target of immutableWriteTargets(value)) {
        const key = `${rel}:${target}`;
        if (
          !hasAllowedImmutableOwner(target, rel) &&
          !seen.has(key)
        ) {
          seen.add(key);
          violations.push({
            file: rel,
            line: template.getStartLineNumber(),
          });
        }
      }
    }
  }
  return violations;
}

function isOperatorScript(path: string): boolean {
  return /\.(?:[cm]?[jt]s|tsx)$/i.test(path);
}

function ledgerFenceFiles(): SourceFile[] {
  const project = realProject();
  for (const file of walk(
    join(REPO_ROOT, "scripts"),
    isOperatorScript,
  )) {
    project.addSourceFileAtPath(file);
  }
  return project.getSourceFiles();
}

function sourceWriteBoundaryViolations(
  files: readonly SourceFile[],
): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const absolute = file.getFilePath().replace(/\\/g, "/");
    const sourceIndex = absolute.lastIndexOf("/src/");
    const rel = sourceIndex >= 0
      ? absolute.slice(sourceIndex + 1)
      : relative(REPO_ROOT, absolute).replace(/\\/g, "/");
    for (const declaration of file.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      const restrictedModule = restrictedSourceModule(
        specifier,
        declaration.getModuleSpecifierSourceFile(),
      );
      if (
        restrictedModule &&
        declaration.getNamespaceImport()
      ) {
        const key = `${rel}:${declaration.getStartLineNumber()}`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({
            file: rel,
            line: declaration.getStartLineNumber(),
          });
        }
      }
      for (const imported of declaration.getNamedImports()) {
        const name = imported.getName();
        const owner = RESTRICTED_SOURCE_IMPORTS[name];
        if (owner && owner !== rel) {
          const key = `${rel}:${imported.getStartLineNumber()}`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push({
              file: rel,
              line: imported.getStartLineNumber(),
            });
          }
        }
      }
    }
    for (const declaration of file.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (
        specifier &&
        restrictedSourceModule(
          specifier,
          declaration.getModuleSpecifierSourceFile(),
        )
      ) {
        const key = `${rel}:${declaration.getStartLineNumber()}`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({
            file: rel,
            line: declaration.getStartLineNumber(),
          });
        }
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
        restrictedSourceModule(value)
      ) {
        const key = `${rel}:${declaration.getStartLineNumber()}`;
        if (!seen.has(key)) {
          seen.add(key);
          violations.push({
            file: rel,
            line: declaration.getStartLineNumber(),
          });
        }
      }
    }
    for (const reference of moduleReferences(file)) {
      const indirectLoader =
        reference.kind === "create-require" ||
        reference.kind === "require-reference";
      const indirectRestricted =
        reference.kind === "dynamic-import" ||
        reference.kind === "require" ||
        reference.kind === "import-equals";
      const unresolvedDynamicImport =
        reference.kind === "dynamic-import" &&
        reference.specifier === null;
      if (
        rel !== "src/infrastructure/ledger/ledger-store.ts" &&
        (
          indirectLoader ||
          unresolvedDynamicImport ||
          (indirectRestricted &&
            reference.specifier !== null &&
            restrictedSourceModule(reference.specifier))
        )
      ) {
        const key = `${rel}:${reference.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({
          file: rel,
          line: reference.line,
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
  it("anti-fork: immutable tables have exact insert owners and no mutation owners", () => {
    const violations = ledgerInsertViolations(ledgerFenceFiles());
    expect(
      violations,
      `immutable decision-ledger mutations bypass ownership:\n${violations.map(
        (item) => `${item.file}:${item.line}`,
      ).join("\n")}`,
    ).toEqual([]);
  }, 60_000);

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

    it("fails closed for unresolved element-access SQL sinks", () => {
      const project = inMemoryProject({
        "/scripts/unresolved-element.ts":
          `export const run = (` +
          `db: { query(s: string): unknown }, method: "query") => ` +
          `db[method]("INSERT INTO decision_ledger (id) VALUES ('x')");`,
        "/scripts/non-sql-element.ts":
          `export const run = (` +
          `log: { error(s: string): unknown }, method: "error") => ` +
          `log[method]("INSERT INTO decision_ledger was refused");`,
        "/scripts/untyped-element.ts":
          `export const run = (db: any, method: string) => ` +
          `db[method]("INSERT INTO decision_records (id) VALUES ('x')");`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(2);
    });

    it("fails closed for unresolved SQL through a dynamic selector", () => {
      const project = inMemoryProject({
        "/scripts/dynamic-selector-and-sql.ts":
          `export const run = (` +
          `db: { query(s: string): unknown; exec(s: string): unknown }, ` +
          `method: "query" | "exec", sql: string) => db[method](sql);`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(1);
    });

    it("fails closed for unresolved SQL parameters and loop values except the migration runner", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil-parameter.ts":
          `export const run = (db: { query(s: string): unknown }, sql: string) => ` +
          `db.query(sql);`,
        "/src/infrastructure/evil-loop.ts":
          `export async function run(db: { exec(s: string): unknown }, migrations: readonly { sql: string }[]) {\n` +
          `  for (const migration of migrations) await db.exec(migration.sql);\n` +
          `}`,
        "/src/infrastructure/store/migrations.ts":
          `const MIGRATIONS: readonly { sql: string }[] = [];\n` +
          `export async function runMigrations(db: { transaction<T>(fn: (tx: { exec(s: string): Promise<void> }) => Promise<T>): Promise<T> }) {\n` +
          `  for (const m of MIGRATIONS) {\n` +
          `    await db.transaction(async (tx) => tx.exec(m.sql));\n` +
          `  }\n` +
          `}`,
      });
      expect(
        ledgerInsertViolations(project.getSourceFiles())
          .map(({ file }) => file.split("/").at(-1))
          .sort(),
      ).toEqual(["evil-loop.ts", "evil-parameter.ts"]);
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
      expect(
        [...new Set(
          ledgerInsertViolations(project.getSourceFiles())
            .map(({ file }) => file),
        )],
      ).toHaveLength(3);
    });

    it("detects destructured sinks and object-method wrappers", () => {
      const project = inMemoryProject({
        "/scripts/destructured.ts":
          `export const run = (db: { query(s: string): unknown }) => {\n` +
          `  const { query: execute } = db;\n` +
          `  return execute("INSERT INTO decision_ledger (id) VALUES ('x')");\n` +
          `};`,
        "/scripts/object-method.ts":
          `export const run = (db: { exec(s: string): unknown }) => {\n` +
          `  const operations = {\n` +
          `    execute(sql: string) { return db.exec(sql); },\n` +
          `  };\n` +
          `  return operations.execute("INSERT INTO decision_records (id) VALUES ('x')");\n` +
          `};`,
        "/scripts/object-property.ts":
          `export const run = (db: { query(s: string): unknown }) => {\n` +
          `  const operations = { execute: db.query.bind(db) };\n` +
          `  const { execute } = operations;\n` +
          `  return execute("INSERT INTO evidence_snapshots (id) VALUES ('x')");\n` +
          `};`,
      });
      expect(
        [...new Set(
          ledgerInsertViolations(project.getSourceFiles())
            .map(({ file }) => file.split("/").at(-1)),
        )].sort(),
      ).toEqual([
        "destructured.ts",
        "object-method.ts",
        "object-property.ts",
      ]);
    });

    it("detects quoted, qualified, tagged, and spread-forwarded inserts", () => {
      const project = inMemoryProject({
        "/scripts/quoted.ts":
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query('INSERT INTO "decision_ledger" (id) VALUES ($1)');`,
        "/scripts/qualified.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec('INSERT /**/ INTO ONLY "public"."decision_records" (id) VALUES ($1)');`,
        "/scripts/tagged.ts":
          `export const run = (db: { query: any }) => ` +
          "db.query`INSERT INTO evidence_snapshots (id) VALUES ($1)`;",
        "/scripts/spread.ts":
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query(...["INSERT INTO decision_input_bundles (id) VALUES ($1)"]);`,
        "/scripts/spread-wrapper.ts":
          `export const run = (db: { exec(s: string): unknown }) => {\n` +
          `  const execute = (...args: [string]) => db.exec(...args);\n` +
          `  return execute(...["INSERT INTO public.decision_replay_source_provenance (source_id) VALUES ($1)"]);\n` +
          `};`,
      });
      expect(
        [...new Set(
          ledgerInsertViolations(project.getSourceFiles())
            .map(({ file }) => file.split("/").at(-1)),
        )].sort(),
      ).toEqual([
        "qualified.ts",
        "quoted.ts",
        "spread-wrapper.ts",
        "spread.ts",
        "tagged.ts",
      ]);
    });

    it("detects merge, copy, and procedural row creation", () => {
      const project = inMemoryProject({
        "/scripts/merge.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("MERGE INTO decision_records target USING staged source ON false WHEN NOT MATCHED THEN INSERT (id) VALUES (source.id)");`,
        "/scripts/copy.ts":
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query('COPY public.evidence_snapshots FROM STDIN');`,
        "/scripts/execute.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          "db.exec(`DO $body$ BEGIN EXECUTE 'INSERT INTO decision_ledger (id) VALUES (''x'')'; END $body$`);",
        "/scripts/execute-concat.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          "db.exec(`DO $body$ BEGIN EXECUTE 'INSERT INTO ' || 'decision_input_bundles'; END $body$`);",
      });
      expect(
        ledgerInsertViolations(project.getSourceFiles())
          .map(({ file }) => file.split("/").at(-1))
          .sort(),
      ).toEqual([
        "copy.ts",
        "execute-concat.ts",
        "execute.ts",
        "merge.ts",
      ]);
      const readOnly = inMemoryProject({
        "/scripts/copy-out.ts":
          `export const run = (db: { query(s: string): unknown }) => ` +
          `db.query("COPY evidence_snapshots TO STDOUT");`,
      });
      expect(ledgerInsertViolations(readOnly.getSourceFiles())).toEqual([]);
    });

    it("detects destructive mutations and append-only trigger bypasses", () => {
      const project = inMemoryProject({
        "/scripts/update.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("UPDATE decision_ledger SET payload_json = '{}' WHERE org_id = $1");`,
        "/scripts/delete.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("DELETE FROM decision_records WHERE org_id = $1");`,
        "/scripts/truncate.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("TRUNCATE TABLE evidence_snapshots");`,
        "/scripts/disable-trigger.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("ALTER TABLE IF EXISTS ONLY public.decision_ledger DISABLE TRIGGER decision_ledger_no_update");`,
        "/scripts/drop-trigger.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("DROP TRIGGER decision_records_no_delete ON decision_records");`,
        "/scripts/disable-all-triggers.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("SET session_replication_role = 'replica'");`,
        "/scripts/set-config.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          `db.exec("SELECT set_config('session_replication_role', $1, false)");`,
        "/src/infrastructure/ledger/ledger-store.ts":
          `export const rewrite = (db: { exec(s: string): unknown }) => ` +
          `db.exec("UPDATE decision_ledger SET payload_json = '{}' WHERE org_id = $1");`,
      });
      expect(
        ledgerInsertViolations(project.getSourceFiles())
          .map(({ file }) => file.split("/").at(-1))
          .sort(),
      ).toEqual([
        "delete.ts",
        "disable-all-triggers.ts",
        "disable-trigger.ts",
        "drop-trigger.ts",
        "ledger-store.ts",
        "set-config.ts",
        "truncate.ts",
        "update.ts",
      ]);
    });

    it("limits immutable migration mutations to exact reviewed entries", () => {
      expect(
        isReviewedImmutableMigration(
          8,
          "decision-ledger-bundle-identity",
          DECISION_LEDGER_BUNDLE_IDENTITY_SQL,
        ),
      ).toBe(true);
      expect(
        isReviewedImmutableMigration(
          8,
          "decision-ledger-bundle-identity",
          `${DECISION_LEDGER_BUNDLE_IDENTITY_SQL}
TRUNCATE decision_ledger;`,
        ),
      ).toBe(false);
      const project = inMemoryProject({
        "/src/infrastructure/store/migrations.ts":
          `const MIGRATIONS = [{ ` +
          `version: 9, name: "unsafe-rewrite", ` +
          `sql: "UPDATE decision_ledger SET payload_json = '{}' WHERE org_id = $1" ` +
          `}];\n` +
          `export async function runMigrations(db: { transaction<T>(fn: (tx: { exec(s: string): Promise<void> }) => Promise<T>): Promise<T> }) {\n` +
          `  for (const m of MIGRATIONS) {\n` +
          `    await db.transaction(async (tx) => tx.exec(m.sql));\n` +
          `  }\n` +
          `}`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(1);
    });

    it("detects formatted and assigned procedural row creation", () => {
      const project = inMemoryProject({
        "/scripts/execute-format.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          "db.exec(`DO $body$ DECLARE target text := 'decision_ledger'; BEGIN EXECUTE format('INSERT INTO %I (id) VALUES (''x'')', target); END $body$`);",
        "/scripts/execute-variable.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          "db.exec(`DO $body$ DECLARE statement text := 'INSERT INTO ' || 'decision_records'; BEGIN EXECUTE statement; END $body$`);",
        "/scripts/execute-unresolved.ts":
          `export const run = (db: { exec(s: string): unknown }) => ` +
          "db.exec(`DO $body$ DECLARE statement text := transform('INSERT INTO decision_records'); BEGIN EXECUTE statement; END $body$`);",
      });
      const planted = ledgerInsertViolations(project.getSourceFiles());
      expect(
        planted.map(({ file }) => file.split("/").at(-1)).sort(),
      ).toEqual([
        "execute-format.ts",
        "execute-unresolved.ts",
        "execute-variable.ts",
      ]);
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
          `db.query("SELECT $1::text, 'INSERT INTO decision_ledger'", ` +
          `[value, "INSERT INTO decision_ledger"]);`,
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

    it("rejects unresolved dynamic imports outside the exact source owner", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil-computed-import.ts":
          `export const load = (moduleName: string) => import(moduleName);`,
        "/src/infrastructure/ledger/ledger-store.ts":
          `export const load = (moduleName: string) => import(moduleName);`,
      });
      expect(
        sourceWriteBoundaryViolations(project.getSourceFiles()),
      ).toHaveLength(1);
    });

    it("rejects restricted modules loaded through aliased and createRequire loaders", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil-require.ts":
          `const load = require;\n` +
          `export const source = load("./ledger/ledger-sources.js");`,
        "/src/infrastructure/evil-create-require.ts":
          `import { createRequire } from "node:module";\n` +
          `const load = createRequire(import.meta.url);\n` +
          `export const capability = load("./ledger/ledger-source-capability.js");`,
      });
      expect(sourceWriteBoundaryViolations(project.getSourceFiles()))
        .toHaveLength(2);
    });

    it("scans every supported Node operator-script extension", () => {
      expect([
        "operator.ts",
        "operator.tsx",
        "operator.mts",
        "operator.cts",
        "operator.js",
        "operator.mjs",
        "operator.cjs",
      ].every(isOperatorScript)).toBe(true);
      expect(isOperatorScript("operator.json")).toBe(false);
      const project = inMemoryProject({
        "/scripts/extension-bypass.mjs":
          `export const run = (db) => ` +
          `db.query("INSERT INTO decision_ledger (id) VALUES ('x')");`,
      });
      expect(ledgerInsertViolations(project.getSourceFiles())).toHaveLength(1);
    });

    it("resolves restricted module imports with emitted JavaScript extensions", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts":
          `import * as capability from "./ledger/ledger-source-capability.js";\n` +
          `void capability;`,
      });
      expect(
        sourceWriteBoundaryViolations(project.getSourceFiles()),
      ).toHaveLength(1);
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
