/**
 * The CLOSED catalogs behind every policy knob the demonstration exposes: the
 * reserve horizons, freshness windows, bank-change handlings, dual-approval
 * thresholds, and normal-approval clocks an administrator may select.
 *
 * They live in ONE module because the option id is what a configuration HASHES: a
 * second copy of a number or a clock string would let a printed rule disagree with
 * the rule the evaluator applied and the bundle hash bound. `data.ts` (the world),
 * `setup-policy.ts` (the evaluator), and the signed-case reader all resolve option
 * ids through here and nowhere else.
 */
export type BankChangeHandling =
  | "specialist-review"
  | "block-until-independently-verified";

export const RESERVE_MONTHS: Readonly<Record<string, number>> = {
  "6-months": 6,
  "9-months": 9,
  "12-months": 12,
};

export const FRESHNESS_DAYS: Readonly<Record<string, number>> = {
  "7-days": 7,
  "14-days": 14,
  "30-days": 30,
};

/** How recently a bank instruction must have changed for change handling to apply.
 * Locked, not selectable: the administrator chooses the HANDLING, never the window. */
export const BANK_CHANGE_RECENCY_DAYS = 7;

export const BANK_HANDLING: Readonly<
  Record<string, BankChangeHandling>
> = {
  specialist: "specialist-review",
  block: "block-until-independently-verified",
};

export const THRESHOLD_MINOR: Readonly<Record<string, number>> = {
  "25000": 2_500_000,
  "50000": 5_000_000,
  "100000": 10_000_000,
};

/** Resolve a closed-choice option id through its table. An unknown id is an error,
 * never a silent default: a default here would print a rule nobody chose. */
export function closedChoiceValue<T>(
  table: Readonly<Record<string, T>>,
  optionId: string,
  label: string,
): T {
  const value = table[optionId];
  if (value === undefined) {
    throw new Error(`Unsupported ${label} selection: ${optionId}`);
  }
  return value;
}

/**
 * The closed catalog of normal-approval clocks. ONE source, because the clock id is
 * what the configuration hashes: a second copy of the strings would let a printed
 * clock disagree with the id the bundle hash says both configurations name.
 */
export interface ApprovalClock {
  readonly id: string;
  readonly escalationAfter: string;
  readonly expiresAfter: string;
  readonly escalation: string;
  readonly expiry: string;
}

function approvalDuration(value: string): {
  days: number;
  hours: number;
} {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(
      `Unsupported demonstration approval duration: ${value}`,
    );
  }
  return {
    days: Number(match[1] ?? 0),
    hours: Number(match[2] ?? 0),
  };
}

function approvalDurationLabel(value: string): string {
  const { days, hours } = approvalDuration(value);
  return [
    days > 0 ? `${days} day${days === 1 ? "" : "s"}` : null,
    hours > 0
      ? `${hours} hour${hours === 1 ? "" : "s"}`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

function approvalClock(
  id: string,
  escalationAfter: string,
  expiresAfter: string,
): ApprovalClock {
  return {
    id,
    escalationAfter,
    expiresAfter,
    escalation: `Escalates after ${approvalDurationLabel(escalationAfter)}`,
    expiry: `Expires after ${approvalDurationLabel(expiresAfter)}`,
  };
}

export const APPROVAL_CLOCKS: Readonly<Record<string, ApprovalClock>> = {
  "4h-2d": approvalClock("4h-2d", "PT4H", "P2D"),
  "1d-3d": approvalClock("1d-3d", "P1D", "P3D"),
  "2d-5d": approvalClock("2d-5d", "P2D", "P5D"),
} as const;

/** The clock the fixture journey runs under, and the id its configuration hashes. */
export const DEFAULT_APPROVAL_CLOCK: ApprovalClock = APPROVAL_CLOCKS["1d-3d"]!;

/** One ISO-8601 approval duration in milliseconds. The signed cases state durations
 * and the demo stores absolute expiries; comparing them requires ONE conversion, so
 * both sides read this rather than each parsing "P3D" its own way. */
export function approvalDurationMs(value: string): number {
  const { days, hours } = approvalDuration(value);
  return days * 86_400_000 + hours * 3_600_000;
}

export function approvalExpiryAt(
  createdAt: string,
  expiresAfter: string,
): string {
  return new Date(
    Date.parse(createdAt) + approvalDurationMs(expiresAfter),
  ).toISOString();
}
