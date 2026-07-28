/**
 * CORPUS VALIDATOR CORE (v3 prompt 11, ADR-0034).
 *
 * The single authority for "what a corpus must satisfy", imported by BOTH the
 * runner (`scripts/corpus-validate.ts`, the blocking `corpus` CI job) and the
 * four fitness fences - so the check that runs in CI and the check that is
 * adversarially proven are the same code, exactly as `golden-cases.lib.ts` does
 * for the signed truth set.
 *
 * Every function takes injected data and returns problems, so a companion can
 * feed deliberately broken input and prove incomplete work CANNOT pass
 * (charter #4).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadGoldenCases, loadScenarioRefs } from "../golden-cases.lib";
import { deriveFreshness, diffSeconds, epochMs, isLocalWeekend, isWithinRecentChangeWindow, renderLocal } from "./clock";
import { CLEAN_CONTROL_ID, defectClassIds, loadTaxonomy, type Taxonomy } from "./defects";
import { generateSyntheticCases, type GeneratedFile } from "./generate";
import { buildInventory, corpusDigest, buildManifest, generatorDigest } from "./manifest";
import { CORPUS_SEED } from "./seed";
import { realDerivedCaseProblems } from "./scrub-contract";
import { loadSignoff, signoffProblems, type CorpusSignoff } from "./signoff";
import { CORPUS_DIR, REAL_DERIVED_DIR, SYNTHETIC_DIR, loadSpec, type LoadedSpec } from "./world";

export interface CommittedFile {
  readonly relPath: string;
  readonly bytes: string;
}

const readJsonFiles = (dir: string, prefix: string): CommittedFile[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => ({ relPath: `${prefix}/${name}`, bytes: readFileSync(join(dir, name), "utf8") }))
    : [];

export const readCommittedCorpus = (root: string = CORPUS_DIR): CommittedFile[] => [
  ...(existsSync(join(root, "manifest.json"))
    ? [{ relPath: "manifest.json", bytes: readFileSync(join(root, "manifest.json"), "utf8") }]
    : []),
  ...readJsonFiles(join(root, "synthetic"), "synthetic"),
];

/** (1) Regenerate-and-compare: any hand edit to a generated file fails here.
 * This is the real enforcement of generated-file ownership; the `.gitattributes`
 * marking and the READMEs are signposts, not mechanisms. */
export function committedBytesProblems(
  generated: readonly GeneratedFile[],
  committed: readonly CommittedFile[],
): string[] {
  const problems: string[] = [];
  const committedByPath = new Map(committed.map((file) => [file.relPath, file.bytes]));
  for (const file of generated) {
    const bytes = committedByPath.get(file.relPath);
    if (bytes === undefined) {
      problems.push(`${file.relPath}: generated but not committed - run \`pnpm corpus:generate\``);
      continue;
    }
    if (bytes !== file.bytes) {
      problems.push(
        `${file.relPath}: committed bytes differ from regeneration (${bytes.length} vs ${file.bytes.length} bytes) - generated files are never hand-edited`,
      );
    }
  }
  const generatedPaths = new Set(generated.map((file) => file.relPath));
  for (const file of committed) {
    if (!generatedPaths.has(file.relPath)) {
      problems.push(`${file.relPath}: committed but no longer generated - delete it or restore its spec entry`);
    }
  }
  return problems;
}

interface EmittedEvidence {
  id: string;
  kind: string;
  observedAt: string;
  retrievedAt: string;
  observedAtLocal: string;
  retrievalLagSeconds: number;
  freshness: string;
  withinRecentChangeWindow: boolean;
}

interface EmittedCase {
  caseId: string;
  provenance: string;
  partition: string;
  label: { kind: string; defectClassId?: string };
  trigger: { asOf: string; timeZone: string; timeZoneDataVersion: string; asOfLocal: string };
  request: { settlementEarliest: string; deadline: string; deadlineFeasible: boolean; idempotencyKey: string };
  reservations: Array<{ family: string; conflictKey: string; firmId: string; reservationId: string }>;
  evidence: EmittedEvidence[];
}

/** (2) Labeling and disjointness: charter #3 plus the design's rule that the
 * signed golden 16 are never counted in a corpus denominator. */
