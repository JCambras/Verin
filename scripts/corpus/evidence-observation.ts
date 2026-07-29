import type { RealDerivedCase } from "./real-derived-types";

const AUTHORITIES: Readonly<
  Record<string, (item: RealDerivedCase) => boolean>
> = {
  request: () => false,
  identity: () => false,
  destination: () => false,
  "liquidity-source": () => false,
  reserve: (item) => item.replayPayload.liquidity.reserveState === "missing",
  "pending-action": () => false,
  authority: (item) =>
    item.replayPayload.authority.authorityState === "missing",
  policy: () => false,
  restriction: () => false,
  "legal-hold": () => false,
  "instruction-conflict": (item) =>
    item.replayPayload.instructionConflict.conflictState === "none",
  "recent-change": () => false,
  "tax-review": (item) =>
    item.replayPayload.taxReviewState === "unavailable",
  temporal: () => false,
  execution: () => false,
};

export function evidenceAllowsMissing(
  item: RealDerivedCase,
  plane: string,
): boolean {
  const authority = AUTHORITIES[plane];
  if (authority === undefined) {
    throw new Error(
      `semantic contract has no observation-state authority "${plane}"`,
    );
  }
  return authority(item);
}

export function evidenceObservationAuthorityProblems(
  planes: readonly string[],
): string[] {
  const configured = new Set(planes);
  const authorities = new Set(Object.keys(AUTHORITIES));
  return [
    ...[...configured]
      .filter((plane) => !authorities.has(plane))
      .map(
        (plane) =>
          `evidence plane "${plane}" has no observation-state authority`,
      ),
    ...[...authorities]
      .filter((plane) => !configured.has(plane))
      .map(
        (plane) =>
          `observation-state authority "${plane}" has no evidence plane`,
      ),
  ];
}
