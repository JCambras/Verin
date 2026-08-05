import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * CHARTER-DRIFT FENCE (charter operating model: "the constitution enforces its
 * own enforcement"). Fails the build if:
 *  (a) any 'enforced' mapping in charter-map.json points at a mechanism (file,
 *      config, fitness test, or CI gate) that no longer exists or is disabled;
 *  (a') any enforced ci-gate is missing from the BLOCKING ci.yml specifically —
 *      a name surviving only in the non-blocking scheduled.yml does not count;
 *  (b) any fitness fence — INCLUDING this one — is disabled or focused
 *      (skip/only/x-prefixed variants);
 *  (c) any of the 16 charter non-negotiables is missing from the map;
 *  (d) any active fitness fence file is NOT referenced by the map (a silently
 *      added/orphaned fence);
 *  (e) any entry that has ever shipped as 'enforced' is flipped back to
 *      'planned' (a ratchet — enforcement is monotonic).
 *
 * Companion (detection-is-not-verification) lives in
 * detection-not-verification.test.ts and proves this fence FAILS when a mapped
 * mechanism is removed — so a green charter-drift check cannot be vacuous.
 *
 * @companion:proof-log — adversarial proof PF-001 in docs/fences/proof-log.md
 * (a self-referential meta fence proves itself via the log, not an inline fixture).
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));
const p = (rel: string) => root + rel;

interface Mechanism {
  type: string;
  ref: string;
  status?: "enforced" | "planned";
}
interface Entry {
  id: number | string;
  title: string;
  status: "enforced" | "planned";
  mechanisms: Mechanism[];
}
interface CharterMap {
  nonNegotiables: Entry[];
  operatingModel: Entry[];
}

const map = JSON.parse(readFileSync(p("charter-map.json"), "utf8")) as CharterMap;
const allEntries = [...map.nonNegotiables, ...map.operatingModel];

const isPathLike = (ref: string) => ref.includes("/") || ref.includes(".");
const effectiveStatus = (entry: Entry, m: Mechanism) => m.status ?? entry.status;

// The RATCHET (e): every id that has shipped as 'enforced'. Flipping one of these
// back to 'planned' in charter-map.json would silently skip its existence checks
// and orphan detection — enforcement is monotonic; removal needs a charter ADR
// AND an edit here, in the fence, where review sees it.
const RATCHETED_ENFORCED_IDS = [
  ...Array.from({ length: 16 }, (_, i) => i + 1),
  "charter-as-code",
  "charter-amended-by-adr-only",
  "charter-drift-fence",
  "non-utc-clock",
  "dependency-rule",
  "v3-direction-ratified",
  "v3-invariants-phase-gated",
  "demo-contract-as-data",
  "golden-cases-truth-set",
  "demo-skeleton-honesty",
  "decision-core-type-system",
];

function blockingCiText(): string {
  // ONLY the blocking workflow counts: gate names also appear in the non-blocking
  // scheduled.yml, so a whole-directory scan would stay green after a gate is
  // deleted from ci.yml.
  const f = p(".github/workflows/ci.yml");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
}

