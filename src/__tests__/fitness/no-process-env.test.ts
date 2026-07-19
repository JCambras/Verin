import { describe, it, expect } from "vitest";
import { readShipped, stripComments } from "./_fence-utils";

/**
 * NO-PROCESS-ENV FENCE (ADR-0003, charter #7). process.env may be read ONLY in
 * src/infrastructure/config. Scans file CONTENTS (not imports) — the seam Iris
 * leaked through: a domain process.env read "walked past" the import-only
 * dependency check.
 */
// Catch dotted AND bracket access (Vale V16): process.env, process["env"], process['env'].
const ENV_RE = /process\s*(\.\s*env\b|\[\s*["']env["']\s*\])/;
const ALLOWED = "src/infrastructure/config";

function detectProcessEnv(files: Array<{ rel: string; text: string }>): string[] {
  const offenders: string[] = [];
  for (const { rel, text } of files) {
    if (rel.replace(/\\/g, "/").startsWith(ALLOWED)) continue;
    text.split("\n").forEach((line, i) => {
      if (ENV_RE.test(stripComments(line))) offenders.push(`${rel}:${i + 1}`);
    });
  }
  return offenders;
}

describe("no-process-env fence", () => {
  it("enforces: no process.env read outside src/infrastructure/config", () => {
    const offenders = detectProcessEnv(readShipped());
    expect(offenders, `process.env read outside config:\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a planted read is caught", () => {
    it("catches process.env in a domain file", () => {
      const offenders = detectProcessEnv([{ rel: "src/domain/evil.ts", text: `export const k = process.env.SECRET;` }]);
      expect(offenders).toEqual(["src/domain/evil.ts:1"]);
    });
    it("catches spaced-out process . env too", () => {
      const offenders = detectProcessEnv([{ rel: "src/app/x.ts", text: `const a = process . env . FOO;` }]);
      expect(offenders.length).toBe(1);
    });
    it("allows process.env inside infrastructure/config", () => {
      const offenders = detectProcessEnv([{ rel: "src/infrastructure/config/index.ts", text: `const k = process.env.DATABASE_URL;` }]);
      expect(offenders).toEqual([]);
    });
    it("does not trip on the string in a comment", () => {
      const offenders = detectProcessEnv([{ rel: "src/domain/ok.ts", text: `// never read process.env here\nexport const y = 1;` }]);
      expect(offenders).toEqual([]);
    });
  });
});
