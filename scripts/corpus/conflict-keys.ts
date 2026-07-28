/**
 * CONFLICT-KEY FAMILIES (v3 prompt 11, ADR-0034).
 *
 * The derivation is read OUT of signed truth, never imposed on it: the signed
 * fixtures already spell `conflict:smiths-liquidity`, `res:GC-01:liquidity` and
 * `idem:GC-01:smiths-75000-2026-08-15`, so these functions are defined to
 * reproduce those literals EXACTLY. No signed fixture changes and no re-signoff
 * is triggered - the `conflict-key-families` fence asserts the reproduction
 * against the live signed set.
 *
 * Two mechanisms are kept apart on purpose:
 *  - CONFLICT control answers "different actions competing for one resource"
 *    (GC-10 / GC-11) and is keyed by (scope, family);
 *  - IDEMPOTENCY answers "the same action attempted twice" (GC-12) and is keyed
 *    by the DECISION, not by its facts.
 * Conflating them is a live failure mode: seven of the eight signed idempotency
 * literals share the facts `smiths-75000-2026-08-15`, so a facts-only key
 * collapses seven distinct decisions onto one. The fence proves that collision
 * against the live signed set and proves the shipped derivation avoids it.
 */

/** The seven resource families a reservation may contend on. */
export const CONFLICT_FAMILIES = [
  "liquidity",
  "bank-instruction",
  "account-registration",
  "household-instruction",
  "regulatory-hold",
  "party-authority",
  "model-rebalance",
] as const;
export type ConflictFamily = (typeof CONFLICT_FAMILIES)[number];

/**
 * Deliberately NOT a conflict family. An external submission attempted twice is
 * an idempotency question; giving it a conflict key would make a retry contend
 * with itself. Exported so the fence can assert the exclusion is a decision
 * rather than an omission.
 */
export const NON_CONFLICT_MECHANISMS = ["external-submission"] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const assertSlug = (label: string, value: string): string => {
  if (!SLUG.test(value)) {
    throw new Error(`conflict-keys: ${label} "${value}" must be a lowercase hyphenated slug`);
  }
  return value;
};

export const isConflictFamily = (value: string): value is ConflictFamily =>
  (CONFLICT_FAMILIES as readonly string[]).includes(value);

/** `conflict:<scope>-<family>` - reproduces `conflict:smiths-liquidity`. */
export function conflictKey(scopeSlug: string, family: ConflictFamily): string {
  assertSlug("scope", scopeSlug);
  if (!isConflictFamily(family)) throw new Error(`conflict-keys: unknown family "${family}"`);
  return `conflict:${scopeSlug}-${family}`;
}

/**
 * Reservation IDENTITY is the pair, never the string alone (ADR-0026: FirmId is
 * org_id). The signed literal `conflict:smiths-liquidity` carries no firm, and
 * the demo's headline act runs the same household under two firms - if lookup
 * keyed on the string, Firm A's GC-10 reservation would block Firm B's GC-02 and
 * the comparison would break. Reservations themselves are prompt 23; prompt 11
 * records the requirement and fences that corpus keys are only ever compared
 * within a firm scope.
 */
export interface ScopedConflictKey {
  readonly firmId: string;
  readonly conflictKey: string;
}

export const scopedConflictKey = (
  firmId: string,
  scopeSlug: string,
  family: ConflictFamily,
): ScopedConflictKey => ({ firmId: assertSlug("firmId", firmId), conflictKey: conflictKey(scopeSlug, family) });

export const sameConflict = (left: ScopedConflictKey, right: ScopedConflictKey): boolean =>
  left.firmId === right.firmId && left.conflictKey === right.conflictKey;

/** `res:<caseId>:<family>` - reproduces `res:GC-01:liquidity`. */
export function reservationKey(caseId: string, family: ConflictFamily): string {
  if (!isConflictFamily(family)) throw new Error(`conflict-keys: unknown family "${family}"`);
  return `res:${caseId}:${family}`;
}

/**
 * `idem:<caseId>:<scope>-<discriminator>` - reproduces
 * `idem:GC-01:smiths-75000-2026-08-15` and `idem:GC-10:smiths-75000-renovation`.
 * The caseId is what makes the key an identity of the DECISION rather than of
 * its facts, so two decisions with identical facts never share a key.
 */
export function idempotencyKey(caseId: string, scopeSlug: string, discriminator: string): string {
  assertSlug("scope", scopeSlug);
  assertSlug("discriminator", discriminator);
  return `idem:${caseId}:${scopeSlug}-${discriminator}`;
}

/**
 * The NAIVE facts-only derivation, shipped so the fence can prove it collides on
 * real signed data. It is never used to generate anything.
 */
export const factsOnlyIdempotencyKey = (scopeSlug: string, discriminator: string): string =>
  `idem:${scopeSlug}-${discriminator}`;