export function labelProblems(
  cases: readonly EmittedCase[],
  taxonomy: Taxonomy,
  provenanceLabels: ReadonlySet<string>,
  goldenCaseIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const classes = defectClassIds(taxonomy);
  const seen = new Set<string>();
  for (const item of cases) {
    const where = item.caseId;
    if (!provenanceLabels.has(item.provenance)) {
      problems.push(`${where}: provenance "${item.provenance}" is not a config/demo/scenarios.yaml provenance label`);
    }
    if (item.provenance !== "synthetic-fixture") {
      problems.push(`${where}: a synthetic-partition case must carry provenance "synthetic-fixture"`);
    }
    if (item.partition !== "synthetic") {
      problems.push(`${where}: partition "${item.partition}" does not match its directory`);
    }
    if (item.label.kind === "defect") {
      if (!classes.has(String(item.label.defectClassId))) {
        problems.push(`${where}: defect class "${item.label.defectClassId}" is outside the closed taxonomy`);
      }
    } else if (item.label.kind !== CLEAN_CONTROL_ID) {
      problems.push(`${where}: label kind "${item.label.kind}" is neither "defect" nor "${CLEAN_CONTROL_ID}"`);
    }
    if (goldenCaseIds.has(item.caseId)) {
      problems.push(`${where}: collides with a signed golden case id - the corpus and the golden set are disjoint`);
    }
    if (seen.has(item.caseId)) problems.push(`${where}: duplicate case id`);
    seen.add(item.caseId);
  }
  if (cases.length > 0 && !cases.some((item) => item.label.kind === CLEAN_CONTROL_ID)) {
    problems.push(
      "corpus: no labeled clean controls - a coverage figure without a false-positive rate is not a measurement (captain ruling 2026-07-28)",
    );
  }
  return problems;
}

/** (3) The six timestamp-realism rules (design §4.6), applied to every case. */
export function timestampProblems(cases: readonly EmittedCase[], spec: LoadedSpec): string[] {
  const problems: string[] = [];
  const clock = spec.world.clock;
  for (const item of cases) {
    const where = item.caseId;
    if (item.trigger.asOf !== clock.asOf) {
      problems.push(`${where}: trigger.asOf "${item.trigger.asOf}" is not the world clock "${clock.asOf}"`);
    }
    if (item.trigger.asOfLocal !== renderLocal(clock.asOf, clock.transitions)) {
      problems.push(`${where}: trigger.asOfLocal does not match the pinned time-zone transitions`);
    }
    if (item.trigger.timeZoneDataVersion !== clock.timeZoneDataVersion) {
      problems.push(`${where}: trigger.timeZoneDataVersion is not the pinned tzdb release`);
    }
    if (isLocalWeekend(item.request.settlementEarliest, clock.transitions)) {
      problems.push(`${where}: settlementEarliest lands on a weekend in ${clock.timeZone}`);
    }
    const expectedFeasible = epochMs(item.request.deadline) >= epochMs(item.request.settlementEarliest);
    if (item.request.deadlineFeasible !== expectedFeasible) {
      problems.push(`${where}: deadlineFeasible is ${item.request.deadlineFeasible} but the deadline/settlement pair says ${expectedFeasible}`);
    }
    for (const evidence of item.evidence) {
      const timing = spec.world.evidenceKinds[evidence.kind];
      if (timing === undefined) {
        problems.push(`${where}/${evidence.id}: evidence kind "${evidence.kind}" has no timing band`);
        continue;
      }
      if (epochMs(evidence.observedAt) > epochMs(item.trigger.asOf)) {
        problems.push(`${where}/${evidence.id}: observedAt "${evidence.observedAt}" postdates the trigger - evidence cannot observe the future`);
      }
      const lag = diffSeconds(evidence.retrievedAt, evidence.observedAt);
      if (lag <= 0) {
        problems.push(`${where}/${evidence.id}: retrievedAt does not follow observedAt (lag ${lag}s)`);
      }
      const triggerLag = diffSeconds(evidence.retrievedAt, item.trigger.asOf);
      if (triggerLag < timing.minRetrievalLagSeconds || triggerLag > timing.maxRetrievalLagSeconds) {
        problems.push(
          `${where}/${evidence.id}: retrieval lag ${triggerLag}s is outside the committed ${evidence.kind} band [${timing.minRetrievalLagSeconds}, ${timing.maxRetrievalLagSeconds}]`,
        );
      }
      if (evidence.retrievalLagSeconds !== triggerLag) {
        problems.push(`${where}/${evidence.id}: retrievalLagSeconds ${evidence.retrievalLagSeconds} disagrees with the emitted timestamps`);
      }
      const expectedFreshness = deriveFreshness(item.trigger.asOf, evidence.observedAt, timing);
      if (evidence.freshness !== expectedFreshness) {
        problems.push(
          `${where}/${evidence.id}: freshness "${evidence.freshness}" but the ${timing.freshnessWindowDays}-day window computes "${expectedFreshness}"`,
        );
      }
      const expectedRecent = isWithinRecentChangeWindow(item.trigger.asOf, evidence.observedAt, clock.recentChangeWindowDays);
      if (evidence.withinRecentChangeWindow !== expectedRecent) {
        problems.push(`${where}/${evidence.id}: withinRecentChangeWindow disagrees with the ${clock.recentChangeWindowDays}-day window`);
      }
      if (evidence.observedAtLocal !== renderLocal(evidence.observedAt, clock.transitions)) {
        problems.push(`${where}/${evidence.id}: observedAtLocal does not match the pinned time-zone transitions`);
      }
    }
  }
  return problems;
}

