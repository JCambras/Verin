import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  DurationSchema,
  HashSchema,
  TimestampSchema,
  compareScopedReferences,
} from "@contracts/decision-core/ids";
import { ActorRefSchema, TokenizedPayloadSchema } from "@contracts/decision-core/actor";
import { EvidenceRequestSchema, IntentSchema } from "@contracts/decision-core/trigger";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
  type DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import { DecisionRecordSchema, DecisionResultSchema, RevaluationConditionSchema } from "@contracts/decision-core/decision";
import {
  ApprovalRequirementSchema,
  ApprovalTemplateSchema,
  AuthorityRequirementSchema,
  EscalationStepSchema,
  isStrictlyPositiveDuration,
} from "@contracts/decision-core/authority";
import { ExecutionPlanSchema } from "@contracts/decision-core/execution";
import {
  BUNDLE_HASH_PAYLOAD_KEYS,
  BUNDLE_HASH_PREIMAGE_VERSION,
  CANONICAL_SERIALIZER_VERSION,
  DECISION_HASH_PAYLOAD_KEYS,
  DECISION_HASH_PREIMAGE_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
  HASH_PROJECTION_SCHEMA_FINGERPRINTS,
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { unwrap } from "@contracts/result";
import {
  CANONICAL_IANA_TIME_ZONES,
  CANONICAL_IANA_TIME_ZONE_LINKS,
  IANA_TIME_ZONE_DATA_VERSION,
  IANA_TIME_ZONE_LINK_REGISTRY_SHA256,
  IANA_TIME_ZONE_REGISTRY_SHA256,
  LinkResolvedTimeZoneSchema,
  SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS,
  SUPPORTED_IANA_TIME_ZONE_RELEASES,
  TimeZoneSchema,
  configuredTimeZoneSchema,
  isTimeZoneInRecordedRegistry,
  timeZoneNameSchema,
  timeZoneRegistryMembership,
  type TimeZone,
} from "@contracts/time-zone";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Decision-core schema tests (v3 §5; ADR-0029, D-040). The illegal-state fence
 * (fitness/decision-core-illegal-states.test.ts) owns invariants 7–9; this suite
 * covers the rest of the prompt-5 contract: tenant scoping of persisted records,
 * canonical-serialization fixtures, vocabulary locks against the demo matrix,
 * and the structural-integrity refinements.
 */

const timestamp = "2026-07-26T13:30:00.000Z";
const hash = "c".repeat(64);
const role = (id: string, firmId = "firm-a") => ({ firmId, id });

const validIntent = {
  firmId: "firm-a",
  id: "intent:u:1",
  trigger: {
    kind: "human_request",
    requester: { firmId: "firm-a", actorId: "actor:u:1", roleIds: [role("advisor")] },
    requestRef: { firmId: "firm-a", id: "req:u:1" },
    maskedRequest: { value: "distribute 75000 USD (tokenized)", piiFree: true },
  },
  domainConfigVersionRef: { firmId: "firm-a", id: "dcv:money-movement:1" },
  action: "primitive:distribute-cash",
  slots: { amount: "slot:amount:u:1" },
  createdAt: timestamp,
};

const validSnapshot = {
  firmId: "firm-a",
  id: "evs:u:1",
  kind: "account-balance",
  sourceRef: { firmId: "firm-a", id: "src:house-crm" },
  subjectRef: { firmId: "firm-a", id: "subject:smiths-joint-taxable" },
  observedAt: timestamp,
  retrievedAt: timestamp,
  attribution: "house-crm nightly sync",
  schemaVersion: "1",
  encryptedStorageRef: { firmId: "firm-a", id: "blob:u:1" },
  contentHash: hash,
  freshness: "fresh",
};

const validBundle = {
  firmId: "firm-a",
  id: "bundle:u:1",
  schemaVersion: DECISION_CORE_SCHEMA_VERSION,
  canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
  engineVersion: "0.0.0",
  primitiveSetVersion: "0",
  domainConfigVersionRef: { firmId: "firm-a", id: "dcv:money-movement:1" },
  policyVersionRef: { firmId: "firm-a", id: "pv:firm-a:1" },
  householdInstructionVersionRefs: [{ firmId: "firm-a", id: "hiv:smiths:1" }],
  evidenceSnapshotRefs: [{ firmId: "firm-a", id: "evs:u:1" }],
  asOf: timestamp,
  timeZone: "America/New_York",
  timeZoneDataVersion: IANA_TIME_ZONE_DATA_VERSION,
  bundleHash: hash,
};

describe("tenant scoping - unscoped persisted records are unrepresentable (v3 invariant 2)", () => {
  it("rejects each persisted record without firmId", () => {
    for (const [schema, value] of [
      [IntentSchema, validIntent],
      [EvidenceSnapshotRefSchema, validSnapshot],
      [DecisionInputBundleSchema, validBundle],
    ] as const) {
      const unscoped = Object.fromEntries(Object.entries(value).filter(([k]) => k !== "firmId"));
      expect(schema.safeParse(value).success, "the scoped counterpart must parse").toBe(true);
      const parsed = schema.safeParse(unscoped);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some((i) => i.path[0] === "firmId")).toBe(true);
    }
  });

  it("rejects a cross-tenant intent (trigger from another firm)", () => {
    const crossTenant = {
      ...validIntent,
      trigger: {
        ...validIntent.trigger,
        requester: { ...validIntent.trigger.requester, firmId: "firm-b" },
      },
    };
    expect(IntentSchema.safeParse(crossTenant).success).toBe(false);
    expect(
      IntentSchema.safeParse({
        ...validIntent,
        domainConfigVersionRef: { ...validIntent.domainConfigVersionRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
  });

  it("rejects cross-tenant evidence source and subject references", () => {
    expect(EvidenceSnapshotRefSchema.safeParse(validSnapshot).success).toBe(true);
    for (const value of [
      { ...validSnapshot, sourceRef: { ...validSnapshot.sourceRef, firmId: "firm-b" } },
      { ...validSnapshot, subjectRef: { ...validSnapshot.subjectRef, firmId: "firm-b" } },
    ]) {
      expect(EvidenceSnapshotRefSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects cross-tenant attribution on a DecisionRecord", () => {
    const fixture = JSON.parse(readFixture("decision-record-proceed")) as { createdBy: { firmId: string } };
    fixture.createdBy = { ...fixture.createdBy, firmId: "firm-b" };
    expect(DecisionRecordSchema.safeParse(fixture).success).toBe(false);
  });

  it("requires tenant-scoped bundle references and rejects every cross-tenant link", () => {
    expect(DecisionInputBundleSchema.safeParse(validBundle).success).toBe(true);
    for (const crossTenant of [
      {
        ...validBundle,
        domainConfigVersionRef: { ...validBundle.domainConfigVersionRef, firmId: "firm-b" },
      },
      { ...validBundle, policyVersionRef: { ...validBundle.policyVersionRef, firmId: "firm-b" } },
      {
        ...validBundle,
        householdInstructionVersionRefs: [
          { ...validBundle.householdInstructionVersionRefs[0]!, firmId: "firm-b" },
        ],
      },
      {
        ...validBundle,
        evidenceSnapshotRefs: [{ ...validBundle.evidenceSnapshotRefs[0]!, firmId: "firm-b" }],
      },
    ]) {
      expect(DecisionInputBundleSchema.safeParse(crossTenant).success).toBe(false);
    }
  });

  it("requires tenant-scoped intent and bundle references on DecisionRecord", () => {
    const fixture = JSON.parse(readFixture("decision-record-proceed")) as {
      intentRef: { firmId: string };
      inputBundleRef: { firmId: string };
    };
    expect(DecisionRecordSchema.safeParse(fixture).success).toBe(true);
    expect(
      DecisionRecordSchema.safeParse({
        ...fixture,
        intentRef: { ...fixture.intentRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
    expect(
      DecisionRecordSchema.safeParse({
        ...fixture,
        inputBundleRef: { ...fixture.inputBundleRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
  });
});

function readFixture(name: string): string {
  return readFileSync(join(ROOT, "fixtures/decision-core", `${name}.json`), "utf8").replace(/\n$/, "");
}

describe("canonical serialization (replay metadata, v3 §5 / prompt 19 groundwork)", () => {
  it("keeps every schema key, including optional keys, classified in its hash projection", () => {
    const bundleKeys = Object.keys(DecisionInputBundleSchema.unwrap().shape).filter(
      (key) => key !== "id" && key !== "bundleHash",
    );
    const decisionKeys = Object.keys(DecisionRecordSchema.unwrap().shape).filter((key) => key !== "decisionHash");
    expect([...BUNDLE_HASH_PAYLOAD_KEYS].sort()).toEqual(bundleKeys.sort());
    expect([...DECISION_HASH_PAYLOAD_KEYS].sort()).toEqual(decisionKeys.sort());
    expect(DECISION_HASH_PAYLOAD_KEYS).toContain("derivedFromDecisionRef");
  });

  it("rejects replay metadata versions without a matching implementation", () => {
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, schemaVersion: "2.0.0" }).success).toBe(false);
    expect(
      DecisionInputBundleSchema.safeParse({ ...validBundle, canonicalSerializerVersion: "2.0.0" }).success,
    ).toBe(false);
  });

  it("uses a version-pinned time-zone registry independent of host ICU data", () => {
    expect(
      createHash("sha256").update(CANONICAL_IANA_TIME_ZONES.join("\n")).digest("hex"),
    ).toBe(IANA_TIME_ZONE_REGISTRY_SHA256);
    for (const timeZone of CANONICAL_IANA_TIME_ZONES) {
      expect(TimeZoneSchema.safeParse(timeZone).success).toBe(true);
    }
    expect(CANONICAL_IANA_TIME_ZONES).toHaveLength(341);
    expect(TimeZoneSchema.safeParse("Etc/UTC").success).toBe(true);
    expect(TimeZoneSchema.safeParse("Factory").success).toBe(true);
    expect(TimeZoneSchema.safeParse("Africa/Accra").success).toBe(false);
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "Not/AZone" }).success).toBe(false);
    expect(DecisionInputBundleSchema.safeParse(validBundle).success).toBe(true);
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "US/Eastern" }).success).toBe(false);
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "Europe/London" }).success).toBe(true);
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "America/Chicago" }).success).toBe(true);
    expect(
      DecisionInputBundleSchema.parse({ ...validBundle, timeZone: "america/new_york" }).timeZone,
    ).toBe("America/New_York");
    expect(
      DecisionInputBundleSchema.safeParse({
        ...validBundle,
        timeZoneDataVersion: "decision-core-time-zones/2.0.0",
      }).success,
    ).toBe(false);
    const original = Intl.DateTimeFormat;
    Reflect.set(Intl, "DateTimeFormat", () => {
      throw new Error("host ICU unavailable");
    });
    try {
      expect(DecisionInputBundleSchema.safeParse(validBundle).success).toBe(true);
    } finally {
      Reflect.set(Intl, "DateTimeFormat", original);
    }
  });

  it("selects the registry a bundle RECORDS, proven on a constructed multi-registry map", () => {
    // The recorded version exists so a bundle can be replayed against the registry it
    // was evaluated with. Asserting that through the SHIPPED map can only restate that
    // its one key is its one key - with a single registry, "the recorded version picks
    // the registry" and "there is one registry" are indistinguishable. So construct the
    // two-registry condition the map exists for and probe the selection directly.
    const older = "iana-tzdb/probe-older";
    const newer = "iana-tzdb/probe-newer";
    // tzdb routinely demotes a Zone to a Link: America/Nipigon is a Zone in the older
    // release and gone from the newer one. A bundle stamped with the older version must
    // still validate - and hash-verify - against the release it actually recorded.
    const membership = timeZoneRegistryMembership({
      [older]: { zones: ["America/Nipigon", "America/Toronto"] },
      [newer]: { zones: ["America/Toronto"] },
    });
    expect(membership(older, "America/Nipigon")).toBe(true);
    expect(membership(newer, "America/Nipigon")).toBe(false);
    expect(membership(older, "America/Toronto")).toBe(true);
    expect(membership(newer, "America/Toronto")).toBe(true);
    expect(membership("iana-tzdb/never-shipped", "America/Toronto")).toBe(false);

    // The boundary consumes exactly that selection over the SHIPPED map - not a
    // free-standing enum that closes over whichever release ships today.
    expect(Object.keys(SUPPORTED_IANA_TIME_ZONE_RELEASES)).toEqual([
      ...SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS,
    ]);
    expect(SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS).toContain(IANA_TIME_ZONE_DATA_VERSION);
    for (const version of SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS) {
      expect(SUPPORTED_IANA_TIME_ZONE_RELEASES[version].version).toBe(version);
      for (const zone of ["America/New_York", "Etc/UTC", "Africa/Accra", "Not/AZone"]) {
        expect(isTimeZoneInRecordedRegistry(version, zone)).toBe(
          SUPPORTED_IANA_TIME_ZONE_RELEASES[version].zones.includes(zone),
        );
      }
      expect(
        DecisionInputBundleSchema.safeParse({ ...validBundle, timeZoneDataVersion: version }).success,
      ).toBe(true);
    }
    expect(isTimeZoneInRecordedRegistry("iana-tzdb/1970a", "America/New_York")).toBe(false);
    expect(
      DecisionInputBundleSchema.safeParse({ ...validBundle, timeZoneDataVersion: "iana-tzdb/1970a" }).success,
    ).toBe(false);

    // A standalone TimeZone spans every supported registry (so a historical Zone stays
    // parseable), while a BUNDLE is held to the one it recorded. Exactly one registry
    // ships, so the two sets coincide and no input can currently tell them apart -
    // asserted here rather than left implied, so this case cannot look covered while
    // being empty. Adopting a second release makes the loop below live.
    expect(SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS).toHaveLength(1);
    const spanningRegistries = new Set(
      SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS.flatMap((version) => [
        ...SUPPORTED_IANA_TIME_ZONE_RELEASES[version].zones,
      ]),
    );
    for (const version of SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS) {
      for (const zone of spanningRegistries) {
        if (SUPPORTED_IANA_TIME_ZONE_RELEASES[version].zones.includes(zone)) continue;
        expect(TimeZoneSchema.safeParse(zone).success).toBe(true);
        expect(
          DecisionInputBundleSchema.safeParse({
            ...validBundle,
            timeZone: zone,
            timeZoneDataVersion: version,
          }).success,
        ).toBe(false);
      }
    }
  });

  it("types timeZoneDataVersion as the supported-version union, not as a bare string", () => {
    // COMPILE-TIME fence, like the TimeZone brand below: the version enum is derived
    // from Object.keys(), whose result is `string[]` unless the registry map's key
    // union is carried through it. If that boundary collapses, the suppression here
    // becomes an unused directive and `pnpm typecheck` fails - a replay-metadata field
    // would otherwise accept any string without ever parsing.
    // @ts-expect-error - an unshipped registry version is NOT a DataVersion.
    const unsupported: DecisionInputBundle["timeZoneDataVersion"] = "iana-tzdb/1970a";
    const supported: DecisionInputBundle["timeZoneDataVersion"] = IANA_TIME_ZONE_DATA_VERSION;
    expect(supported).toBe(IANA_TIME_ZONE_DATA_VERSION);
    expect(
      DecisionInputBundleSchema.safeParse({ ...validBundle, timeZoneDataVersion: unsupported }).success,
    ).toBe(false);
  });

  it("brands TimeZone so a bare string cannot reach a time-zone field", () => {
    // COMPILE-TIME fence: the registry enum is built from a JSON import, so without
    // an explicit brand its inferred type collapses to `string` and every other
    // constrained primitive's type-level boundary would not apply here. If the brand
    // is removed, the suppression below becomes an unused-directive error and
    // `pnpm typecheck` fails - this assertion is not merely a runtime one.
    // @ts-expect-error - a raw string is NOT assignable to the branded TimeZone.
    const unparsed: TimeZone = "America/New_York";
    const parsed: TimeZone = TimeZoneSchema.parse("America/New_York");
    expect(parsed).toBe(unparsed);
  });

  it("resolves pinned Link aliases to canonical Zones ONLY at the configuration boundary", () => {
    // Replay bytes stay single-valued: an alias is never a distinct persisted value.
    expect(Object.keys(CANONICAL_IANA_TIME_ZONE_LINKS)).toHaveLength(257);
    expect(
      createHash("sha256")
        .update(
          Object.entries(CANONICAL_IANA_TIME_ZONE_LINKS)
            .map(([alias, zone]) => `${alias} ${zone}`)
            .join("\n"),
        )
        .digest("hex"),
    ).toBe(IANA_TIME_ZONE_LINK_REGISTRY_SHA256);
    for (const [alias, zone] of Object.entries(CANONICAL_IANA_TIME_ZONE_LINKS)) {
      expect(CANONICAL_IANA_TIME_ZONES).toContain(zone);
      expect(CANONICAL_IANA_TIME_ZONES).not.toContain(alias);
      expect(TimeZoneSchema.safeParse(alias).success).toBe(false);
      expect(LinkResolvedTimeZoneSchema.parse(alias)).toBe(zone);
    }
    expect(LinkResolvedTimeZoneSchema.parse("UTC")).toBe("Etc/UTC");
    expect(LinkResolvedTimeZoneSchema.parse("us/eastern")).toBe("America/New_York");
    expect(LinkResolvedTimeZoneSchema.parse("America/New_York")).toBe("America/New_York");
    expect(LinkResolvedTimeZoneSchema.safeParse("Not/AZone").success).toBe(false);
    // The bundle keeps refusing aliases: they are not replay values.
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "UTC" }).success).toBe(false);
  });

  it("holds NEW configuration to the CURRENT release, proven on a constructed two-release pair", () => {
    // The config boundary and the persisted-record boundary must NOT be the same set.
    // With one shipped release they coincide, so asserting through the shipped release
    // could only restate that - construct the two-release condition and probe directly.
    const older = {
      version: "iana-tzdb/probe-older",
      zones: ["America/Nipigon", "America/Toronto"],
      links: { "Canada/Eastern": "America/Nipigon" },
      placeholderZones: [],
    };
    const newer = {
      version: "iana-tzdb/probe-newer",
      zones: ["America/Toronto"],
      links: { "Canada/Eastern": "America/Toronto" },
      placeholderZones: [],
    };

    // The alias table travels with ITS release: one spelling, two canonical answers.
    // A single un-versioned Link table could not express this, so it lives in the map.
    expect(configuredTimeZoneSchema(older).parse("Canada/Eastern")).toBe("America/Nipigon");
    expect(configuredTimeZoneSchema(newer).parse("canada/eastern")).toBe("America/Toronto");

    // A Zone the current release dropped stays parseable as a PERSISTED value (that is
    // what the cross-release union is for) but must NOT boot: a new bundle stamps the
    // CURRENT version, so accepting it would boot a config no bundle can be built from.
    const spanning = timeZoneNameSchema([...older.zones, ...newer.zones]);
    expect(spanning.safeParse("America/Nipigon").success).toBe(true);
    expect(configuredTimeZoneSchema(newer).safeParse("America/Nipigon").success).toBe(false);
    expect(configuredTimeZoneSchema(older).parse("America/Nipigon")).toBe("America/Nipigon");

    // The SHIPPED boundary is that factory applied to the current release, so a Zone
    // only an older supported release ships stays readable as a persisted value and
    // still refuses to boot. Exactly one release ships, so the two sets coincide and
    // no input can currently tell them apart - asserted here rather than left implied,
    // so this arm cannot look covered while being empty. Adopting a second release
    // makes the loop live.
    const current = SUPPORTED_IANA_TIME_ZONE_RELEASES[IANA_TIME_ZONE_DATA_VERSION];
    expect(current.version).toBe(IANA_TIME_ZONE_DATA_VERSION);
    // @ts-expect-error - diagnostic version is inseparable from its release data.
    expect(configuredTimeZoneSchema(current, "iana-tzdb/wrong-release")).toBeDefined();
    expect(SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS).toHaveLength(1);
    for (const version of SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS) {
      for (const zone of SUPPORTED_IANA_TIME_ZONE_RELEASES[version].zones) {
        if (current.zones.includes(zone)) continue;
        expect(TimeZoneSchema.safeParse(zone).success).toBe(true);
        expect(LinkResolvedTimeZoneSchema.safeParse(zone).success).toBe(false);
      }
    }
    for (const zone of ["America/New_York", "Etc/UTC"]) {
      expect(current.zones).toContain(zone);
      expect(LinkResolvedTimeZoneSchema.parse(zone)).toBe(zone);
    }
    expect(LinkResolvedTimeZoneSchema.parse("UTC")).toBe(current.links["UTC"]);
  });

  it("refuses to BOOT on a declared placeholder zone, while still reading one that persisted", () => {
    // tzdb ships `Factory` as the placeholder for an unconfigured system and CLDR/ICU
    // omits it, so it is a legal registry name that no formatter resolves. Configuring
    // it would boot and then throw at the first local-time render - the fail-late
    // shape the release-scoped config boundary exists to refuse. WHICH names are
    // placeholders is DECLARED by the pinned release and reviewed when a release is
    // adopted, never probed from the host here: sweeping the registry through `Intl`
    // would require the running Node's bundled tzdata to be at least as new as the
    // pinned release (which already carries America/Coyhaique, added in tzdata 2025a),
    // re-introducing on the test side the OS coupling the pinned registry removes.
    const current = SUPPORTED_IANA_TIME_ZONE_RELEASES[IANA_TIME_ZONE_DATA_VERSION];
    // The review record is keyed BY RELEASE for the same reason the registries are:
    // adopting one ADDS an entry here rather than repointing a single-release constant,
    // and a release nobody reviewed fails outright instead of declaring itself correct.
    // An unlisted placeholder and an over-broad declaration both fail this, order-free.
    const reviewedPlaceholderZones: Record<string, readonly string[]> = {
      "iana-tzdb/2026b": ["Factory"],
    };
    for (const version of SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS) {
      expect([...SUPPORTED_IANA_TIME_ZONE_RELEASES[version].placeholderZones].sort()).toEqual(
        reviewedPlaceholderZones[version],
      );
    }
    for (const placeholder of current.placeholderZones) {
      expect(current.zones).toContain(placeholder);
      expect(LinkResolvedTimeZoneSchema.safeParse(placeholder).success).toBe(false);
      // ...and it stays a readable, hash-verifiable PERSISTED value.
      expect(TimeZoneSchema.safeParse(placeholder).success).toBe(true);
      const persisted = DecisionInputBundleSchema.parse({ ...validBundle, timeZone: placeholder });
      expect(persisted.timeZone).toBe(placeholder);
      expect(hashPreimage(bundleHashPreimage(persisted))).toHaveLength(64);
    }
    // NON-VACUOUS: the admitted set is EXACTLY this release minus its declared
    // placeholders, not just "Factory is refused somewhere". A placeholder left off the
    // list would still boot here, and an over-broad subtraction would refuse a real
    // Zone - both fail this loop, deterministically from the pinned registry.
    const placeholders = new Set<string>(current.placeholderZones);
    for (const zone of current.zones) {
      expect(LinkResolvedTimeZoneSchema.safeParse(zone).success).toBe(!placeholders.has(zone));
    }
    // No alias spelling can smuggle an unconfigurable Zone past the subtraction, which
    // runs AFTER resolution: an alias is admitted exactly when its target is, and then
    // resolves to that target. This is the CODE's rule, so it holds for any release -
    // including one whose Link table aliases a placeholder, which this one does not.
    for (const [alias, zone] of Object.entries(current.links)) {
      const admitted = !placeholders.has(zone);
      expect(LinkResolvedTimeZoneSchema.safeParse(alias).success).toBe(admitted);
      if (admitted) expect(LinkResolvedTimeZoneSchema.parse(alias)).toBe(zone);
    }
    // The refusing arm of that equivalence is empty on this release, so exercise it on
    // THIS release plus one alias that does target a declared placeholder - still
    // deterministic from the pinned registry, never probed from the host.
    const placeholder = current.placeholderZones[0]!;
    const withPlaceholderAlias = configuredTimeZoneSchema({
      ...current,
      links: { ...current.links, "Legacy/Unset": placeholder },
    });
    expect(withPlaceholderAlias.safeParse("Legacy/Unset").success).toBe(false);
    expect(withPlaceholderAlias.parse("UTC")).toBe(current.links["UTC"]);
  });

  it("subtracts placeholders per RELEASE, after alias resolution", () => {
    // Proven on a constructed release, because the shipped one has a single
    // placeholder and no alias pointing at it - the general rule would otherwise be
    // indistinguishable from "Factory is hardcoded somewhere".
    const release = {
      version: "iana-tzdb/probe-placeholder",
      zones: ["America/Toronto", "Local"],
      links: { "Canada/Eastern": "America/Toronto", Unset: "Local" },
      placeholderZones: ["Local"],
    };
    const configured = configuredTimeZoneSchema(release);
    expect(configured.parse("Canada/Eastern")).toBe("America/Toronto");
    expect(configured.safeParse("Local").success).toBe(false);
    // An ALIAS of a placeholder is refused too: the subtraction runs after resolution.
    expect(configured.safeParse("Unset").success).toBe(false);
    // A release that declares no placeholder still admits the same name.
    expect(configuredTimeZoneSchema({ ...release, placeholderZones: [] }).parse("Local")).toBe("Local");
  });

  it("formats every refused zone through one bounded, single-line, control-safe diagnostic", () => {
    const issue = (value: unknown): string => {
      const parsed = LinkResolvedTimeZoneSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      return parsed.success ? "" : parsed.error.issues[0]!.message;
    };
    const unsafe = `bad\n\t\u0000\u2028${"x".repeat(2_000)}`;
    const message = issue(unsafe);
    expect(message).toContain('"bad\\u000a\\u0009\\u0000\\u2028');
    expect(message).not.toContain("\n");
    expect(message).not.toContain("\t");
    expect(message).not.toContain("x".repeat(100));
    expect(message.length).toBeLessThan(260);
    expect(issue({ secret: "never echo this payload" })).toContain("<object>");
    expect(issue(["never echo this payload"])).toContain("<array>");
    expect(issue(null)).toContain("<null>");
  });

  it.each(["householdInstructionVersionRefs", "evidenceSnapshotRefs"] as const)(
    "rejects duplicate replay IDs in %s",
    (key) => {
      const ref = validBundle[key][0]!;
      const parsed = DecisionInputBundleSchema.safeParse({ ...validBundle, [key]: [ref, ref] });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path[0] === key)).toBe(true);
    },
  );

  it("canonicalizes set-like replay collections in parsed evaluator input", () => {
    const fixture = JSON.parse(readFixture("decision-input-bundle")) as typeof validBundle;
    const canonical = DecisionInputBundleSchema.parse(fixture);
    const reversed = DecisionInputBundleSchema.parse({
      ...fixture,
      householdInstructionVersionRefs: [...fixture.householdInstructionVersionRefs].reverse(),
      evidenceSnapshotRefs: [...fixture.evidenceSnapshotRefs].reverse(),
    });
    expect(reversed.householdInstructionVersionRefs).toEqual(canonical.householdInstructionVersionRefs);
    expect(reversed.evidenceSnapshotRefs).toEqual(canonical.evidenceSnapshotRefs);
  });

  it("freezes parsed replay inputs and their nested collections", () => {
    const bundle = DecisionInputBundleSchema.parse(validBundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.policyVersionRef)).toBe(true);
    expect(Object.isFrozen(bundle.householdInstructionVersionRefs)).toBe(true);
    expect(Object.isFrozen(bundle.evidenceSnapshotRefs)).toBe(true);
    expect(Reflect.set(bundle.policyVersionRef, "id", "pv:mutated")).toBe(false);
    expect(Reflect.set(bundle.evidenceSnapshotRefs, 0, { firmId: "firm-a", id: "evs:mutated" })).toBe(false);
  });

  it.each(["decision-record-proceed", "decision-record-blocked", "decision-record-prohibited"])(
    "deep-freezes every hash-bound object and collection in %s",
    (name) => {
      const record = DecisionRecordSchema.parse(JSON.parse(readFixture(name)));
      expectDeepFrozen(record);
      expect(Reflect.set(record, "result", {})).toBe(false);
      if (record.result.kind === "proceed") {
        expect(Reflect.set(record.result.executionPlan, "steps", [])).toBe(false);
        expect(Reflect.set(record.result.executionPlan.steps, 0, {})).toBe(false);
      }
    },
  );

  it("deep-freezes other parsed decision-core boundary outputs", () => {
    for (const value of [
      IntentSchema.parse(validIntent),
      EvidenceSnapshotRefSchema.parse(validSnapshot),
      DecisionInputBundleSchema.parse(validBundle),
      TokenizedPayloadSchema.parse({
        value: { nested: { values: [1, 2, 3] } },
        piiFree: true,
      }),
    ]) {
      expectDeepFrozen(value);
    }
  });

  it("binds each preimage version to its complete recursive projection schema", () => {
    expect(projectionSchemaFingerprint(DecisionInputBundleSchema, ["id", "bundleHash"])).toBe(
      HASH_PROJECTION_SCHEMA_FINGERPRINTS[BUNDLE_HASH_PREIMAGE_VERSION],
    );
    expect(projectionSchemaFingerprint(DecisionRecordSchema, ["decisionHash"])).toBe(
      HASH_PROJECTION_SCHEMA_FINGERPRINTS[DECISION_HASH_PREIMAGE_VERSION],
    );
  });

  it("changes the projection fingerprint when an optional nested field is added", () => {
    const before = z.strictObject({ nested: z.strictObject({ required: z.string() }) });
    const after = z.strictObject({
      nested: z.strictObject({ required: z.string(), newlyOptional: z.string().optional() }),
    });
    expect(projectionSchemaFingerprint(before, [])).not.toBe(projectionSchemaFingerprint(after, []));
  });

  it("locks the versioned, non-self-referential bundle hash preimage and digest", () => {
    const text = readFixture("decision-input-bundle");
    const bundle = DecisionInputBundleSchema.parse(JSON.parse(text));
    expect(unwrap(canonicalJson(JSON.parse(text) as JsonValue))).toBe(text);
    expect(hashPreimage(bundleHashPreimage(bundle))).toBe(bundle.bundleHash);
    const reidentified = DecisionInputBundleSchema.parse({
      ...bundle,
      id: "bundle:reidentified",
      bundleHash: "f".repeat(64),
    });
    expect(hashPreimage(bundleHashPreimage(reidentified))).toBe(bundle.bundleHash);
    expect(
      hashPreimage(
        bundleHashPreimage({
          ...bundle,
          householdInstructionVersionRefs: [...bundle.householdInstructionVersionRefs].reverse(),
          evidenceSnapshotRefs: [...bundle.evidenceSnapshotRefs].reverse(),
        }),
      ),
    ).toBe(bundle.bundleHash);
  });

  it.each(["decision-record-proceed", "decision-record-blocked", "decision-record-prohibited"])(
    "fixture %s round-trips byte-identically and locks its non-self-referential decision digest",
    (name) => {
      const text = readFixture(name);
      const value = JSON.parse(text) as JsonValue;
      const record = DecisionRecordSchema.parse(value);
      expect(unwrap(canonicalJson(value))).toBe(text);
      expect(hashPreimage(decisionHashPreimage(record))).toBe(record.decisionHash);
      const changedStoredHash = DecisionRecordSchema.parse({ ...record, decisionHash: "f".repeat(64) });
      expect(hashPreimage(decisionHashPreimage(changedStoredHash))).toBe(record.decisionHash);
    },
  );

  it("is key-order independent: permuted insertion order yields identical bytes", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    expect(unwrap(canonicalJson(a))).toBe(unwrap(canonicalJson(b)));
    expect(unwrap(canonicalJson(a))).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it("refuses values JSON cannot round-trip instead of silently coercing them", () => {
    expect(canonicalJson(Number.NaN).ok).toBe(false);
    expect(canonicalJson(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(canonicalJson({ a: undefined } as unknown as JsonValue).ok).toBe(false);
    expect(canonicalJson(new Date() as unknown as JsonValue).ok).toBe(false);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(canonicalJson(circular as JsonValue).ok).toBe(false);
  });

  it("keeps that refusal REACHABLE on the production preimage paths, not only on a direct call", () => {
    // canonicalJson's only shipped callers are the two preimage builders, and every
    // payload field they emit passes through optional-property normalization first. If
    // that normalization rebuilds objects from their own entries, a Date/Map/class
    // instance arrives at the serializer already flattened to {} and hashes as {} -
    // structurally different decision inputs collapsing onto one hash, in the
    // audit-chain-critical path. Probing canonicalJson directly cannot see that.
    const bundle = DecisionInputBundleSchema.parse(JSON.parse(readFixture("decision-input-bundle")));
    const record = DecisionRecordSchema.parse(JSON.parse(readFixture("decision-record-proceed")));
    class OpaqueRef {
      readonly firmId = "firm-a";
      readonly id = "dcv:opaque";
    }
    for (const opaque of [new Date(timestamp), new Map([["firmId", "firm-a"]]), new OpaqueRef()]) {
      for (const refused of [
        canonicalJson(bundleHashPreimage({ ...bundle, domainConfigVersionRef: opaque } as unknown as typeof bundle)),
        canonicalJson(decisionHashPreimage({ ...record, intentRef: opaque } as unknown as typeof record)),
        // ...and nested one level down, where the recursive walk does the rebuilding.
        canonicalJson(
          bundleHashPreimage({
            ...bundle,
            policyVersionRef: { firmId: "firm-a", id: opaque },
          } as unknown as typeof bundle),
        ),
      ]) {
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.error.message).toContain("only plain objects");
      }
    }
    // The control: the flattened {} these must NOT be silently confused with DOES
    // serialize, so the assertions above are refusals, not an unrelated failure.
    expect(
      canonicalJson(bundleHashPreimage({ ...bundle, domainConfigVersionRef: {} } as unknown as typeof bundle)).ok,
    ).toBe(true);
    // A plain-object payload still normalizes: explicit undefined is still dropped.
    expect(hashPreimage(bundleHashPreimage(bundle))).toBe(bundle.bundleHash);
  });

  it("names a cycle precisely instead of relying on the stack running out", () => {
    // Detection must not depend on RangeError: whether unbounded recursion is even
    // caught is a host stack-depth accident, and the refusal it produces cannot say
    // WHERE the cycle is - on an explanation tree that is the whole diagnostic.
    const child: Record<string, unknown> = { label: "leaf" };
    const root: Record<string, unknown> = { branch: { children: [child] } };
    child.parent = root;
    const refusal = canonicalJson(root as JsonValue);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.error.message).toContain("circular reference");
      expect(refusal.error.message).toContain("value.branch.children.0.parent");
    }
    // A repeated (non-circular) sibling is NOT a cycle and still serializes.
    const shared = { n: 1 };
    expect(unwrap(canonicalJson({ a: shared, b: shared } as JsonValue))).toBe('{"a":{"n":1},"b":{"n":1}}');
  });

  it("orders the hash preimage by THE canonical comparator, not by id alone", () => {
    // The preimage and the parsed record must sort identically. Today the bundle's
    // superRefine forces one tenant, which makes id-only and (firm, id) order agree
    // and hides a divergence - so probe the preimage with the cross-tenant lists
    // that constraint currently prevents. Relaxing it must not silently change the
    // bytes of already-recorded hashes.
    const crossTenant = [
      { firmId: "firm-b", id: "aaa" },
      { firmId: "firm-a", id: "zzz" },
    ];
    const byFirmThenId = [
      { firmId: "firm-a", id: "zzz" },
      { firmId: "firm-b", id: "aaa" },
    ];
    expect([...crossTenant].sort(compareScopedReferences)).toEqual(byFirmThenId);
    const preimage = bundleHashPreimage({
      ...DecisionInputBundleSchema.parse(validBundle),
      householdInstructionVersionRefs: crossTenant,
      evidenceSnapshotRefs: crossTenant,
    } as unknown as Parameters<typeof bundleHashPreimage>[0]);
    expect(preimage.payload.householdInstructionVersionRefs).toEqual(byFirmThenId);
    expect(preimage.payload.evidenceSnapshotRefs).toEqual(byFirmThenId);
    // A single-tenant list is canonicalized identically by parse and by preimage.
    const bundle = DecisionInputBundleSchema.parse({
      ...validBundle,
      evidenceSnapshotRefs: [
        { firmId: "firm-a", id: "evs:z" },
        { firmId: "firm-a", id: "evs:a" },
      ],
    });
    expect(bundleHashPreimage(bundle).payload.evidenceSnapshotRefs).toEqual([
      ...bundle.evidenceSnapshotRefs,
    ]);
  });

  it("cannot change decisionHash by reordering ANY set-like collection a record carries", () => {
    // decisionHash is what approvals and replay bind to. A planner emitting the same
    // preconditions, conflicts, reservations or dependency edges in a different order
    // describes the SAME decision and must produce the SAME digest - the drift the
    // sorting discipline exists to prevent. The shipped fixture cannot show this on its
    // own (its sets hold one element each), so build the plan that can (D-057).
    type Ref = { firmId: string; id: string };
    type FixtureStep = Record<string, unknown> & {
      conflictKeys: string[];
      dependsOn: string[];
      reservationRefs: Ref[];
      preconditions: Array<Record<string, unknown> & { requiredEvidenceSnapshotRefs: Ref[] }>;
    };
    const base = JSON.parse(readFixture("decision-record-proceed")) as Record<string, unknown> & {
      result: Record<string, unknown> & {
        authority: Record<string, unknown> & {
          stages: Array<Record<string, unknown> & { requirements: Array<Record<string, unknown>> }>;
        };
        executionPlan: Record<string, unknown> & { steps: FixtureStep[] };
      };
    };
    const fixtureStep = base.result.executionPlan.steps[0]!;
    const ref = (id: string) => ({ firmId: "firm-a", id });
    const leaf = (name: string) => ({
      ...fixtureStep,
      id: `step:${name}`,
      idempotencyKey: `idem:${name}`,
      dependsOn: [] as string[],
    });
    const join = {
      ...fixtureStep,
      id: "step:join",
      idempotencyKey: "idem:join",
      dependsOn: ["step:a", "step:b"],
      conflictKeys: ["conflict:z", "conflict:a"],
      reservationRefs: [ref("res:z"), ref("res:a")],
      preconditions: [
        {
          ...fixtureStep.preconditions[0]!,
          code: "precondition:z",
          requiredEvidenceSnapshotRefs: [ref("evs:z"), ref("evs:a")],
        },
        {
          ...fixtureStep.preconditions[0]!,
          code: "precondition:a",
          requiredEvidenceSnapshotRefs: [ref("evs:c"), ref("evs:b")],
        },
      ],
    };
    const roleIds = [ref("operations"), ref("compliance")];
    const record = (steps: unknown[], roles: unknown[]) => ({
      ...base,
      result: {
        ...base.result,
        authority: {
          ...base.result.authority,
          stages: base.result.authority.stages.map((stage) => ({
            ...stage,
            requirements: stage.requirements.map((requirement) => ({
              ...requirement,
              eligibleRoleIds: roles,
            })),
          })),
        },
        executionPlan: { ...base.result.executionPlan, steps },
      },
    });
    const digest = (value: unknown) =>
      hashPreimage(decisionHashPreimage(DecisionRecordSchema.parse(value)));
    const canonical = digest(record([leaf("a"), leaf("b"), join], roleIds));

    const reversed = (key: "dependsOn" | "conflictKeys" | "reservationRefs" | "preconditions" | "requiredEvidenceSnapshotRefs") =>
      key === "preconditions"
        ? { ...join, preconditions: [...join.preconditions].reverse() }
        : key === "requiredEvidenceSnapshotRefs"
        ? {
            ...join,
            preconditions: [
              {
                ...join.preconditions[0]!,
                requiredEvidenceSnapshotRefs: [...join.preconditions[0]!.requiredEvidenceSnapshotRefs].reverse(),
              },
              join.preconditions[1]!,
            ],
          }
        : { ...join, [key]: [...join[key]].reverse() };
    for (const key of ["dependsOn", "conflictKeys", "reservationRefs", "preconditions", "requiredEvidenceSnapshotRefs"] as const) {
      expect(digest(record([leaf("a"), leaf("b"), reversed(key)], roleIds)), key).toBe(canonical);
    }
    // The role-set control, which held before these four sorts landed.
    expect(digest(record([leaf("a"), leaf("b"), join], [...roleIds].reverse()))).toBe(canonical);
    // NON-VACUOUS: the digest is not order-blind in general. `steps` is an ORDERED
    // list, not a set, so reversing it MUST change the hash - otherwise every
    // assertion above would pass on a preimage that ignores ordering entirely.
    expect(digest(record([join, leaf("b"), leaf("a")], roleIds))).not.toBe(canonical);
  });

  it("gives explanation references set discipline and defensively normalizes shaped preimages", () => {
    type Ref = { firmId: string; id: string };
    type Source = {
      sourceType: "firm_policy";
      sourceRef: Ref;
      versionRef: Ref;
    };
    type Node = {
      messageTemplate: string;
      evidenceSnapshotRefs: Ref[];
      sourceRefs: Source[];
      childNodes: Node[];
    };
    type Precondition = Record<string, unknown> & {
      code: string;
      requiredEvidenceSnapshotRefs: Ref[];
    };
    type RecordShape = Record<string, unknown> & {
      explanationTrace: Node[];
      result: {
        executionPlan: {
          steps: Array<Record<string, unknown> & { preconditions: Precondition[] }>;
        };
      };
    };
    const base = JSON.parse(readFixture("decision-record-proceed")) as RecordShape;
    const node = base.explanationTrace[0]!;
    const step = base.result.executionPlan.steps[0]!;
    const ref = (id: string): Ref => ({ firmId: "firm-a", id });
    const source = (id: string): Source => ({
      sourceType: "firm_policy",
      sourceRef: ref(`policy:${id}`),
      versionRef: ref(`policy:${id}@1`),
    });
    const input: RecordShape = {
      ...base,
      explanationTrace: [{
        ...node,
        evidenceSnapshotRefs: [ref("evs:z"), ref("evs:a")],
        sourceRefs: [source("z"), source("a")],
      }],
      result: {
        ...base.result,
        executionPlan: {
          ...base.result.executionPlan,
          steps: [{
            ...step,
            preconditions: [
              { ...step.preconditions[0]!, code: "precondition:z" },
              { ...step.preconditions[0]!, code: "precondition:a" },
            ],
          }],
        },
      },
    };
    const canonical = DecisionRecordSchema.parse(input);
    const shaped = structuredClone(canonical) as unknown as RecordShape;
    shaped.explanationTrace[0]!.evidenceSnapshotRefs.reverse();
    shaped.explanationTrace[0]!.sourceRefs.reverse();
    shaped.result.executionPlan.steps[0]!.preconditions.reverse();
    const digest = (record: Parameters<typeof decisionHashPreimage>[0]) =>
      hashPreimage(decisionHashPreimage(record));
    expect(digest(shaped as unknown as typeof canonical)).toBe(digest(canonical));

    for (const key of ["evidenceSnapshotRefs", "sourceRefs"] as const) {
      const duplicate = structuredClone(input);
      const first = duplicate.explanationTrace[0]![key][0]!;
      duplicate.explanationTrace[0]![key] = [first, first] as Ref[] & Source[];
      expect(DecisionRecordSchema.safeParse(duplicate).success, key).toBe(false);
    }
    const changed = structuredClone(canonical) as unknown as RecordShape;
    changed.explanationTrace[0]!.messageTemplate = "materially changed explanation";
    expect(digest(changed as unknown as typeof canonical)).not.toBe(digest(canonical));
  });

  it("refuses sparse arrays instead of colliding with dense arrays or emitting invalid JSON", () => {
    expect(canonicalJson(Array(1) as JsonValue).ok).toBe(false);
    expect(canonicalJson(Array(2) as JsonValue).ok).toBe(false);
    expect(unwrap(canonicalJson([]))).toBe("[]");
  });

  it("hashes every schema-valid decision even when optional keys were explicitly undefined", () => {
    const value = JSON.parse(readFixture("decision-record-proceed")) as {
      result: { executionPlan: { steps: Array<Record<string, unknown>> } };
      reevaluateWhen: Array<Record<string, unknown>>;
    };
    value.result.executionPlan.steps[0]!.compensatingAction = undefined;
    value.reevaluateWhen = [{ kind: "evidence_changed", subjectRef: undefined }];
    const record = DecisionRecordSchema.parse(value);
    expect(canonicalJson(decisionHashPreimage(record)).ok).toBe(true);
  });
});

