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
 * tzdb's placeholder `Zone` for a system whose zone was never set. CLDR/ICU omits it,
 * so `Intl.DateTimeFormat` throws `RangeError` on it. It stays in the `Zone` list
 * because a record that already persisted it must remain parseable and hash-verifiable;
 * it is refused at the CONFIGURATION boundary, where a name no formatter can resolve
 * would boot a firm whose first local-time render throws - fail-late, where charter #7
 * is fail-closed at boot.
 */
export const IANA_TIME_ZONE_PLACEHOLDER_ZONES: readonly string[] = Object.freeze(["Factory"]);

/** ONE tz release: its version, `Zone` names, `Link` aliases, and placeholders. */
export type IanaTimeZoneRelease<V extends string = string> = {
  readonly dataVersion: V;
  readonly zones: readonly string[];
  readonly links: Readonly<Record<string, string>>;
  readonly placeholderZones: readonly string[];
};

export const CURRENT_IANA_TIME_ZONE_RELEASE = Object.freeze({
  dataVersion: IANA_TIME_ZONE_DATA_VERSION,
  zones: CANONICAL_IANA_TIME_ZONES,
  links: CANONICAL_IANA_TIME_ZONE_LINKS,
  placeholderZones: IANA_TIME_ZONE_PLACEHOLDER_ZONES,
});

const indexTimeZoneReleases = <
  const R extends readonly IanaTimeZoneRelease[],
>(
  ...releases: R
): Readonly<{
  [V in R[number]["dataVersion"]]: Extract<R[number], { dataVersion: V }>;
}> =>
  Object.freeze(
    Object.fromEntries(
      releases.map((release) => [release.dataVersion, release]),
    ),
  ) as {
    [V in R[number]["dataVersion"]]: Extract<R[number], { dataVersion: V }>;
  };

/**
 * Every tz release a persisted bundle may be replayed against, keyed by the version it
 * records. An entry carries BOTH halves of its release, because tzdb moves names
 * between them: adopting a newer release advances the `Zone` list and the alias table
 * together, and one un-versioned alias table could not express that (ADR-0029's
 * adoption procedure adds "its version key + registries", plural). Entries are
 * ADDITIVE and never removed: a bundle stamped with an older release must stay
 * parseable against the registry it was evaluated with (D-051, D-053).
 */
export const SUPPORTED_IANA_TIME_ZONE_RELEASES = indexTimeZoneReleases(
  CURRENT_IANA_TIME_ZONE_RELEASE,
);

/** The map's key union - a replay-metadata version is never a bare `string`. */
export type IanaTimeZoneDataVersion = keyof typeof SUPPORTED_IANA_TIME_ZONE_RELEASES;

export const SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS = Object.freeze(
  Object.keys(SUPPORTED_IANA_TIME_ZONE_RELEASES) as [
    IanaTimeZoneDataVersion,
    ...IanaTimeZoneDataVersion[],
  ],
);

/**
 * A branded `Zone` enum over ONE name set, canonicalizing identifier casing. Exported
 * as a factory so the multi-release condition - the only one in which "the union of
 * every release" and "this release" are different sets - is constructible, and
 * therefore provable, before a second release is ever adopted.
 */
const TIME_ZONE_VALUE_LIMIT = 80;
export const formatTimeZoneRefusal = (
  value: unknown,
  release: string,
): string => {
  if (typeof value !== "string") {
    const kind =
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return `time zone for ${release} must be a string; received ${kind}`;
  }
  const singleLine = value.replace(
    /[\p{Cc}\p{Zl}\p{Zp}]/gu,
    "",
  );
  const bounded =
    singleLine.length > TIME_ZONE_VALUE_LIMIT
      ? `${singleLine.slice(0, TIME_ZONE_VALUE_LIMIT)}...`
      : singleLine;
  return `"${bounded}" is not a Zone in ${release}`;
};

export const timeZoneNameCanonicalizer = (
  zones: readonly string[],
): ((value: string) => string) => {
  const byCaseFoldedName = new Map(
    zones.map((zone) => [zone.toLowerCase(), zone]),
  );
  return (value) => byCaseFoldedName.get(value.toLowerCase()) ?? value;
};

export const timeZoneNameSchema = (
  zones: readonly string[],
  release: string,
) => {
  const canonicalize = timeZoneNameCanonicalizer(zones);
  const admitted = new Set(zones);
  return z.preprocess(
    (value) =>
      typeof value === "string"
        ? canonicalize(value)
        : value,
    z
      .enum([...admitted] as [string, ...string[]], {
        error: (issue) => formatTimeZoneRefusal(issue.input, release),
      })
      .brand<"TimeZone">(),
  );
};

