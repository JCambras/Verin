import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import { activateMoneyMovementSetup } from "@app/demo/setup-evaluator";
import {
  SNAPSHOTS_PER_PRINCIPAL,
  SNAPSHOT_TTL_MS,
  activatedSetupSnapshot,
  isSetupActivationToken,
  registerActivatedSetupSnapshot,
  type SetupActivationScope,
} from "@app/demo/setup-activation-store";
import type {
  SetupActivatedSnapshotVM,
  SetupSelections,
} from "@app/demo/setup-model";

/**
 * The activation registry holds F1's frozen snapshots. It is memory a signed-in user
 * can grow, and a snapshot hash travels in a URL, so the registry itself carries three
 * invariants: entries are SCOPED to the principal that activated them, they are BOUNDED
 * by both a per-principal LRU and a TTL, and every miss returns null so the caller
 * fails closed instead of recomputing or borrowing a signed record.
 */

const RESERVE_OPTIONS = ["6-months", "9-months", "12-months"] as const;
const FRESHNESS_OPTIONS = ["7-days", "14-days", "30-days"] as const;
const THRESHOLD_OPTIONS = ["25000", "50000", "100000"] as const;

function baseSelections(): SetupSelections {
  const vm = buildMoneyMovementSetup();
  const selections = {
    "firm-a": {} as SetupSelections["firm-a"],
    "firm-b": {} as SetupSelections["firm-b"],
  };
  for (const group of vm.policyGroups) {
    for (const firm of group.firms) {
      selections[firm.firmId][group.id] = firm.initialOptionId;
    }
  }
  return selections;
}

/** `index` distinct activations, each a genuinely different closed combination. */
function snapshotAt(index: number): SetupActivatedSnapshotVM {
  const selections = baseSelections();
  selections["firm-a"].reserve = RESERVE_OPTIONS[index % 3]!;
  selections["firm-a"].freshness = FRESHNESS_OPTIONS[Math.floor(index / 3) % 3]!;
  selections["firm-a"].threshold = THRESHOLD_OPTIONS[Math.floor(index / 9) % 3]!;
  const result = activateMoneyMovementSetup(selections);
  if (!result.ok) throw new Error(result.error);
  return result.snapshot;
}

let scopeCounter = 0;
/** A fresh principal per assertion: the registry lives on globalThis by design. */
function scope(orgId = "org-demo"): SetupActivationScope {
  scopeCounter += 1;
  return { orgId, userId: `user-${scopeCounter}` };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("activated setup snapshot registry", () => {
  it("hands the acting principal back the EXACT frozen snapshot it activated", () => {
    const principal = scope();
    const snapshot = snapshotAt(0);
    registerActivatedSetupSnapshot(principal, snapshot);
    const read = activatedSetupSnapshot(principal, snapshot.snapshotHash);
    expect(read).toBe(snapshot);
    expect(Object.isFrozen(read)).toBe(true);
  });

  it("scopes entries: another principal holding the hash reads nothing", () => {
    const owner = scope();
    const snapshot = snapshotAt(1);
    registerActivatedSetupSnapshot(owner, snapshot);

    const otherUser = { orgId: owner.orgId, userId: `${owner.userId}-intruder` };
    const otherOrg = { orgId: "org-other", userId: owner.userId };
    expect(activatedSetupSnapshot(otherUser, snapshot.snapshotHash)).toBeNull();
    expect(activatedSetupSnapshot(otherOrg, snapshot.snapshotHash)).toBeNull();
    expect(activatedSetupSnapshot(owner, snapshot.snapshotHash)).toBe(snapshot);
  });

  it("bounds each principal: past the LRU limit the oldest activation is evicted", () => {
    const principal = scope();
    const snapshots = Array.from(
      { length: SNAPSHOTS_PER_PRINCIPAL + 1 },
      (_unused, index) => snapshotAt(index),
    );
    expect(new Set(snapshots.map((s) => s.snapshotHash)).size).toBe(
      snapshots.length,
    );
    for (const snapshot of snapshots) {
      registerActivatedSetupSnapshot(principal, snapshot);
    }
    expect(
      activatedSetupSnapshot(principal, snapshots[0]!.snapshotHash),
      "the oldest activation must be evicted, not retained forever",
    ).toBeNull();
    for (const snapshot of snapshots.slice(1)) {
      expect(activatedSetupSnapshot(principal, snapshot.snapshotHash)).toBe(
        snapshot,
      );
    }
  });

  it("expires entries: past the TTL the snapshot is gone, never stale-served", () => {
    vi.useFakeTimers();
    const principal = scope();
    const snapshot = snapshotAt(2);
    registerActivatedSetupSnapshot(principal, snapshot);
    expect(activatedSetupSnapshot(principal, snapshot.snapshotHash)).toBe(
      snapshot,
    );

    vi.advanceTimersByTime(SNAPSHOT_TTL_MS + 1);
    expect(activatedSetupSnapshot(principal, snapshot.snapshotHash)).toBeNull();
  });

  it("fails closed on an unknown hash instead of substituting another snapshot", () => {
    const principal = scope();
    const snapshot = snapshotAt(3);
    registerActivatedSetupSnapshot(principal, snapshot);
    expect(activatedSetupSnapshot(principal, "not-a-snapshot-hash")).toBeNull();
  });

  it("accepts only generated lowercase SHA-256 activation tokens", () => {
    const principal = scope();
    const snapshot = snapshotAt(4);
    expect(isSetupActivationToken(snapshot.snapshotHash)).toBe(true);
    for (const invalid of [
      "",
      "a".repeat(63),
      "A".repeat(64),
      "g".repeat(64),
      `${snapshot.snapshotHash}suffix`,
    ]) {
      expect(isSetupActivationToken(invalid)).toBe(false);
      expect(activatedSetupSnapshot(principal, invalid)).toBeNull();
    }
    expect(() =>
      registerActivatedSetupSnapshot(principal, {
        ...snapshot,
        snapshotHash: "not-a-generated-token",
      }),
    ).toThrow("invalid token");
  });
});
