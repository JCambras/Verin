/**
 * CORPUS VALIDATOR CORE (v3 prompt 11, ADR-0052).
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
import { join } from "node:path";
import { loadGoldenCases, loadScenarioRefs } from "../golden-cases.lib";
import { deriveFreshness, diffSeconds, epochMs, isLocalWeekend, isWithinRecentChangeWindow, renderLocal } from "./clock";
import {
  CLEAN_CONTROL_ID,
  defectClassIds,
  loadTaxonomy,
  taxonomyExerciseProblems,
  type Taxonomy,
} from "./defects";
import { generateSyntheticCases, type GeneratedFile } from "./generate";
import { evidenceResolutionProblems } from "./graph";
import {
  buildInventory,
  corpusDigest,
  buildManifest,
  currentAuthorityBindings,
  generatedSignatureProblems,
  REAL_DERIVED_SCHEMA_FILES,
  taxonomySemanticDigest,
  type CaseInventoryEntry,
  type CorpusAuthorityBindings,
} from "./manifest";
import {
  inspectRealDerivedPartition,
  realDerivedDeferralProblems,
  realDerivedProblems,
} from "./real-derived";
import { CORPUS_SEED } from "./seed";
import {
  loadSignoff,
  SIGNOFF_FILE,
  signoffProblems,
  type CorpusSignoff,
} from "./signoff";
import {
  syntheticSemanticProblems,
  type EmittedCase,
} from "./synthetic-semantics";
import { readTree, type TreeEntry } from "./tree";
import { CORPUS_DIR, SPEC_FILES, loadSpec, type LoadedSpec } from "./world";

export interface CommittedFile {
  readonly relPath: string;
  readonly bytes: string;
}

const committedCorpusFiles = (entries: readonly TreeEntry[]): CommittedFile[] =>
  entries
    .filter(
      (entry) =>
        entry.relPath === "manifest.json" ||
        entry.relPath.startsWith("synthetic/"),
    )
    .map((entry) => ({
      relPath: entry.relPath,
      bytes: entry.bytes ?? `<${entry.kind}>`,
    }));

export const readCommittedCorpus = (
  root: string = CORPUS_DIR,
): CommittedFile[] => committedCorpusFiles(readTree(root));

/** The ONLY corpus-root entries no generator emits, no digest binds, and no
 * intake contract governs. Documentation, stated exactly and held both ways: an
 * unlisted entry fails, and a listed one that stops existing fails too. */
export const CORPUS_ROOT_DOCUMENTATION_FILES = ["README.md"] as const;

/** Every other committed byte belongs to one of these accountable buckets:
 * `manifest.json` and `synthetic/**` are regenerated and byte-compared,
 * `spec/**` is digest-bound (`specCoverageProblems`), and `real-derived/**` is
 * governed by the fail-closed intake contract. */
const ACCOUNTED_CORPUS_SUBTREES = ["real-derived/", "spec/", "synthetic/"] as const;

/**
 * (1b) THE COMMITTED CORPUS TREE IS AN EXACT INVENTORY.
 *
 * A file committed outside every accounted-for bucket is checked by nothing: it
 * is not regenerated, not digest-bound, not intake-governed, and not even
 * NFC-scanned - so it could carry corpus-shaped content that no signature moves
 * for. The buckets are named here rather than implied by what each reader
 * happens to select, because "nothing looked at it" is the failure mode this
 * closure exists to make impossible.
 */