/**
 * The union of every SUPPORTED release's `Zone` names. A standalone `TimeZone` spans
 * releases on purpose: tzdb routinely reclassifies a Zone as a Link
 * (America/Nipigon, America/Godthab, Europe/Uzhgorod), and a bundle recorded under
 * the older release still names it - closing this enum over only the newest
 * registry would make that bundle unparseable and unverifiable. WHICH registry a
 * given bundle is held to is decided by the version the bundle itself records
 * (isTimeZoneInRecordedRegistry, consumed by DecisionInputBundleSchema). This union
 * reads ALREADY-PERSISTED records; new input is held to the current release below.
 */
const SUPPORTED_IANA_TIME_ZONE_NAMES = Object.freeze(
  [
    ...new Set(
      SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS.flatMap((version) => [
        ...SUPPORTED_IANA_TIME_ZONE_RELEASES[version].zones,
      ]),
    ),
  ].sort() as [string, ...string[]],
);

export const TimeZoneSchema = timeZoneNameSchema(
  SUPPORTED_IANA_TIME_ZONE_NAMES,
  `supported releases ${SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS.join(", ")}`,
);
export type TimeZone = z.infer<typeof TimeZoneSchema>;

/**
 * Membership in the registry a record RECORDS - not in whichever release happens to
 * ship today. Built as a factory over the release map for the same reason.
 */
export const timeZoneRegistryMembership = <V extends string>(
  releases: Readonly<Record<V, { readonly zones: readonly string[] }>>,
): ((dataVersion: string, timeZone: string) => boolean) => {
  const zonesByVersion = new Map<string, ReadonlySet<string>>(
    (Object.keys(releases) as V[]).map((version) => [version, new Set(releases[version].zones)]),
  );
  return (dataVersion, timeZone) => zonesByVersion.get(dataVersion)?.has(timeZone) ?? false;
};

export const isTimeZoneInRecordedRegistry = timeZoneRegistryMembership(
  SUPPORTED_IANA_TIME_ZONE_RELEASES,
);

const canonicalizeTimeZoneByVersion = new Map(
  SUPPORTED_IANA_TIME_ZONE_DATA_VERSIONS.map((version) => [
    version,
    timeZoneNameCanonicalizer(
      SUPPORTED_IANA_TIME_ZONE_RELEASES[version].zones,
    ),
  ]),
);

export const canonicalizeTimeZoneForRecordedRelease = (
  dataVersion: string,
  timeZone: string,
): string =>
  canonicalizeTimeZoneByVersion.get(
    dataVersion as IanaTimeZoneDataVersion,
  )?.(timeZone) ?? timeZone;

/**
 * Configuration-boundary form: resolves a `Link` alias of THAT SAME release (`UTC`,
 * `US/Eastern`, `Asia/Calcutta`, ...) to its canonical `Zone` BEFORE validation, so an
 * operator value that has always been a legal IANA identifier still boots while
 * everything downstream - persistence, hashing, replay - only ever sees the Zone. That
 * release's placeholders are subtracted AFTER resolution, so neither one nor an alias
 * of one can be configured.
 */
export const configuredTimeZoneSchema = (release: IanaTimeZoneRelease) => {
  const zoneByCaseFoldedAlias = new Map(
    Object.entries(release.links).map(([alias, zone]) => [alias.toLowerCase(), zone]),
  );
  const placeholders = new Set(release.placeholderZones);
  return z.preprocess(
    (value) =>
      typeof value === "string" ? (zoneByCaseFoldedAlias.get(value.toLowerCase()) ?? value) : value,
    timeZoneNameSchema(
      release.zones.filter((zone) => !placeholders.has(zone)),
      release.dataVersion,
    ),
  );
};

/**
 * `FIRM_TIMEZONE` is held to the CURRENT release MINUS its placeholders, never to the
 * cross-release union `TimeZoneSchema` admits: a NEW bundle stamps the CURRENT
 * version, so a configured Zone that only an older release shipped would boot and then
 * fail at every bundle parse, and a placeholder Zone would boot and then throw at the
 * first render. Configuration fails closed at boot (charter #7), never late.
 */
export const LinkResolvedTimeZoneSchema = configuredTimeZoneSchema(
  CURRENT_IANA_TIME_ZONE_RELEASE,
);

/** The default firm zone, parsed so it cannot drift out of the current release. */
export const DEFAULT_FIRM_TIME_ZONE: TimeZone = LinkResolvedTimeZoneSchema.parse("America/New_York");
