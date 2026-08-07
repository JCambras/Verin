/**
 * Invocation contract for the decision-projection repair (`pnpm ledger:rebuild`).
 *
 * The repair discards and re-folds derived decision state, and the restore runbook
 * points an operator here under RTO pressure - where the intent is "repair THIS
 * tenant". So the tenant is an explicit argument with no fleet-wide form, an
 * unrecognized flag is refused rather than ignored, and writing takes `--apply`:
 * the default is a preview. No argument means no action.
 *
 * It lives beside the script rather than inside it so the contract can be proven
 * without importing a module whose top level runs the repair.
 */
export interface RebuildInvocation {
  readonly orgId: string;
  readonly apply: boolean;
}

export const REBUILD_USAGE =
  "usage: pnpm ledger:rebuild <org-id> [--apply]\n" +
  "  <org-id>  the ONE tenant to replay - there is no fleet-wide form\n" +
  "  --apply   commit the replay; omitted, it is previewed and rolled back\n";

export function parseRebuildInvocation(
  argv: readonly string[],
): RebuildInvocation | null {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 1 || flags.some((flag) => flag !== "--apply")) {
    return null;
  }
  return { orgId: positional[0]!, apply: flags.includes("--apply") };
}
