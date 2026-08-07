import { join } from "node:path";
import { defectClassIds } from "../../../scripts/corpus/defects";
import { validateCorpus } from "../../../scripts/corpus/validate";
import { loadGoldenCases, loadScenarioRefs } from "../../../scripts/golden-cases.lib";
import { REPO_ROOT } from "./_fence-utils";

/** The one validated read of the committed corpus the fence files share. */
export const CORPUS_MANIFEST = join(REPO_ROOT, "fixtures/corpus/manifest.json");
export const SCENARIOS = join(REPO_ROOT, "config/demo/scenarios.yaml");

export const real = validateCorpus();
export const refs = loadScenarioRefs();
export const goldenIds = new Set(loadGoldenCases().map((e) => String((e.data as Record<string, unknown>).caseId)));
export const classes = defectClassIds(real.taxonomy);
