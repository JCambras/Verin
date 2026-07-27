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
  DomainConfigVersionRefSchema,
  EvidenceKindSchema,
  EvidenceSnapshotIdRefSchema,
  EvidenceSnapshotIdSchema,
  EvidenceSourceRefSchema,
  HashSchema,
  HouseholdInstructionVersionRefSchema,
  PolicyVersionRefSchema,
  SecureBlobRefSchema,
  SubjectRefSchema,
  TimestampSchema,
  compareScopedReferences,
  hasUniqueScopedReferences,
} from "./ids";
import { TenantContextSchema } from "./actor";
import { CANONICAL_SERIALIZER_VERSION, DECISION_CORE_SCHEMA_VERSION } from "./serialization";
import {
  IANA_TIME_ZONE_DATA_VERSION,
  SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS,
  TimeZoneSchema,
  isTimeZoneInRecordedRegistry,
} from "../time-zone";
export { TimeZoneSchema };

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
  sourceRef: EvidenceSourceRefSchema,
  subjectRef: SubjectRefSchema,
  observedAt: TimestampSchema,
  retrievedAt: TimestampSchema,
  attribution: z.string().min(1),
  schemaVersion: z.string().min(1),
  encryptedStorageRef: SecureBlobRefSchema,
  contentHash: HashSchema,
  freshness: EvidenceFreshnessSchema,
})
  .superRefine((snapshot, ctx) => {
    for (const [ref, path] of [
      [snapshot.sourceRef, ["sourceRef", "firmId"]],
      [snapshot.subjectRef, ["subjectRef", "firmId"]],
      [snapshot.encryptedStorageRef, ["encryptedStorageRef", "firmId"]],
    ] as const) {
      if (ref.firmId !== snapshot.firmId) {
        ctx.addIssue({
          code: "custom",
          message: "referenced record must belong to the snapshot tenant",
          path: [...path],
        });
      }
    }
  })
  .readonly();
export type EvidenceSnapshotRef = z.infer<typeof EvidenceSnapshotRefSchema>;

/**
 * Everything an evaluation reads, pinned (replay metadata). schemaVersion,
 * canonicalSerializerVersion, engineVersion, and primitiveSetVersion identify the
 * exact machinery; the policy/config/instruction versions and evidence snapshot
 * references identify the exact inputs; asOf + timeZone pin time itself; bundleHash is
 * the canonical-serialization hash the approval and replay paths bind to.
 */
export const TIME_ZONE_DATA_VERSION = IANA_TIME_ZONE_DATA_VERSION;

export const DecisionInputBundleSchema = TenantContextSchema.unwrap().extend({
  id: DecisionInputBundleIdSchema,
  schemaVersion: z.literal(DECISION_CORE_SCHEMA_VERSION),
  canonicalSerializerVersion: z.literal(CANONICAL_SERIALIZER_VERSION),
  engineVersion: z.string().min(1),
  primitiveSetVersion: z.string().min(1),
  domainConfigVersionRef: DomainConfigVersionRefSchema,
  policyVersionRef: PolicyVersionRefSchema,
  householdInstructionVersionRefs: z
    .array(HouseholdInstructionVersionRefSchema)
    .refine(hasUniqueScopedReferences, {
      message: "duplicate household instruction version reference",
    })
    .overwrite((refs) => [...refs].sort(compareScopedReferences))
    .readonly(),
  evidenceSnapshotRefs: z
    .array(EvidenceSnapshotIdRefSchema)
    .refine(hasUniqueScopedReferences, {
      message: "duplicate evidence snapshot reference",
    })
    .overwrite((refs) => [...refs].sort(compareScopedReferences))
    .readonly(),
  asOf: TimestampSchema,
  timeZone: TimeZoneSchema,
  // A supported-version ENUM, not the single shipped literal: a bundle records the
  // registry it was evaluated against so it can be replayed against that registry,
  // which is impossible if adopting a newer release makes every stored bundle
  // unparseable. Versions are only ever ADDED (ADR-0029, D-051).
  timeZoneDataVersion: z.enum(SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS),
  bundleHash: HashSchema,
})
  .superRefine((bundle, ctx) => {
    const requireSameFirm = (ref: { firmId: string }, path: (string | number)[]) => {
      if (ref.firmId !== bundle.firmId) {
        ctx.addIssue({ code: "custom", message: "referenced record must belong to the bundle tenant", path });
      }
    };
    requireSameFirm(bundle.domainConfigVersionRef, ["domainConfigVersionRef", "firmId"]);
    requireSameFirm(bundle.policyVersionRef, ["policyVersionRef", "firmId"]);
    bundle.householdInstructionVersionRefs.forEach((ref, index) =>
      requireSameFirm(ref, ["householdInstructionVersionRefs", index, "firmId"]),
    );
    bundle.evidenceSnapshotRefs.forEach((ref, index) =>
      requireSameFirm(ref, ["evidenceSnapshotRefs", index, "firmId"]),
    );
    // TimeZoneSchema spans every supported registry so an older bundle stays
    // parseable; the registry THIS bundle is held to is the one it recorded, which
    // is what makes the recorded version a replay input rather than a label.
    if (!isTimeZoneInRecordedRegistry(bundle.timeZoneDataVersion, bundle.timeZone)) {
      ctx.addIssue({
        code: "custom",
        message: "timeZone must belong to the registry named by timeZoneDataVersion",
        path: ["timeZone"],
      });
    }
  })
  .readonly();
export type DecisionInputBundle = z.infer<typeof DecisionInputBundleSchema>;
