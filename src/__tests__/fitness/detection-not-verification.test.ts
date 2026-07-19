import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * DETECTION-IS-NOT-VERIFICATION META-FENCE (charter #4). Every PASS-emitting
 * fence must ship a companion proving incomplete/wrong work CANNOT pass it. This
 * meta-fence enforces the discipline mechanically: every fitness fence file must
 * contain a companion — a `describe("detects` block (or an explicit
 * `@companion:proof-log` tag for the two self-referential meta fences, whose
 * adversarial proofs live in docs/fences/proof-log.md).
 *
 * @companion:proof-log — this meta fence's own adversarial proof is PF-META in
 * docs/fences/proof-log.md; the inline "detects" block below double-covers it.
 */
const dir = fileURLToPath(new URL(".", import.meta.url));

// The two self-referential meta fences prove themselves via the proof log, not an
// inline "detects" block (a meta fence cannot cleanly feed itself a fixture).
const PROOF_LOG_EXEMPT = new Set(["charter-drift.test.ts", "detection-not-verification.test.ts"]);

function hasInlineCompanion(text: string): boolean {
  return /describe\(\s*["'`]detects/.test(text);
}
function hasProofLogTag(text: string): boolean {
  return /@companion:proof-log/.test(text);
}

describe("detection-is-not-verification meta-fence", () => {
  const fenceFiles = readdirSync(dir).filter((f) => f.endsWith(".test.ts"));

  it("enforces: every fence ships a companion (inline 'detects' block or a proof-log tag)", () => {
    const missing: string[] = [];
    for (const f of fenceFiles) {
      const text = readFileSync(`${dir}/${f}`, "utf8");
      if (PROOF_LOG_EXEMPT.has(f)) {
        if (!hasProofLogTag(text)) missing.push(`${f} (meta fence must carry @companion:proof-log)`);
        continue;
      }
      if (!hasInlineCompanion(text)) missing.push(`${f} (no 'describe("detects…")' companion)`);
    }
    expect(missing, `fences without a companion:\n${missing.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a fence file lacking a companion is caught", () => {
    it("flags synthetic fence text with no companion block", () => {
      const noCompanion = `describe("some fence", () => { it("enforces", () => {}); });`;
      expect(hasInlineCompanion(noCompanion)).toBe(false);
    });
    it("accepts fence text that has a companion block", () => {
      const withCompanion = `describe("x", () => { it("enforces", ()=>{}); }); describe("detects (companion)", ()=>{});`;
      expect(hasInlineCompanion(withCompanion)).toBe(true);
    });
  });
});
