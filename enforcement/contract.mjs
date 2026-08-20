// enforcement/contract.mjs - `Gen4EnforcementContract`, the one seam (CONSTITUTION.md; prompt 1 section 4).
// evaluateEnforcement(input) -> { violations: [{ rule, ref, message }] }. Pure over its input: every fact
// (git observations, the event payload, API answers) is collected by the caller, so a rule fails closed on a
// missing fact instead of reaching for ambient state and reading an error as agreement.

const v = (rule, ref, message) => ({ rule, ref, message });

function e1NoSharedHistory(input) {
  if (!Array.isArray(input.mergeBaseWithMain))
    return [v("E1", "origin/main", "the merge-base set against origin/main could not be computed; failing closed")];
  return input.mergeBaseWithMain.map((sha) => v("E1", sha, `generation-4 shares history with origin/main: merge-base ${sha}`));
}

function e2PrTarget(input) {
  if (input.eventName === "pull_request") {
    if (!input.baseRef)
      return [v("E2", "base.ref", "pull_request payload carries no base ref; a missing field is not agreement; failing closed")];
    return input.baseRef === "generation-4" ? [] : [v("E2", "base.ref", `this pull request targets '${input.baseRef}', not generation-4`)];
  }
  // A push run has no pull request to assert; it verifies its own ref, and the PR-target assertion runs on every pull_request event.
  if (input.eventName === "push")
    return input.pushedRef === "refs/heads/generation-4" ? [] : [v("E2", "ref", `push run is for '${input.pushedRef}', not refs/heads/generation-4`)];
  return [v("E2", "event", `unrecognized event '${input.eventName}'; failing closed`)];
}

function e3DefaultBranchUnchanged(input) {
  if (input.defaultBranch == null)
    return [v("E3", "default-branch", `the repository default branch could not be read (${input.defaultBranchError ?? "no answer"}); an unanswered question is never treated as 'main'; failing closed`)];
  return input.defaultBranch === "main" ? [] : [v("E3", "default-branch", `the repository default branch is '${input.defaultBranch}', expected 'main'`)];
}

function e4OneSeamPerPr(input) {
  if (input.eventName !== "pull_request") return []; // seam declarations live on pull requests; asserted on every PR run
  if (!Array.isArray(input.roadmapSeamIds) || input.roadmapSeamIds.length !== 10)
    return [v("E4", "CONSTITUTION.md", `the closed roadmap seam list is unreadable (found ${input.roadmapSeamIds?.length ?? "none"} ids, expected 10); failing closed`)];
  const declared = input.declaredSeamIds ?? [];
  if (declared.length === 0) return [v("E4", "pr-body", "no declared seam id ('Seam: <id>') in the pull request body")];
  if (declared.length > 1) return [v("E4", "pr-body", `more than one declared seam id: ${declared.join(", ")}`)];
  if (!input.roadmapSeamIds.includes(declared[0]))
    return [v("E4", "pr-body", `declared seam id '${declared[0]}' is not in CONSTITUTION.md's closed roadmap list`)];
  return [];
}

import { e5ReviewBudget, e6Reachability, e7Provenance, e8CompanionProof, e9NoExternalEffect, e10SignedTruthImmutable } from "./rules-tree.mjs";

export const RULES = new Map([
  ["E1", e1NoSharedHistory],
  ["E2", e2PrTarget],
  ["E3", e3DefaultBranchUnchanged],
  ["E4", e4OneSeamPerPr],
  ["E5", e5ReviewBudget],
  ["E6", e6Reachability],
  ["E7", e7Provenance],
  ["E8", e8CompanionProof],
  ["E9", e9NoExternalEffect],
  ["E10", e10SignedTruthImmutable],
]);

export function evaluateEnforcement(input) {
  const violations = [];
  for (const rule of RULES.values()) violations.push(...rule(input));
  return { violations };
}
