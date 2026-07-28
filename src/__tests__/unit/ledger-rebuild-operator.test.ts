import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REBUILD_PLAN_SAMPLE,
  parseRebuildArgs,
  rebuildPlanLines,
} from "../../../scripts/ledger-rebuild.lib";

/**
 * `pnpm ledger:rebuild --apply` DELETEs a tenant's projections, reservation index,
 * and checkpoint before re-folding them. The guardrails below are what keeps a stray
 * invocation from being that: one named tenant, preview by default, no all-tenant
 * form, and a bounded plan printed before anything is written.
 */
const plan = (derived: number) => ({
  tenant: "firm-a",
  entries: 42,
  derived,
  sample: Array.from({ length: Math.min(derived, REBUILD_PLAN_SAMPLE) }, (_, index) => ({
    decisionId: `dec:${index}`,
    lastSequence: index,
  })),
});
const RUNNER = readFileSync(
  new URL("../../../scripts/ledger-rebuild.ts", import.meta.url),
  "utf8",
);
const planProjectionReaders = (source: string): string[] =>
  [...source.matchAll(/\b(listDecisionProjections|listDecisionProjectionMetadata)\s*\(/g)]
    .map((match) => match[1]!);

describe("ledger-rebuild operator contract", () => {
  it("requires an explicit tenant - a bare invocation rebuilds nothing", () => {
    expect(parseRebuildArgs([])).toBe(
      "a rebuild replaces one tenant's derived decision state and requires --tenant",
    );
    expect(parseRebuildArgs(["--apply"])).toBe(
      "a rebuild replaces one tenant's derived decision state and requires --tenant",
    );
    expect(parseRebuildArgs(["--tenant"])).toBe(
      "a rebuild replaces one tenant's derived decision state and requires --tenant",
    );
  });

  it("refuses an all-tenant rebuild rather than fanning out", () => {
    expect(parseRebuildArgs(["--all"])).toBe(
      "refusing an all-tenant rebuild - name exactly one tenant with --tenant",
    );
    expect(parseRebuildArgs(["--tenant", "firm-a", "--all"])).toBe(
      "refusing an all-tenant rebuild - name exactly one tenant with --tenant",
    );
    expect(parseRebuildArgs(["--tenant", "firm-a", "firm-b"])).toBe(
      "unknown argument firm-b",
    );
  });

  it("defaults to preview and mutates only under an explicit --apply", () => {
    expect(parseRebuildArgs(["--tenant", "firm-a"])).toEqual({
      tenant: "firm-a",
      apply: false,
    });
    expect(parseRebuildArgs(["--tenant=firm-a"])).toEqual({
      tenant: "firm-a",
      apply: false,
    });
    expect(parseRebuildArgs(["--tenant=firm-a", "--apply"])).toEqual({
      tenant: "firm-a",
      apply: true,
    });
  });

  it("prints a bounded plan that names what would be discarded", () => {
    const small = rebuildPlanLines(plan(2));
    expect(small).toContain("  verified ledger entries to replay: 42");
    expect(small).toContain(
      "  derived decision projections to discard and re-fold: 2",
    );
    expect(small.filter((line) => line.startsWith("  - "))).toHaveLength(2);
    expect(small.some((line) => line.includes("bounded at"))).toBe(false);

    const large = rebuildPlanLines(plan(250));
    expect(large.filter((line) => line.startsWith("  - "))).toHaveLength(
      REBUILD_PLAN_SAMPLE,
    );
    // A truncated plan says so: silence would read as "these are all of them".
    expect(large).toContain(
      `  ... and ${250 - REBUILD_PLAN_SAMPLE} more (plan bounded at ${REBUILD_PLAN_SAMPLE})`,
    );
  });

  it("builds the preview without decoding mutable projection JSON", () => {
    expect(planProjectionReaders(RUNNER)).toEqual([
      "listDecisionProjectionMetadata",
    ]);
  });

  it("detects a preview that reads deserialized projection state", () => {
    expect(
      planProjectionReaders(
        "const sample = await listDecisionProjections(db, tenant, 10);",
      ),
    ).toEqual(["listDecisionProjections"]);
  });
});
