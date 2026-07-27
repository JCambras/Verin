import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type Project,
  type Type,
} from "ts-morph";
import { realSemanticProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";
import {
  isSafeObservabilityPrimitive,
  OBSERVABILITY_VOCABULARY,
} from "@domain/observability/safe-values";

/**
 * OBSERVABILITY-VOCABULARY FENCE (charter #14; v3 §15.4).
 *
 * safeSpanName / safeLogMessage degrade anything outside their closed sets to
 * the generic "operation" / "log event". That is the right RUNTIME posture, but
 * on its own it makes a new span or log line lose its identity in traces and
 * logs with no build failure and no runtime signal — a silent observability
 * regression in a SOC-2-targeted system. This fence derives the inventory from
 * the AST of the real call sites and checks it BOTH ways:
 *
 *  1. every `withSpan(...)` / `log.<level>(...)` literal in shipped code is in
 *     the production vocabulary (adding one without registering it fails);
 *  2. every vocabulary entry still has a live call site (no stale entries);
 *  3. a DYNAMIC span name or log message in shipped code fails outright — it
 *     could never be checked statically, and it always degrades at runtime;
 *  4. the test-only injection point (registerTestSpanName) has NO production
 *     caller, so test vocabulary can never leak into production allowlists.
 */

const TRACER = "src/infrastructure/observability/tracer.ts";
const LOGGER = "src/infrastructure/observability/logger.ts";
const SAFE_VALUES = "src/domain/observability/safe-values.ts";
const TEST_INJECTION_POINT = "registerTestSpanName";
const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

export interface ObservabilityVocabulary {
  readonly spanNames: readonly string[];
  readonly logMessages: readonly string[];
  readonly violations: readonly string[];
}

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

/** Shipped code: src/ and scripts/, never the test tree. */
function isShipped(file: string): boolean {
  return (file.startsWith("src/") || file.startsWith("scripts/")) &&
    !file.includes("/__tests__/");
}

/**
 * The statically known text of a message/span argument. A HOISTED constant
 * (`const MSG = "…"; log.info(MSG)`) is as checkable as an inline literal — its
 * TYPE is that string literal — and degrades identically at runtime, so it must
 * be read the same way.
 */
function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  const type = node.getType();
  return type.isStringLiteral() ? String(type.getLiteralValue()) : null;
}

function resolvesTo(node: Node, file: string, name: string): boolean {
  const symbol = node.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getName() === name &&
    target.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) === file
    );
}

function isWithSpanCall(call: CallExpression): boolean {
  return resolvesTo(call.getExpression(), TRACER, "withSpan");
}

function isLoggerCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  if (Node.isPropertyAccessExpression(expression)) {
    return LOG_LEVELS.has(expression.getName()) &&
      resolvesTo(expression.getExpression(), LOGGER, "log");
  }
  // `log[level](...)` — audited-write picks its level from the error code. The
  // LEVEL may be dynamic; the MESSAGE still may not be.
  return Node.isElementAccessExpression(expression) &&
    resolvesTo(expression.getExpression(), LOGGER, "log");
}

/** pino accepts (msg) or (mergeObject, msg); pick whichever slot holds the message. */
function messageArgument(call: CallExpression): Node | null {
  const args = call.getArguments();
  const first = args[0];
  if (!first) return null;
  if (literalText(first) !== null || first.getType().isString()) return first;
  return args[1] ?? null;
}

export function collectObservabilityVocabulary(project: Project): ObservabilityVocabulary {
  const spanNames = new Set<string>();
  const logMessages = new Set<string>();
  const violations: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!isShipped(file)) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const where = `${file}:${call.getStartLineNumber()}`;
      if (isWithSpanCall(call)) {
        const name = literalText(call.getArguments()[0]);
        if (name === null) {
          violations.push(`${where}: withSpan needs a literal span name (a dynamic name always degrades to "operation")`);
        } else {
          spanNames.add(name);
        }
        continue;
      }
      if (!isLoggerCall(call)) continue;
      const message = messageArgument(call);
      if (!message) continue;
      const text = literalText(message);
      if (text === null) {
        violations.push(`${where}: log message must be a literal (a dynamic message always degrades to "log event")`);
      } else {
        logMessages.add(text);
      }
    }
  }
  return {
    spanNames: [...spanNames].sort(),
    logMessages: [...logMessages].sort(),
    violations,
  };
}

