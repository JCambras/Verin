import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalJson,
  type JsonValue,
} from "../../src/contracts/decision-core/serialization";
import { REAL_DERIVED_EVIDENCE_KINDS } from "./real-derived-policy";
import { parseStrictJson } from "./strict-json";
import { readRepositoryFile } from "./tree";
import { REPO_ROOT, SPEC_DIR } from "./world";

export const REAL_DERIVED_SEMANTIC_CONTRACT_FILE =
  "real-derived-semantic-contract.json";
export const REAL_DERIVED_SEMANTIC_DIGEST_PREIMAGE_VERSION =
  "verin-real-derived-semantics-digest/1.0.0";
export const REAL_DERIVED_EXECUTABLE_AUTHORITY_ROOT_FILES = [
  "scripts/corpus/validate.ts",
  "scripts/corpus/real-derived.ts",
  "scripts/corpus/semantic-contract.ts",
  "scripts/corpus/real-derived-semantics.ts",
  "scripts/corpus/evidence-observation.ts",
  "scripts/corpus/synthetic-semantics.ts",
  "scripts/corpus/synthetic-identity.ts",
  "scripts/corpus/case-spec.ts",
  "scripts/corpus/world.ts",
  "scripts/corpus/world-topology.ts",
  "scripts/corpus/graph.ts",
  "scripts/corpus/report.ts",
  "scripts/corpus/real-derived-topology.ts",
  "scripts/corpus/scrub-contract.ts",
  "scripts/corpus/pending-actions.ts",
  "scripts/corpus/selected-funding.ts",
  "scripts/corpus/real-derived-policy.ts",
] as const;

export const REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES = [
  "scripts/corpus/case-spec.ts",
  "scripts/corpus/clock.ts",
  "scripts/corpus/conflict-keys.ts",
  "scripts/corpus/defects.ts",
  "scripts/corpus/entities.ts",
  "scripts/corpus/evidence-observation.ts",
  "scripts/corpus/generate.ts",
  "scripts/corpus/graph.ts",
  "scripts/corpus/instruction-conflicts.ts",
  "scripts/corpus/manifest.ts",
  "scripts/corpus/pending-actions.ts",
  "scripts/corpus/real-derived-policy.ts",
  "scripts/corpus/real-derived.ts",
  "scripts/corpus/real-derived-semantics.ts",
  "scripts/corpus/real-derived-topology.ts",
  "scripts/corpus/report.ts",
  "scripts/corpus/scrub-contract.ts",
  "scripts/corpus/seed.ts",
  "scripts/corpus/selected-funding.ts",
  "scripts/corpus/semantic-contract.ts",
  "scripts/corpus/signoff.ts",
  "scripts/corpus/strict-json.ts",
  "scripts/corpus/subgraph.ts",
  "scripts/corpus/synthetic-evidence-integrity.ts",
  "scripts/corpus/synthetic-identity.ts",
  "scripts/corpus/synthetic-instruction-topology.ts",
  "scripts/corpus/synthetic-pending.ts",
  "scripts/corpus/synthetic-semantics.ts",
  "scripts/corpus/synthetic-structural-context.ts",
  "scripts/corpus/tree.ts",
  "scripts/corpus/validate.ts",
  "scripts/corpus/world-topology.ts",
  "scripts/corpus/world.ts",
  "scripts/golden-cases.lib.ts",
  "src/contracts/decision-core/actor.ts",
  "src/contracts/decision-core/authority.ts",
  "src/contracts/decision-core/decision.ts",
  "src/contracts/decision-core/execution.ts",
  "src/contracts/decision-core/explanation.ts",
  "src/contracts/decision-core/ids.ts",
  "src/contracts/decision-core/normalization.ts",
  "src/contracts/decision-core/serialization.ts",
  "src/contracts/decision-core/trigger.ts",
  "src/contracts/iana-time-zone-links-2026b.json",
  "src/contracts/iana-time-zones-2026b.json",
  "src/contracts/errors.ts",
  "src/contracts/result.ts",
  "src/contracts/time-zone.ts",
] as const;

export const TREATMENT_SELECTOR_VALUES = {
  fixed: ["fixed"],
  "authority-state": ["effective", "ineffective"],
  "reserve-state": ["modeled-scalar", "modeled-segmented", "missing"],
  "pending-availability": [
    "unchanged",
    "settled-incoming-included",
    "settled-incoming-excluded",
    "settled-outgoing-included",
    "settled-outgoing-excluded",
  ],
  "threshold-comparator": ["strict", "inclusive"],
} as const;

const TreatmentSelectorSchema = z.enum([
  "fixed",
  "authority-state",
  "reserve-state",
  "pending-availability",
  "threshold-comparator",
]);

