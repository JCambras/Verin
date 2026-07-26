import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LineCounter, parseDocument, visit } from "yaml";
import { REPO_ROOT } from "./_fence-utils";

/**
 * DEMO-SCENARIOS-CONTRACT FENCE (charter #1, D-034). config/demo/scenarios.yaml
 * states two invariants in its header - the STABILITY CONTRACT (every `id` is a
 * stable identifier: never renamed or reused, additions append) and the
 * INERT-DATA rule ("NO executable content of any kind": plain YAML
 * scalars/maps/lists only, no tags) - and its sections cross-reference each
 * other by id. This fence makes all three machine-enforced:
 *  (a) the file parses clean with NO tags of any kind (a custom/unresolved tag
 *      is the executable-content class this file must never gain);
 *  (b) EVERY id family in the file is pinned, two-directionally: each pinned id
 *      below is still present (renames/removals fail the build), each id present
 *      in the file is pinned below (an addition must append here in the same PR,
 *      where review sees it - same ratchet pattern as charter-drift's
 *      RATCHETED_ENFORCED_IDS), and no id is duplicated;
 *  (c) every cross-reference resolves: scenario dispositions and `exercises`
 *      to state_vocabulary ids, `per_firm` keys to firm ids, element
 *      reality_now/reality_at_phase1 to provenance_labels ids, and
 *      deferral.deferred_elements to element ids (both directions).
 * The detectors are pure functions over YAML text so the companion below can
 * feed them violating synthetic documents (charter #4).
 */
const SCENARIOS_REL = "config/demo/scenarios.yaml";

/** Stable ids shipped by D-034 - every id family in scenarios.yaml, exactly the
 * scope the STABILITY CONTRACT claims ("every `id` in this file"). Append-only:
 * additions append here in the same PR (the reverse baseline check forces it);
 * removing or renaming an entry requires a captain-approved demo-contract
 * change AND an edit here, where review sees it. */
export const PINNED_IDS: Record<string, readonly string[]> = {
  contract: ["verin-demo-contract"],
  firms: ["firm-a", "firm-b"],
  household: ["smiths"],
  "household.required_shape": [
    "accounts",
    "planned-withdrawals",
    "recent-bank-instruction-change",
    "destination-restriction",
    "pending-liquidity-activity",
    "judgment-complexity",
  ],
  deferral: ["salesforce-sandbox"],
  scenarios: [
    "safe-proceed",
    "recent-bank-change-block",
    "permanent-prohibition",
    "stale-evidence",
    "ambiguous-instruction",
    "dual-approval",
    "approval-invalidation",
    "competing-liquidity",
    "duplicate-retry",
    "partial-salesforce-success",
    "delayed-nigo",
    "specialist-review-expiration",
  ],
  state_vocabulary: [
    "proceed",
    "blocked",
    "prohibited",
    "awaiting-approval",
    "approved",
    "submitted",
    "in-flight",
    "completed",
    "nigo",
    "unknown",
  ],
  provenance_labels: [
    "synthetic-fixture",
    "real-derived-fixture",
    "fake-adapter-response",
    "real-salesforce-sandbox-response",
    "user-entered-demo-input",
    "deterministic-engine-output",
    "llm-proposed-draft",
  ],
  elements: [
    "advisor-request",
    "household-records",
    "evidence-snapshots",
    "decision-outputs",
    "approvals",
    "intent-shaping",
    "policy-draft",
    "execution-invocation",
    "returned-status",
    "delayed-exception-events",
    "replay-corpus",
  ],
};

interface IdRow {
  id?: unknown;
}
interface ScenarioRow extends IdRow {
  disposition?: unknown;
  exercises?: unknown;
}
interface ElementRow extends IdRow {
  reality_now?: unknown;
  reality_at_phase1?: unknown;
  deferral?: unknown;
}
export interface ScenariosData {
  contract?: IdRow;
  firms?: IdRow[];
  household?: IdRow & { required_shape?: IdRow[] };
  state_vocabulary?: IdRow[];
  scenarios?: ScenarioRow[];
  provenance_labels?: IdRow[];
  elements?: ElementRow[];
  deferral?: IdRow & { deferred_elements?: unknown };
}

