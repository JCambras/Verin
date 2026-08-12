/**
 * Shipped-activation ratchets (ADR-0055). Every ACTIVE invariant's complete
 * mechanism tuple set is pinned here, so activation facts move only by an edit
 * in this reviewed module, never by a registry change alone. Extension is
 * monotonic: a newly activated invariant ADDS its tuples in registry order.
 */
import type { InvariantMechanism, Registry } from "./model";

export const ACTIVE_MECHANISM_RATCHET: Readonly<
  Record<number, readonly InvariantMechanism[]>
> = {
  1: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/llm-pii-boundary.test.ts",
    },
    {
      type: "fitness",
      ref: "src/__tests__/fitness/tokenized-factory-only.test.ts",
    },
  ],
  2: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/org-id-required.test.ts",
    },
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-tenant-scope.test.ts",
    },
    {
      type: "fitness",
      ref: "src/__tests__/fitness/tenant-context-required.test.ts",
    },
    {
      type: "fitness",
      ref: "src/__tests__/fitness/ledger-append-only.test.ts",
    },
  ],
  3: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/domain-configuration.test.ts",
    },
    {
      type: "file",
      ref: "config/domains/account-opening.yaml",
    },
    {
      type: "file",
      ref: "config/domains/money-movement.yaml",
    },
  ],
  5: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/ledger-append-only.test.ts",
    },
    {
      type: "fitness",
      ref: "src/__tests__/fitness/audited-write-required.test.ts",
    },
    {
      type: "ci-gate",
      ref: "audit-chain-verify",
      command: "pnpm exec tsx scripts/audit-chain-verify.ts",
    },
    {
      type: "file",
      ref: "src/infrastructure/store/decision-ledger-migration.ts",
    },
    {
      type: "file",
      ref: "src/infrastructure/store/migrations.ts",
    },
  ],
  7: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-illegal-states.test.ts",
    },
  ],
  8: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-illegal-states.test.ts",
    },
  ],
  9: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-illegal-states.test.ts",
    },
  ],
  16: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/policy-ast.test.ts",
    },
    {
      type: "fitness",
      ref: "src/__tests__/unit/policy-load.test.ts",
    },
    {
      type: "file",
      ref: "src/contracts/decision-core/policy.ts",
    },
    {
      type: "file",
      ref: "src/domain/policy/load.ts",
    },
  ],
};

export const ACTIVE_RATCHET = Object.keys(
  ACTIVE_MECHANISM_RATCHET,
).map(Number);

function mechanismTuples(
  mechanisms: readonly InvariantMechanism[],
): Array<[string, string, string | null]> {
  return mechanisms.map((mechanism) => [
    mechanism.type,
    mechanism.ref,
    mechanism.command ?? null,
  ]);
}

export function activeInvariantRatchetProblems(
  reg: Pick<Registry, "invariants">,
): string[] {
  const problems: string[] = [];
  const activeIds = reg.invariants
    .filter((invariant) => invariant.status === "active")
    .map((invariant) => invariant.id)
    .sort((left, right) => left - right);
  const ratchetedIds = [...ACTIVE_RATCHET].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(activeIds) !== JSON.stringify(ratchetedIds)) {
    problems.push(
      `active invariant ids must exactly match the shipped mechanism ratchet; expected ${JSON.stringify(ratchetedIds)}, received ${JSON.stringify(activeIds)}`,
    );
  }
  for (const id of ACTIVE_RATCHET) {
    const invariant = reg.invariants.find((candidate) => candidate.id === id);
    if (invariant === undefined) continue;
    if (invariant.status !== "active") {
      problems.push(
        `invariant ${id}: shipped as 'active' but regressed to '${invariant.status}' (the ratchet is monotonic)`,
      );
    }
    const expected = mechanismTuples(
      ACTIVE_MECHANISM_RATCHET[id] ?? [],
    );
    const actual = mechanismTuples(invariant.mechanisms ?? []);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(
        `invariant ${id}: shipped mechanism set drifted; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }
  }
  return problems;
}

export const INVARIANT_THREE_ACTIVATION_REQUIREMENTS = {
  artifacts: [
    "config/domains/account-opening.yaml",
    "config/domains/money-movement.yaml",
  ],
  mechanisms: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/domain-configuration.test.ts",
    },
  ],
} as const;