const SemanticContractSchema = z.strictObject({
  contractVersion: z.literal("verin-real-derived-semantics/1.13.0"),
  defectRules: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    contextRule: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    treatmentSelector: TreatmentSelectorSchema,
    treatments: z.array(z.strictObject({
      selectorValue: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      expectedTreatment: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      defectTreatment: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    })).min(1),
  })).min(1),
  evidencePlanes: z.array(z.strictObject({
    plane: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    evidenceKind: z.enum(REAL_DERIVED_EVIDENCE_KINDS),
  })).min(1),
  funding: z.strictObject({
    selection: z.literal(
      "explicit-account-reference-set-in-both-partitions",
    ),
    sufficiency: z.literal(
      "selected-aggregate-covers-request-reserve-after-exact-once-pending-action-accounting",
    ),
    taxRisk: z.literal(
      "any-selected-retirement-source-requires-completed-review",
    ),
    arithmetic: z.literal("exact-safe-integer-minor-units"),
  }),
  topology: z.strictObject({
    referenceIdentity: z.literal("entity-kind-scoped"),
    tenantScope: z.literal(
      "case-request-reservations-share-one-firm-reference",
    ),
    genericSubjects: z.literal("exclude-firm-references"),
    syntheticIdentity: z.literal(
      "typed-raw-bytes-candidates-and-household-bindings",
    ),
    sourceAccount: z.literal(
      "must-resolve-once-to-request-household",
    ),
    selectedFunding: z.literal(
      "must-resolve-once-to-request-household",
    ),
    realDerivedSelectedFundingOwner: z.literal(
      "must-share-owner-with-request-source",
    ),
    materialEvidence: z.literal(
      "kind-subject-source-observation-exactly-once",
    ),
    instructionConflict: z.literal(
      "derived-from-request-bound-typed-instruction-terms",
    ),
    instructionOwners: z.literal(
      "target-specific-normalized-destination-owner-set",
    ),
    restrictionLifecycle: z.literal(
      "derived-from-effective-instants-at-evaluation",
    ),
    realDerivedTemporal: z.literal(
      "derive-zone-state-and-local-rendering-from-recorded-iana-registry-and-transition-rules",
    ),
    syntheticTemporal: z.literal(
      "cited-zone-bound-records-cross-declared-transition",
    ),
    syntheticBlastRadius: z.literal(
      "one-cited-instruction-change-reaches-multiple-topology-subjects",
    ),
    pendingAction: z.literal(
      "must-resolve-to-request-household-and-selected-funding",
    ),
    pendingModel: z.literal(
      "must-resolve-to-request-household-and-selected-funding",
    ),
  }),
  outcomes: z.strictObject({
    completeness: z.literal(
      "one-expected-observed-treatment-per-defect-class",
    ),
    defect: z.literal(
      "exactly-one-context-bound-mismatched-treatment",
    ),
    control: z.literal("all-observed-treatments-match-expected"),
    synthetic: z.literal("context-requires-typed-treatment"),
    attribution: z.literal(
      "defect-empty-or-exact-label-singleton",
    ),
  }),
});

export type RealDerivedSemanticContract = z.infer<
  typeof SemanticContractSchema
>;
export type SemanticDefectRule =
  RealDerivedSemanticContract["defectRules"][number];
export type SemanticTreatment =
  SemanticDefectRule["treatments"][number];

export function semanticTreatment(
  rule: SemanticDefectRule,
  selectorValue: string,
): SemanticTreatment {
  const treatment = rule.treatments.find(
    (candidate) => candidate.selectorValue === selectorValue,
  );
  if (treatment === undefined) {
    throw new Error(
      `semantic rule "${rule.id}" has no treatment for selector "${selectorValue}"`,
    );
  }
  return treatment;
}

export interface RealDerivedSemanticContractBinding {
  readonly version: string;
  readonly digest: string;
  readonly dataDigest: string;
  readonly executableAuthorities: readonly {
    readonly file: string;
    readonly digest: string;
  }[];
}

const sha256 = (bytes: string): string =>
  createHash("sha256").update(bytes, "utf8").digest("hex");

export function loadRealDerivedSemanticContract(
  bytes: string = readRepositoryFile(
    join(SPEC_DIR, REAL_DERIVED_SEMANTIC_CONTRACT_FILE),
    REPO_ROOT,
  ),
): RealDerivedSemanticContract {
  return SemanticContractSchema.parse(
    parseStrictJson(bytes, REAL_DERIVED_SEMANTIC_CONTRACT_FILE),
  );
}

export function realDerivedSemanticContractBinding(
  dataBytes: string = readRepositoryFile(
    join(SPEC_DIR, REAL_DERIVED_SEMANTIC_CONTRACT_FILE),
    REPO_ROOT,
  ),
  authorityBytes: Readonly<Record<string, string>> = Object.fromEntries(
    REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES.map((file) => [
      file,
      readRepositoryFile(join(REPO_ROOT, file), REPO_ROOT),
    ]),
  ),
): RealDerivedSemanticContractBinding {
  const contract = loadRealDerivedSemanticContract(dataBytes);
  const dataDigest = sha256(dataBytes);
  const executableAuthorities =
    REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES.map((file) => {
      const bytes = authorityBytes[file];
      if (bytes === undefined) {
        throw new Error(`missing executable semantic authority ${file}`);
      }
      return { file, digest: sha256(bytes) };
    });
  const preimage: JsonValue = {
    hashKind: "verin-real-derived-semantic-contract",
    preimageVersion: REAL_DERIVED_SEMANTIC_DIGEST_PREIMAGE_VERSION,
    payload: {
      contract,
      dataBytesDigest: dataDigest,
      executableAuthorities: executableAuthorities.map(
        (entry) => [entry.file, entry.digest] as unknown as JsonValue,
      ),
    },
  };
  const serialized = canonicalJson(preimage);
  if (!serialized.ok) {
    throw new Error(
      `real-derived semantic contract is not canonically serializable: ${serialized.error.message}`,
    );
  }
  return {
    version: contract.contractVersion,
    digest: sha256(serialized.value),
    dataDigest,
    executableAuthorities,
  };
}
