import type { TestProject } from "vitest/node";
import { defectClassIds } from "../../../scripts/corpus/defects";
import { validateCorpus } from "../../../scripts/corpus/validate";
import { loadGoldenCases, loadScenarioRefs } from "../../../scripts/golden-cases.lib";

/**
 * ONE corpus validation per RUN, not one per fence FILE.
 *
 * `validateCorpus()` regenerates all 27 synthetic cases, hashes the bound
 * executable authorities and both intake schemas, walks the corpus tree and
 * loads the signed golden cases. Vitest isolates modules per test file, so a
 * module-scope call in `_corpus-world.ts` re-ran that whole validation once per
 * importing fence - thirteen times after the corpus fences were split into
 * per-topic modules, and serially, because the fitness project is pinned to one
 * worker. Computing it here and injecting it keeps the fences reading the SAME
 * validated corpus they always did, at the cost of one execution.
 */
export interface CorpusWorld {
  readonly real: ReturnType<typeof validateCorpus>;
  readonly refs: ReturnType<typeof loadScenarioRefs>;
  readonly goldenIds: ReadonlySet<string>;
  readonly classes: ReturnType<typeof defectClassIds>;
}

declare module "vitest" {
  interface ProvidedContext {
    corpusWorld: CorpusWorld;
  }
}

/**
 * Global setup runs in vitest's MAIN process, which does NOT inherit the
 * project's `test.env`, so the shared world would otherwise be built on whatever
 * clock the developer's machine happens to keep. The zone is read back from the
 * SAME config that pins the workers - never a second copy of it - and a UTC
 * clock is refused exactly the way `src/__tests__/setup.ts` refuses one, because
 * a corpus validated in UTC and asserted in New York is a green suite proving
 * nothing (charter #8).
 */
const pinConfiguredClock = (project: TestProject): void => {
  const zone = project.config.env?.TZ;
  if (zone !== undefined) process.env.TZ = zone;
  const january = new Date("2026-01-15T12:00:00Z").getTimezoneOffset();
  const july = new Date("2026-07-15T12:00:00Z").getTimezoneOffset();
  if (january === 0 && july === 0) {
    throw new Error(
      "Shared corpus world would be built on a UTC clock. The fitness project pins " +
        "TZ in vitest.config.ts; global setup must resolve that same non-UTC zone.",
    );
  }
};

export default function setup(project: TestProject): void {
  pinConfiguredClock(project);
  const real = validateCorpus();
  project.provide("corpusWorld", {
    real,
    refs: loadScenarioRefs(),
    goldenIds: new Set(
      loadGoldenCases().map((e) => String((e.data as Record<string, unknown>).caseId)),
    ),
    classes: defectClassIds(real.taxonomy),
  });
}
