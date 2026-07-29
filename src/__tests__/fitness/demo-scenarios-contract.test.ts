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
 *      RATCHETED_ENFORCED_IDS), and no id is duplicated. Families are discovered
 *      generically - every `id`-keyed value anywhere in the document, grouped by
 *      its key path - so a future id-bearing section joins the pinning the
 *      moment it appears, with no extraction path to hand-list;
 *  (c) every cross-reference resolves: scenario dispositions and `exercises`
 *      to state_vocabulary ids, `per_firm` keys to firm ids, top-level
 *      `provenance` fields and element reality_now/reality_at_phase1 to
 *      provenance_labels ids, and the deferral sections agree in full:
 *      deferral.deferred_elements to element ids in both directions
 *      (marked-implies-listed AND listed-implies-marked), with every element
 *      `deferral` value matching deferral.status. Shape drift is a violation,
 *      not a skip: a missing scenario disposition, a non-list `exercises`, a
 *      malformed or empty `per_firm` map, and a dropped provenance-bearing
 *      section are each reported with the offending path.
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
    "rejected",
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
const SHIPPED_ID_PREFIXES: Record<string, readonly string[]> = {
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
    "rejected",
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
  canonical_request?: { provenance?: unknown };
  firms?: IdRow[];
  household?: IdRow & { provenance?: unknown; required_shape?: IdRow[] };
  state_vocabulary?: IdRow[];
  scenarios?: ScenarioRow[];
  provenance_labels?: IdRow[];
  elements?: ElementRow[];
  deferral?: IdRow & { status?: unknown; deferred_elements?: unknown };
}

const idsOf = (rows: IdRow[] | undefined): string[] =>
  (rows ?? []).map((r) => (typeof r?.id === "string" ? r.id : "")).filter(Boolean);

const shapeOf = (value: unknown): string =>
  value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "a list" : typeof value;

/** Every `id`-keyed value in the document, grouped by family = the key path of
 * its containing section (array indices elided). Discovery is structural, not a
 * hand-listed set of extraction paths, so an id in a section this fence has
 * never seen still lands in a family and is held against PINNED_IDS. Non-string
 * ids are kept via String() so they cannot slip past the baseline unreviewed. */
export function collectIdFamilies(value: unknown): Record<string, string[]> {
  const families: Record<string, string[]> = {};
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, path);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if ("id" in record) (families[path || "(root)"] ??= []).push(String(record.id));
    for (const [key, child] of Object.entries(record)) {
      if (key !== "id") walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(value, "");
  return families;
}

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
  const sets = collectIdFamilies(data);
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
    for (let index = 0; index < Math.min(pinnedIds.length, present.length); index += 1) {
      if (present[index] !== pinnedIds[index]) {
        issues.push(
          `${setName}: id "${present[index]}" at position ${index} breaks the append-only sequence; expected "${pinnedIds[index]}"`,
        );
      }
    }
    const shippedPrefix = SHIPPED_ID_PREFIXES[setName] ?? [];
    for (let index = 0; index < shippedPrefix.length; index += 1) {
      if (present[index] !== shippedPrefix[index]) {
        issues.push(
          `${setName}: id "${present[index]}" at position ${index} breaks the shipped append-only prefix; expected "${shippedPrefix[index]}"`,
        );
      }
    }
  }
  return issues;
}

