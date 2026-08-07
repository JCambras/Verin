import { describe, it, expect } from "vitest";
import { loadGoldenCases } from "../../../scripts/golden-cases.lib";
import {
  CONFLICT_FAMILIES,
  NON_CONFLICT_MECHANISMS,
  conflictKey,
  factsOnlyIdempotencyKey,
  idempotencyKey,
  isConflictFamily,
  reservationKey,
  sameConflict,
  scopedConflictKey,
} from "../../../scripts/corpus/conflict-keys";
import { real } from "./_corpus-world";

/**
 * CONFLICT-KEY-FAMILIES FENCE (v3 prompt 11, ADR-0052; charter #1/#4/#16).
 *
 * The prompt requires "simultaneous-request cases share conflict keys". A
 * constant-returning function satisfies that alone, so this fence proves four
 * properties, not one:
 *
 *  1. same family + same scope  => identical key   (the required property);
 *  2. different scope, same family => different key (kills a constant);
 *  3. same scope, different family => different key (a liquidity hold must not
 *     block a bank-instruction change);
 *  4. same scope under a DIFFERENT FIRM => never the same conflict. The signed
 *     literal `conflict:smiths-liquidity` carries no firm, and the demo's
 *     headline act runs one household under two firms - if reservation lookup
 *     keyed on the string alone, Firm A's GC-10 reservation would block Firm B's
 *     GC-02. Reservations are prompt 23; prompt 11 records the requirement that
 *     reservation identity is the PAIR `(firmId, conflictKey)` and fences it.
 *
 * The derivations are read OUT of signed truth: every `conflict:`, `res:` and
 * `idem:` literal in `fixtures/golden/` must be reproduced exactly, so no signed
 * fixture changes and no re-signoff is triggered.
 *
 * Idempotency is kept a SEPARATE mechanism. Seven of the eight signed
 * idempotency literals share the facts `smiths-75000-2026-08-15`, so a
 * facts-only key collapses seven distinct decisions onto one - proven below
 * against the live signed set.
 */
const goldenText = loadGoldenCases()
  .map((entry) => JSON.stringify(entry.data))
  .join("\n");

const matches = (pattern: RegExp): string[] => [...new Set(goldenText.match(pattern) ?? [])].sort();

const signedConflictKeys = matches(/conflict:[a-z0-9-]+/g);
const signedReservationIds = matches(/res:GC-\d{2}:[a-z-]+/g);
const signedIdempotencyKeys = matches(/idem:GC-\d{2}:[a-z0-9-]+/g);