const idsOf = (rows: IdRow[] | undefined): string[] =>
  (rows ?? []).map((r) => (typeof r?.id === "string" ? r.id : "")).filter(Boolean);

const singletonIdOf = (row: IdRow | undefined): string[] =>
  typeof row?.id === "string" ? [row.id] : [];

/** (a) Inertness: parse issues and ANY tag (unresolved or explicit-standard) are violations. */
export function inertnessViolations(text: string): string[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const issues: string[] = [];
  for (const problem of [...doc.errors, ...doc.warnings]) {
    issues.push(problem.message.split("\n")[0] ?? problem.message);
  }
  visit(doc, {
    Node(_key, node) {
      if ("tag" in node && node.tag !== undefined) {
        const line = node.range ? lineCounter.linePos(node.range[0]).line : "?";
        issues.push(`line ${line}: tag "${node.tag}" - plain YAML scalars/maps/lists only, no tags of any kind`);
      }
    },
  });
  return issues;
}

/** (b) Stability contract, two-directional: every pinned id present, every
 * present id pinned, no id reused within its set. */
export function baselineViolations(data: ScenariosData, pinned: Record<string, readonly string[]> = PINNED_IDS): string[] {
  const sets: Record<string, string[]> = {
    contract: singletonIdOf(data.contract),
    firms: idsOf(data.firms),
    household: singletonIdOf(data.household),
    "household.required_shape": idsOf(data.household?.required_shape),
    deferral: singletonIdOf(data.deferral),
    scenarios: idsOf(data.scenarios),
    state_vocabulary: idsOf(data.state_vocabulary),
    provenance_labels: idsOf(data.provenance_labels),
    elements: idsOf(data.elements),
  };
  const issues: string[] = [];
  for (const setName of new Set([...Object.keys(pinned), ...Object.keys(sets)])) {
    const pinnedIds = pinned[setName] ?? [];
    const present = sets[setName] ?? [];
    const presentSet = new Set(present);
    const pinnedSet = new Set(pinnedIds);
    for (const id of pinnedIds) {
      if (!presentSet.has(id)) issues.push(`${setName}: pinned id "${id}" is missing - ids are never renamed or removed; additions append`);
    }
    for (const id of presentSet) {
      if (!pinnedSet.has(id)) issues.push(`${setName}: id "${id}" is not in PINNED_IDS - append it to the baseline in the same PR that adds it`);
    }
    for (const dup of new Set(present.filter((id, i) => present.indexOf(id) !== i))) {
      issues.push(`${setName}: id "${dup}" appears more than once - ids are never reused`);
    }
  }
  return issues;
}

/** (c) Every cross-reference between sections resolves. */
export function crossRefViolations(data: ScenariosData): string[] {
  const states = new Set(idsOf(data.state_vocabulary));
  const firms = new Set(idsOf(data.firms));
  const labels = new Set(idsOf(data.provenance_labels));
  const elementIds = new Set(idsOf(data.elements));
  const issues: string[] = [];

  for (const scenario of data.scenarios ?? []) {
    const sid = typeof scenario.id === "string" ? scenario.id : "?";
    if (Array.isArray(scenario.exercises)) {
      for (const state of scenario.exercises) {
        if (!states.has(String(state))) issues.push(`scenarios[${sid}].exercises -> "${String(state)}" is not a state_vocabulary id`);
      }
    }
    const disposition = scenario.disposition;
    if (typeof disposition === "string") {
      if (!states.has(disposition)) issues.push(`scenarios[${sid}].disposition -> "${disposition}" is not a state_vocabulary id`);
    } else if (disposition && typeof disposition === "object" && "per_firm" in disposition) {
      const perFirm = (disposition as { per_firm?: unknown }).per_firm;
      if (perFirm && typeof perFirm === "object") {
        for (const [firmId, state] of Object.entries(perFirm)) {
          if (!firms.has(firmId)) issues.push(`scenarios[${sid}].disposition.per_firm -> "${firmId}" is not a firm id`);
          if (!states.has(String(state))) issues.push(`scenarios[${sid}].disposition.per_firm.${firmId} -> "${String(state)}" is not a state_vocabulary id`);
        }
      }
    }
  }

  for (const element of data.elements ?? []) {
    const eid = typeof element.id === "string" ? element.id : "?";
    for (const field of ["reality_now", "reality_at_phase1"] as const) {
      const label = element[field];
      if (!labels.has(String(label))) issues.push(`elements[${eid}].${field} -> "${String(label)}" is not a provenance_labels id`);
    }
  }

  const deferred = Array.isArray(data.deferral?.deferred_elements) ? data.deferral.deferred_elements.map(String) : [];
  for (const elementId of deferred) {
    if (!elementIds.has(elementId)) issues.push(`deferral.deferred_elements -> "${elementId}" is not an element id`);
  }
  const deferredSet = new Set(deferred);
  for (const element of data.elements ?? []) {
    if (element.deferral !== undefined && !deferredSet.has(String(element.id))) {
      issues.push(`elements[${String(element.id)}] carries a deferral marking but is missing from deferral.deferred_elements`);
    }
  }
  return issues;
}