const AUDIT_INTENT_SITES = [
  { file: "src/infrastructure/audit/audited-write.ts", name: "auditedWrite" },
  { file: "src/infrastructure/wire.ts", name: "auditEvent" },
] as const;
const OBSERVABILITY_ID_FACTORY = "observabilityId";

/** Every statically-known string value of a type: a literal, or each member of a literal union. */
function literalUnionValues(type: Type): { values: string[]; numeric: boolean; dynamic: boolean } {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  const values: string[] = [];
  let numeric = false;
  let dynamic = false;
  for (const member of members) {
    if (member.isStringLiteral()) values.push(String(member.getLiteralValue()));
    else if (member.isNumber() || member.isNumberLiteral() || member.isBigInt()) numeric = true;
    else if (member.isString() || member.isAny() || member.isUnknown()) dynamic = true;
  }
  return { values, numeric, dynamic };
}

/** The attribute-bag ARGUMENT slot: withSpan's second argument, pino's merge object. */
function attributesArgument(call: CallExpression): Node | null {
  const args = call.getArguments();
  if (isWithSpanCall(call)) return args[1] ?? null;
  return messageArgument(call) === args[1] ? args[0] ?? null : null;
}

/**
 * The object literal a node IS, or the one a hoisted constant stands for. The
 * sibling `literalText` already resolves a hoisted STRING through its declaration;
 * an attribute BAG hoisted to a const degrades at runtime exactly the same way, so
 * it has to be read the same way rather than silently contributing nothing.
 */
function objectLiteralOf(node: Node | undefined): Node | null {
  if (!node) return null;
  if (Node.isObjectLiteralExpression(node)) return node;
  if (!Node.isIdentifier(node)) return null;
  const symbol = node.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  for (const declaration of target?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer && Node.isObjectLiteralExpression(initializer)) return initializer;
  }
  return null;
}

interface AttributeEntry {
  readonly field: string;
  readonly valueNode: Node;
}

/**
 * Every (field, value) pair an attribute bag contributes, following a spread into
 * the literal it spreads. An UNRESOLVABLE spread is reported rather than skipped:
 * `log.info({ ...ids, status: "archived" }, …)` would otherwise hide everything in
 * `ids` from a fence whose whole job is to know what gets logged.
 */