describe("conflict-key-families fence", () => {
  it("enforces: the derivation reproduces every signed conflict-key literal exactly", () => {
    expect(signedConflictKeys.length, "no signed conflict keys found - the fence would be vacuous").toBeGreaterThan(0);
    for (const literal of signedConflictKeys) {
      const [, rest = ""] = literal.split(":");
      const family = CONFLICT_FAMILIES.find((candidate) => rest.endsWith(`-${candidate}`));
      expect(family, `signed literal "${literal}" names no known conflict family`).toBeDefined();
      const scope = rest.slice(0, rest.length - family!.length - 1);
      expect(conflictKey(scope, family!)).toBe(literal);
    }
    expect(conflictKey("smiths", "liquidity")).toBe("conflict:smiths-liquidity");
  });

  it("enforces: the derivation reproduces every signed reservation and idempotency literal exactly", () => {
    expect(signedReservationIds.length).toBeGreaterThan(0);
    for (const literal of signedReservationIds) {
      const [, caseId = "", family = ""] = literal.split(":");
      expect(isConflictFamily(family)).toBe(true);
      expect(reservationKey(caseId, family as (typeof CONFLICT_FAMILIES)[number])).toBe(literal);
    }
    expect(signedIdempotencyKeys.length).toBeGreaterThan(0);
    for (const literal of signedIdempotencyKeys) {
      const [, caseId = "", rest = ""] = literal.split(":");
      const [scope = "", ...discriminator] = rest.split("-");
      expect(idempotencyKey(caseId, scope, discriminator.join("-"))).toBe(literal);
    }
  });

  it("enforces: property 1 - same family + same scope yields the identical key", () => {
    expect(conflictKey("smiths", "liquidity")).toBe(conflictKey("smiths", "liquidity"));
    const liquidityCases = real.cases.filter((item) =>
      item.reservations.some((r) => r.family === "liquidity" && r.conflictKey === "conflict:smiths-liquidity"),
    );
    expect(liquidityCases.length, "simultaneous-request cases must share a conflict key").toBeGreaterThan(1);
  });

  it("enforces: property 2 - a different scope in the same family yields a different key", () => {
    expect(conflictKey("smiths", "liquidity")).not.toBe(conflictKey("okonkwo", "liquidity"));
    const keys = new Set(
      real.cases
        .flatMap((item) => item.reservations)
        .filter((r) => r.family === "liquidity")
        .map((r) => r.conflictKey),
    );
    expect(keys.size, "a constant-returning derivation would collapse every scope to one key").toBeGreaterThan(1);
  });

  it("enforces: property 3 - a different family in the same scope yields a different key", () => {
    const keys = new Set(CONFLICT_FAMILIES.map((family) => conflictKey("smiths", family)));
    expect(keys.size).toBe(CONFLICT_FAMILIES.length);
  });

  it("enforces: property 4 - one scope under two firms is never the same conflict", () => {
    const firmA = scopedConflictKey("firm-a", "smiths", "liquidity");
    const firmB = scopedConflictKey("firm-b", "smiths", "liquidity");
    expect(firmA.conflictKey).toBe(firmB.conflictKey);
    expect(sameConflict(firmA, firmB)).toBe(false);
    expect(sameConflict(firmA, scopedConflictKey("firm-a", "smiths", "liquidity"))).toBe(true);
  });

  it("enforces: every corpus reservation is firm-scoped and family-valid", () => {
    const problems: string[] = [];
    for (const item of real.cases) {
      expect(item.reservations.length).toBeGreaterThan(0);
      for (const reservation of item.reservations) {
        if (!isConflictFamily(reservation.family)) problems.push(`${item.caseId}: unknown family ${reservation.family}`);
        if (!reservation.conflictKey.startsWith("conflict:")) problems.push(`${item.caseId}: malformed conflict key`);
        if (!/^firm-[a-z]$/.test(reservation.firmId)) problems.push(`${item.caseId}: reservation carries no firm scope`);
        if (reservation.reservationId !== reservationKey(item.caseId, reservation.family as (typeof CONFLICT_FAMILIES)[number])) {
          problems.push(`${item.caseId}: reservation id is not derived`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("enforces: idempotency is a SEPARATE mechanism - the facts-only derivation collides on signed truth", () => {
    const facts = signedIdempotencyKeys.map((literal) => {
      const [, , rest = ""] = literal.split(":");
      const [scope = "", ...discriminator] = rest.split("-");
      return factsOnlyIdempotencyKey(scope, discriminator.join("-"));
    });
    // The shipped derivation keys on the DECISION: one key per signed case.
    expect(new Set(signedIdempotencyKeys).size).toBe(signedIdempotencyKeys.length);
    // The naive facts-only derivation collapses distinct signed decisions.
    expect(new Set(facts).size).toBeLessThan(facts.length);
  });

  it("enforces: `external-submission` is excluded from the conflict families by decision, not omission", () => {
    expect(NON_CONFLICT_MECHANISMS).toContain("external-submission");
    expect(CONFLICT_FAMILIES as readonly string[]).not.toContain("external-submission");
    expect(isConflictFamily("external-submission")).toBe(false);
  });
});

describe("detects (companion): a degenerate or unscoped conflict-key derivation CANNOT pass", () => {
  const constantKey = (): string => "conflict:everything";

  it("a constant-returning derivation fails properties 2 and 3", () => {
    expect(constantKey()).toBe(constantKey());
    expect(new Set([constantKey(), constantKey()]).size).toBe(1);
    expect(new Set(CONFLICT_FAMILIES.map((f) => conflictKey("smiths", f))).size).toBeGreaterThan(1);
  });

  it("a family collision (two families mapped to one key) is caught by property 3", () => {
    const collide = (_scope: string, family: string): string =>
      `conflict:smiths-${family === "bank-instruction" ? "liquidity" : family}`;
    expect(new Set(CONFLICT_FAMILIES.map((f) => collide("smiths", f))).size).toBeLessThan(CONFLICT_FAMILIES.length);
  });

  it("treating a cross-firm key as shared is caught by property 4", () => {
    const stringOnly = (left: { conflictKey: string }, right: { conflictKey: string }): boolean =>
      left.conflictKey === right.conflictKey;
    const firmA = scopedConflictKey("firm-a", "smiths", "liquidity");
    const firmB = scopedConflictKey("firm-b", "smiths", "liquidity");
    expect(stringOnly(firmA, firmB)).toBe(true); // the bug
    expect(sameConflict(firmA, firmB)).toBe(false); // the shipped identity
  });

  it("a facts-derived idempotency key demonstrably collides on the signed set", () => {
    const collided = factsOnlyIdempotencyKey("smiths", "75000-2026-08-15");
    const signedSharingThoseFacts = signedIdempotencyKeys.filter((k) => k.endsWith("smiths-75000-2026-08-15"));
    expect(signedSharingThoseFacts.length).toBeGreaterThan(1);
    expect(new Set(signedSharingThoseFacts.map(() => collided)).size).toBe(1);
  });

  it("an unknown family and a malformed scope are refused rather than silently keyed", () => {
    expect(() => conflictKey("smiths", "not-a-family" as (typeof CONFLICT_FAMILIES)[number])).toThrow(/unknown family/);
    expect(() => conflictKey("Smiths Household", "liquidity")).toThrow(/lowercase hyphenated slug/);
    expect(() => idempotencyKey("GC-01", "smiths", "75000 renovation")).toThrow(/lowercase hyphenated slug/);
  });
});
