/**
 * Immutable evidence snapshots and the decision input bundle (v3 §5; ratified
 * shapes: docs/v3/verin-core-contracts.ts; ADR-0029, D-040).
 *
 * The bundle IS the replay contract: it pins every version and hash a byte-identical
 * re-evaluation needs (prompt 19). EvidenceSnapshotRef is the immutable
 * decision-input entity; the existing RecordProvenance (contracts/provenance.ts)
 * remains the field-level label on operational rows - they coexist, never merge.
 */
import { z } from "zod";
import {
  DecisionInputBundleIdSchema,
  DomainConfigVersionIdSchema,
  EvidenceKindSchema,
  EvidenceSnapshotIdRefSchema,
  EvidenceSnapshotIdSchema,
  EvidenceSourceIdSchema,
  HashSchema,
  HouseholdInstructionVersionRefSchema,
  PolicyVersionRefSchema,
  SecureBlobRefSchema,
  SubjectRefSchema,
  TimestampSchema,
} from "./ids";
import { TenantContextSchema } from "./actor";
import { CANONICAL_SERIALIZER_VERSION, DECISION_CORE_SCHEMA_VERSION } from "./serialization";

/** Freshness at retrieval - the golden truth set's vocabulary ("fresh"/"stale"/"unknown"). */
export const EvidenceFreshnessSchema = z.enum(["fresh", "stale", "unknown"]);
export type EvidenceFreshness = z.infer<typeof EvidenceFreshnessSchema>;

/**
 * An immutable, tenant-scoped snapshot of one piece of evidence: what was observed
 * (observedAt) vs when Verin fetched it (retrievedAt), where the encrypted content
 * lives, and the content hash that makes reuse tamper-evident. The snapshot never
 * carries the content itself - PII stays behind the blob ref.
 */
export const EvidenceSnapshotRefSchema = TenantContextSchema.unwrap().extend({
  id: EvidenceSnapshotIdSchema,
  kind: EvidenceKindSchema,
  sourceId: EvidenceSourceIdSchema,
  subjectRef: SubjectRefSchema,
  observedAt: TimestampSchema,
  retrievedAt: TimestampSchema,
  attribution: z.string().min(1),
  schemaVersion: z.string().min(1),
  encryptedStorageRef: SecureBlobRefSchema,
  contentHash: HashSchema,
  freshness: EvidenceFreshnessSchema,
}).readonly();
export type EvidenceSnapshotRef = z.infer<typeof EvidenceSnapshotRefSchema>;

/**
 * Everything an evaluation reads, pinned (replay metadata). schemaVersion,
 * canonicalSerializerVersion, engineVersion, and primitiveSetVersion identify the
 * exact machinery; the policy/config/instruction versions and evidence snapshot
 * references identify the exact inputs; asOf + timeZone pin time itself; bundleHash is
 * the canonical-serialization hash the approval and replay paths bind to.
 */
const TimeZoneSchema = z.string().min(1).refine((timeZone) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone === timeZone;
    } catch {
      return false;
    }
  }, { message: "unsupported or non-canonical IANA time-zone identifier" });

export const DecisionInputBundleSchema = TenantContextSchema.unwrap().extend({
  id: DecisionInputBundleIdSchema,
  schemaVersion: z.literal(DECISION_CORE_SCHEMA_VERSION),
  canonicalSerializerVersion: z.literal(CANONICAL_SERIALIZER_VERSION),
  engineVersion: z.string().min(1),
  primitiveSetVersion: z.string().min(1),
  domainConfigVersionId: DomainConfigVersionIdSchema,
  policyVersionRef: PolicyVersionRefSchema,
  householdInstructionVersionRefs: z
    .array(HouseholdInstructionVersionRefSchema)
    .refine((refs) => new Set(refs.map((ref) => ref.id)).size === refs.length, {
      message: "duplicate household instruction version id",
    })
    .readonly(),
  evidenceSnapshotRefs: z
    .array(EvidenceSnapshotIdRefSchema)
    .refine((refs) => new Set(refs.map((ref) => ref.id)).size === refs.length, {
      message: "duplicate evidence snapshot id",
    })
    .readonly(),
  asOf: TimestampSchema,
  timeZone: TimeZoneSchema,
  bundleHash: HashSchema,
})
  .superRefine((bundle, ctx) => {
    const requireSameFirm = (ref: { firmId: string }, path: (string | number)[]) => {
      if (ref.firmId !== bundle.firmId) {
        ctx.addIssue({ code: "custom", message: "referenced record must belong to the bundle tenant", path });
      }
    };
    requireSameFirm(bundle.policyVersionRef, ["policyVersionRef", "firmId"]);
    bundle.householdInstructionVersionRefs.forEach((ref, index) =>
      requireSameFirm(ref, ["householdInstructionVersionRefs", index, "firmId"]),
    );
    bundle.evidenceSnapshotRefs.forEach((ref, index) =>
      requireSameFirm(ref, ["evidenceSnapshotRefs", index, "firmId"]),
    );
  })
  .readonly();
export type DecisionInputBundle = z.infer<typeof DecisionInputBundleSchema>;
