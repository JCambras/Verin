import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type Project,
} from "ts-morph";
import { realSemanticProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";
import { OBSERVABILITY_VOCABULARY } from "@domain/observability/safe-values";

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

function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)
    ? node.getLiteralValue()
    : null;
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

/** The test-only span injection point must be unreachable from shipped code. */
export function detectShippedTestVocabularyUse(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!isShipped(file) || file === SAFE_VALUES) continue;
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getText() !== TEST_INJECTION_POINT) continue;
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