const parseData = (text: string): ScenariosData => (parseDocument(text).toJS() ?? {}) as ScenariosData;

const realText = readFileSync(join(REPO_ROOT, SCENARIOS_REL), "utf8");
const realData = parseData(realText);
const prefix = (issues: string[]) => issues.map((i) => `${SCENARIOS_REL} :: ${i}`);

describe("demo-scenarios-contract fence", () => {
  it("enforces: the scenario matrix is inert - plain scalars/maps/lists, no tags of any kind", () => {
    const issues = prefix(inertnessViolations(realText));
    expect(issues, `executable/tagged YAML content found:\n${issues.join("\n")}`).toEqual([]);
  });

  it("enforces: every pinned stable id is present and none is reused (append-only)", () => {
    const issues = prefix(baselineViolations(realData));
    expect(issues, `stability-contract violations:\n${issues.join("\n")}`).toEqual([]);
  });

  it("enforces: every cross-reference between sections resolves", () => {
    const issues = prefix(crossRefViolations(realData));
    expect(issues, `dangling cross-references:\n${issues.join("\n")}`).toEqual([]);
  });
});

describe("detects (companion): violating scenario data CANNOT pass", () => {
  it("flags a custom tag (the executable-content class) with its line", () => {
    const issues = inertnessViolations('amount: !exec "rm -rf /"\n');
    expect(issues.some((i) => i.includes("!exec"))).toBe(true);
    expect(issues.some((i) => i.includes("line 1"))).toBe(true);
  });

  it("flags an explicit standard tag too - no tags of any kind", () => {
    expect(inertnessViolations("amount: !!str 75000\n")).not.toEqual([]);
  });

  it("flags a removed pinned id", () => {
    const gutted = parseData(realText);
    gutted.scenarios = gutted.scenarios?.filter((s) => s.id !== "dual-approval");
    expect(baselineViolations(gutted).some((i) => i.includes(`pinned id "dual-approval" is missing`))).toBe(true);
  });

  it("flags a renamed pinned id", () => {
    const renamed = parseData(realText.replace("- id: safe-proceed", "- id: safe-proceed-v2"));
    expect(baselineViolations(renamed).some((i) => i.includes(`pinned id "safe-proceed" is missing`))).toBe(true);
  });

  it("flags a reused id", () => {
    const doubled = parseData(realText);
    doubled.elements = [...(doubled.elements ?? []), { id: "approvals", reality_now: "user-entered-demo-input", reality_at_phase1: "user-entered-demo-input" }];
    expect(baselineViolations(doubled).some((i) => i.includes(`id "approvals" appears more than once`))).toBe(true);
  });

  it("flags a coordinated firm rename (firms + per_firm keys changed together) that cross-refs alone would miss", () => {
    const renamed = parseData(realText.replaceAll("firm-a", "firm-alpha"));
    expect(crossRefViolations(renamed)).toEqual([]);
    const issues = baselineViolations(renamed);
    expect(issues.some((i) => i.includes(`firms: pinned id "firm-a" is missing`))).toBe(true);
    expect(issues.some((i) => i.includes(`firms: id "firm-alpha" is not in PINNED_IDS`))).toBe(true);
  });

  it("flags a removed household required-shape id", () => {
    const gutted = parseData(realText);
    if (gutted.household) gutted.household.required_shape = gutted.household.required_shape?.filter((r) => r.id !== "destination-restriction");
    expect(baselineViolations(gutted).some((i) => i.includes(`household.required_shape: pinned id "destination-restriction" is missing`))).toBe(true);
  });

  it("flags a renamed singleton id (contract, household, deferral)", () => {
    const renamed = parseData(
      realText
        .replace("id: verin-demo-contract", "id: verin-demo-contract-v2")
        .replace("id: smiths", "id: the-smiths")
        .replace("id: salesforce-sandbox", "id: sf-sandbox"),
    );
    const issues = baselineViolations(renamed);
    expect(issues.some((i) => i.includes(`contract: pinned id "verin-demo-contract" is missing`))).toBe(true);
    expect(issues.some((i) => i.includes(`household: pinned id "smiths" is missing`))).toBe(true);
    expect(issues.some((i) => i.includes(`deferral: pinned id "salesforce-sandbox" is missing`))).toBe(true);
  });

  it("flags an id added WITHOUT appending it to PINNED_IDS (reverse direction)", () => {
    const appended = parseData(realText);
    appended.scenarios = [...(appended.scenarios ?? []), { id: "a-new-branch", disposition: "proceed", exercises: ["proceed"] }];
    expect(baselineViolations(appended).some((i) => i.includes(`scenarios: id "a-new-branch" is not in PINNED_IDS`))).toBe(true);
  });

  it("accepts an appended NEW id once the baseline is appended in the same PR (additions pass)", () => {
    const appended = parseData(realText);
    appended.scenarios = [...(appended.scenarios ?? []), { id: "a-new-branch", disposition: "proceed", exercises: ["proceed"] }];
    expect(baselineViolations(appended, { ...PINNED_IDS, scenarios: [...(PINNED_IDS.scenarios ?? []), "a-new-branch"] })).toEqual([]);
    expect(crossRefViolations(appended)).toEqual([]);
  });

  it("flags a scenario exercising a state outside the vocabulary (e.g. ObservedStatus's excluded 'rejected')", () => {
    const drifted = parseData(realText.replace("exercises: [proceed, approved, submitted, nigo]", "exercises: [proceed, approved, submitted, rejected]"));
    expect(crossRefViolations(drifted).some((i) => i.includes(`"rejected" is not a state_vocabulary id`))).toBe(true);
  });

  it("flags an element with an unknown provenance label", () => {
    const mislabeled = parseData(realText.replace("reality_now: deterministic-engine-output", "reality_now: totally-real-data"));
    expect(crossRefViolations(mislabeled).some((i) => i.includes(`"totally-real-data" is not a provenance_labels id`))).toBe(true);
  });

  it("flags a dangling deferred element (both directions)", () => {
    const dangling = parseData(realText);
    dangling.elements = dangling.elements?.filter((e) => e.id !== "returned-status");
    const issues = crossRefViolations(dangling);
    expect(issues.some((i) => i.includes(`deferral.deferred_elements -> "returned-status" is not an element id`))).toBe(true);

    const unlisted = parseData(realText);
    if (unlisted.deferral) unlisted.deferral.deferred_elements = ["execution-invocation", "returned-status"];
    expect(crossRefViolations(unlisted).some((i) => i.includes("elements[delayed-exception-events] carries a deferral marking"))).toBe(true);
  });

  it("flags a gutted or empty document instead of passing vacuously", () => {
    expect(baselineViolations(parseData("{}\n")).length).toBeGreaterThan(0);
  });
});