function attributeEntries(
  object: Node,
  where: string,
  out: string[],
  seen = new Set<string>(),
): AttributeEntry[] {
  if (!Node.isObjectLiteralExpression(object)) return [];
  const key = `${object.getSourceFile().getFilePath()}:${object.getStart()}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const entries: AttributeEntry[] = [];
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spread = objectLiteralOf(property.getExpression());
      if (!spread) {
        out.push(`${where}: attribute spread cannot be resolved to a literal bag — its fields cannot be checked`);
        continue;
      }
      entries.push(...attributeEntries(spread, where, out, seen));
      continue;
    }
    if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      if (initializer) entries.push({ field: property.getName(), valueNode: initializer });
      continue;
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      entries.push({ field: property.getName(), valueNode: property.getNameNode() });
    }
  }
  return entries;
}

/**
 * The type a value node contributes. A SHORTHAND property (`{ action }`) types
 * its name node as the WIDENED property type, so the literal a hoisted constant
 * actually holds has to be recovered from the declaration the name refers to —
 * otherwise `const action = "household.archive"; auditedWrite({ action, … })`
 * derives nothing while degrading at runtime exactly like the inline form.
 */
function attributeType(node: Node): Type {
  const type = node.getType();
  if (!Node.isIdentifier(node) || type.isStringLiteral() || type.isUnion()) return type;
  for (const definition of node.getDefinitionNodes()) {
    const declared = definition.getType();
    if (declared.isStringLiteral() || declared.isUnion()) return declared;
  }
  return type;
}

/** The `field` an `observabilityId("<field>", …)` mint stamps into the value, if statically known. */
function mintedIdField(node: Node): string | null {
  const call = Node.isAwaitExpression(node) ? node.getExpression() : node;
  if (
    !Node.isCallExpression(call) ||
    !resolvesTo(call.getExpression(), SAFE_VALUES, OBSERVABILITY_ID_FACTORY)
  ) {
    return null;
  }
  return literalText(call.getArguments()[0]);
}

/**
 * Fields the audit boundary TYPES against the vocabulary itself (AuditedWriteOpts
 * action/entityType). Expanding that union at a call site would check the
 * vocabulary against itself and mark every member "live" — so a genuinely dead
 * action could never be reported stale. The type is the guarantee; staleness for
 * these two comes from the literal choices at the audit-intent sites.
 */
const VOCABULARY_TYPED_FIELDS = new Set(["action", "entityType"]);

/**
 * The attribute vocabulary the RUNTIME degrades against. safeSpanName /
 * safeLogMessage are only half the silent-degradation class: ACTIONS, ENUMS
 * (code/entityType/flow/status) and NUMERIC_FIELDS are closed sets too, and an
 * unlisted value becomes "[REDACTED]" in the very log line that would explain
 * an incident, with every gate green. Both directions are derived here from the
 * same call sites the span/message scan already walks, plus the audit-intent
 * sites that FEED the `action`/`entityType` attributes.
 */
export function detectAttributeVocabularyDrift(
  project: Project,
  vocabulary: {
    readonly idFields: readonly string[];
    readonly actions: readonly string[];
    readonly enums: Readonly<Record<string, readonly string[]>>;
    readonly numericFields: readonly string[];
  },
  accepts: (field: string, value: string | number) => boolean,
): string[] {
  const out: string[] = [];
  const liveIdFields = new Set<string>();
  const liveNumericFields = new Set<string>();
  const liveValues = new Map<string, Set<string>>();
  const record = (field: string, value: string): void => {
    const values = liveValues.get(field) ?? new Set<string>();
    values.add(value);
    liveValues.set(field, values);
  };
  const registeredFor = (field: string): readonly string[] =>
    field === "action" ? vocabulary.actions : vocabulary.enums[field] ?? [];

  /** One (field, value) pair, from an attribute bag or an audit intent. */
  const checkAttribute = (where: string, field: string, valueNode: Node): void => {
    const type = attributeType(valueNode);
    if (declaredAsObservabilityId(type)) {
      // The value is opaque, but its minted FIELD must match the key it is logged
      // under: readObservabilityId compares the two, and a mismatch degrades the
      // whole attribute to "[REDACTED]" at runtime.
      const minted = mintedIdField(valueNode);
      if (minted !== null && minted !== field) {
        out.push(`${where}: observability id logged as "${field}" is minted with field "${minted}" — it would be logged as "[REDACTED]"`);
      }
      return;
    }
    const { values, numeric, dynamic } = literalUnionValues(type);
    const registered = registeredFor(field);
    if (
      VOCABULARY_TYPED_FIELDS.has(field) &&
      values.length > 1 &&
      registered.length === values.length &&
      registered.every((value) => values.includes(value))
    ) {
      return;
    }
    if (numeric) {
      liveNumericFields.add(field);
      if (!accepts(field, 1)) {
        out.push(`${where}: unregistered numeric attribute "${field}" — it would be logged as "[REDACTED]"`);
      }
    }
    // A value the checker only knows as `string` can never be verified here, and
    // degrades at runtime whenever it falls outside the closed set — the same
    // silent-identity loss a dynamic span name gets failed for. `reason` is the
    // one field governed by a PATTERN rather than a closed set, so a computed
    // reason is legitimate; its literals are still checked below.
    if (dynamic && field !== "reason") {
      out.push(`${where}: dynamic ${field} value — it cannot be checked and would be logged as "[REDACTED]" unless it happens to be registered`);
    }
    for (const value of values) {
      if (field !== "reason") record(field, value);
      if (!accepts(field, value)) {
        out.push(`${where}: unregistered ${field} "${value}" — it would be logged as "[REDACTED]"`);
      }
    }
  };

  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!isShipped(file)) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const where = `${file}:${call.getStartLineNumber()}`;
      // The id-field vocabulary is exactly the first argument of every
      // observabilityId(...) mint.
      if (resolvesTo(call.getExpression(), SAFE_VALUES, OBSERVABILITY_ID_FACTORY)) {
        const field = literalText(call.getArguments()[0]);
        if (field === null) {
          out.push(`${where}: observabilityId needs a literal field name`);
        } else {
          liveIdFields.add(field);
          if (!vocabulary.idFields.includes(field)) {
            out.push(`${where}: unregistered observability id field "${field}"`);
          }
        }
      }
      // The audit intents that become the `action`/`entityType` log attributes,
      // and the only place staleness for those two can honestly be measured.
      if (AUDIT_INTENT_SITES.some((site) => resolvesTo(call.getExpression(), site.file, site.name))) {
        for (const argument of call.getArguments()) {
          const intent = objectLiteralOf(argument);
          if (!intent) continue;
          for (const entry of attributeEntries(intent, where, out)) {
            if (!VOCABULARY_TYPED_FIELDS.has(entry.field)) continue;
            checkAttribute(where, entry.field, entry.valueNode);
          }
        }
      }
      if (!isWithSpanCall(call) && !isLoggerCall(call)) continue;
      const argument = attributesArgument(call);
      if (!argument) continue;
      const attributes = objectLiteralOf(argument);
      if (!attributes) {
        out.push(`${where}: attributes must be a literal object (a dynamic bag cannot be checked)`);
        continue;
      }
      for (const entry of attributeEntries(attributes, where, out)) {
        checkAttribute(where, entry.field, entry.valueNode);
      }
    }
  }

  for (const field of vocabulary.idFields) {
    if (!liveIdFields.has(field)) out.push(`stale observability id field "${field}" — no shipped mint uses it`);
  }
  for (const field of vocabulary.numericFields) {
    if (!liveNumericFields.has(field)) out.push(`stale numeric attribute "${field}" — no shipped call site emits it`);
  }
  for (const action of vocabulary.actions) {
    if (!liveValues.get("action")?.has(action)) out.push(`stale action "${action}" — no shipped call site emits it`);
  }
  for (const [field, values] of Object.entries(vocabulary.enums)) {
    for (const value of values) {
      if (!liveValues.get(field)?.has(value)) {
        out.push(`stale ${field} "${value}" — no shipped call site emits it`);
      }
    }
  }
  return out;
}

function declaredAsObservabilityId(type: Type): boolean {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  return members.some((member) =>
    [member.getAliasSymbol(), member.getSymbol()].some((symbol) =>
      symbol?.getName() === "ObservabilityId" &&
      symbol.getDeclarations().some((declaration) =>
        normalizedPath(declaration.getSourceFile().getFilePath()) === SAFE_VALUES
      )
    )
  );
}

export function detectVocabularyDrift(
  derived: ObservabilityVocabulary,
  allowed: { readonly spanNames: readonly string[]; readonly logMessages: readonly string[] },
): string[] {
  const out: string[] = [];
  const pairs = [
    { kind: "span name", derived: derived.spanNames, allowed: allowed.spanNames, degraded: "operation" },
    { kind: "log message", derived: derived.logMessages, allowed: allowed.logMessages, degraded: "log event" },
  ] as const;
  for (const pair of pairs) {
    const registered = new Set(pair.allowed);
    const live = new Set(pair.derived);
    for (const value of pair.derived) {
      if (!registered.has(value)) {
        out.push(`unregistered ${pair.kind} "${value}" — it would be emitted as "${pair.degraded}"`);
      }
    }
    for (const value of pair.allowed) {
      if (!live.has(value)) out.push(`stale ${pair.kind} "${value}" — no shipped call site emits it`);
    }
  }
  return out;
}

/**
 * The test-only span injection point must be unreachable from shipped code.
 * Keyed SEMANTICALLY (never on the identifier's text), so an aliased import —
 * `import { registerTestSpanName as reg }` then `reg("test.x")` — is caught.
 */
export function detectShippedTestVocabularyUse(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!isShipped(file) || file === SAFE_VALUES) continue;
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
      if (!resolvesTo(identifier, SAFE_VALUES, TEST_INJECTION_POINT)) continue;
      out.push(`${file}:${identifier.getStartLineNumber()} references ${TEST_INJECTION_POINT}`);
    }
  }
  return out;
}

function vocabularyFixture(consumer: string): Project {
  return inMemoryProject({
    "/src/infrastructure/observability/tracer.ts": `
      export async function withSpan<T>(
        name: string,
        attributes: Readonly<Record<string, unknown>>,
        fn: () => Promise<T>,
      ): Promise<T> {
        void name;
        void attributes;
        return fn();
      }
    `,
    "/src/infrastructure/observability/logger.ts": `
      export const log = {
        info(obj: unknown, msg?: string): void { void obj; void msg; },
        warn(obj: unknown, msg?: string): void { void obj; void msg; },
        error(obj: unknown, msg?: string): void { void obj; void msg; },
      };
    `,
    "/src/domain/observability/safe-values.ts": `
      export function registerTestSpanName(name: string): void { void name; }
    `,
    "/src/infrastructure/consumer.ts": consumer,
  });
}

/** vocabularyFixture plus the observabilityId factory and the audit-intent chokepoint. */
function attributeFixture(consumer: string): Project {
  const project = vocabularyFixture(consumer);
  project.createSourceFile(
    "/src/domain/observability/safe-values.ts",
    `
      export interface ObservabilityId { readonly field: string; readonly value: string }
      export function observabilityId(field: string, value: string): ObservabilityId {
        return { field, value };
      }
      export function registerTestSpanName(name: string): void { void name; }
    `,
    { overwrite: true },
  );
  project.createSourceFile(
    "/src/infrastructure/audit/audited-write.ts",
    `export async function auditedWrite(opts: unknown): Promise<void> { void opts; }`,
  );
  return project;
}

describe("observability-vocabulary fence (charter #14)", () => {
  const project = realSemanticProject();
  const derived = collectObservabilityVocabulary(project);

  it("enforces: the scan actually finds shipped call sites (charter #4 non-vacuity)", () => {
    expect(derived.spanNames.length, "no withSpan call sites found — the scan went stale").toBeGreaterThanOrEqual(8);
    expect(derived.logMessages.length, "no log call sites found — the scan went stale").toBeGreaterThanOrEqual(8);
    expect(derived.spanNames).toContain("flow.account-opening.start");
    expect(derived.logMessages).toContain("flow started");
  });

  it("enforces: every shipped span name and log message is a checked literal", () => {
    expect(
      derived.violations,
      `dynamic observability identities:\n${derived.violations.join("\n")}`,
    ).toEqual([]);
  });

  it("enforces: the production vocabulary matches the shipped call sites exactly", () => {
    const drift = detectVocabularyDrift(derived, OBSERVABILITY_VOCABULARY);
    expect(drift, `observability vocabulary drift:\n${drift.join("\n")}`).toEqual([]);
  });

  it("enforces: the attribute vocabularies match the shipped call sites exactly", () => {
    const drift = detectAttributeVocabularyDrift(
      project,
      OBSERVABILITY_VOCABULARY,
      isSafeObservabilityPrimitive,
    );
    expect(drift, `observability attribute drift:\n${drift.join("\n")}`).toEqual([]);
  });

  it("enforces: the production vocabulary carries no test-namespace entries", () => {
    const testish = [...OBSERVABILITY_VOCABULARY.spanNames, ...OBSERVABILITY_VOCABULARY.logMessages]
      .filter((value) => value.startsWith("test."));
    expect(testish, `test vocabulary in production allowlists:\n${testish.join("\n")}`).toEqual([]);
  });

  it("enforces: the test-only injection point has no shipped caller", () => {
    const leaks = detectShippedTestVocabularyUse(project);
    expect(leaks, `shipped code widening the test vocabulary:\n${leaks.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): planted vocabulary drift is caught", () => {
    it("flags a new span name that is not registered", () => {
      const found = collectObservabilityVocabulary(vocabularyFixture(`
        import { withSpan } from "@infra/observability/tracer";
        export const run = () => withSpan("crm.household.archive", {}, async () => 1);
      `));
      expect(found.spanNames).toEqual(["crm.household.archive"]);
      expect(detectVocabularyDrift(found, { spanNames: [], logMessages: [] })).toEqual([
        `unregistered span name "crm.household.archive" — it would be emitted as "operation"`,
      ]);
    });

    it("flags a new log message that is not registered", () => {
      const found = collectObservabilityVocabulary(vocabularyFixture(`
        import { log } from "@infra/observability/logger";
        export const run = () => log.warn({ code: "X" }, "brand new operator message");
      `));
      expect(found.logMessages).toEqual(["brand new operator message"]);
      expect(detectVocabularyDrift(found, { spanNames: [], logMessages: [] })).toEqual([
        `unregistered log message "brand new operator message" — it would be emitted as "log event"`,
      ]);
    });

    it("flags a stale vocabulary entry with no call site", () => {
      const found = collectObservabilityVocabulary(vocabularyFixture(`export const nothing = 1;`));
      expect(detectVocabularyDrift(found, {
        spanNames: ["esign.request"],
        logMessages: ["flow started"],
      })).toEqual([
        `stale span name "esign.request" — no shipped call site emits it`,
        `stale log message "flow started" — no shipped call site emits it`,
      ]);
    });

    it("flags a DYNAMIC span name and a dynamic log message", () => {
      const found = collectObservabilityVocabulary(vocabularyFixture(`
        import { withSpan } from "@infra/observability/tracer";
        import { log } from "@infra/observability/logger";
        export const run = (id: string) => {
          log.info({}, \`processed \${id}\`);
          return withSpan(\`crm.\${id}\`, {}, async () => 1);
        };
      `));
      expect(found.spanNames).toEqual([]);
      expect(found.logMessages).toEqual([]);
      expect(found.violations).toHaveLength(2);
      expect(found.violations.some((v) => v.includes("withSpan needs a literal span name"))).toBe(true);
      expect(found.violations.some((v) => v.includes("log message must be a literal"))).toBe(true);
    });

    it("flags shipped code calling the test-only injection point", () => {
      const project = vocabularyFixture(`
        import { registerTestSpanName } from "@domain/observability/safe-values";
        registerTestSpanName("test.sneaky");
      `);
      expect(detectShippedTestVocabularyUse(project)).toEqual([
        "src/infrastructure/consumer.ts:3 references registerTestSpanName",
      ]);
    });

    it("catches an ALIASED call to the test-only injection point", () => {
      const project = vocabularyFixture(`
        import { registerTestSpanName as reg } from "@domain/observability/safe-values";
        reg("test.sneaky");
      `);
      expect(detectShippedTestVocabularyUse(project)).toEqual([
        "src/infrastructure/consumer.ts:3 references registerTestSpanName",
      ]);
    });

    it("checks a HOISTED span name and log message constant like an inline literal", () => {
      const found = collectObservabilityVocabulary(vocabularyFixture(`
        import { withSpan } from "@infra/observability/tracer";
        import { log } from "@infra/observability/logger";
        const SPAN = "crm.household.archive";
        const MSG = "brand new operator message";
        export const run = () => {
          log.info({ code: "X" }, MSG);
          log.warn(MSG);
          return withSpan(SPAN, {}, async () => 1);
        };
      `));
      expect(found.spanNames).toEqual(["crm.household.archive"]);
      expect(found.logMessages).toEqual(["brand new operator message"]);
      expect(found.violations).toEqual([]);
      expect(detectVocabularyDrift(found, { spanNames: [], logMessages: [] })).toEqual([
        `unregistered span name "crm.household.archive" — it would be emitted as "operation"`,
        `unregistered log message "brand new operator message" — it would be emitted as "log event"`,
      ]);
    });

    it("flags an unregistered action, entityType, numeric field, and id field", () => {
      const project = attributeFixture(`
        import { withSpan } from "@infra/observability/tracer";
        import { log } from "@infra/observability/logger";
        import { observabilityId } from "@domain/observability/safe-values";
        import { auditedWrite } from "@infra/audit/audited-write";
        export const archive = async () => {
          await auditedWrite({ action: "household.archive", entityType: "Ledger" });
          log.warn({ durationMs: 12, orgId: observabilityId("sessionId", "x") }, "archived");
          return withSpan("crm.household.archive", {}, async () => 1);
        };
      `);
      const drift = detectAttributeVocabularyDrift(
        project,
        { idFields: ["orgId"], actions: [], enums: {}, numericFields: [] },
        // Nothing is registered, so every derived value is unregistered.
        () => false,
      );
      expect(drift.some((v) => v.includes(`unregistered action "household.archive"`))).toBe(true);
      expect(drift.some((v) => v.includes(`unregistered entityType "Ledger"`))).toBe(true);
      expect(drift.some((v) => v.includes(`unregistered numeric attribute "durationMs"`))).toBe(true);
      expect(drift.some((v) => v.includes(`unregistered observability id field "sessionId"`))).toBe(true);
    });

    it("flags a stale registered value, id field, and numeric field", () => {
      const project = attributeFixture(`export const nothing = 1;`);
      const drift = detectAttributeVocabularyDrift(
        project,
        {
          idFields: ["orgId"],
          actions: ["household.create"],
          enums: { status: ["completed"] },
          numericFields: ["attempts"],
        },
        () => true,
      );
      expect(drift).toEqual([
        `stale observability id field "orgId" — no shipped mint uses it`,
        `stale numeric attribute "attempts" — no shipped call site emits it`,
        `stale action "household.create" — no shipped call site emits it`,
        `stale status "completed" — no shipped call site emits it`,
      ]);
    });

    it("does not charge an opaque ObservabilityId attribute to the enum vocabulary", () => {
      const project = attributeFixture(`
        import { log } from "@infra/observability/logger";
        import { observabilityId } from "@domain/observability/safe-values";
        export const emit = () =>
          log.info({ orgId: observabilityId("orgId", "org") }, "emitted");
      `);
      expect(detectAttributeVocabularyDrift(
        project,
        { idFields: ["orgId"], actions: [], enums: {}, numericFields: [] },
        () => false,
      )).toEqual([]);
    });

    it("flags a DYNAMIC attribute value, which can never be checked statically", () => {
      const project = attributeFixture(`
        import { log } from "@infra/observability/logger";
        export const emit = (status: string) => log.info({ status }, "emitted");
      `);
      const drift = detectAttributeVocabularyDrift(
        project,
        { idFields: [], actions: [], enums: { status: ["completed"] }, numericFields: [] },
        () => true,
      );
      expect(drift.some((v) => v.includes(`dynamic status value`))).toBe(true);
    });

    it("reads a HOISTED attribute bag and a resolvable spread, and refuses an unresolvable one", () => {
      const project = attributeFixture(`
        import { log } from "@infra/observability/logger";
        const ids = { flow: "onboarding" };
        const attrs = { ...ids, status: "archived" };
        export const emit = () => log.info(attrs, "emitted");
      `);
      const drift = detectAttributeVocabularyDrift(
        project,
        { idFields: [], actions: [], enums: {}, numericFields: [] },
        () => false,
      );
      // Hoisted bag AND the spread inside it both contribute.
      expect(drift.some((v) => v.includes(`unregistered status "archived"`))).toBe(true);
      expect(drift.some((v) => v.includes(`unregistered flow "onboarding"`))).toBe(true);

      const opaque = attributeFixture(`
        import { log } from "@infra/observability/logger";
        declare const ids: Record<string, string>;
        export const emit = () => log.info({ ...ids, status: "archived" }, "emitted");
      `);
      expect(detectAttributeVocabularyDrift(
        opaque,
        { idFields: [], actions: [], enums: {}, numericFields: [] },
        () => true,
      ).some((v) => v.includes("attribute spread cannot be resolved"))).toBe(true);
    });

    it("reads a SHORTHAND audit-intent action instead of pushing authors toward the degrading form", () => {
      const project = attributeFixture(`
        import { auditedWrite } from "@infra/audit/audited-write";
        export const archive = async () => {
          const action = "household.archive";
          const entityType = "Ledger";
          await auditedWrite({ action, entityType });
        };
      `);
      const drift = detectAttributeVocabularyDrift(
        project,
        { idFields: [], actions: [], enums: {}, numericFields: [] },
        () => false,
      );
      expect(drift.some((v) => v.includes(`unregistered action "household.archive"`))).toBe(true);
      expect(drift.some((v) => v.includes(`unregistered entityType "Ledger"`))).toBe(true);
    });

    it("flags an observability id whose minted field does not match the attribute key", () => {
      const project = attributeFixture(`
        import { log } from "@infra/observability/logger";
        import { observabilityId } from "@domain/observability/safe-values";
        export const emit = () =>
          log.info({ actor: observabilityId("orgId", "org") }, "emitted");
      `);
      const drift = detectAttributeVocabularyDrift(
        project,
        { idFields: ["actor", "orgId"], actions: [], enums: {}, numericFields: [] },
        () => true,
      );
      // Both fields are REGISTERED — only the key/field disagreement is wrong.
      expect(drift.some((v) => v.includes("unregistered observability id field"))).toBe(false);
      expect(drift.some((v) =>
        v.includes(`logged as "actor" is minted with field "orgId"`)
      )).toBe(true);
    });

    it("does not charge a vocabulary-TYPED action union to liveness (it would check itself)", () => {
      const project = attributeFixture(`
        import { log } from "@infra/observability/logger";
        declare const opts: { action: "household.create" | "task.create" };
        export const emit = () => log.info({ action: opts.action }, "emitted");
      `);
      // The union IS the registered vocabulary: nothing to check, nothing live.
      const drift = detectAttributeVocabularyDrift(
        project,
        { idFields: [], actions: ["household.create", "task.create"], enums: {}, numericFields: [] },
        () => true,
      );
      expect(drift).toEqual([
        `stale action "household.create" — no shipped call site emits it`,
        `stale action "task.create" — no shipped call site emits it`,
      ]);
    });

    it("ignores a same-named helper that is not the observability boundary", () => {
      const found = collectObservabilityVocabulary(vocabularyFixture(`
        const withSpan = async (name: string) => name;
        const log = { info(_obj: unknown, msg: string) { void msg; } };
        export const run = async () => {
          log.info({}, "not the production logger");
          return withSpan("not.a.real.span");
        };
      `));
      expect(found).toEqual({ spanNames: [], logMessages: [], violations: [] });
    });
  });
});
