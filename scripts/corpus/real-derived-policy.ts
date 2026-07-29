import { createHash } from "node:crypto";
import { canonicalJson, type JsonValue } from "../../src/contracts/decision-core/serialization";
import { diffSeconds } from "./clock";

export const REAL_DERIVED_FRESHNESS_POLICY_VERSION =
  "verin-real-derived-freshness/1.0.0";
export const REAL_DERIVED_FRESHNESS_POLICY_DIGEST_VERSION =
  "verin-real-derived-freshness-digest/1.0.0";

export const REAL_DERIVED_EVIDENCE_KINDS = [
  "balance",
  "bank-instruction",
  "household-instruction",
  "planned-withdrawals",
  "pending-actions",
  "restriction",
  "authority",
  "model-assignment",
  "legal-hold",
  "recent-change",
] as const;

export type RealDerivedEvidenceKind =
  (typeof REAL_DERIVED_EVIDENCE_KINDS)[number];

export interface RealDerivedFreshnessPolicy {
  readonly version: string;
  readonly freshnessWindowDays: Readonly<Record<RealDerivedEvidenceKind, number>>;
}

export const REAL_DERIVED_FRESHNESS_POLICY: RealDerivedFreshnessPolicy = {
  version: REAL_DERIVED_FRESHNESS_POLICY_VERSION,
  freshnessWindowDays: {
    balance: 1,
    "bank-instruction": 30,
    "household-instruction": 90,
    "planned-withdrawals": 30,
    "pending-actions": 1,
    restriction: 90,
    authority: 90,
    "model-assignment": 7,
    "legal-hold": 365,
    "recent-change": 7,
  },
};

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

export function freshnessPolicySemanticDigest(
  policy: RealDerivedFreshnessPolicy = REAL_DERIVED_FRESHNESS_POLICY,
): string {
  const serialized = canonicalJson({
    hashKind: "verin-real-derived-freshness-policy",
    preimageVersion: REAL_DERIVED_FRESHNESS_POLICY_DIGEST_VERSION,
    payload: {
      version: policy.version,
      freshnessWindowDays: policy.freshnessWindowDays,
    },
  } as JsonValue);
  if (!serialized.ok) {
    throw new Error(
      `real-derived freshness policy is not canonically serializable: ${serialized.error.message}`,
    );
  }
  return sha256(serialized.value);
}

export function deriveRealDerivedFreshness(
  policyVersion: string,
  evidenceKind: RealDerivedEvidenceKind,
  asOf: string,
  observedAt: string | null,
): "fresh" | "stale" | "unknown" {
  if (policyVersion !== REAL_DERIVED_FRESHNESS_POLICY.version) {
    throw new Error(`unsupported freshness policy "${policyVersion}"`);
  }
  if (observedAt === null) return "unknown";
  const windowDays =
    REAL_DERIVED_FRESHNESS_POLICY.freshnessWindowDays[evidenceKind];
  return diffSeconds(asOf, observedAt) > windowDays * 86_400 ? "stale" : "fresh";
}
