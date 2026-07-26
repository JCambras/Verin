import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * ARCH-VERSION FENCE (ADR-0023; v3 prompt-sequence prompt 4's "architecture
 * checksum"). The ratified v3 documents under docs/v3/ are SHA-256-pinned in
 * v3-invariants.json. This fence fails the build when a ratified document's
 * bytes no longer match its pin (or a pinned document is missing), so no build
 * session can silently target a stale or edited copy of the architecture. If a
 * document legitimately changes, update its sha256 pin IN THE SAME PR and
 * review v3-invariants.json for invariant drift (docs/v3/README.md).
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));

interface DocumentPin {
  path: string;
  sha256: string;
}
interface Registry {
  architectureVersion: string;
  documents: DocumentPin[];
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Pure core: verify pins against a byte reader; returns human-readable mismatches. */
export function verifyDocumentPins(pins: DocumentPin[], readBytes: (path: string) => Buffer | null): string[] {
  const problems: string[] = [];
  for (const pin of pins) {
    const bytes = readBytes(pin.path);
    if (bytes === null) {
      problems.push(`${pin.path}: pinned in v3-invariants.json but MISSING on disk`);
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual !== pin.sha256) {
      problems.push(
        `${pin.path}: content drifted from its ratified pin.\n` +
          `  pinned:  ${pin.sha256}\n` +
          `  actual:  ${actual}\n` +
          `  If this change is intentional, update the pin in v3-invariants.json IN THE SAME PR\n` +
          `  and review the 30 invariants for drift (ADR-0023; docs/v3/README.md).`,
      );
    }
  }
  return problems;
}

const registry = JSON.parse(readFileSync(root + "v3-invariants.json", "utf8")) as Registry;

describe("arch-version fence", () => {
  it("enforces: v3-invariants.json pins at least the architecture document", () => {
    expect(registry.architectureVersion).toBe("v3");
    const paths = registry.documents.map((d) => d.path);
    expect(paths).toContain("docs/v3/verin-architecture-v3.md");
    for (const d of registry.documents) {
      expect(d.sha256, `${d.path} pin must be a sha256 hex digest`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("enforces: every ratified v3 document matches its SHA-256 pin", () => {
    const problems = verifyDocumentPins(registry.documents, (p) => (existsSync(root + p) ? readFileSync(root + p) : null));
    expect(problems, `ratified v3 documents drifted from their pins:\n${problems.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): drifted or missing documents cannot pass", () => {
    const pins: DocumentPin[] = [{ path: "docs/v3/x.md", sha256: sha256Hex(Buffer.from("ratified content")) }];

    it("flags a document whose bytes drifted from the pin", () => {
      const problems = verifyDocumentPins(pins, () => Buffer.from("ratified content EDITED"));
      expect(problems.length).toBe(1);
      expect(problems[0]).toContain("drifted");
    });
    it("flags a pinned document that is missing on disk", () => {
      const problems = verifyDocumentPins(pins, () => null);
      expect(problems.length).toBe(1);
      expect(problems[0]).toContain("MISSING");
    });
    it("accepts a document whose bytes match the pin (cannot pass by always-failing)", () => {
      expect(verifyDocumentPins(pins, () => Buffer.from("ratified content"))).toEqual([]);
    });
    it("a single flipped byte is caught (hash sensitivity, not length)", () => {
      expect(verifyDocumentPins(pins, () => Buffer.from("ratified Content")).length).toBe(1);
    });
  });
});
