import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ciJobRunProblem, parseCiJobs, type CiJob } from "../../../scripts/v3-gates.lib";

/**
 * CHARTER-DRIFT FENCE (charter operating model: "the constitution enforces its
 * own enforcement"). Fails the build if:
 *  (a) any 'enforced' mapping in charter-map.json points at a mechanism (file,
 *      config, fitness test, or CI gate) that no longer exists or is disabled;
 *  (a') any enforced ci-gate is not a real, blocking job of ci.yml specifically —
 *      a name surviving only in the non-blocking scheduled.yml does not count, nor
 *      does one surviving as a comment, a path, or a job that cannot fail the build;
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
  command?: string;
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
  "v3-gate-ordering",
  "demo-contract-as-data",
  "golden-cases-truth-set",
  "demo-skeleton-honesty",
  "decision-core-type-system",
  "primitive-vocabulary-versioned",
  "replay-corpus-substrate",
];

const RATCHETED_CI_COMMANDS = [
  {
    entryId: "3",
    ref: "provenance-trace",
    command:
      "pnpm exec vitest run src/__tests__/fitness/provenance-required.test.ts src/__tests__/fitness/no-unlabeled-synthetic.test.ts src/__tests__/fitness/metric-provenance.test.ts src/__tests__/fitness/derived-provenance.test.ts src/__tests__/fitness/no-pii-in-audit-store.test.ts",
  },
  { entryId: "5", ref: "knip", command: "pnpm knip" },
  { entryId: "8", ref: "e2e", command: "pnpm test:e2e" },
  { entryId: "9", ref: "e2e", command: "pnpm test:e2e" },
  { entryId: "11", ref: "load-smoke", command: "pnpm load:smoke" },
  { entryId: "13", ref: "audit-chain-verify", command: "pnpm audit:chain" },
  { entryId: "14", ref: "test", command: "pnpm test" },
  {
    entryId: "15",
    ref: "secret-scan",
    command: "gitleaks git --config .gitleaks.toml --redact --no-banner --exit-code 1 .",
  },
  {
    entryId: "15",
    ref: "sast",
    command:
      "semgrep scan --config p/typescript --config p/react --config p/nodejsscan --config p/secrets --exclude-rule ajinabraham.njsscan.dos.regex_dos.regex_dos --error",
  },
  { entryId: "15", ref: "dependency-audit", command: "pnpm audit --audit-level=high" },
  { entryId: "15", ref: "dependency-audit", command: "pnpm license:audit" },
  { entryId: "v3-invariants-phase-gated", ref: "v3-invariants", command: "pnpm v3:invariants" },
  { entryId: "v3-gate-ordering", ref: "v3-invariants", command: "pnpm v3:invariants" },
  { entryId: "golden-cases-truth-set", ref: "golden-cases", command: "pnpm golden:validate" },
] as const;

function blockingCiJobs(): Map<string, CiJob> {
  const f = p(".github/workflows/ci.yml");
  return parseCiJobs(existsSync(f) ? readFileSync(f, "utf8") : "");
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

  it("(a') every enforced ci-gate binds an exact command in a dedicated blocking step", () => {
    const jobs = blockingCiJobs();
    const missing: string[] = [];
    for (const entry of allEntries) {
      for (const m of entry.mechanisms) {
        if (effectiveStatus(entry, m) !== "enforced") continue;
        if (m.type !== "ci-gate") continue;
        if (m.command === undefined || m.command.trim() === "") {
          missing.push(`${entry.id} -> ci-gate:${m.ref} does not bind an exact command`);
          continue;
        }
        const problem = ciJobRunProblem(jobs, m.ref, m.command);
        if (problem !== undefined) missing.push(`${entry.id} -> ${problem}`);
      }
    }
    expect(missing, `enforced CI gates are not proven by .github/workflows/ci.yml:\n${missing.join("\n")}`).toEqual([]);
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

  it("(e') ratchet: load-bearing CI mappings stay bound to their exact blocking commands", () => {
    const byId = new Map(allEntries.map((entry) => [String(entry.id), entry]));
    const regressions = RATCHETED_CI_COMMANDS.flatMap(({ entryId, ref, command }) => {
      const entry = byId.get(entryId);
      const bound = entry?.mechanisms.some((mechanism) => mechanism.type === "ci-gate" && mechanism.ref === ref && mechanism.command === command);
      return bound ? [] : [`${entryId} -> ci-gate:${ref} must run '${command}'`];
    });
    expect(regressions, `charter CI command bindings regressed:\n${regressions.join("\n")}`).toEqual([]);
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
});
