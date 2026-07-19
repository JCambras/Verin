import { describe, it, expect } from "vitest";
import { readShipped, stripComments } from "./_fence-utils";

/**
 * NO-CONSOLE FENCE (ADR-0013, charter #14). Raw console.* is banned in shipped
 * domain/infrastructure code: only the pino logger scrubs PII (ADR-0006), so a
 * stray console.log can leak PII to stdout. Use the structured logger.
 */
const CONSOLE_RE = /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|dir)\s*\(/;

function detectConsole(files: Array<{ rel: string; text: string }>): string[] {
  const offenders: string[] = [];
  for (const { rel, text } of files) {
    const r = rel.replace(/\\/g, "/");
    if (!r.startsWith("src/domain/") && !r.startsWith("src/infrastructure/")) continue;
    // The logger module itself is the one place allowed to touch the console transport.
    if (r.startsWith("src/infrastructure/observability/")) continue;
    text.split("\n").forEach((line, i) => {
      if (CONSOLE_RE.test(stripComments(line))) offenders.push(`${rel}:${i + 1}`);
    });
  }
  return offenders;
}

describe("no-console fence", () => {
  it("enforces: no raw console.* in domain/infrastructure", () => {
    const offenders = detectConsole(readShipped());
    expect(offenders, `raw console.* (use the pino logger):\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a planted console.* is caught", () => {
    it("catches console.log in a domain file", () => {
      const offenders = detectConsole([{ rel: "src/domain/x.ts", text: `export function f(){ console.log("pii?"); }` }]);
      expect(offenders).toEqual(["src/domain/x.ts:1"]);
    });
    it("allows console inside the observability logger module", () => {
      const offenders = detectConsole([{ rel: "src/infrastructure/observability/logger.ts", text: `console.error("transport");` }]);
      expect(offenders).toEqual([]);
    });
  });
});
