import { z } from "zod";
import timeZoneRecords from "./iana-time-zones-2026b.json";

export const IANA_TIME_ZONE_DATA_VERSION = "iana-tzdb/2026b";
export const IANA_TIME_ZONE_REGISTRY_SHA256 = "8125f9d8cdf87a0afaa26fd9a6fd609d659beb20d09b81a016a245d7e0c9efaa";

export const CANONICAL_IANA_TIME_ZONES = Object.freeze(
  [...timeZoneRecords] as [string, ...string[]],
);

const timeZoneByCaseFoldedName = new Map<string, string>(
  CANONICAL_IANA_TIME_ZONES.map((timeZone) => [timeZone.toLowerCase(), timeZone]),
);

export const TimeZoneSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? (timeZoneByCaseFoldedName.get(value.toLowerCase()) ?? value)
      : value,
  z.enum(CANONICAL_IANA_TIME_ZONES),
);
export type TimeZone = z.infer<typeof TimeZoneSchema>;
