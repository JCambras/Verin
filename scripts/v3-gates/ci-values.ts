/**
 * Literal-value validators shared by the CI workflow schema and evidence rules
 * (ADR-0055). Everything here fails closed: a value that is not a literal of
 * the accepted shape invalidates the field it configures.
 */
export function literalMapping(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function sameLiteralMapping(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, string | number>>,
): boolean {
  const actualEntries = Object.entries(actual).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEntries = Object.entries(expected).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

export function hasOnlyKeys(
  mapping: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(mapping).every((key) => allowedKeys.has(key));
}

export function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function scalarValue(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function scalarMappingProblem(
  value: unknown,
  label: string,
): string | undefined {
  const mapping = literalMapping(value);
  if (mapping === undefined) return `${label} must be a literal mapping`;
  return Object.values(mapping).every(scalarValue)
    ? undefined
    : `${label} values must be literal scalars`;
}

export function stringOrStringArray(value: unknown): boolean {
  return (
    nonEmptyString(value) ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every(nonEmptyString))
  );
}

export function conditionValue(value: unknown): boolean {
  return typeof value === "boolean" || nonEmptyString(value);
}

const GITHUB_EXPRESSION = /^\s*\$\{\{\s*\S(?:[\s\S]*\S)?\s*\}\}\s*$/;

function expressionValue(value: unknown): boolean {
  return typeof value === "string" && GITHUB_EXPRESSION.test(value);
}

export function timeoutValue(value: unknown): boolean {
  return (
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0) ||
    expressionValue(value)
  );
}

const PERMISSION_SCOPES = new Set([
  "actions",
  "attestations",
  "checks",
  "contents",
  "deployments",
  "discussions",
  "id-token",
  "issues",
  "models",
  "packages",
  "pages",
  "pull-requests",
  "security-events",
  "statuses",
]);

export function permissionsProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === "read-all" || value === "write-all") {
    return undefined;
  }
  const mapping = literalMapping(value);
  return mapping !== undefined &&
    Object.entries(mapping).every(
      ([scope, permission]) =>
        PERMISSION_SCOPES.has(scope) &&
        typeof permission === "string" &&
        ["read", "write", "none"].includes(permission),
    )
    ? undefined
    : "permissions must be 'read-all', 'write-all', or a literal permission mapping";
}

export function defaultsProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const defaults = literalMapping(value);
  const run = literalMapping(defaults?.run);
  if (
    defaults === undefined ||
    !hasOnlyKeys(defaults, ["run"]) ||
    run === undefined ||
    !hasOnlyKeys(run, ["shell", "working-directory"])
  ) {
    return "defaults must contain only a literal run mapping";
  }
  if (run.shell !== undefined && !nonEmptyString(run.shell)) {
    return "defaults.run.shell must be a non-empty string";
  }
  return run["working-directory"] === undefined ||
    nonEmptyString(run["working-directory"])
    ? undefined
    : "defaults.run.working-directory must be a non-empty string";
}

export function concurrencyProblem(value: unknown): string | undefined {
  if (value === undefined || nonEmptyString(value)) return undefined;
  const mapping = literalMapping(value);
  if (
    mapping === undefined ||
    !hasOnlyKeys(mapping, ["group", "cancel-in-progress"]) ||
    !nonEmptyString(mapping.group)
  ) {
    return "concurrency must be a non-empty string or a literal group mapping";
  }
  return mapping["cancel-in-progress"] === undefined ||
    conditionValue(mapping["cancel-in-progress"])
    ? undefined
    : "concurrency.cancel-in-progress must be a boolean or expression string";
}
