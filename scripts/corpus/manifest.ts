/**
 * CORPUS DIGESTS AND MANIFEST (v3 prompt 11, ADR-0034).
 *
 * Three digests, deliberately distinct and domain-separated (the
 * `fixtures/decision-core/` precedent):
 *
 *  - `caseDigest`      SHA-256 over one case's canonical bytes.
 *  - `corpusDigest`    SHA-256 over {corpusVersion, seed, sorted [caseId, digest]}
 *                      - the corpus VERSION identity the captain signs against.
 *                      Any regeneration that changes it invalidates the signoff.
 *  - `generatorDigest` SHA-256 over the hand-owned spec bytes, so a spec edit is
 *                      visible even if the outputs were hand-restored.
 *
 * The manifest carries NO signature. Signoff lives in the hand-owned
 * `spec/SIGNOFF.md` and is bound to `corpusDigest` by the validator, so no
 * generated file can ever contain a `signedBy` value (agents never sign).
 */
import { createHash } from "node:crypto";
import { canonicalJson, type JsonValue } from "../../src/contracts/decision-core/serialization";
import type { GeneratedFile } from "./generate";
import { CORPUS_SEED } from "./seed";
import { SPEC_FILES, type LoadedSpec } from "./world";

export const CORPUS_DIGEST_PREIMAGE_VERSION = "verin-corpus/1.0.0";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const canonicalBytes = (value: JsonValue, what: string): string => {
  const result = canonicalJson(value);
  if (!result.ok) throw new Error(`corpus manifest: ${what} is not canonically serializable: ${result.error.message}`);
  return result.value;
};

/** SHA-256 over a case file's committed canonical bytes (newline included). */
export const caseDigest = (bytes: string): string => sha256(bytes);

export interface CaseInventoryEntry {
  readonly caseId: string;
  readonly file: string;
  readonly digest: string;
  readonly labelKind: "defect" | "clean-control";
  readonly labelId: string;
}

export function corpusDigest(
  corpusVersion: string,
  seed: string,
  entries: readonly CaseInventoryEntry[],
): string {
  const preimage: JsonValue = {
    hashKind: "verin-corpus",
    preimageVersion: CORPUS_DIGEST_PREIMAGE_VERSION,
    payload: {
      corpusVersion,
      seed,
      cases: [...entries]
        .sort((left, right) => (left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0))
        .map((entry) => [entry.caseId, entry.digest] as unknown as JsonValue),
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

/** One inventory shape, shared by the manifest and the validator, so the digest
 * the manifest records and the digest the validator recomputes cannot drift. */
export const buildInventory = (files: readonly GeneratedFile[]): CaseInventoryEntry[] =>
  files.map((file) => {
    const value = file.value as Record<string, JsonValue>;
    const label = value.label as { kind: "defect" | "clean-control"; defectClassId?: string };
    return {
      caseId: String(value.caseId),
      file: file.relPath,
      digest: caseDigest(file.bytes),
      labelKind: label.kind,
      labelId: label.kind === "defect" ? String(label.defectClassId) : "clean-control",
    };
  });

/** The deferral this corpus ships with, mirrored from ADR-0034 so a reader of the
 * manifest alone learns why the real-derived partition is empty. */
export const REAL_DERIVED_DEFERRAL = {
  status: "deferred-pending-authorized-source",
  unDeferTrigger:
    "The captain authorizes a scrubbed source of real NIGO returns, custodian rejections, or operational exceptions, names an accountable owner for extraction and de-identification, and agrees a delivery date and review path.",
  decidedBy: "captain ruling, 2026-07-28",
  adr: "docs/adr/0034-synthetic-corpus-and-provenance-split.md",
  procedure: "docs/corpus-scrub-procedure.md",
} as const;

/**
 * The manifest. `inventory` is injectable so the validator can hash the SAME
 * array instance it hands here - the manifest's `corpusDigest` and the digest the
 * validator recomputes are then provably over one object, not two coincidentally
 * equal recomputations.
 */
export function buildManifest(
  spec: LoadedSpec,
  files: readonly GeneratedFile[],
  seed: string = CORPUS_SEED,
  inventory: readonly CaseInventoryEntry[] = buildInventory(files),
): GeneratedFile {
  const defects = inventory.filter((entry) => entry.labelKind === "defect");
  const controls = inventory.filter((entry) => entry.labelKind === "clean-control");
  const generator = generatorDigest(seed, spec.rawBytes);
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
    corpusDigest: corpusDigest(spec.world.corpusVersion, seed, inventory),
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
        total: inventory.length,
        defectCases: defects.length,
        cleanControls: controls.length,
        cases: inventory.map((entry) => ({
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
        total: 0,
        defectCases: 0,
        cleanControls: 0,
        cases: [],
        deferral: REAL_DERIVED_DEFERRAL as unknown as JsonValue,
      },
    },
  };
  return { relPath: "manifest.json", value, bytes: `${canonicalBytes(value, "manifest")}\n` };
}