/** (c) Every cross-reference between sections resolves, and every container the
 * references live in has the expected shape - a shape drift (missing
 * disposition, non-list exercises, malformed/empty per_firm, dropped
 * provenance-bearing section) is a reported violation, never a silent skip. */
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
    } else {
      issues.push(`scenarios[${sid}].exercises -> expected a list of state_vocabulary ids, got ${shapeOf(scenario.exercises)}`);
    }
    const disposition = scenario.disposition;
    if (typeof disposition === "string") {
      if (!states.has(disposition)) issues.push(`scenarios[${sid}].disposition -> "${disposition}" is not a state_vocabulary id`);
    } else if (disposition && typeof disposition === "object" && !Array.isArray(disposition)) {
      const perFirm = (disposition as { per_firm?: unknown }).per_firm;
      if (perFirm && typeof perFirm === "object" && !Array.isArray(perFirm)) {
        const entries = Object.entries(perFirm);
        if (entries.length === 0) issues.push(`scenarios[${sid}].disposition.per_firm -> expected a firm-id to state map, got an empty map`);
        for (const [firmId, state] of entries) {
          if (!firms.has(firmId)) issues.push(`scenarios[${sid}].disposition.per_firm -> "${firmId}" is not a firm id`);
          if (!states.has(String(state))) issues.push(`scenarios[${sid}].disposition.per_firm.${firmId} -> "${String(state)}" is not a state_vocabulary id`);
        }
      } else {
        issues.push(`scenarios[${sid}].disposition.per_firm -> expected a firm-id to state map, got ${shapeOf(perFirm)}`);
      }
    } else {
      issues.push(`scenarios[${sid}].disposition -> expected a state_vocabulary id or a per_firm map, got ${shapeOf(disposition)}`);
    }
  }

  for (const [section, row] of [
    ["canonical_request", data.canonical_request],
    ["household", data.household],
  ] as const) {
    if (!row || typeof row !== "object") {
      issues.push(`${section} -> expected a section carrying a provenance label, got ${shapeOf(row)}`);
    } else if (!labels.has(String(row.provenance))) {
      issues.push(`${section}.provenance -> "${String(row.provenance)}" is not a provenance_labels id`);
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
  const deferralStatus = data.deferral?.status;
  for (const element of data.elements ?? []) {
    const eid = String(element.id);
    if (element.deferral !== undefined && !deferredSet.has(eid)) {
      issues.push(`elements[${eid}] carries a deferral marking but is missing from deferral.deferred_elements`);
    }
    if (element.deferral === undefined && deferredSet.has(eid)) {
      issues.push(`deferral.deferred_elements lists "${eid}" but elements[${eid}] carries no deferral marking`);
    }
    if (element.deferral !== undefined && String(element.deferral) !== String(deferralStatus)) {
      issues.push(`elements[${eid}].deferral -> "${String(element.deferral)}" does not match deferral.status "${String(deferralStatus)}"`);
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

  it("flags a stable id inserted before the pinned append-only prefix", () => {
    const reordered = parseData(realText);
    const states = reordered.state_vocabulary ?? [];
    reordered.state_vocabulary = [
      ...states.slice(0, -3),
      states.at(-1)!,
      ...states.slice(-3, -1),
    ];
    const coordinatedPin = {
      ...PINNED_IDS,
      state_vocabulary: idsOf(reordered.state_vocabulary),
    };
    expect(
      baselineViolations(reordered, coordinatedPin).some((i) =>
        i.includes("breaks the shipped append-only prefix"),
      ),
    ).toBe(true);
  });

  it("keeps rejected inside the immutable shipped status prefix", () => {
    const reordered = parseData(realText);
    const states = [
      ...(reordered.state_vocabulary ?? []),
      { id: "queued" },
    ];
    const rejected = states.find(
      ({ id }) => id === "rejected",
    )!;
    reordered.state_vocabulary = [
      ...states.filter(
        ({ id }) => id !== "rejected",
      ),
      rejected,
    ];
    const coordinatedPin = {
      ...PINNED_IDS,
      state_vocabulary: idsOf(reordered.state_vocabulary),
    };
    expect(
      baselineViolations(reordered, coordinatedPin).some((issue) =>
        issue.includes(
          'id "queued" at position 10 breaks the shipped append-only prefix; expected "rejected"',
        ),
      ),
    ).toBe(true);
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

  it("flags an id in a NEW, never-before-seen section - no hand-listed extraction path to bypass", () => {
    const extended = parseData(realText) as ScenariosData & { personas?: unknown };
    extended.personas = [{ id: "avery-the-advisor", role: "presenter" }];
    expect(baselineViolations(extended).some((i) => i.includes(`personas: id "avery-the-advisor" is not in PINNED_IDS`))).toBe(true);
    expect(baselineViolations(extended, { ...PINNED_IDS, personas: ["avery-the-advisor"] })).toEqual([]);
  });

  it("flags a non-string id instead of letting it slip past the baseline", () => {
    const numeric = parseData(realText);
    numeric.scenarios = [...(numeric.scenarios ?? []), { id: 13, disposition: "proceed", exercises: ["proceed"] }];
    expect(baselineViolations(numeric).some((i) => i.includes(`scenarios: id "13" is not in PINNED_IDS`))).toBe(true);
  });

  it("flags a scenario exercising a state outside the vocabulary (for example presentation-only 'settled')", () => {
    const drifted = parseData(realText.replace("exercises: [proceed, approved, submitted, nigo]", "exercises: [proceed, approved, submitted, settled]"));
    expect(crossRefViolations(drifted).some((i) => i.includes(`"settled" is not a state_vocabulary id`))).toBe(true);
  });

  it("flags an element with an unknown provenance label", () => {
    const mislabeled = parseData(realText.replace("reality_now: deterministic-engine-output", "reality_now: totally-real-data"));
    expect(crossRefViolations(mislabeled).some((i) => i.includes(`"totally-real-data" is not a provenance_labels id`))).toBe(true);
  });

  it("flags a typo'd top-level provenance reference (canonical_request, household)", () => {
    const typoed = parseData(
      realText
        .replace("provenance: user-entered-demo-input", "provenance: user-entered-demo-inputs")
        .replace("provenance: synthetic-fixture", "provenance: synthetic-fixtures"),
    );
    const issues = crossRefViolations(typoed);
    expect(issues.some((i) => i.includes(`canonical_request.provenance -> "user-entered-demo-inputs" is not a provenance_labels id`))).toBe(true);
    expect(issues.some((i) => i.includes(`household.provenance -> "synthetic-fixtures" is not a provenance_labels id`))).toBe(true);
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

  it("flags a listed deferred element whose marking was dropped (listed-implies-marked)", () => {
    const unmarked = parseData(realText);
    const element = unmarked.elements?.find((e) => e.id === "returned-status");
    if (element) delete element.deferral;
    expect(
      crossRefViolations(unmarked).some((i) =>
        i.includes(`deferral.deferred_elements lists "returned-status" but elements[returned-status] carries no deferral marking`),
      ),
    ).toBe(true);
  });

  it("flags an element deferral marking that disagrees with deferral.status", () => {
    const disagreeing = parseData(realText);
    const element = disagreeing.elements?.find((e) => e.id === "execution-invocation");
    if (element) element.deferral = "deferred-until-someday";
    expect(
      crossRefViolations(disagreeing).some((i) =>
        i.includes(`elements[execution-invocation].deferral -> "deferred-until-someday" does not match deferral.status "deferred-pending-sandbox"`),
      ),
    ).toBe(true);
  });

  it("flags a scenario whose disposition key is missing entirely instead of skipping it", () => {
    const missing = parseData(realText);
    const scenario = missing.scenarios?.find((s) => s.id === "safe-proceed");
    if (scenario) delete scenario.disposition;
    expect(
      crossRefViolations(missing).some((i) =>
        i.includes(`scenarios[safe-proceed].disposition -> expected a state_vocabulary id or a per_firm map, got missing`),
      ),
    ).toBe(true);
  });

  it("flags exercises that is not a list (scalar or missing) instead of skipping it", () => {
    const scalar = parseData(realText);
    const drifted = scalar.scenarios?.find((s) => s.id === "stale-evidence");
    if (drifted) drifted.exercises = "blocked";
    expect(
      crossRefViolations(scalar).some((i) => i.includes(`scenarios[stale-evidence].exercises -> expected a list of state_vocabulary ids, got string`)),
    ).toBe(true);

    const dropped = parseData(realText);
    const gutted = dropped.scenarios?.find((s) => s.id === "stale-evidence");
    if (gutted) delete gutted.exercises;
    expect(
      crossRefViolations(dropped).some((i) => i.includes(`scenarios[stale-evidence].exercises -> expected a list of state_vocabulary ids, got missing`)),
    ).toBe(true);
  });

  it("flags a disposition object lacking per_firm, and a per_firm that is a scalar or an empty map", () => {
    const lacking = parseData(realText);
    const renamedKey = lacking.scenarios?.find((s) => s.id === "recent-bank-change-block");
    if (renamedKey) renamedKey.disposition = { firm_split: { "firm-a": "proceed" } };
    expect(
      crossRefViolations(lacking).some((i) =>
        i.includes(`scenarios[recent-bank-change-block].disposition.per_firm -> expected a firm-id to state map, got missing`),
      ),
    ).toBe(true);

    const scalar = parseData(realText);
    const flattened = scalar.scenarios?.find((s) => s.id === "recent-bank-change-block");
    if (flattened) flattened.disposition = { per_firm: "proceed" };
    expect(
      crossRefViolations(scalar).some((i) =>
        i.includes(`scenarios[recent-bank-change-block].disposition.per_firm -> expected a firm-id to state map, got string`),
      ),
    ).toBe(true);

    const empty = parseData(realText);
    const emptied = empty.scenarios?.find((s) => s.id === "recent-bank-change-block");
    if (emptied) emptied.disposition = { per_firm: {} };
    expect(
      crossRefViolations(empty).some((i) =>
        i.includes(`scenarios[recent-bank-change-block].disposition.per_firm -> expected a firm-id to state map, got an empty map`),
      ),
    ).toBe(true);
  });

  it("flags a per_firm entry with an unknown firm id or a non-state value", () => {
    const unknownFirm = parseData(realText.replace("firm-a: proceed", "firm-c: proceed"));
    expect(
      crossRefViolations(unknownFirm).some((i) => i.includes(`scenarios[recent-bank-change-block].disposition.per_firm -> "firm-c" is not a firm id`)),
    ).toBe(true);

    const badState = parseData(realText.replace("firm-b: blocked", "firm-b: vetoed"));
    expect(
      crossRefViolations(badState).some((i) =>
        i.includes(`scenarios[recent-bank-change-block].disposition.per_firm.firm-b -> "vetoed" is not a state_vocabulary id`),
      ),
    ).toBe(true);
  });

  it("flags a dropped provenance-bearing section (canonical_request, household) instead of skipping it", () => {
    const dropped = parseData(realText);
    delete dropped.canonical_request;
    delete dropped.household;
    const issues = crossRefViolations(dropped);
    expect(issues.some((i) => i.includes(`canonical_request -> expected a section carrying a provenance label, got missing`))).toBe(true);
    expect(issues.some((i) => i.includes(`household -> expected a section carrying a provenance label, got missing`))).toBe(true);
  });

  it("flags a gutted or empty document instead of passing vacuously", () => {
    expect(baselineViolations(parseData("{}\n")).length).toBeGreaterThan(0);
  });
});
