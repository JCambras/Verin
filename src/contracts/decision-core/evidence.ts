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
import type { PIIBearing } from "@contracts/pii";
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
  hasUniqueScopedReferences,
  normalizeScopedReferences,
} from "./ids";
import { TenantContextSchema } from "./actor";
import {
  CANONICAL_SERIALIZER_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
} from "./serialization";
import {
  SUPPORTED_IANA_TIME_ZONE_RELEASE_LIST,
  formatTimeZoneRefusal,
  timeZoneNameSchema,
  timeZoneRegistryMembership,
  type IanaTimeZoneRelease,
} from "../time-zone";

/**
 * The evaluator's freshness verdict at retrieval - the golden truth set's vocabulary
 * ("fresh"/"stale"/"unknown"). RECORDED, not re-derived: the staleness threshold is
 * per-evidence-kind policy this layer does not have, so the label cannot be checked
 * against observedAt/retrievedAt here without inventing that policy.
 */
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
    // observedAt is the instant the fact itself holds; retrievedAt is when Verin
    // fetched it. Retrieval cannot precede observation - an inverted pair would bind
    // into the decision hash as an immutable input, and every downstream evaluator
    // that reads the pair (the freshness threshold owner among them) would be reading
    // a nonsense interval. Equality is legal: as-of == fetched-at is ordinary.
    if (snapshot.retrievedAt < snapshot.observedAt) {
      ctx.addIssue({
        code: "custom",
        message: "evidence retrieval cannot precede the observation it records",
        path: ["retrievedAt"],
      });
    }
  })
  .readonly();
export type EvidenceSnapshotRef =
  z.infer<typeof EvidenceSnapshotRefSchema> & PIIBearing;

/**
 * Everything an evaluation reads, pinned (replay metadata). schemaVersion,
 * canonicalSerializerVersion, engineVersion, and primitiveSetVersion identify the
 * exact machinery; the policy/config/instruction versions and evidence snapshot
 * references identify the exact inputs; asOf + timeZone pin time itself; bundleHash is
 * the canonical-serialization hash the approval and replay paths bind to.
 */
export const decisionInputBundleSchemaForReleases = <
  const R extends readonly [
    IanaTimeZoneRelease,
    ...IanaTimeZoneRelease[],
  ],
>(
  releases: R,
) => {
  type Version = R[number]["dataVersion"];
  const versions = releases.map((release) => release.dataVersion) as [
    Version,
    ...Version[],
  ];
  if (new Set(versions).size !== versions.length) {
    throw new Error("time-zone release data versions must be unique");
  }
  const zones = [
    ...new Set(releases.flatMap((release) => release.zones)),
  ].sort() as [string, ...string[]];
  const membership = timeZoneRegistryMembership(releases);
  return TenantContextSchema.unwrap().extend({
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
      .overwrite(normalizeScopedReferences)
      .readonly(),
    evidenceSnapshotRefs: z
      .array(EvidenceSnapshotIdRefSchema)
      .refine(hasUniqueScopedReferences, {
        message: "duplicate evidence snapshot reference",
      })
      .overwrite(normalizeScopedReferences)
      .readonly(),
    asOf: TimestampSchema,
    timeZone: timeZoneNameSchema(
      zones,
      `supported releases ${versions.join(", ")}`,
    ),
    timeZoneDataVersion: z.enum(versions),
    bundleHash: HashSchema,
  })
    .superRefine((bundle, ctx) => {
      const requireSameFirm = (
        ref: { firmId: string },
        path: (string | number)[],
      ) => {
        if (ref.firmId !== bundle.firmId) {
          ctx.addIssue({
            code: "custom",
            message: "referenced record must belong to the bundle tenant",
            path,
          });
        }
      };
      requireSameFirm(bundle.domainConfigVersionRef, [
        "domainConfigVersionRef",
        "firmId",
      ]);
      requireSameFirm(bundle.policyVersionRef, [
        "policyVersionRef",
        "firmId",
      ]);
      bundle.householdInstructionVersionRefs.forEach((ref, index) =>
        requireSameFirm(ref, [
          "householdInstructionVersionRefs",
          index,
          "firmId",
        ]),
      );
      bundle.evidenceSnapshotRefs.forEach((ref, index) =>
        requireSameFirm(ref, ["evidenceSnapshotRefs", index, "firmId"]),
      );
      if (!membership(bundle.timeZoneDataVersion, bundle.timeZone)) {
        ctx.addIssue({
          code: "custom",
          message: formatTimeZoneRefusal(
            bundle.timeZone,
            bundle.timeZoneDataVersion,
          ),
          path: ["timeZone"],
        });
      }
    })
    .readonly();
};

export const DecisionInputBundleSchema =
  decisionInputBundleSchemaForReleases(
    SUPPORTED_IANA_TIME_ZONE_RELEASE_LIST,
  );
export type DecisionInputBundle = z.infer<typeof DecisionInputBundleSchema>;
