import { createHash } from "node:crypto";
import { canonicalJson, type JsonValue } from "../../src/contracts/decision-core/serialization";
import type { Taxonomy } from "./defects";
import type { GeneratedFile } from "./generate";
import { CORPUS_SEED } from "./seed";
import { SPEC_FILES, type LoadedSpec } from "./world";

export const CORPUS_DIGEST_PREIMAGE_VERSION = "verin-corpus/1.1.0";
export const TAXONOMY_DIGEST_PREIMAGE_VERSION = "verin-defect-taxonomy/1.0.0";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const canonicalBytes = (value: JsonValue, what: string): string => {
  const result = canonicalJson(value);
  if (!result.ok) throw new Error(`corpus manifest: ${what} is not canonically serializable: ${result.error.message}`);
  return result.value;
};

export const caseDigest = (bytes: string): string => sha256(bytes);

export interface CaseInventoryEntry {
  readonly caseId: string;
  readonly file: string;
  readonly digest: string;
  readonly partition: "synthetic" | "real-derived";
  readonly labelKind: "defect" | "clean-control";
  readonly labelId: string;
}

export function taxonomySemanticDigest(taxonomy: Taxonomy): string {
  const semanticProjection: JsonValue = {
    hashKind: "verin-defect-taxonomy",
    preimageVersion: TAXONOMY_DIGEST_PREIMAGE_VERSION,
    payload: {
      specVersion: taxonomy.specVersion,
      cleanControlLabel: taxonomy.cleanControlLabel,
      defectClasses: [...taxonomy.defectClasses].sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
    },
  };
  return sha256(canonicalBytes(semanticProjection, "taxonomy semantic preimage"));
}

export function corpusDigest(
  corpusVersion: string,
  seed: string,
  taxonomyDigest: string,
  entries: readonly CaseInventoryEntry[],
): string {
  const preimage: JsonValue = {
    hashKind: "verin-corpus",
    preimageVersion: CORPUS_DIGEST_PREIMAGE_VERSION,
    payload: {
      corpusVersion,
      seed,
      taxonomyDigest,
      cases: [...entries]
        .sort((left, right) => (left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0))
        .map((entry) => [entry.partition, entry.caseId, entry.digest] as unknown as JsonValue),
    },
  };
  return sha256(canonicalBytes(preimage, "corpusDigest preimage"));
}

export function generatorDigest(seed: string, rawBytes: Readonly<Record<string, string>>): string {
  const preimage: JsonValue = {
    hashKind: "verin-corpus-generator",
    preimageVersion: CORPUS_DIGEST_PREIMAGE_VERSION,
    payload: {
      seed,
      specFiles: SPEC_FILES.map((name) => [name, sha256(rawBytes[name] ?? "")] as unknown as JsonValue),
    },
  };
  return sha256(canonicalBytes(preimage, "generatorDigest preimage"));
}

export const buildInventory = (
  files: readonly GeneratedFile[],
  partition: CaseInventoryEntry["partition"] = "synthetic",
): CaseInventoryEntry[] =>
  files.map((file) => {
    const value = file.value as Record<string, JsonValue>;
    const label = value.label as { kind: "defect" | "clean-control"; defectClassId?: string };
    return {
      caseId: String(value.caseId),
      file: file.relPath,
      digest: caseDigest(file.bytes),
      partition,
      labelKind: label.kind,
      labelId: label.kind === "defect" ? String(label.defectClassId) : "clean-control",
    };
  });

export const REAL_DERIVED_DEFERRAL: {
  readonly status: string;
  readonly unDeferTrigger: string;
  readonly decidedBy: string;
  readonly adr: string;
  readonly procedure: string;
} | null = {
  status: "deferred-pending-authorized-source",
  unDeferTrigger:
    "The captain authorizes a scrubbed source of real NIGO returns, custodian rejections, or operational exceptions, names an accountable owner for extraction and de-identification, and agrees a delivery date and review path.",
  decidedBy: "captain ruling, 2026-07-28",
  adr: "docs/adr/0034-synthetic-corpus-and-provenance-split.md",
  procedure: "docs/corpus-scrub-procedure.md",
} as const;

export function buildManifest(
  spec: LoadedSpec,
  taxonomy: Taxonomy,
  files: readonly GeneratedFile[],
  seed: string = CORPUS_SEED,
  inventory: readonly CaseInventoryEntry[] = buildInventory(files),
): GeneratedFile {
  const synthetic = inventory.filter((entry) => entry.partition === "synthetic");
  const realDerived = inventory.filter((entry) => entry.partition === "real-derived");
  const defects = synthetic.filter((entry) => entry.labelKind === "defect");
  const controls = synthetic.filter((entry) => entry.labelKind === "clean-control");
  const realDefects = realDerived.filter((entry) => entry.labelKind === "defect");
  const realControls = realDerived.filter((entry) => entry.labelKind === "clean-control");
  const generator = generatorDigest(seed, spec.rawBytes);
  const taxonomyDigest = taxonomySemanticDigest(taxonomy);
  const value: JsonValue = {
    __generated: {
      generator: "scripts/corpus-generate.ts",
      command: "pnpm corpus:generate",
      handOwnedInput: SPEC_FILES.map((name) => `fixtures/corpus/spec/${name}`),
      seed,
      generatorDigest: generator,
      corpusVersion: spec.world.corpusVersion,
    },
    corpusVersion: spec.world.corpusVersion,
    seed,
    asOf: spec.world.clock.asOf,
    timeZone: spec.world.clock.timeZone,
    timeZoneDataVersion: spec.world.clock.timeZoneDataVersion,
    corpusDigest: corpusDigest(spec.world.corpusVersion, seed, taxonomyDigest, inventory),
    taxonomyDigest,
    taxonomyDigestPreimageVersion: TAXONOMY_DIGEST_PREIMAGE_VERSION,
    generatorDigest: generator,
    signoffRef: {
      file: "fixtures/corpus/spec/SIGNOFF.md",
      boundTo: "corpusDigest",
      note: "Signatures live in the hand-owned signoff file; no generated file carries one.",
    },
    partitions: {
      synthetic: {
        provenance: "synthetic-fixture",
        path: "synthetic",
        total: synthetic.length,
        defectCases: defects.length,
        cleanControls: controls.length,
        cases: synthetic.map((entry) => ({
          caseId: entry.caseId,
          file: entry.file,
          digest: entry.digest,
          labelKind: entry.labelKind,
          labelId: entry.labelId,
        })),
      },
      realDerived: {
        provenance: "real-derived-fixture",
        path: "real-derived",
        total: realDerived.length,
        defectCases: realDefects.length,
        cleanControls: realControls.length,
        cases: realDerived.map((entry) => ({
          caseId: entry.caseId,
          file: entry.file,
          digest: entry.digest,
          labelKind: entry.labelKind,
          labelId: entry.labelId,
        })),
        deferral: REAL_DERIVED_DEFERRAL as unknown as JsonValue,
      },
    },
  };
  return { relPath: "manifest.json", value, bytes: `${canonicalBytes(value, "manifest")}\n` };
}
