import { join } from "node:path";
import { canonicalJson, type JsonValue } from "../../src/contracts/decision-core/serialization";
import { sha256 } from "./_util";
import type { Taxonomy } from "./defects";
import type { GeneratedFile } from "./generate";
import {
  freshnessPolicySemanticDigest,
  REAL_DERIVED_FRESHNESS_POLICY_VERSION,
} from "./real-derived-policy";
import {
  REAL_DERIVED_SEMANTIC_DIGEST_PREIMAGE_VERSION,
  realDerivedSemanticContractBinding,
  type RealDerivedSemanticContractBinding,
} from "./semantic-contract";
import { CORPUS_SEED } from "./seed";
import { parseStrictJson } from "./strict-json";
import { readRepositoryFile } from "./tree";
import { REPO_ROOT, SPEC_DIR, SPEC_FILES, type LoadedSpec } from "./world";

export const CORPUS_DIGEST_PREIMAGE_VERSION = "verin-corpus/1.12.0";
export const TAXONOMY_DIGEST_PREIMAGE_VERSION = "verin-defect-taxonomy/1.0.0";
export const REAL_DERIVED_SCHEMA_DIGEST_PREIMAGE_VERSION = "verin-real-derived-schema-digest/1.0.0";
export const REAL_DERIVED_SCHEMA_FILES = ["real-derived-case-schema.json", "real-derived-replay-schema.json"] as const;
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
export interface FreshnessPolicyBinding { readonly version: string; readonly digest: string }
export interface RealDerivedSchemaBinding { readonly id: string; readonly digest: string }
export const currentFreshnessPolicyBinding = (): FreshnessPolicyBinding => ({
  version: REAL_DERIVED_FRESHNESS_POLICY_VERSION, digest: freshnessPolicySemanticDigest(),
});

/** The versioned semantics a corpus is digested UNDER, resolved from the
 * repository that executes the validation. One resolved value passed explicitly
 * is what makes two digests over the same inventory the same object rather than
 * two independent rebuilds of the same ~50 hashed files. */
export interface CorpusAuthorityBindings {
  readonly freshnessPolicy: FreshnessPolicyBinding;
  readonly realDerivedSchemas: readonly RealDerivedSchemaBinding[];
  readonly semanticContract: RealDerivedSemanticContractBinding;
}
export const currentAuthorityBindings = (): CorpusAuthorityBindings => ({
  freshnessPolicy: currentFreshnessPolicyBinding(),
  realDerivedSchemas: realDerivedSchemaBindings(),
  semanticContract: realDerivedSemanticContractBinding(),
});

