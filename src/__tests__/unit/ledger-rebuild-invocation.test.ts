import { describe, it, expect } from "vitest";
import { parseRebuildInvocation } from "../../../scripts/ledger-rebuild-args";

/**
 * Companion for the scoped-rebuild contract. The repair discards and re-folds derived
 * decision state, so the two ways an operator can be surprised by it - a run that was
 * never scoped to a tenant, and a run that wrote when they meant to look - must both
 * be impossible to reach by accident, not merely discouraged in a runbook.
 */
describe("ledger-rebuild invocation", () => {
  it("refuses an unscoped run: no argument means no action", () => {
    expect(parseRebuildInvocation([])).toBeNull();
    expect(parseRebuildInvocation(["--apply"])).toBeNull();
  });

  it("refuses a fleet-wide run: exactly one tenant, never several", () => {
    expect(parseRebuildInvocation(["org-a", "org-b"])).toBeNull();
  });

  it("refuses an unrecognized flag rather than silently ignoring it", () => {
    expect(parseRebuildInvocation(["org-a", "--force"])).toBeNull();
  });

  it("previews by default and writes only when --apply is explicit", () => {
    expect(parseRebuildInvocation(["org-a"])).toEqual({ orgId: "org-a", apply: false });
    expect(parseRebuildInvocation(["org-a", "--apply"])).toEqual({
      orgId: "org-a",
      apply: true,
    });
  });
});
