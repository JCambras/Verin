import { z } from "zod";
import {
  DecisionInputBundleIdSchema,
  DomainConfigVersionRefSchema,
  EvidenceSnapshotIdRefSchema,
  HashSchema,
  HouseholdInstructionVersionRefSchema,
  PolicyVersionRefSchema,
  RegulatoryVersionRefSchema,
  TimestampSchema,
  hasUniqueScopedReferences,
  normalizeScopedReferences,
} from "../v1-7/ids";
import { TenantContextSchema } from "../v1-7/actor";
import {
  CANONICAL_SERIALIZER_V1_0_0,
  DECISION_CORE_SCHEMA_V1_8_0,
} from "./serialization";
import {
  SUPPORTED_IANA_TIME_ZONE_RELEASE_LIST,
  formatTimeZoneRefusal,
  timeZoneNameSchema,
  timeZoneRegistryMembership,
  type IanaTimeZoneRelease,
} from "../v1-7/time-zone";

export {
  DecisionInputBundleV1_7_0Schema,
  EvidenceFreshnessSchema,
  EvidenceSnapshotRefSchema,
  EvidenceSnapshotRefV1_7_0Schema,
  type DecisionInputBundleV1_7_0,
  type EvidenceFreshness,
  type EvidenceSnapshotRef,
  type EvidenceSnapshotRefV1_7_0,
} from "../v1-7/evidence";

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
    schemaVersion: z.literal(DECISION_CORE_SCHEMA_V1_8_0),
    canonicalSerializerVersion: z.literal(CANONICAL_SERIALIZER_V1_0_0),
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
    regulatoryVersionRefs: z
      .array(RegulatoryVersionRefSchema)
      .refine(hasUniqueScopedReferences, {
        message: "duplicate regulatory version reference",
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
      bundle.regulatoryVersionRefs.forEach((ref, index) =>
        requireSameFirm(ref, [
          "regulatoryVersionRefs",
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

export const DecisionInputBundleV1_8_0Schema =
  decisionInputBundleSchemaForReleases(
    SUPPORTED_IANA_TIME_ZONE_RELEASE_LIST,
  );
export const DecisionInputBundleSchema =
  DecisionInputBundleV1_8_0Schema.clone();
export type DecisionInputBundleV1_8_0 = z.infer<
  typeof DecisionInputBundleV1_8_0Schema
>;
export type DecisionInputBundle = z.infer<typeof DecisionInputBundleSchema>;