export function realDerivedSchemaBindings(
  rawBytes: Readonly<Record<string, string>> = Object.fromEntries(
    REAL_DERIVED_SCHEMA_FILES.map((name) => [
      name,
      readRepositoryFile(join(SPEC_DIR, name), REPO_ROOT),
    ]),
  ),
): RealDerivedSchemaBinding[] {
  return REAL_DERIVED_SCHEMA_FILES.map((name) => {
    const bytes = rawBytes[name];
    if (bytes === undefined) throw new Error(`missing real-derived schema bytes for ${name}`);
    const schema = parseStrictJson(
      bytes,
      name,
    ) as JsonValue & { $id?: unknown };
    if (typeof schema.$id !== "string" || schema.$id.length === 0)
      throw new Error(`${name}: real-derived schema requires a non-empty $id`);
    const preimage: JsonValue = {
      hashKind: "verin-real-derived-json-schema", preimageVersion: REAL_DERIVED_SCHEMA_DIGEST_PREIMAGE_VERSION,
      payload: { id: schema.$id, bytesDigest: sha256(bytes), schema },
    };
    return { id: schema.$id, digest: sha256(canonicalBytes(preimage, `${name} semantic preimage`)) };
  });
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
  authority: CorpusAuthorityBindings = currentAuthorityBindings(),
): string {
  const { freshnessPolicy, realDerivedSchemas, semanticContract } = authority;
  const preimage: JsonValue = {
    hashKind: "verin-corpus",
    preimageVersion: CORPUS_DIGEST_PREIMAGE_VERSION,
    payload: {
      corpusVersion,
      seed,
      taxonomyDigest,
      freshnessPolicy: { ...freshnessPolicy },
      realDerivedSchemas: realDerivedSchemas.map((schema) => ({ ...schema })),
      realDerivedSemanticContract: {
        version: semanticContract.version,
        digest: semanticContract.digest,
        dataDigest: semanticContract.dataDigest,
        executableAuthorities:
          semanticContract.executableAuthorities.map((entry) => ({
            ...entry,
          })),
      },
      cases: [...entries]
        .sort((left, right) => (left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0))
        .map((entry) => [
          entry.partition, entry.caseId, entry.digest, entry.labelKind, entry.labelId,
        ] as unknown as JsonValue),
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
      specFiles: SPEC_FILES.map((name) => {
        const bytes = rawBytes[name];
        if (bytes === undefined) throw new Error(`missing corpus spec bytes for ${name}`);
        return [name, sha256(bytes)] as unknown as JsonValue;
      }),
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
const SIGNATURE_FIELDS = new Set(["signedBy", "signedAt", "signedDigest"]);
export function generatedSignatureProblems(
  files: readonly GeneratedFile[],
): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const pending: Array<{ value: JsonValue; path: string }> = [
      { value: file.value, path: file.relPath },
    ];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (Array.isArray(current.value)) {
        current.value.forEach((value, index) =>
          pending.push({ value, path: `${current.path}[${index}]` }),
        );
      } else if (
        current.value !== null &&
        typeof current.value === "object"
      ) {
        for (const [key, value] of Object.entries(current.value)) {
          const path = `${current.path}.${key}`;
          if (SIGNATURE_FIELDS.has(key)) {
            problems.push(
              `${path}: generated artifacts cannot contain signature fields`,
            );
          }
          pending.push({ value, path });
        }
      }
    }
  }
  return problems;
}
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
  adr: "docs/adr/0039-synthetic-corpus-and-provenance-split.md",
  procedure: "docs/corpus-scrub-procedure.md",
} as const;
export function buildManifest(
  spec: LoadedSpec,
  taxonomy: Taxonomy,
  inventory: readonly CaseInventoryEntry[],
  seed: string = CORPUS_SEED,
  authority: CorpusAuthorityBindings = currentAuthorityBindings(),
): GeneratedFile {
  const synthetic = inventory.filter((entry) => entry.partition === "synthetic");
  const realDerived = inventory.filter((entry) => entry.partition === "real-derived");
  const defects = synthetic.filter((entry) => entry.labelKind === "defect");
  const controls = synthetic.filter((entry) => entry.labelKind === "clean-control");
  const realDefects = realDerived.filter((entry) => entry.labelKind === "defect");
  const realControls = realDerived.filter((entry) => entry.labelKind === "clean-control");
  const generator = generatorDigest(seed, spec.rawBytes);
  const taxonomyDigest = taxonomySemanticDigest(taxonomy);
  const { freshnessPolicy, realDerivedSchemas, semanticContract } = authority;
  const value: JsonValue = {
    __generated: {
      generator: "scripts/corpus-generate.ts",
      command: "pnpm corpus:generate",
      handOwnedInput: [
        ...SPEC_FILES.map((name) => `fixtures/corpus/spec/${name}`),
        ...REAL_DERIVED_SCHEMA_FILES.map(
          (name) => `fixtures/corpus/spec/${name}`,
        ),
      ],
      seed,
      generatorDigest: generator,
      corpusVersion: spec.world.corpusVersion,
    },
    corpusVersion: spec.world.corpusVersion,
    seed,
    asOf: spec.world.clock.asOf,
    timeZone: spec.world.clock.timeZone,
    timeZoneDataVersion: spec.world.clock.timeZoneDataVersion,
    corpusDigest: corpusDigest(
      spec.world.corpusVersion,
      seed,
      taxonomyDigest,
      inventory,
      authority,
    ),
    taxonomyDigest,
    taxonomyDigestPreimageVersion: TAXONOMY_DIGEST_PREIMAGE_VERSION,
    freshnessPolicyVersion: freshnessPolicy.version,
    freshnessPolicyDigest: freshnessPolicy.digest,
    realDerivedSchemaDigestPreimageVersion:
      REAL_DERIVED_SCHEMA_DIGEST_PREIMAGE_VERSION,
    realDerivedSchemas: realDerivedSchemas.map((schema) => ({ ...schema })),
    realDerivedSemanticContractDigestPreimageVersion:
      REAL_DERIVED_SEMANTIC_DIGEST_PREIMAGE_VERSION,
    realDerivedSemanticContractVersion: semanticContract.version,
    realDerivedSemanticContractDigest: semanticContract.digest,
    realDerivedSemanticContractDataDigest: semanticContract.dataDigest,
    realDerivedSemanticContractAuthorities:
      semanticContract.executableAuthorities.map((entry) => ({ ...entry })),
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