/** (4) Canonical identity: every emitted string equals its NFC form. */
export function nfcProblems(files: readonly CommittedFile[]): string[] {
  return files
    .filter((file) => file.bytes !== file.bytes.normalize("NFC"))
    .map((file) => `${file.relPath}: contains non-NFC bytes - two spellings of one name must not be two subjects`);
}

/** (5) The honestly empty real-derived partition and its fail-closed intake. */
export function realDerivedProblems(taxonomy: Taxonomy, dir: string = REAL_DERIVED_DIR): string[] {
  const problems: string[] = [];
  if (!existsSync(join(dir, "README.md"))) {
    problems.push("real-derived/README.md is missing - the intake contract must ship with the empty partition");
  }
  const classes = defectClassIds(taxonomy);
  for (const file of readJsonFiles(dir, "real-derived")) {
    problems.push(...realDerivedCaseProblems(JSON.parse(file.bytes), classes, file.relPath));
  }
  return problems;
}

export interface CorpusValidation {
  readonly spec: LoadedSpec;
  readonly taxonomy: Taxonomy;
  readonly generated: readonly GeneratedFile[];
  readonly manifest: GeneratedFile;
  readonly cases: readonly EmittedCase[];
  readonly signoff: CorpusSignoff;
  readonly corpusDigest: string;
  readonly problems: readonly string[];
}

/** The whole check, over the committed tree. */
export function validateCorpus(root: string = CORPUS_DIR, seed: string = CORPUS_SEED): CorpusValidation {
  const spec = loadSpec(join(root, "spec"));
  const taxonomy = loadTaxonomy(join(root, "spec"));
  const generated = generateSyntheticCases(spec, seed);
  const manifest = buildManifest(spec, generated, seed);
  const committed = readCommittedCorpus(root);
  const cases = generated.map((file) => file.value as unknown as EmittedCase);
  const refs = loadScenarioRefs();
  const goldenCaseIds = new Set(
    loadGoldenCases().map((entry) => String((entry.data as Record<string, unknown>).caseId)),
  );
  const digest = corpusDigest(spec.world.corpusVersion, seed, buildInventory(generated));
  const signoff = loadSignoff(join(root, "spec"));
  const problems = [
    ...committedBytesProblems([...generated, manifest], committed),
    ...labelProblems(cases, taxonomy, refs.provenanceLabels, goldenCaseIds),
    ...timestampProblems(cases, spec),
    ...nfcProblems(committed),
    ...realDerivedProblems(taxonomy, join(root, "real-derived")),
    ...signoffProblems(signoff, spec.world.corpusVersion, digest),
    ...(generatorDigest(seed, spec.rawBytes).length === 64 ? [] : ["generatorDigest is malformed"]),
  ];
  return { spec, taxonomy, generated, manifest, cases, signoff, corpusDigest: digest, problems };
}

export { SYNTHETIC_DIR };
