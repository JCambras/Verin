import { join } from "node:path";
import { inject } from "vitest";
import { REPO_ROOT } from "./_fence-utils";

/** The one validated read of the committed corpus the fence files share -
 * computed ONCE per run by `_corpus-world-setup.ts` and injected here, because
 * vitest isolates modules per test file and a module-scope `validateCorpus()`
 * would re-run the whole validation for every fence that imports it. */
const world = inject("corpusWorld");

export const CORPUS_MANIFEST = join(REPO_ROOT, "fixtures/corpus/manifest.json");
export const SCENARIOS = join(REPO_ROOT, "config/demo/scenarios.yaml");

export const real = world.real;
export const refs = world.refs;
export const goldenIds = world.goldenIds;
export const classes = world.classes;
