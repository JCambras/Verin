import { afterEach, describe, expect, it } from "vitest";
import type { TestProject, TestSpecification } from "vitest/node";
import setup, { pinConfiguredClock } from "./_corpus-world-setup";

/**
 * CORPUS-WORLD SHARING SEAM (D-145; charter #4/#8).
 *
 * The corpus fences read ONE `validateCorpus()` result computed in the fitness
 * project's global setup. Vitest runs global setup once per PROCESS and never
 * again, so the two properties that make that sharing honest are not free:
 *
 *  1. A WATCH RERUN REBUILDS the world. Without it every rerun in a session
 *     asserts against the snapshot taken at startup - a corpus fixture or
 *     generator edit would rerun the fences green against bytes that no longer
 *     exist, which is the "green suite proving nothing" class the charter
 *     targets. `vitest.config.ts` declares the world's inputs in
 *     `forceRerunTriggers` so the edit schedules a rerun at all; this fence
 *     proves the rerun hook rebuilds before it collects, and that another
 *     project's rerun does not pay for a world it never reads.
 *  2. THE CLOCK IS PINNED OR REFUSED. Global setup runs in vitest's main
 *     process, which does NOT inherit `test.env`, so an unread, unresolvable or
 *     UTC zone would build the corpus on the machine's clock while the workers
 *     assert under America/New_York.
 */

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const recordingProject = () => {
  const provided: unknown[] = [];
  const rerunHooks: ((specifications: TestSpecification[]) => void)[] = [];
  const project = {
    name: "fitness",
    config: { env: { TZ: ORIGINAL_TZ } },
    provide: (_key: string, value: unknown) => provided.push(value),
    onTestsRerun: (cb: (specifications: TestSpecification[]) => void) => rerunHooks.push(cb),
  };
  return { project: project as unknown as TestProject, provided, rerunHooks };
};

const rerunOf = (projectName: string): TestSpecification[] =>
  [{ project: { name: projectName } }] as unknown as TestSpecification[];

describe("corpus-world sharing seam", () => {
  it("enforces: a fitness rerun REBUILDS the shared world; another project's rerun does not", () => {
    const { project, provided, rerunHooks } = recordingProject();
    setup(project);
    expect(provided).toHaveLength(1);
    expect(provided[0]).toHaveProperty("real");
    expect(rerunHooks).toHaveLength(1);

    rerunHooks[0]!(rerunOf("app"));
    expect(provided, "an unrelated project's rerun rebuilt a world it never reads").toHaveLength(1);

    rerunHooks[0]!(rerunOf("fitness"));
    expect(provided, "a fitness rerun kept the world computed at process start").toHaveLength(2);
    expect(provided[1]).not.toBe(provided[0]);
    expect(provided[1]).toHaveProperty("real");
  });

  describe("detects (companion): a shared world built on an unpinned clock CANNOT pass", () => {
    it("refuses an absent, empty, unresolvable or UTC zone BY NAME rather than keeping the machine's", () => {
      expect(() => pinConfiguredClock(undefined)).toThrow(/no configured clock/);
      expect(() => pinConfiguredClock("")).toThrow(/no configured clock/);
      expect(() => pinConfiguredClock(42)).toThrow(/no configured clock/);
      expect(() => pinConfiguredClock("Not/AZone")).toThrow(/not a resolvable/);
      expect(() => pinConfiguredClock("UTC")).toThrow(/UTC clock/);
      expect(() => pinConfiguredClock(ORIGINAL_TZ)).not.toThrow();
      expect(process.env.TZ).toBe(ORIGINAL_TZ);
    });
  });
});