function hashPreimage(value: Parameters<typeof canonicalJson>[0]): string {
  return createHash("sha256").update(unwrap(canonicalJson(value)), "utf8").digest("hex");
}

function projectionSchemaFingerprint(schema: z.ZodType, excludedRootKeys: readonly string[]): string {
  const document = structuredClone(z.toJSONSchema(schema)) as Record<string, unknown>;
  delete document.$schema;
  const properties = document.properties as Record<string, unknown>;
  for (const key of excludedRootKeys) delete properties[key];
  if (Array.isArray(document.required)) {
    document.required = document.required.filter((key) => !excludedRootKeys.includes(String(key)));
  }
  return createHash("sha256")
    .update(unwrap(canonicalJson(document as JsonValue)), "utf8")
    .digest("hex");
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

describe("vocabulary locks - aligned with what is on main", () => {
  it("DecisionResult kinds are EXACTLY the scenarios.yaml disposition vocabulary", () => {
    const yaml = parseYaml(readFileSync(join(ROOT, "config/demo/scenarios.yaml"), "utf8")) as {
      state_vocabulary: Array<{ id: string; class: string }>;
    };
    const dispositions = yaml.state_vocabulary.filter((s) => s.class === "disposition").map((s) => s.id);
    const kinds = DecisionResultSchema.unwrap().options.map((o) => o.shape.kind.value);
    expect([...kinds].sort()).toEqual([...dispositions].sort());
  });

  it("evidence freshness matches the golden truth set's vocabulary", () => {
    for (const freshness of ["fresh", "stale", "unknown"]) {
      expect(EvidenceSnapshotRefSchema.safeParse({ ...validSnapshot, freshness }).success).toBe(true);
    }
    expect(EvidenceSnapshotRefSchema.safeParse({ ...validSnapshot, freshness: "expired" }).success).toBe(false);
  });
});

describe("temporal + integrity primitives", () => {
  it("Timestamp admits ONLY the toISOString() byte form - the store's byte-exact ISO discipline", () => {
    expect(TimestampSchema.safeParse(timestamp).success).toBe(true);
    expect(TimestampSchema.safeParse("2026-07-26T09:30:00-04:00").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T09:30:00").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30Z").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30:00Z").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30:00.5Z").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30:00.0000Z").success).toBe(false);
  });

  it("Hash admits only sha256 lowercase hex", () => {
    expect(HashSchema.safeParse(hash).success).toBe(true);
    expect(HashSchema.safeParse(hash.toUpperCase()).success).toBe(false);
    expect(HashSchema.safeParse("c".repeat(63)).success).toBe(false);
  });

  it("Duration admits ISO-8601 durations (the truth set's expiresAfter vocabulary)", () => {
    expect(DurationSchema.safeParse("P3D").success).toBe(true);
    expect(DurationSchema.safeParse("PT30M").success).toBe(true);
    expect(DurationSchema.safeParse("3 days").success).toBe(false);
  });

  it.each(["expiresAfter", "after"] as const)(
    "requires EVERY approval duration (%s) to be strictly positive, sign placement notwithstanding",
    (field) => {
      // The guard reads the duration itself instead of trusting the accepted grammar:
      // 8601-2 permits a sign on each individual component, so a rule phrased as
      // "must not start with -" would admit P-1D / PT-1H as "positive" the day the
      // validator's ISO profile widens - stages born already expired.
      const parse = (duration: string) =>
        field === "after"
          ? EscalationStepSchema.safeParse({ after: duration, roleIds: [role("ops")], reasonCode: "idle" }).success
          : ApprovalTemplateSchema.safeParse({
              firmId: "firm-a",
              id: "apt:u:1",
              stages: [
                {
                  stageId: "stg:ops",
                  order: 0,
                  executionMode: "sequential",
                  requirements: [
                    {
                      eligibleRoleIds: [role("ops")],
                      approvalsRequired: 1,
                      distinctActorsRequired: true,
                      requesterMayApprove: false,
                      priorExecutorMayApprove: true,
                      reasonRequiredOnOverride: true,
                    },
                  ],
                  escalationPath: [],
                  expiresAfter: duration,
                },
              ],
            }).success;
      for (const positive of ["P1D", "PT30M", "P1W", "PT0.001S", "P0Y0M1D"]) {
        expect(parse(positive), `${positive} is strictly positive`).toBe(true);
      }
      for (const nonPositive of ["PT0S", "P0D", "P0Y0M0D", "-P1D", "P-1D", "PT-1H", "+P1D", "P1DT-1H"]) {
        expect(parse(nonPositive), `${nonPositive} is not strictly positive`).toBe(false);
      }
    },
  );

  it("decides positivity from the duration itself, not from the validator's ISO profile", () => {
    // zod 4.4.3's grammar happens to refuse signed components, so the schema alone
    // cannot show whether the guard would still hold if that profile widened to
    // 8601-2. Assert the predicate directly, where a leading-minus heuristic fails.
    for (const positive of ["P1D", "PT30M", "P1W", "PT0.001S", "PT0,5S", "P0Y0M1D"]) {
      expect(isStrictlyPositiveDuration(positive), positive).toBe(true);
    }
    for (const nonPositive of [
      "P-1D",
      "PT-1H",
      "P1DT-1H",
      "-P1D",
      "+P1D",
      "PT0S",
      "P0D",
      "P0Y0M0DT0H0M0S",
      "PT0,0S",
    ]) {
      expect(isStrictlyPositiveDuration(nonPositive), nonPositive).toBe(false);
    }
  });
});

