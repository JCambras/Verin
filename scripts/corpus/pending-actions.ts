export const PENDING_ACTION_KINDS = [
  "outgoing-distribution",
  "outgoing-debit",
  "incoming-transfer",
  "incoming-credit",
  "unknown",
  "unclassified",
] as const;

export type PendingActionKind = (typeof PENDING_ACTION_KINDS)[number];

export const PENDING_ACTION_STATES = [
  "pending",
  "settling",
  "blocked",
  "cancelled",
  "rejected",
  "settled",
] as const;

export type PendingActionState = (typeof PENDING_ACTION_STATES)[number];

export type PendingAvailabilitySelector =
  | "unchanged"
  | "settled-included"
  | "settled-excluded";

const ACTION_KIND_REGISTRY: Readonly<
  Record<
    PendingActionKind,
    {
      readonly direction: "outgoing" | "incoming" | "unknown";
      readonly liquidityClass: "distribution" | "debit" | "credit" | "unclassified";
    }
  >
> = {
  "outgoing-distribution": { direction: "outgoing", liquidityClass: "distribution" },
  "outgoing-debit": { direction: "outgoing", liquidityClass: "debit" },
  "incoming-transfer": { direction: "incoming", liquidityClass: "credit" },
  "incoming-credit": { direction: "incoming", liquidityClass: "credit" },
  unknown: { direction: "unknown", liquidityClass: "unclassified" },
  unclassified: { direction: "unknown", liquidityClass: "unclassified" },
};

export function pendingActionLiquidityTreatment(
  kind: PendingActionKind,
  state: PendingActionState,
): {
  readonly direction: "outgoing" | "incoming" | "unknown";
  readonly liquidityClass: "distribution" | "debit" | "credit" | "unclassified";
  readonly reducesEffectiveLiquidity: boolean;
  readonly increasesAvailableLiquidity: boolean;
} {
  const classification = ACTION_KIND_REGISTRY[kind];
  const live = state === "pending" || state === "settling";
  const outgoingReduction =
    classification.direction === "outgoing" &&
    (classification.liquidityClass === "distribution" ||
      classification.liquidityClass === "debit");
  return {
    ...classification,
    reducesEffectiveLiquidity: live && outgoingReduction,
    increasesAvailableLiquidity:
      state === "settled" &&
      classification.direction === "incoming" &&
      classification.liquidityClass === "credit",
  };
}

export function pendingAvailabilitySelector(
  kind: PendingActionKind,
  state: PendingActionState,
  availableMinorIncludesAction: boolean,
): PendingAvailabilitySelector {
  if (!pendingActionLiquidityTreatment(kind, state).increasesAvailableLiquidity) {
    return "unchanged";
  }
  return availableMinorIncludesAction
    ? "settled-included"
    : "settled-excluded";
}

export function pendingAvailabilityAdjustmentMinor(
  kind: PendingActionKind,
  state: PendingActionState,
  availableMinorIncludesAction: boolean,
  amountMinor: bigint,
): bigint | null {
  const treatment = pendingActionLiquidityTreatment(kind, state);
  const expectedEffect = treatment.reducesEffectiveLiquidity
    ? -amountMinor
    : treatment.increasesAvailableLiquidity
      ? amountMinor
      : 0n;
  if (!availableMinorIncludesAction) return expectedEffect;
  const reportedEffect = treatment.direction === "outgoing"
    ? -amountMinor
    : treatment.direction === "incoming"
      ? amountMinor
      : null;
  return reportedEffect === null ? null : expectedEffect - reportedEffect;
}
