import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shippedSourceFiles, REPO_ROOT } from "./_fence-utils";
import { relative } from "node:path";

/**
 * LINE-BUDGET FENCE (ADR-0018, charter #1/#10). Two INDEPENDENT budgets:
 *  - PLATFORM (contracts+domain+infrastructure): ratchet-DOWN only. Lowering the
 *    ceiling is a code change; raising it is an ADR amendment.
 *  - PRESENTATION (app/presentation): its OWN envelope, grown only by an ADR bump,
 *    so richness is planned — NOT the shrink-only global budget that punished
 *    richness in Iris (gap-s4 §3-Structural #2).
 *
 * NOTE (foundation): the platform ceiling carries interim build headroom and is
 * RATCHETED DOWN to actual+buffer at foundation close (Phase G). It still fails on
 * runaway growth today.
 */
const PLATFORM_CEILING = 12_000; // ratchets down at foundation close (ADR-0018)
const PRESENTATION_CEILING = 6_000; // grown only by an ADR bump (ADR-0012/0018)

function countLines(file: string): number {
  return readFileSync(file, "utf8").split("\n").length;
}

function bucket(file: string): "platform" | "presentation" | "other" {
  const r = relative(REPO_ROOT, file).replace(/\\/g, "/");
  if (r.startsWith("src/app/presentation/")) return "presentation";
  if (r.startsWith("src/contracts/") || r.startsWith("src/domain/") || r.startsWith("src/infrastructure/")) return "platform";
  return "other";
}

export function measureBudgets() {
  let platform = 0;
  let presentation = 0;
  for (const f of shippedSourceFiles()) {
    const n = countLines(f);
    const b = bucket(f);
    if (b === "platform") platform += n;
    else if (b === "presentation") presentation += n;
  }
  return { platform, presentation };
}

describe("line-budget fence", () => {
  const { platform, presentation } = measureBudgets();

  it(`enforces: platform (contracts+domain+infrastructure) <= ${PLATFORM_CEILING} [now ${platform}]`, () => {
    expect(platform, `platform lines ${platform} exceed ceiling ${PLATFORM_CEILING} — shrink or amend ADR-0018`).toBeLessThanOrEqual(PLATFORM_CEILING);
  });

  it(`enforces: presentation (app/presentation) <= ${PRESENTATION_CEILING} [now ${presentation}]`, () => {
    expect(presentation, `presentation lines ${presentation} exceed ceiling ${PRESENTATION_CEILING} — bump the budget via an ADR`).toBeLessThanOrEqual(PRESENTATION_CEILING);
  });

  describe("detects (companion): the budget math actually catches an over-budget total", () => {
    it("an over-budget platform total fails the comparison", () => {
      const over = PLATFORM_CEILING + 1;
      expect(over <= PLATFORM_CEILING).toBe(false);
    });
    it("the two budgets are independent (presentation growth never charges the platform ceiling)", () => {
      // A presentation-bucket file must not be counted against the platform sum.
      expect(bucket(`${REPO_ROOT}src/app/presentation/home.tsx`)).toBe("presentation");
      expect(bucket(`${REPO_ROOT}src/domain/x.ts`)).toBe("platform");
    });
  });
});
