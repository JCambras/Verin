import type {
  SignedCaseVariant,
  SignedLedgerEventData,
} from "./signed-case-types";

export interface ProofResult {
  readonly ok: boolean;
  readonly gaps: readonly string[];
}

export interface DecisionProof extends ProofResult {
  readonly event: SignedLedgerEventData | null;
}

export function proof(gaps: readonly string[]): ProofResult {
  const unique = [...new Set(gaps)];
  return { ok: unique.length === 0, gaps: unique };
}

export function eventLabel(
  sourceCase: SignedCaseVariant,
  event: SignedLedgerEventData,
): string {
  const index = sourceCase.ledgerEvents.indexOf(event);
  return `expectedLedgerEvents[${index}] ${event.type}`;
}

export function eventInstant(
  event: SignedLedgerEventData,
): number | null {
  if (!event.recordedAt) return null;
  const parsed = Date.parse(event.recordedAt);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === event.recordedAt
    ? parsed
    : null;
}

export function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  if (!left || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

export function fieldGap(
  sourceCase: SignedCaseVariant,
  event: SignedLedgerEventData,
  field: string,
  valid: boolean,
): string[] {
  return valid
    ? []
    : [`${eventLabel(sourceCase, event)} lacks exact structured ${field}`];
}
