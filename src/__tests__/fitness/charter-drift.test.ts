import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * CHARTER-DRIFT FENCE (charter operating model: "the constitution enforces its
 * own enforcement"). Fails the build if:
 *  (a) any 'enforced' mapping in charter-map.json points at a mechanism (file,
 *      config, fitness test, or CI gate) that no longer exists or is disabled;
 *  (b) any fitness fence is disabled or focused (.skip/.only/xit/xdescribe);
 *  (c) any of the 16 charter non-negotiables is missing from the map;
 *  (d) any active fitness fence file is NOT referenced by the map (a silently
 *      added/orphaned fence).
 *
 * Companion (detection-is-not-verification) lives in
 * detection-not-verification.test.ts and proves this fence FAILS when a mapped
 * mechanism is removed — so a green charter-drift check cannot be vacuous.
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

function ciWorkflowText(): string {
  const dir = p(".github/workflows");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
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

  it("(a') every enforced ci-gate is declared in a CI workflow", () => {
    const ci = ciWorkflowText();
    const missing: string[] = [];
    for (const entry of allEntries) {
      for (const m of entry.mechanisms) {
        if (effectiveStatus(entry, m) !== "enforced") continue;
        if (m.type === "ci-gate" && !ci.includes(m.ref)) missing.push(`${entry.id} -> ci-gate:${m.ref}`);
      }
    }
    expect(missing, `enforced CI gates not found in .github/workflows:\n${missing.join("\n")}`).toEqual([]);
  });

  it("(b) no fitness fence is disabled or focused", () => {
    const dir = p("src/__tests__/fitness");
    const offenders: string[] = [];
    const banned = [/\bit\.skip\b/, /\bit\.only\b/, /\bdescribe\.skip\b/, /\bdescribe\.only\b/, /\bxit\b/, /\bxdescribe\b/, /\btest\.skip\b/, /\btest\.only\b/];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
      if (f === "charter-drift.test.ts") continue; // self: contains these patterns as regex literals
      const src = readFileSync(`${dir}/${f}`, "utf8");
      for (const re of banned) if (re.test(src)) offenders.push(`${f} :: ${re}`);
    }
    expect(offenders, `disabled/focused fences found:\n${offenders.join("\n")}`).toEqual([]);
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
      if (f === "charter-drift.test.ts") continue; // self
      const rel = `src/__tests__/fitness/${f}`;
      if (!refs.has(rel)) orphans.push(rel);
    }
    expect(orphans, `fitness fences not referenced by charter-map.json (silently added?):\n${orphans.join("\n")}`).toEqual([]);
  });
});
