/**
 * Operator contract for `pnpm ledger:rebuild` (ADR-0033), kept separate from the
 * runner so the guardrails are directly testable. Rebuild scope is ONE named tenant
 * and the default is a non-mutating preview: the mutating form DELETEs a tenant's
 * projections, reservation index, and checkpoint, so it must never be the thing a
 * bare invocation does, and there is deliberately no all-tenant form.
 */
export const LEDGER_REBUILD_USAGE =
  "usage: pnpm ledger:rebuild --tenant <org-id> [--apply]";

/** Decisions named in a printed plan before the plan is truncated. */
export const REBUILD_PLAN_SAMPLE = 10;

export interface RebuildOptions {
  readonly tenant: string;
  readonly apply: boolean;
}

export interface RebuildPlan {
  readonly tenant: string;
  readonly entries: number;
  readonly derived: number;
  readonly sample: readonly {
    readonly decisionId: string;
    readonly lastSequence: number;
  }[];
}

/** Returns the parsed options, or a refusal reason. Preview is the default. */
export function parseRebuildArgs(
  argv: readonly string[],
): RebuildOptions | string {
  let tenant = "";
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--all") {
      return "refusing an all-tenant rebuild - name exactly one tenant with --tenant";
    } else if (arg === "--tenant") {
      tenant = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--tenant=")) {
      tenant = arg.slice("--tenant=".length);
    } else {
      return `unknown argument ${arg}`;
    }
  }
  return tenant.length > 0
    ? { tenant, apply }
    : "a rebuild replaces one tenant's derived decision state and requires --tenant";
}

export function rebuildPlanLines(plan: RebuildPlan): string[] {
  const named = plan.sample.slice(0, REBUILD_PLAN_SAMPLE);
  return [
    `plan for org ${plan.tenant}:`,
    `  verified ledger entries to replay: ${plan.entries}`,
    `  derived decision projections to discard and re-fold: ${plan.derived}`,
    ...named.map((item) =>
      `  - ${item.decisionId} @ sequence ${item.lastSequence}`),
    ...(plan.derived > named.length
      ? [`  ... and ${plan.derived - named.length} more (plan bounded at ${REBUILD_PLAN_SAMPLE})`]
      : []),
    "  immutable ledger, evidence, bundle, and decision rows are never touched",
  ];
}
