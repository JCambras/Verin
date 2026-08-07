import type { TestProject, TestSpecification } from "vitest/node";
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
 *
 * "Per run" is enforced, not assumed. Global setup runs ONCE PER PROCESS -
 * vitest never re-invokes it - so a watch session would otherwise keep every
 * later rerun asserting against the snapshot taken at startup, and the fences
 * lost the module-graph edge to the generator when they stopped importing it.
 * Two mechanisms close that: `forceRerunTriggers` in `vitest.config.ts` covers
 * the world's real inputs, so editing a corpus fixture or generator schedules a
 * rerun at all; and the rerun hook below REBUILDS and re-provides the world
 * before that rerun collects, so what reruns is measured against the bytes on
 * disk. CI (`vitest run`) never reruns and is unaffected.
 */
export interface CorpusWorld {
  readonly real: ReturnType<typeof validateCorpus>;
  readonly refs: ReturnType<typeof loadScenarioRefs>;
  readonly goldenIds: ReadonlySet<string>;
  readonly classes: ReturnType<typeof defectClassIds>;
}

/** A corpus that does not validate is reported to the fences that READ it, as
 * the throw each one used to raise for itself, rather than aborting global setup
 * and taking every unrelated fence down with a setup error. Fail-closed either
 * way: no fence can read a world that was never built. */
export interface UnavailableCorpusWorld {
  readonly unavailable: string;
}

declare module "vitest" {
  interface ProvidedContext {
    corpusWorld: CorpusWorld | UnavailableCorpusWorld;
  }
}

const buildCorpusWorld = (): CorpusWorld | UnavailableCorpusWorld => {
  try {
    const real = validateCorpus();
    return {
      real,
      refs: loadScenarioRefs(),
      goldenIds: new Set(
        loadGoldenCases().map((e) => String((e.data as Record<string, unknown>).caseId)),
      ),
      classes: defectClassIds(real.taxonomy),
    };
  } catch (error) {
    return {
      unavailable: `the corpus world could not be built: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
};

const WINTER = "2026-01-15T12:00:00Z";
const SUMMER = "2026-07-15T12:00:00Z";

/** ICU's offset for an instant in a named zone, in minutes EAST of UTC. */
const zoneOffsetMinutes = (zone: string, instant: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(instant));
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
};

/**
 * Global setup runs in vitest's MAIN process, which does NOT inherit the
 * project's `test.env`, so the shared world would otherwise be built on whatever
 * clock the developer's machine happens to keep. The zone is read back from the
 * SAME config that pins the workers - never a second copy of it - and every way
 * that read can fail is a REFUSAL, because a corpus validated on one clock and
 * asserted on another is a green suite proving nothing (charter #8): an absent
 * zone means the config binding broke, an unresolvable one means the pin cannot
 * be honoured, an offset that disagrees with the named zone means the pin did
 * not take, and UTC is refused exactly the way `src/__tests__/setup.ts` refuses
 * it. Silently keeping the machine zone would pass both offset checks on a
 * Europe/Paris laptop while the workers assert under America/New_York.
 */
export const pinConfiguredClock = (zone: unknown): void => {
  if (typeof zone !== "string" || zone === "") {
    throw new Error(
      "Shared corpus world has no configured clock: the fitness project pins TZ in " +
        "vitest.config.ts and global setup must read that same zone back, but resolved " +
        `${JSON.stringify(zone)}. Refusing to build the corpus on the machine's own clock.`,
    );
  }
  process.env.TZ = zone;
  for (const instant of [WINTER, SUMMER]) {
    let expected: number;
    try {
      expected = -zoneOffsetMinutes(zone, instant);
    } catch {
      throw new Error(
        `Shared corpus world cannot pin the configured clock: "${zone}" is not a resolvable ` +
          "time zone, so the corpus would be built on the machine's own clock.",
      );
    }
    const actual = new Date(instant).getTimezoneOffset();
    if (actual !== expected) {
      throw new Error(
        `Shared corpus world clock did not take: at ${instant} the process reports offset ` +
          `${actual} while the configured zone "${zone}" is ${expected}.`,
      );
    }
  }
  if (
    new Date(WINTER).getTimezoneOffset() === 0 &&
    new Date(SUMMER).getTimezoneOffset() === 0
  ) {
    throw new Error(
      "Shared corpus world would be built on a UTC clock. The fitness project pins " +
        "TZ in vitest.config.ts; global setup must resolve that same non-UTC zone.",
    );
  }
};

/**
 * The builder is a PARAMETER so the sharing fence can prove this wiring -
 * provided once, rebuilt on this project's rerun, never on another's - against a
 * counted double instead of paying two more real validations to observe it.
 * Vitest calls global setup with the project alone, so the shipped run always
 * takes the default, and that the default builds a REAL world is proven by the
 * fences that read the injected one rather than asserted here.
 */
export default function setup(
  project: TestProject,
  buildWorld: () => CorpusWorld | UnavailableCorpusWorld = buildCorpusWorld,
): void {
  pinConfiguredClock(project.config.env?.TZ);
  project.provide("corpusWorld", buildWorld());
  project.onTestsRerun((specifications: TestSpecification[]) => {
    if (specifications.some((spec) => spec.project.name === project.name)) {
      project.provide("corpusWorld", buildWorld());
    }
  });
}
