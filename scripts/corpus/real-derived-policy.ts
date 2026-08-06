import { createHash } from "node:crypto";
import { canonicalJson, type JsonValue } from "../../src/contracts/decision-core/serialization";

export const REAL_DERIVED_FRESHNESS_POLICY_VERSION =
  "verin-real-derived-freshness/1.0.0";
export const REAL_DERIVED_FRESHNESS_POLICY_DIGEST_VERSION =
  "verin-real-derived-freshness-digest/1.0.0";

export const REAL_DERIVED_EVIDENCE_KINDS = [
  "request",
  "identity-resolution",
  "balance",
  "bank-instruction",
  "household-instruction",
  "planned-withdrawals",
  "pending-actions",
  "restriction",
  "authority",
  "legal-hold",
  "recent-change",
  "policy",
  "tax-review",
  "time-zone-rule",
  "execution-precondition",
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
    request: 30,
    "identity-resolution": 30,
    balance: 1,
    "bank-instruction": 30,
    "household-instruction": 90,
    "planned-withdrawals": 30,
    "pending-actions": 1,
    restriction: 90,
    authority: 90,
    "legal-hold": 365,
    "recent-change": 7,
    policy: 90,
    "tax-review": 30,
    "time-zone-rule": 365,
    "execution-precondition": 1,
  },
};

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");
const diffSeconds = (later: string, earlier: string): number =>
  (new Date(later).getTime() - new Date(earlier).getTime()) / 1000;

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

/** An evidence kind with no committed window is REFUSED, never defaulted: a
 * missing window makes `observed - asOf > NaN` false, which reads "fresh" for
 * arbitrarily stale evidence in a fail-closed intake path. The vocabulary is
 * held equal to the delivered schema's enum by
 * `evidenceKindVocabularyProblems`, so a delivered case cannot reach here with
 * an unknown kind. */
const freshnessWindowDays = (evidenceKind: RealDerivedEvidenceKind): number => {
  const windows: Readonly<Record<string, number | undefined>> =
    REAL_DERIVED_FRESHNESS_POLICY.freshnessWindowDays;
  const windowDays = windows[evidenceKind];
  if (windowDays === undefined) {
    throw new Error(`unsupported freshness evidence kind "${evidenceKind}"`);
  }
  return windowDays;
};

export function deriveRealDerivedFreshness(
  policyVersion: string,
  evidenceKind: RealDerivedEvidenceKind,
  asOf: string,
  observedAt: string | null,
): "fresh" | "stale" | "unknown" {
  if (policyVersion !== REAL_DERIVED_FRESHNESS_POLICY.version) {
    throw new Error(`unsupported freshness policy "${policyVersion}"`);
  }
  const windowDays = freshnessWindowDays(evidenceKind);
  if (observedAt === null) return "unknown";
  return diffSeconds(asOf, observedAt) > windowDays * 86_400 ? "stale" : "fresh";
}

const enumFromSchema = (schema: unknown): readonly unknown[] | null => {
  const definitions = (schema as { $defs?: unknown } | null)?.$defs;
  const node = (definitions as Record<string, unknown> | undefined)?.evidenceKind;
  const declared = (node as { enum?: unknown } | undefined)?.enum;
  return Array.isArray(declared) ? declared : null;
};

/**
 * THE DELIVERED SCHEMA, THE FRESHNESS WINDOWS, AND THE EXECUTABLE VOCABULARY
 * ARE ONE LIST.
 *
 * The intake schema is bound to this module by a cast (`z.fromJSONSchema(...) as
 * ... RealDerivedCase`), which asserts the coupling rather than checking it. A
 * kind the schema admits but no window covers would be refused only at replay
 * time, deep inside a fail-closed path; a window no schema kind reaches is a
 * rule nobody is holding. Reported, not thrown: this runs over hand-owned intake
 * input alongside the other delivery checks.
 */
export function evidenceKindVocabularyProblems(
  schema: unknown,
  where: string,
): string[] {
  const declared = enumFromSchema(schema);
  if (declared === null) {
    return [`${where}: $defs/evidenceKind declares no enum to bind evidence freshness to`];
  }
  const schemaKinds = declared.map((value) => String(value));
  const executable: readonly string[] = REAL_DERIVED_EVIDENCE_KINDS;
  const windowed = Object.keys(REAL_DERIVED_FRESHNESS_POLICY.freshnessWindowDays);
  return [
    ...(new Set(schemaKinds).size === schemaKinds.length
      ? []
      : [`${where}: $defs/evidenceKind repeats a kind`]),
    ...schemaKinds
      .filter((kind) => !executable.includes(kind))
      .map((kind) => `${where}: evidence kind "${kind}" has no executable freshness authority`),
    ...executable
      .filter((kind) => !schemaKinds.includes(kind))
      .map((kind) => `${where}: executable evidence kind "${kind}" is not admitted by the schema`),
    ...executable
      .filter((kind) => !windowed.includes(kind))
      .map((kind) => `evidence kind "${kind}" has no committed freshness window`),
    ...windowed
      .filter((kind) => !executable.includes(kind))
      .map((kind) => `freshness window "${kind}" is outside the executable evidence vocabulary`),
  ];
}