export function corpusRootInventoryProblems(entries: readonly TreeEntry[]): string[] {
  const documentation: ReadonlySet<string> = new Set(CORPUS_ROOT_DOCUMENTATION_FILES);
  const present = new Set(entries.map((entry) => entry.relPath));
  return [
    ...entries.flatMap((entry) => {
      if (documentation.has(entry.relPath)) {
        return entry.kind === "file"
          ? []
          : [`${entry.relPath}: allowlisted corpus documentation must be a regular file`];
      }
      return entry.relPath === "manifest.json" ||
          ACCOUNTED_CORPUS_SUBTREES.some((subtree) => entry.relPath.startsWith(subtree))
        ? []
        : [
          `${entry.relPath}: committed corpus entry is outside every accounted-for bucket - nothing generates, digests, or governs it`,
        ];
    }),
    ...CORPUS_ROOT_DOCUMENTATION_FILES.filter((name) => !present.has(name)).map(
      (name) => `${name}: allowlisted corpus documentation is missing from the committed tree`,
    ),
  ];
}

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
      if (epochMs(evidence.recordChangedAt) > epochMs(item.trigger.asOf)) {
        problems.push(`${where}/${evidence.id}: recordChangedAt "${evidence.recordChangedAt}" postdates the trigger`);
      }
      if (epochMs(evidence.recordChangedAt) > epochMs(evidence.observedAt)) {
        problems.push(
          `${where}/${evidence.id}: recordChangedAt "${evidence.recordChangedAt}" postdates observedAt "${evidence.observedAt}" - a source cannot observe a record before its content exists`,
        );
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
      // Recent-change membership is a fact about the RECORD, not about when the
      // source last looked at it: "changed four days ago" must not become "we
      // synced this morning".
      const expectedRecent = isWithinRecentChangeWindow(item.trigger.asOf, evidence.recordChangedAt, clock.recentChangeWindowDays);
      if (evidence.withinRecentChangeWindow !== expectedRecent) {
        problems.push(`${where}/${evidence.id}: withinRecentChangeWindow disagrees with the ${clock.recentChangeWindowDays}-day window`);
      }
      for (const [label, instant, rendered] of [
        ["recordChangedAtLocal", evidence.recordChangedAt, evidence.recordChangedAtLocal],
        ["observedAtLocal", evidence.observedAt, evidence.observedAtLocal],
        ["retrievedAtLocal", evidence.retrievedAt, evidence.retrievedAtLocal],
      ] as const) {
        // A detector over injected data REPORTS; only the generator may abort.
        // An instant outside the pinned table is a finding, not a crash.
        let expectedLocal: string;
        try {
          expectedLocal = renderLocal(instant, clock.transitions);
        } catch (error) {
          problems.push(`${where}/${evidence.id}: ${label} cannot be checked - ${(error as Error).message}`);
          continue;
        }
        if (rendered !== expectedLocal) {
          problems.push(`${where}/${evidence.id}: ${label} does not match the pinned time-zone transitions`);
        }
      }
    }
  }
  return problems;
}

/**
 * (3b) A CLEAN CONTROL MUST NOT CARRY THE DEFECT BEING MEASURED.
 *
 * Controls are the false-positive DENOMINATOR: a control that quietly carries a
 * defect signature makes the very rate it exists to produce uninterpretable, and
 * a correct detector flagging it would read as a false positive. Each rule below
 * is the mechanical signature of one taxonomy class, read off the case's OWN
 * emitted bytes - so the check is over what ships, not over the generator's
 * intent.
 */
export function cleanControlProblems(cases: readonly EmittedCase[]): string[] {
  return syntheticSemanticProblems(
    cases.filter((item) => item.label.kind === CLEAN_CONTROL_ID),
  );
}

/** (4) Canonical identity: every emitted string equals its NFC form. */
export function nfcProblems(files: readonly CommittedFile[]): string[] {
  return files
    .filter((file) => file.bytes !== file.bytes.normalize("NFC"))
    .map((file) => `${file.relPath}: contains non-NFC bytes - two spellings of one name must not be two subjects`);
}

/** The spec subtree as the ONE corpus walk already read it. A second walk would
 * re-read every hand-owned byte - the 1 100-line replay schema included - to
 * learn names this walk already carries, and would answer from a tree that could
 * have moved underneath it. Held equal to an independent `readTree(SPEC_DIR)` by
 * the corpus-provenance-split fence. */
export const specEntryNames = (entries: readonly TreeEntry[]): string[] =>
  entries.flatMap((entry) =>
    entry.relPath.startsWith("spec/") ? [entry.relPath.slice("spec/".length)] : [],
  );

/**
 * (5) EVERY HAND-OWNED SPEC INPUT IS BOUND BY A DIGEST.
 *
 * `generatorDigest` covers `SPEC_FILES`, the schema bindings cover
 * `REAL_DERIVED_SCHEMA_FILES`, and the signoff file is the signature itself. A
 * spec file outside all three is a hand-owned input no digest moves for: the
 * generator may read it, the corpus may change because of it, and the captain's
 * signature would survive the edit - which is the ONE thing `corpusDigest`
 * exists to prevent. Nothing else checks this, because the regenerate-and-
 * byte-compare gate covers GENERATED files and `spec/**` is hand-owned.
 */
