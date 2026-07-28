import { z } from "zod";
import timeZoneRecords from "../../iana-time-zones-2026b.json";

export type IanaTimeZoneRelease<V extends string = string> = {
  readonly dataVersion: V;
  readonly zones: readonly string[];
};

const RELEASE = Object.freeze({
  dataVersion: "iana-tzdb/2026b",
  zones: Object.freeze([...timeZoneRecords] as [string, ...string[]]),
});

export const SUPPORTED_IANA_TIME_ZONE_RELEASE_LIST = Object.freeze([
  RELEASE,
] as const);

const VALUE_LIMIT = 80;

export const formatTimeZoneRefusal = (
  value: unknown,
  release: string,
): string => {
  if (typeof value !== "string") {
    const kind =
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return `time zone for ${release} must be a string; received ${kind}`;
  }
  const singleLine = value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "");
  const bounded =
    singleLine.length > VALUE_LIMIT
      ? `${singleLine.slice(0, VALUE_LIMIT)}...`
      : singleLine;
  return `"${bounded}" is not a Zone in ${release}`;
};

const canonicalizer = (zones: readonly string[]) => {
  const names = new Map(zones.map((zone) => [zone.toLowerCase(), zone]));
  return (value: string): string => names.get(value.toLowerCase()) ?? value;
};

export const timeZoneNameSchema = (
  zones: readonly string[],
  release: string,
) => {
  const canonicalize = canonicalizer(zones);
  return z.preprocess(
    (value) => (typeof value === "string" ? canonicalize(value) : value),
    z.enum([...zones] as [string, ...string[]], {
      error: (issue) => formatTimeZoneRefusal(issue.input, release),
    }).brand<"TimeZone">(),
  );
};

export const timeZoneRegistryMembership = <V extends string>(
  releases: readonly IanaTimeZoneRelease<V>[],
) => {
  const zonesByVersion = new Map<string, ReadonlySet<string>>(
    releases.map((release) => [
      release.dataVersion,
      new Set(release.zones),
    ]),
  );
  return (dataVersion: string, timeZone: string): boolean =>
    zonesByVersion.get(dataVersion)?.has(timeZone) ?? false;
};

const canonicalizeByVersion = new Map<string, (value: string) => string>(
  SUPPORTED_IANA_TIME_ZONE_RELEASE_LIST.map((release) => [
    release.dataVersion,
    canonicalizer(release.zones),
  ]),
);

export const canonicalizeTimeZoneForRecordedRelease = (
  dataVersion: string,
  timeZone: string,
): string => canonicalizeByVersion.get(dataVersion)?.(timeZone) ?? timeZone;
