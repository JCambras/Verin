import { describe, it, expect } from "vitest";
import { readShipped, stripComments } from "./_fence-utils";

/**
 * NO-BARE-THROW FENCE (ADR-0002, charter #1/#2). Across infrastructure adapters
 * (and everywhere in domain), nothing may `throw new Error(...)` (or TypeError,
 * etc.) — throws that cross a boundary must be typed AppError, so a validation
 * failure becomes a 400, not a 500 (retro-r7 don't-again #36). Business logic
 * returns Result instead of throwing.
 */
// All built-in Error subclasses (Vale V16: AggregateError/EvalError/URIError evaded before).
const BARE_THROW_RE = /\bthrow\s+new\s+(Error|TypeError|RangeError|SyntaxError|EvalError|URIError|AggregateError|ReferenceError)\s*\(/;
// contracts may define AppError helpers and result.ts throws in unwrap() at boundaries;
// the config module throws a FATAL at boot by design (ADR-0003 fail-closed).
const ALLOW = ["src/contracts/result.ts", "src/contracts/errors.ts", "src/infrastructure/config/index.ts"];

function detectBareThrow(files: Array<{ rel: string; text: string }>): string[] {
  const offenders: string[] = [];
  for (const { rel, text } of files) {
    const r = rel.replace(/\\/g, "/");
    if (ALLOW.includes(r)) continue;
    // Enforce in domain + infrastructure (the platform layers); app UI may throw for React error boundaries.
    if (!r.startsWith("src/domain/") && !r.startsWith("src/infrastructure/")) continue;
    text.split("\n").forEach((line, i) => {
      if (BARE_THROW_RE.test(stripComments(line))) offenders.push(`${rel}:${i + 1}`);
    });
  }
  return offenders;
}

describe("no-bare-throw fence", () => {
  it("enforces: no bare throw in domain/infrastructure", () => {
    const offenders = detectBareThrow(readShipped());
    expect(offenders, `bare throws (use a typed AppError):\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a planted bare throw is caught", () => {
    it("catches throw new Error in an infrastructure adapter", () => {
      const offenders = detectBareThrow([{ rel: "src/infrastructure/crm/adapter.ts", text: `export function f() { throw new Error("boom"); }` }]);
      expect(offenders).toEqual(["src/infrastructure/crm/adapter.ts:1"]);
    });
    it("allows throwing a typed AppError object", () => {
      const offenders = detectBareThrow([{ rel: "src/infrastructure/crm/adapter.ts", text: `throw { code: "VALIDATION", message: "x" } satisfies AppError;` }]);
      expect(offenders).toEqual([]);
    });
  });
});