export function specCoverageProblems(
  specEntries: readonly string[],
  digested: readonly string[] = [
    ...SPEC_FILES,
    ...REAL_DERIVED_SCHEMA_FILES,
    SIGNOFF_FILE,
  ],
): string[] {
  const bound = new Set(digested);
  return [
    ...specEntries
      .filter((name) => !bound.has(name))
      .map(
        (name) =>
          `spec/${name}: hand-owned corpus input is bound by no digest - register it in SPEC_FILES or a schema binding, or delete it`,
      ),
    ...digested
      .filter((name) => !specEntries.includes(name))
      .map((name) => `spec/${name}: digested corpus input is missing from the committed spec`),
  ];
}

export interface CorpusValidation {
  readonly spec: LoadedSpec;
  readonly taxonomy: Taxonomy;
  readonly generated: readonly GeneratedFile[];
  readonly manifest: GeneratedFile;
  readonly cases: readonly EmittedCase[];
  readonly realDerivedCases: readonly Record<string, unknown>[];
  readonly realDerivedFiles: readonly GeneratedFile[];
  readonly inventory: readonly CaseInventoryEntry[];
  readonly signoff: CorpusSignoff;
  readonly authority: CorpusAuthorityBindings;
  readonly seed: string;
  readonly taxonomyDigest: string;
  readonly corpusDigest: string;
  readonly problems: readonly string[];
}

/** The whole check, over the committed tree. `root` selects the corpus DATA -
 * spec, signoff, generated tree, real-derived intake - and nothing else. The
 * versioned semantics the corpus is checked and digested UNDER are always this
 * repository's, because they are the ones this process executes. */
export function validateCorpus(root: string = CORPUS_DIR, seed: string = CORPUS_SEED): CorpusValidation {
  const spec = loadSpec(join(root, "spec"));
  const taxonomy = loadTaxonomy(join(root, "spec"));
  const generated = generateSyntheticCases(spec, seed);
  const realDerived = inspectRealDerivedPartition(
    taxonomy,
    spec.world.corpusVersion,
    join(root, "real-derived"),
  );
  const realDerivedFiles = realDerived.inventoryFiles;
  // ONE inventory: the manifest's corpusDigest and the digest recomputed here are
  // then provably over the same object, not two equal-by-coincidence rebuilds.
  const inventory = [
    ...buildInventory(generated),
    ...buildInventory(realDerivedFiles, "real-derived"),
  ];
  // ONE authority binding for the same reason: the manifest's digest and the
  // digest recomputed below are then over the same semantics by construction,
  // and the ~50-file authority set is read and hashed once per validation.
  const authority = currentAuthorityBindings();
  const manifest = buildManifest(spec, taxonomy, inventory, seed, authority);
  const corpusEntries = readTree(root);
  const committed = committedCorpusFiles(corpusEntries);
  const cases = generated.map((file) => file.value as unknown as EmittedCase);
  const realDerivedCases = realDerivedFiles.map(
    (file) => file.value as unknown as Record<string, unknown>,
  );
  const refs = loadScenarioRefs();
  const goldenCaseIds = new Set(
    loadGoldenCases().map((entry) => String((entry.data as Record<string, unknown>).caseId)),
  );
  const taxonomyDigest = taxonomySemanticDigest(taxonomy);
  const digest = corpusDigest(
    spec.world.corpusVersion,
    seed,
    taxonomyDigest,
    inventory,
    authority,
  );
  const signoff = loadSignoff(join(root, "spec"));
  const problems = [
    ...committedBytesProblems([...generated, manifest], committed),
    ...corpusRootInventoryProblems(corpusEntries),
    ...labelProblems(cases, taxonomy, refs.provenanceLabels, goldenCaseIds),
    ...taxonomyExerciseProblems(taxonomy, spec.cases),
    ...timestampProblems(cases, spec),
    ...evidenceResolutionProblems(cases),
    ...syntheticSemanticProblems(cases),
    ...nfcProblems([...committed, ...realDerived.delivery.files]),
    ...realDerived.problems,
    ...generatedSignatureProblems([...generated, manifest]),
    ...signoffProblems(signoff, spec.world.corpusVersion, digest),
    ...specCoverageProblems(specEntryNames(corpusEntries)),
  ];
  return {
    spec,
    taxonomy,
    generated,
    manifest,
    cases,
    realDerivedCases,
    realDerivedFiles,
    inventory,
    signoff,
    authority,
    seed,
    taxonomyDigest,
    corpusDigest: digest,
    problems,
  };
}

export {
  realDerivedDeferralProblems,
  realDerivedProblems,
};
