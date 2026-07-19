import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Project, SyntaxKind } from "ts-morph";

/**
 * DETECTION-IS-NOT-VERIFICATION META-FENCE (charter #4). Every PASS-emitting
 * fence must ship a companion proving incomplete/wrong work CANNOT pass it. This
 * meta-fence enforces the discipline mechanically — via AST, not text presence:
 * every fitness fence file must contain a `describe("detects…")` companion block
 * with AT LEAST ONE non-skipped test case inside it (an empty stub or a
 * commented-out block is itself the hollow-companion class this fence exists to
 * reject), or an explicit `@companion:proof-log` tag for the two self-referential
 * meta fences, whose adversarial proofs live in docs/fences/proof-log.md.
 *
 * @companion:proof-log — this meta fence's own adversarial proof is PF-META in
 * docs/fences/proof-log.md; the inline "detects" block below double-covers it.
 */
const dir = fileURLToPath(new URL(".", import.meta.url));

// The two self-referential meta fences prove themselves via the proof log, not an
// inline "detects" block (a meta fence cannot cleanly feed itself a fixture).
const PROOF_LOG_EXEMPT = new Set(["charter-drift.test.ts", "detection-not-verification.test.ts"]);

/** AST check: a describe whose title starts with "detects" containing >=1 live `it`/`test` case. */
export function hasLiveCompanion(text: string): boolean {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("fence.ts", text);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "describe") continue;
    const arg0 = call.getArguments()[0];
    if (!arg0) continue;
    const title = arg0.getKind() === SyntaxKind.StringLiteral ? arg0.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText() : arg0.getText();
    if (!title.startsWith("detects")) continue;
    const liveTests = call
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((c) => c !== call)
      .filter((c) => {
        const e = c.getExpression().getText();
        return e === "it" || e === "test"; // a skipped/todo case has a dotted expression text, not the bare name
      });
    if (liveTests.length > 0) return true;
  }
  return false;
}
function hasProofLogTag(text: string): boolean {
  return /@companion:proof-log/.test(text);
}

describe("detection-is-not-verification meta-fence", () => {
  const fenceFiles = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));

  it("enforces: every fence ships a NON-HOLLOW companion (live 'detects' test case or a proof-log tag)", () => {
    const missing: string[] = [];
    for (const f of fenceFiles) {
      const text = readFileSync(`${dir}/${f}`, "utf8");
      if (PROOF_LOG_EXEMPT.has(f)) {
        if (!hasProofLogTag(text)) missing.push(`${f} (meta fence must carry @companion:proof-log)`);
        continue;
      }
      if (!hasLiveCompanion(text)) missing.push(`${f} (no 'describe("detects…")' companion with a live test case)`);
    }
    expect(missing, `fences without a live companion:\n${missing.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): hollow companions are caught", () => {
    it("flags synthetic fence text with no companion block", () => {
      expect(hasLiveCompanion(`describe("some fence", () => { it("enforces", () => {}); });`)).toBe(false);
    });
    it("flags an EMPTY describe(\"detects…\") stub (no test cases inside)", () => {
      expect(hasLiveCompanion(`describe("detects (companion)", () => {});`)).toBe(false);
    });
    it("flags a companion whose only test case is commented out", () => {
      expect(hasLiveCompanion(`describe("detects (companion)", () => {\n  // it("catches", () => { expect(f()).toBe(true); });\n});`)).toBe(false);
    });
    it("flags a companion whose only test case is skipped", () => {
      // ("it" + ".skip") assembled so the charter-drift disabled-fence scan does
      // not read this fixture as a real skipped test in this file.
      expect(hasLiveCompanion(`describe("detects (companion)", () => { ${"it" + ".skip"}("catches", () => {}); });`)).toBe(false);
    });
    it("accepts a companion block with a live test case", () => {
      expect(hasLiveCompanion(`describe("detects (companion)", () => { it("catches", () => { expect(1).toBe(1); }); });`)).toBe(true);
    });
  });
});