describe("structural-integrity refinements", () => {
  const step = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    targetRef: { firmId: "firm-a", id: "target:house-crm" },
    command: {
      commandType: "submit",
      payloadRef: { firmId: "firm-a", id: `blob:${id}` },
      payloadHash: hash,
    },
    idempotencyKey: `idem:${id}`,
    conflictKeys: [`conflict:${id}`],
    reservationRefs: [],
    preconditions: [{
      code: "evidence-still-fresh",
      requiredEvidenceSnapshotRefs: [
        { firmId: "firm-a", id: `evidence:${id}` },
      ],
      mustStillHoldAtExecution: true,
    }],
    verificationRuleRef: { firmId: "firm-a", id: "vr:u:1" },
    dependsOn: [],
    ...over,
  });

  it("accepts dependency graphs; rejects duplicate ids, duplicate idempotency keys, unknown, self, and cyclic dependencies", () => {
    const good = { id: "plan:u:1", steps: [step("s1"), step("s2", { dependsOn: ["s1"] })] };
    const diamond = {
      id: "plan:u:diamond",
      steps: [step("s1"), step("s2", { dependsOn: ["s1"] }), step("s3", { dependsOn: ["s1"] }), step("s4", { dependsOn: ["s2", "s3"] })],
    };
    expect(ExecutionPlanSchema.safeParse(good).success).toBe(true);
    expect(ExecutionPlanSchema.safeParse(diamond).success).toBe(true);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:2", steps: [step("s1"), step("s1")] }).success).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({ id: "plan:u:3", steps: [step("s1"), step("s2", { idempotencyKey: "idem:s1" })] }).success,
    ).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:4", steps: [step("s1", { dependsOn: ["ghost"] })] }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:5", steps: [step("s1", { dependsOn: ["s1"] })] }).success).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({
        id: "plan:u:6",
        steps: [step("s1", { dependsOn: ["s2"] }), step("s2", { dependsOn: ["s1"] })],
      }).success,
    ).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({
        id: "plan:u:7",
        steps: [
          step("s1", { dependsOn: ["s3"] }),
          step("s2", { dependsOn: ["s1"] }),
          step("s3", { dependsOn: ["s2"] }),
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an evidence snapshot retrieved BEFORE the observation it records", () => {
    // The pair is hash-bound and immutable once parsed, and freshness is derived from
    // it - an inverted pair is a nonsense input, not a lenient one. Equality is legal.
    const observedAt = "2026-07-26T13:30:00.000Z";
    const inverted = {
      ...validSnapshot,
      observedAt,
      retrievedAt: "2026-07-26T13:29:59.999Z",
    };
    const parsed = EvidenceSnapshotRefSchema.safeParse(inverted);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === "retrievedAt")).toBe(true);
    }
    // The companion: the LEGAL counterparts still parse, so the rejection is
    // attributable to the inversion and not to a schema that refuses this shape.
    expect(
      EvidenceSnapshotRefSchema.safeParse({ ...inverted, retrievedAt: observedAt }).success,
    ).toBe(true);
    expect(
      EvidenceSnapshotRefSchema.safeParse({
        ...inverted,
        retrievedAt: "2026-07-26T13:30:00.001Z",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["dependsOn", { dependsOn: ["s0", "s0"] }],
    ["conflictKeys", { conflictKeys: ["conflict:s1", "conflict:s1"] }],
    [
      "reservationRefs",
      {
        reservationRefs: [
          { firmId: "firm-a", id: "reservation:s1" },
          { firmId: "firm-a", id: "reservation:s1" },
        ],
      },
    ],
    [
      "requiredEvidenceSnapshotRefs",
      {
        preconditions: [{
          code: "evidence-still-fresh",
          requiredEvidenceSnapshotRefs: [
            { firmId: "firm-a", id: "evidence:s1" },
            { firmId: "firm-a", id: "evidence:s1" },
          ],
          mustStillHoldAtExecution: true,
        }],
      },
    ],
  ] as const)("rejects duplicate set-like execution collection %s", (_name, over) => {
    const plan = {
      id: "plan:u:duplicates",
      steps: [
        step("s0"),
        step("s1", over),
      ],
    };
    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(false);
  });

  const stageBase = (stageId: string, order: number) => ({
    stageId,
    order,
    executionMode: "sequential",
    requirements: [
      {
        eligibleRoleIds: [role("operations-manager")],
        approvalsRequired: 1,
        distinctActorsRequired: true,
        requesterMayApprove: false,
        priorExecutorMayApprove: true,
        reasonRequiredOnOverride: true,
      },
    ],
    escalationPath: [],
  });
  const approvalStage = (stageId: string, order: number) => ({
    ...stageBase(stageId, order),
    templateRef: { firmId: "firm-a", id: "apt:u:1" },
    expiresAt: timestamp,
  });
  const templateStage = (stageId: string, order: number) => ({
    ...stageBase(stageId, order),
    expiresAfter: "P3D",
  });

  it("accepts distinct approval stages; rejects a duplicate stageId and a duplicate order in every stage-carrying shape", () => {
    const distinct = [approvalStage("stg:ops", 0), approvalStage("stg:manager", 1)];
    const dupId = [approvalStage("stg:ops", 0), approvalStage("stg:ops", 1)];
    const dupOrder = [approvalStage("stg:ops", 0), approvalStage("stg:manager", 0)];
    expect(AuthorityRequirementSchema.safeParse({ mode: "approval", stages: distinct }).success).toBe(true);
    expect(AuthorityRequirementSchema.safeParse({ mode: "approval", stages: dupId }).success).toBe(false);
    expect(AuthorityRequirementSchema.safeParse({ mode: "approval", stages: dupOrder }).success).toBe(false);
    const review = (stages: unknown) => ({ mode: "specialist_review", specialistRoleIds: [role("cco")], stages });
    expect(AuthorityRequirementSchema.safeParse(review(distinct)).success).toBe(true);
    expect(AuthorityRequirementSchema.safeParse(review(dupId)).success).toBe(false);
    expect(AuthorityRequirementSchema.safeParse(review(dupOrder)).success).toBe(false);
    const template = (stages: unknown) => ({ firmId: "firm-a", id: "apt:u:1", stages });
    expect(ApprovalTemplateSchema.safeParse(template([templateStage("stg:ops", 0), templateStage("stg:manager", 1)])).success).toBe(true);
    expect(ApprovalTemplateSchema.safeParse(template([templateStage("stg:ops", 0), templateStage("stg:ops", 1)])).success).toBe(false);
    expect(ApprovalTemplateSchema.safeParse(template([templateStage("stg:ops", 0), templateStage("stg:manager", 0)])).success).toBe(false);
  });

  it("rejects duplicate role sets", () => {
    const duplicateRoles = [role("operations"), role("operations")];
    expect(ActorRefSchema.safeParse({
      firmId: "firm-a",
      actorId: "actor:1",
      roleIds: duplicateRoles,
    }).success).toBe(false);
    expect(ApprovalRequirementSchema.safeParse({
      ...stageBase("stage", 0).requirements[0],
      eligibleRoleIds: duplicateRoles,
    }).success).toBe(false);
    expect(EscalationStepSchema.safeParse({
      after: "P1D",
      roleIds: duplicateRoles,
      reasonCode: "idle",
    }).success).toBe(false);
    expect(AuthorityRequirementSchema.safeParse({
      mode: "specialist_review",
      specialistRoleIds: duplicateRoles,
      stages: [approvalStage("stage", 0)],
    }).success).toBe(false);
  });

  it("canonicalizes role and stage order", () => {
    const actor = ActorRefSchema.parse({
      firmId: "firm-a",
      actorId: "actor:1",
      roleIds: [role("z-role"), role("a-role")],
    });
    const approvalRequirement = ApprovalRequirementSchema.parse({
      ...stageBase("stage", 0).requirements[0],
      eligibleRoleIds: [role("z-role"), role("a-role")],
    });
    const escalation = EscalationStepSchema.parse({
      after: "P1D",
      roleIds: [role("z-role"), role("a-role")],
      reasonCode: "idle",
    });
    const authority = AuthorityRequirementSchema.parse({
      mode: "specialist_review",
      specialistRoleIds: [role("z-role"), role("a-role")],
      stages: [approvalStage("second", 2), approvalStage("first", 1)],
    });
    expect(actor.roleIds.map((ref) => ref.id)).toEqual(["a-role", "z-role"]);
    expect(approvalRequirement.eligibleRoleIds.map((ref) => ref.id)).toEqual(["a-role", "z-role"]);
    expect(escalation.roleIds.map((ref) => ref.id)).toEqual(["a-role", "z-role"]);
    if (authority.mode !== "specialist_review") throw new Error("expected specialist review");
    expect(authority.specialistRoleIds.map((ref) => ref.id)).toEqual(["a-role", "z-role"]);
    expect(authority.stages.map((stage) => stage.order)).toEqual([1, 2]);
  });

  it("canonicalizes and tenant-checks role-based evidence suppliers", () => {
    const request = {
      evidenceKind: "account-balance",
      subjectRef: { firmId: "firm-a", id: "subject:1" },
      suppliableBy: [role("z-role"), "external", role("a-role")],
    };
    expect(
      EvidenceRequestSchema.parse(request).suppliableBy.map((supplier) =>
        typeof supplier === "string" ? supplier : supplier.id,
      ),
    ).toEqual(["external", "a-role", "z-role"]);
    expect(EvidenceRequestSchema.safeParse({
      ...request,
      suppliableBy: [role("operations", "firm-b")],
    }).success).toBe(false);
  });

  it("deadline_reached requires a deadline; other kinds do not", () => {
    expect(RevaluationConditionSchema.safeParse({ kind: "deadline_reached", deadline: timestamp }).success).toBe(true);
    expect(RevaluationConditionSchema.safeParse({ kind: "deadline_reached" }).success).toBe(false);
    expect(RevaluationConditionSchema.safeParse({ kind: "approval_expired" }).success).toBe(true);
  });
});