export function duplicateReviewProofIds(text: string): string[] {
  const firstLine = new Map<number, number>();
  const duplicates: string[] = [];
  for (const match of text.matchAll(/^## F(\d+)(?:-F?(\d+))?\b/gm)) {
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    const line = text.slice(0, match.index).split("\n").length;
    for (let id = start; id <= end; id += 1) {
      const first = firstLine.get(id);
      if (first !== undefined) {
        duplicates.push(`docs/fences/proof-log.md:${line} :: duplicate F${id} (first declared at line ${first})`);
      } else {
        firstLine.set(id, line);
      }
    }
  }
  return duplicates;
}

export function duplicateDecisionIds(text: string): string[] {
  const firstLine = new Map<string, number>();
  const duplicates: string[] = [];
  for (const match of text.matchAll(/^#{2,3}\s+D-(\d{3})\b/gm)) {
    const id = match[1]!;
    const line = text.slice(0, match.index).split("\n").length;
    const first = firstLine.get(id);
    if (first === undefined) {
      firstLine.set(id, line);
    } else {
      duplicates.push(
        `DECISIONS.md:${line} :: duplicate D-${id} (first declared at line ${first})`,
      );
    }
  }
  return duplicates;
}

export function adrIdentifierProblems(
  files: Array<{ name: string; text: string }>,
): string[] {
  const firstFile = new Map<string, string>();
  const problems: string[] = [];
  for (const { name, text } of files) {
    const fileMatch = /^(\d{4})-[a-z0-9-]+\.md$/.exec(name);
    if (!fileMatch) continue;
    const id = fileMatch[1]!;
    if (id === "0000") continue;
    const first = firstFile.get(id);
    if (first === undefined) {
      firstFile.set(id, name);
    } else {
      problems.push(
        `docs/adr/${name}:1 :: duplicate ADR-${id} (first declared by ${first})`,
      );
    }
    const header = /^# ADR-(\d{4}):/.exec(text);
    if (header?.[1] !== id) {
      problems.push(
        `docs/adr/${name}:1 :: filename ADR-${id} does not match header ${header ? `ADR-${header[1]}` : "(missing)"}`,
      );
    }
  }
  return problems;
}

describe("charter-drift fence", () => {
  it("(a) every enforced file/config/fitness mechanism exists on disk", () => {
    const missing: string[] = [];
    for (const entry of allEntries) {
      for (const m of entry.mechanisms) {
        if (effectiveStatus(entry, m) !== "enforced") continue;
        if (["file", "config", "fitness", "adr", "procedure"].includes(m.type) && isPathLike(m.ref)) {
          if (!existsSync(p(m.ref))) missing.push(`${entry.id} -> ${m.type}:${m.ref}`);
        }
      }
    }
    expect(missing, `enforced mappings point at missing mechanisms:\n${missing.join("\n")}`).toEqual([]);
  });

  it("(a') every enforced ci-gate is declared in the BLOCKING ci.yml", () => {
    const ci = blockingCiText();
    const missing: string[] = [];
    for (const entry of allEntries) {
      for (const m of entry.mechanisms) {
        if (effectiveStatus(entry, m) !== "enforced") continue;
        if (m.type === "ci-gate" && !ci.includes(m.ref)) missing.push(`${entry.id} -> ci-gate:${m.ref}`);
      }
    }
    expect(missing, `enforced CI gates not found in .github/workflows/ci.yml:\n${missing.join("\n")}`).toEqual([]);
  });

  it("(b) no fitness fence is disabled or focused (this file included)", () => {
    const dir = p("src/__tests__/fitness");
    const offenders: string[] = [];
    // Matchers are ASSEMBLED so this file can scan ITSELF without the pattern
    // literals self-triggering (a describe-dot-skip on the meta-fence must be caught).
    const dot = "\\.";
    const banned = ["it", "describe", "test"].flatMap((fn) => [new RegExp(`\\b${fn}${dot}skip\\b`), new RegExp(`\\b${fn}${dot}only\\b`)]);
    banned.push(new RegExp(`\\bx${"it"}\\b`), new RegExp(`\\bx${"describe"}\\b`));
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      for (const re of banned) if (re.test(src)) offenders.push(`${f} :: ${re}`);
    }
    expect(offenders, `disabled/focused fences found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("(e) ratchet: every id that shipped as 'enforced' is still enforced", () => {
    const byId = new Map(allEntries.map((e) => [String(e.id), e]));
    const regressions: string[] = [];
    for (const id of RATCHETED_ENFORCED_IDS) {
      const entry = byId.get(String(id));
      if (!entry) regressions.push(`${id}: removed from charter-map.json`);
      else if (entry.status !== "enforced") regressions.push(`${id}: status flipped to '${entry.status}'`);
    }
    expect(regressions, `enforced charter entries regressed (the ratchet is monotonic):\n${regressions.join("\n")}`).toEqual([]);
  });

  it("(c) all 16 non-negotiables are present in the map", () => {
    const ids = new Set(map.nonNegotiables.map((e) => Number(e.id)));
    const missing = Array.from({ length: 16 }, (_, i) => i + 1).filter((n) => !ids.has(n));
    expect(missing, `non-negotiable IDs missing from charter-map.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("(d) every active fitness fence file is referenced by the map", () => {
    const dir = p("src/__tests__/fitness");
    const refs = new Set(allEntries.flatMap((e) => e.mechanisms.map((m) => m.ref)));
    const orphans: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
      const rel = `src/__tests__/fitness/${f}`;
      if (!refs.has(rel)) orphans.push(rel);
    }
    expect(orphans, `fitness fences not referenced by charter-map.json (silently added?):\n${orphans.join("\n")}`).toEqual([]);
  });

  it("proof-log review ids are unique, including ids covered by ranges", () => {
    const proofLog = readFileSync(p("docs/fences/proof-log.md"), "utf8");
    expect(duplicateReviewProofIds(proofLog)).toEqual([]);
    const injected = duplicateReviewProofIds(`${proofLog}\n## F103 · injected duplicate\n`);
    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain("duplicate F103");
    expect(injected[0]).toContain("docs/fences/proof-log.md:");
  });

  it("decision and ADR identifiers are unique and filename-bound", () => {
    const decisions = readFileSync(p("DECISIONS.md"), "utf8");
    const adrDir = p("docs/adr");
    const adrs = readdirSync(adrDir).map((name) => ({
      name,
      text: readFileSync(`${adrDir}/${name}`, "utf8"),
    }));
    expect(duplicateDecisionIds(decisions)).toEqual([]);
    expect(adrIdentifierProblems(adrs)).toEqual([]);

    const duplicateDecision = duplicateDecisionIds(
      `${decisions}\n### D-098 · injected duplicate\n`,
    );
    expect(duplicateDecision).toHaveLength(1);
    expect(duplicateDecision[0]).toContain("duplicate D-098");

    const duplicateAdr = adrIdentifierProblems([
      ...adrs,
      {
        name: "0040-injected-duplicate.md",
        text: "# ADR-0040: Injected duplicate\n",
      },
    ]);
    expect(duplicateAdr).toHaveLength(1);
    expect(duplicateAdr[0]).toContain("duplicate ADR-0040");

    const mismatchedAdr = adrIdentifierProblems([
      {
        name: "0041-header-mismatch.md",
        text: "# ADR-0042: Header mismatch\n",
      },
    ]);
    expect(mismatchedAdr).toHaveLength(1);
    expect(mismatchedAdr[0]).toContain(
      "filename ADR-0041 does not match header ADR-0042",
    );
  });
});
