/**
 * CORPUS WORLD CLOCK (v3 prompt 11, ADR-0052).
 *
 * Deterministic instant arithmetic in ONE canonical byte form: the
 * `Date.prototype.toISOString()` shape `TimestampSchema` accepts
 * (`YYYY-MM-DDTHH:MM:SS.mmmZ`, three fractional digits, `Z`).
 *
 * There is no wall clock here and no locale API. Every instant descends from the
 * spec's `asOf` by an explicit offset, and local rendering is computed from tz
 * TRANSITION INSTANTS carried in the hand-owned spec and pinned to a tzdb
 * release - never from a hardcoded `-04:00` and never from `Intl`, whose output
 * depends on the host ICU build. The `corpus-timestamps` fence checks those
 * committed transitions against the platform tz database as an INDEPENDENT
 * oracle, so a wrong transition fails the build rather than silently rendering a
 * plausible offset (design §4.6.6).
 */

/** Per-evidence-kind observation/retrieval realism, committed as data. */
export interface EvidenceKindTiming {
  /** Minimum seconds between `trigger.asOf` and `retrievedAt` - the band is
   * measured from the DECISION instant, not from `observedAt`, because retrieval
   * is what the evaluation does and observation is what the source already did.
   * Zero latency is the "all timestamps are the same second" tell of an invented
   * fixture. */
  readonly minRetrievalLagSeconds: number;
  readonly maxRetrievalLagSeconds: number;
  /** Freshness window in whole days: `asOf - observedAt` beyond it is `stale`. */
  readonly freshnessWindowDays: number;
}

export interface TimeZoneTransition {
  /** The UTC instant at which `offsetMinutes` starts applying. */
  readonly at: string;
  /** Minutes to ADD to UTC to get local time (EST = -300, EDT = -240). */
  readonly offsetMinutes: number;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function assertCanonicalInstant(value: string, where: string): string {
  if (!ISO_UTC.test(value)) {
    throw new Error(`corpus clock: ${where} "${value}" is not canonical UTC (YYYY-MM-DDTHH:MM:SS.mmmZ)`);
  }
  return value;
}

/** Milliseconds since epoch. `new Date(<explicit ISO>)` only - never argless. */
export function epochMs(instant: string): number {
  const ms = new Date(assertCanonicalInstant(instant, "instant")).getTime();
  if (!Number.isFinite(ms)) throw new Error(`corpus clock: unparseable instant "${instant}"`);
  return ms;
}

export function fromEpochMs(ms: number): string {
  if (!Number.isSafeInteger(ms)) throw new Error(`corpus clock: non-integer epoch ${ms}`);
  return assertCanonicalInstant(new Date(ms).toISOString(), "derived instant");
}

export const addSeconds = (instant: string, seconds: number): string =>
  fromEpochMs(epochMs(instant) + seconds * 1000);

export const addDays = (instant: string, days: number): string => addSeconds(instant, days * 86_400);

export const diffSeconds = (later: string, earlier: string): number =>
  (epochMs(later) - epochMs(earlier)) / 1000;

/** 0 = Sunday … 6 = Saturday, in UTC. */
const utcDayOfWeek = (instant: string): number => new Date(epochMs(instant)).getUTCDay();

/** 0 = Sunday … 6 = Saturday, in the zone the transition table describes. */
export const localDayOfWeek = (
  instant: string,
  transitions: readonly TimeZoneTransition[],
): number => utcDayOfWeek(localWallClockInstant(instant, transitions));

export const isLocalWeekend = (
  instant: string,
  transitions: readonly TimeZoneTransition[],
): boolean => [0, 6].includes(localDayOfWeek(instant, transitions));

/** One LOCAL calendar day later, not 86 400 seconds later. Across a DST
 * transition a fixed 24-hour step drifts the local wall clock by an hour, so a
 * day counter stepping in raw seconds can revisit or skip a local calendar date
 * near midnight - and `settlementEarliest` would be a day out. The offset
 * correction holds the local time of day fixed. */
const addLocalDay = (
  instant: string,
  transitions: readonly TimeZoneTransition[],
): string => {
  const shifted = addDays(instant, 1);
  const before = localOffsetMinutes(instant, transitions);
  const after = localOffsetMinutes(shifted, transitions);
  return before === after ? shifted : addSeconds(shifted, (before - after) * 60);
};

/** Advance by whole BUSINESS days in the given zone: Saturdays and Sundays in
 * LOCAL time are skipped, so "two business days later" can never land on a
 * Sunday (design §4.6.6). Weekend-only; holiday calendars are a firm-policy
 * concern that prompt 10 owns and this corpus deliberately does not invent. */
export function addBusinessDays(
  instant: string,
  days: number,
  transitions: readonly TimeZoneTransition[],
): string {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new Error(`corpus clock: business-day count must be a non-negative integer, got ${days}`);
  }
  let current = instant;
  for (let moved = 0; moved < days; ) {
    current = addLocalDay(current, transitions);
    if (!isLocalWeekend(current, transitions)) moved += 1;
  }
  return current;
}

/** Offset (minutes to add to UTC) in force at `instant`, from the pinned
 * transition table. An instant before the first recorded transition is a spec
 * gap, not a default: refuse rather than silently assume standard time. */
export function localOffsetMinutes(
  instant: string,
  transitions: readonly TimeZoneTransition[],
): number {
  const at = epochMs(instant);
  let current: TimeZoneTransition | null = null;
  for (const transition of transitions) {
    if (
      epochMs(transition.at) <= at &&
      (current === null || epochMs(transition.at) > epochMs(current.at))
    ) {
      current = transition;
    }
  }
  if (current === null) {
    throw new Error(
      `corpus clock: no pinned time-zone transition covers "${instant}" - extend the spec's transition table`,
    );
  }
  return current.offsetMinutes;
}

/** The instant shifted INTO local wall-clock terms (for day-of-week questions). */
const localWallClockInstant = (
  instant: string,
  transitions: readonly TimeZoneTransition[],
): string => addSeconds(instant, localOffsetMinutes(instant, transitions) * 60);

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

/** `YYYY-MM-DDTHH:MM:SS.mmm±HH:MM` - the local rendering of a canonical instant. */
export function renderLocal(instant: string, transitions: readonly TimeZoneTransition[]): string {
  const offsetMinutes = localOffsetMinutes(instant, transitions);
  const shifted = localWallClockInstant(instant, transitions);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${shifted.slice(0, 23)}${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`;
}

/** `fresh` | `stale`, DERIVED from the per-kind window rather than asserted.
 * `EvidenceFreshnessSchema` records freshness because the contracts layer has no
 * threshold policy; the corpus has one, so it recomputes instead of trusting a
 * label (design §4.6.4). */
export function deriveFreshness(
  asOf: string,
  observedAt: string,
  timing: EvidenceKindTiming,
): "fresh" | "stale" {
  return diffSeconds(asOf, observedAt) > timing.freshnessWindowDays * 86_400 ? "stale" : "fresh";
}

/** True iff `recordChangedAt` sits inside the firm's recent-change window before
 * `asOf`. Recent-change membership is a fact about when the RECORD changed, never
 * about when a source last observed it: passing `observedAt` here is the
 * `evidence-staleness-unnoticed` conflation this window exists to measure. */
export const isWithinRecentChangeWindow = (
  asOf: string,
  recordChangedAt: string,
  windowDays: number,
): boolean => {
  const age = diffSeconds(asOf, recordChangedAt);
  return age >= 0 && age <= windowDays * 86_400;
};
