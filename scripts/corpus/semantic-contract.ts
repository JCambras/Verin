import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalJson,
  type JsonValue,
} from "../../src/contracts/decision-core/serialization";
import { REAL_DERIVED_EVIDENCE_KINDS } from "./real-derived-policy";
import { parseStrictJson } from "./strict-json";
import { REPO_ROOT, SPEC_DIR } from "./world";

export const REAL_DERIVED_SEMANTIC_CONTRACT_FILE =
  "real-derived-semantic-contract.json";
export const REAL_DERIVED_SEMANTIC_DIGEST_PREIMAGE_VERSION =
  "verin-real-derived-semantics-digest/1.0.0";
export const REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES = [
  "scripts/corpus/real-derived-semantics.ts",
  "scripts/corpus/scrub-contract.ts",
  "scripts/corpus/pending-actions.ts",
  "scripts/corpus/real-derived-policy.ts",
] as const;

const SemanticContractSchema = z.strictObject({
  contractVersion: z.literal("verin-real-derived-semantics/1.0.0"),
  defectRules: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    rule: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })).min(1),
  evidencePlanes: z.array(z.strictObject({
    plane: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    evidenceKind: z.enum(REAL_DERIVED_EVIDENCE_KINDS),
  })).min(1),
  funding: z.strictObject({
    selection: z.literal("explicit-account-reference-set"),
    sufficiency: z.literal(
      "selected-aggregate-covers-request-reserve-and-reducing-pending",
    ),
    taxRisk: z.literal(
      "any-selected-retirement-source-requires-completed-review",
    ),
  }),
  topology: z.strictObject({
    referenceIdentity: z.literal("entity-kind-scoped"),
    sourceAccount: z.literal("must-resolve-in-liquidity-sources"),
    selectedFunding: z.literal(
      "must-resolve-once-to-request-household-and-source-owner",
    ),
    materialEvidence: z.literal("kind-subject-source-exactly-once"),
  }),
});

export type RealDerivedSemanticContract = z.infer<
  typeof SemanticContractSchema
>;

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
  bytes: string = readFileSync(
    join(SPEC_DIR, REAL_DERIVED_SEMANTIC_CONTRACT_FILE),
    "utf8",
  ),
): RealDerivedSemanticContract {
  return SemanticContractSchema.parse(
    parseStrictJson(bytes, REAL_DERIVED_SEMANTIC_CONTRACT_FILE),
  );
}

export function realDerivedSemanticContractBinding(
  dataBytes: string = readFileSync(
    join(SPEC_DIR, REAL_DERIVED_SEMANTIC_CONTRACT_FILE),
    "utf8",
  ),
  authorityBytes: Readonly<Record<string, string>> = Object.fromEntries(
    REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES.map((file) => [
      file,
      readFileSync(join(REPO_ROOT, file), "utf8"),
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
