import { z } from "zod";
import timeZoneRecords from "./iana-time-zones-2026b.json";
import timeZoneLinkRecords from "./iana-time-zone-links-2026b.json";

export const IANA_TIME_ZONE_DATA_VERSION = "iana-tzdb/2026b";
export const IANA_TIME_ZONE_REGISTRY_SHA256 = "8125f9d8cdf87a0afaa26fd9a6fd609d659beb20d09b81a016a245d7e0c9efaa";
export const IANA_TIME_ZONE_LINK_REGISTRY_SHA256 = "d00c1e0c0184166aba674a6b0a80b5d00a7737f311b670f3c49f72063f27e570";

export const CANONICAL_IANA_TIME_ZONES = Object.freeze(
  [...timeZoneRecords] as [string, ...string[]],
);

/**
 * The pinned release's `Link` aliases resolved to their canonical `Zone` target.
 * Aliases are NOT replay values - a bundle persists and hashes the canonical Zone
 * only - so this table exists solely to canonicalize operator-supplied input at the
 * configuration boundary (ADR-0029, D-051).
 */
export const CANONICAL_IANA_TIME_ZONE_LINKS: Readonly<Record<string, string>> =
  Object.freeze({ ...timeZoneLinkRecords });

/**
 * Every tz registry a persisted bundle may be replayed against, keyed by the
 * version it records. Entries are ADDITIVE and never removed: a bundle stamped with
 * an older release must stay parseable against the registry it was evaluated with.
 */
export const SUPPORTED_IANA_TIME_ZONE_REGISTRIES = Object.freeze({
  [IANA_TIME_ZONE_DATA_VERSION]: CANONICAL_IANA_TIME_ZONES,
});

/** The map's key union - a replay-metadata version is never a bare `string`. */
export type IanaTimeZoneDataVersion = keyof typeof SUPPORTED_IANA_TIME_ZONE_REGISTRIES;

export const SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS = Object.freeze(
  Object.keys(SUPPORTED_IANA_TIME_ZONE_REGISTRIES) as [
    IanaTimeZoneDataVersion,
    ...IanaTimeZoneDataVersion[],
  ],
);

/**
 * The union of every SUPPORTED registry's `Zone` names. A standalone `TimeZone`
 * spans releases on purpose: tzdb routinely reclassifies a Zone as a Link
 * (America/Nipigon, America/Godthab, Europe/Uzhgorod), and a bundle recorded under
 * the older release still names it - closing this enum over only the newest
 * registry would make that bundle unparseable and unverifiable. WHICH registry a
 * given bundle is held to is decided by the version the bundle itself records
 * (isTimeZoneInRecordedRegistry, consumed by DecisionInputBundleSchema).
 */
const SUPPORTED_IANA_TIME_ZONE_NAMES = Object.freeze(
  [
    ...new Set(
      SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS.flatMap((version) => [
        ...SUPPORTED_IANA_TIME_ZONE_REGISTRIES[version],
      ]),
    ),
  ].sort() as [string, ...string[]],
);

const timeZoneByCaseFoldedName = new Map<string, string>(
  SUPPORTED_IANA_TIME_ZONE_NAMES.map((timeZone) => [timeZone.toLowerCase(), timeZone]),
);

const zoneByCaseFoldedLinkName = new Map<string, string>(
  Object.entries(CANONICAL_IANA_TIME_ZONE_LINKS).map(([alias, zone]) => [alias.toLowerCase(), zone]),
);

export const TimeZoneSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? (timeZoneByCaseFoldedName.get(value.toLowerCase()) ?? value)
      : value,
  z.enum(SUPPORTED_IANA_TIME_ZONE_NAMES).brand<"TimeZone">(),
);
export type TimeZone = z.infer<typeof TimeZoneSchema>;

/**
 * Membership in the registry a record RECORDS - not in whichever release happens to
 * ship today. Built as a factory over the registry map so the multi-registry case is
 * constructible, and therefore provable, before a second release is ever adopted.
 */
export const timeZoneRegistryMembership = <V extends string>(
  registries: Readonly<Record<V, readonly string[]>>,
): ((dataVersion: string, timeZone: string) => boolean) => {
  const namesByVersion = new Map<string, ReadonlySet<string>>(
    (Object.keys(registries) as V[]).map((version) => [version, new Set(registries[version])]),
  );
  return (dataVersion, timeZone) => namesByVersion.get(dataVersion)?.has(timeZone) ?? false;
};

export const isTimeZoneInRecordedRegistry = timeZoneRegistryMembership(
  SUPPORTED_IANA_TIME_ZONE_REGISTRIES,
);

/**
 * Configuration-boundary form: resolves a pinned `Link` alias (`UTC`, `US/Eastern`,
 * `Asia/Calcutta`, ...) to its canonical `Zone` BEFORE validation, so an operator
 * value that has always been a legal IANA identifier still boots while everything
 * downstream - persistence, hashing, replay - only ever sees the canonical Zone.
 */
export const LinkResolvedTimeZoneSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? (zoneByCaseFoldedLinkName.get(value.toLowerCase()) ?? value)
      : value,
  TimeZoneSchema,
);

/** The default firm zone, parsed so it cannot drift out of the pinned registry. */
export const DEFAULT_FIRM_TIME_ZONE: TimeZone = TimeZoneSchema.parse("America/New_York");
