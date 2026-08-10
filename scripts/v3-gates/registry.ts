/**
 * Registry-structural validation (ADR-0023): completeness, honest
 * activation-only statuses, live mechanism mappings, and the shipped-activation
 * ratchet. One implementation, imported by BOTH the v3-invariants fence and the
 * blocking runner (the charter's one-shared-rule-set mandate), so the two
 * cannot re-implement these rules divergently.
 */
import type { Registry } from "./model";
import { activeInvariantRatchetProblems } from "./invariant-ratchets";
import { ciJobRunProblem, type CiJob } from "./ci-workflow";

const VALID_STATUSES = ["active", "not-yet-active"];
const MECHANISM_TYPES = ["fitness", "ci-gate", "file", "config", "adr", "procedure"];

export interface RegistryValidationDeps {
  exists: (path: string) => boolean;
  ciJobs: Map<string, CiJob>;
}

/** Pure core: validate the registry against an injectable fs/ci view; returns human-readable problems. */
export function validateRegistry(
  reg: Pick<Registry, "invariants">,
  deps: RegistryValidationDeps,
): string[] {
  const problems: string[] = [];
  const invs = reg.invariants ?? [];

  const ids = invs.map((i) => i.id);
  const missing = Array.from({ length: 30 }, (_, k) => k + 1).filter((n) => !ids.includes(n));
  if (missing.length > 0) problems.push(`invariants missing from the registry: ${missing.join(", ")}`);
  if (new Set(ids).size !== ids.length) problems.push("duplicate invariant ids in the registry");
  if (invs.length !== 30) problems.push(`registry must hold exactly the 30 v3 §17 invariants, found ${invs.length}`);

  for (const inv of invs) {
    const tag = `invariant ${inv.id} (${inv.name ?? "unnamed"})`;
    if (!inv.name) problems.push(`${tag}: missing name`);
    if (!inv.group) problems.push(`${tag}: missing group`);
    if (!inv.gate) problems.push(`${tag}: missing gate`);
    if (!VALID_STATUSES.includes(inv.status)) {
      problems.push(
        `${tag}: status '${inv.status}' is not allowed. The registry records ACTIVATION only ` +
          `('active' | 'not-yet-active'); pass/fail is COMPUTED by the runner, never stored (v3 §17: never fake green).`,
      );
      continue;
    }
    if (inv.status === "active") {
      const fitness = (inv.mechanisms ?? []).filter((m) => m.type === "fitness");
      if (fitness.length === 0) {
        problems.push(`${tag}: ACTIVE but maps to no runnable fitness mechanism - an active invariant nobody runs is fake green`);
      }
    } else {
      if (!inv.activatesWhen || inv.activatesWhen.trim() === "") {
        problems.push(`${tag}: not-yet-active but names no activation prerequisite (activatesWhen) - that is a silent deferral`);
      }
    }
    for (const m of inv.mechanisms ?? []) {
      if (!MECHANISM_TYPES.includes(m.type)) problems.push(`${tag}: unknown mechanism type '${m.type}'`);
      if (m.type === "ci-gate") {
        if (typeof m.command !== "string" || m.command.trim() === "") {
          problems.push(`${tag}: ci-gate '${m.ref}' must name the command its blocking job runs - a job NAME alone is satisfied by a comment or a path`);
        } else {
          const problem = ciJobRunProblem(deps.ciJobs, m.ref, m.command);
          if (problem !== undefined) problems.push(`${tag}: ${problem}`);
        }
      } else if (!deps.exists(m.ref)) {
        problems.push(`${tag}: mechanism ${m.type}:${m.ref} does not exist on disk`);
      }
    }
  }

  problems.push(...activeInvariantRatchetProblems(reg));
  return problems;
}
