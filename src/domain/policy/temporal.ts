/**
 * Deterministic temporal arithmetic for the policy interpreter (prompt 9,
 * ADR-0053). NO Date, NO Intl, NO tz data - the `policy-ast` fence bans them
 * (same discipline as the primitive catalog): timestamps here are the canonical
 * UTC byte form the Timestamp brand pins (YYYY-MM-DDTHH:MM:SS.mmmZ), so epoch
 * math is pure integer arithmetic over the proleptic Gregorian calendar.
 *
 * Durations are DAY-OR-FINER only. A freshness window carrying years or months
 * would need calendar anchoring semantics nobody has ratified (which month does
 * `P1M` before an observation span?), and a fractional component would invite
 * float drift into replay hashes - both are LOAD-TIME refusals with precise
 * errors, per the OQ-7 ruling that interim temporal mechanisms are rejected
 * rather than improvised.
 */

const DAY_MS = 86_400_000;

/** Days from 1970-01-01 for a proleptic-Gregorian civil date (Howard Hinnant's algorithm). */
const daysFromCivil = (year: number, month: number, day: number): number => {
  const shiftedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.trunc((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.trunc(yearOfEra / 4) - Math.trunc(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
};

const CANONICAL_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

/**
 * Epoch milliseconds of a canonical UTC timestamp; null when the byte form is
 * not the pinned one (a caller upstream of the Timestamp brand hands us raw
 * strings, and the fail-closed answer to a malformed instant is refusal).
 */
export const epochMillisOf = (timestamp: string): number | null => {
  const match = timestamp.match(CANONICAL_TIMESTAMP);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second, millis] = match;
  const days = daysFromCivil(Number(year), Number(month), Number(day));
  return (
    days * DAY_MS +
    Number(hour) * 3_600_000 +
    Number(minute) * 60_000 +
    Number(second) * 1_000 +
    Number(millis)
  );
};

/** ISO-8601 duration, day-or-finer, integer components (see the module header). */
const DAY_OR_FINER_DURATION =
  /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export type DurationRefusal = {
  readonly reason: "calendar-granularity" | "fractional-component" | "malformed" | "empty";
};

/**
 * Milliseconds of a day-or-finer ISO duration. Weeks are exactly seven days.
 * Years/months (calendar granularity), fractional components, and anything
 * unparseable refuse with a typed reason for the loader to surface.
 */
export const durationToMillis = (
  duration: string,
): { readonly ok: true; readonly millis: number } | { readonly ok: false; readonly refusal: DurationRefusal } => {
  // A Y or M before the time designator is calendar-granular (minutes live
  // after T; months never do).
  if (/[YM]/.test(duration.split("T")[0]!)) {
    return { ok: false, refusal: { reason: "calendar-granularity" } };
  }
  if (duration.includes(".") || duration.includes(",")) {
    return { ok: false, refusal: { reason: "fractional-component" } };
  }
  const match = duration.match(DAY_OR_FINER_DURATION);
  if (match === null) return { ok: false, refusal: { reason: "malformed" } };
  const [, weeks, days, hours, minutes, seconds] = match;
  if (!weeks && !days && !hours && !minutes && !seconds) {
    return { ok: false, refusal: { reason: "empty" } };
  }
  return {
    ok: true,
    millis:
      Number(weeks ?? 0) * 7 * DAY_MS +
      Number(days ?? 0) * DAY_MS +
      Number(hours ?? 0) * 3_600_000 +
      Number(minutes ?? 0) * 60_000 +
      Number(seconds ?? 0) * 1_000,
  };
};

