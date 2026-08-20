// enforcement/run.mjs - CI wiring for the seam: collect the EnforcementInput facts, evaluate, print every
// rule's verdict, and exit non-zero on any violation. Also runs the proof log's own check: the rule-to-entry
// mapping in docs/proof-log.md is total in both directions (every implemented rule has exactly one M-<rule>
// entry; every entry names an implemented rule). There is no second seam here - only collection and wiring.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { evaluateEnforcement, RULES } from "./contract.mjs";
import { collectTreeFacts, regenerateSignedTruthPins } from "./rules-tree.mjs";

const regen = process.argv.find((a) => a.startsWith("--regenerate="));
if (regen) {
  if (regen.slice(13) !== "enforcement/signed-truth-pins.json") { console.error(`unknown regenerable artifact '${regen.slice(13)}'`); process.exit(2); }
  process.stdout.write(regenerateSignedTruthPins());
  process.exit(0);
}

function mergeBaseSet() {
  try { execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]); } catch { return null; }
  try {
    return execFileSync("git", ["merge-base", "--all", "HEAD", "origin/main"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch (err) { return err.status === 1 ? [] : null; } // exit 1 with no output is git's empty set, not an error
}

async function readDefaultBranch() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { defaultBranch: null, defaultBranchError: "no credential (GITHUB_TOKEN unset); refusing an unauthenticated read" };
  try {
    const url = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${process.env.GITHUB_REPOSITORY ?? "JCambras/Verin"}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
    if (!res.ok) return { defaultBranch: null, defaultBranchError: `the API answered ${res.status}` };
    const branch = (await res.json()).default_branch;
    return branch ? { defaultBranch: branch } : { defaultBranch: null, defaultBranchError: "the answer carried no default_branch" };
  } catch (err) { return { defaultBranch: null, defaultBranchError: String(err) }; }
}

function readRoadmapSeamIds() {
  if (!existsSync("CONSTITUTION.md")) return null;
  const section = readFileSync("CONSTITUTION.md", "utf8").split(/^## The ten-slice roadmap.*$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/^\| \d+ \| \d+ \| `([A-Za-z0-9]+)` \|/gm)].map((m) => m[1]);
}

async function collectInput() {
  const event = process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const body = event.pull_request?.body ?? "";
  const input = {
    eventName: process.env.GITHUB_EVENT_NAME ?? null,
    baseRef: event.pull_request?.base?.ref ?? null,
    headRef: event.pull_request?.head?.ref ?? null,
    baseSha: event.pull_request?.base?.sha ?? null,
    headSha: event.pull_request?.head?.sha ?? null,
    pushedRef: event.ref ?? null,
    beforeSha: event.before ?? null,
    headPushSha: event.after ?? null,
    mergeBaseWithMain: mergeBaseSet(),
    declaredSeamIds: [...body.matchAll(/^Seam:[ \t]*(\S+)[ \t]*$/gm)].map((m) => m[1]),
    declaredSliceClass: body.match(/^Slice-Class:[ \t]*(\S+)[ \t]*$/m)?.[1] ?? null,
    roadmapSeamIds: readRoadmapSeamIds(),
    ...(await readDefaultBranch()),
  };
  return { ...input, ...collectTreeFacts(input) };
}

function proofLogViolations() {
  const path = "docs/proof-log.md";
  if (!existsSync(path)) return [{ rule: "proof-log", ref: path, message: "docs/proof-log.md is missing; every shipped rule needs its proven entry" }];
  const entries = [...readFileSync(path, "utf8").matchAll(/^## (M-E\d+|M-V\d+) \(rule (E\d+)\)/gm)].map((m) => ({ id: m[1], rule: m[2] }));
  const out = [];
  for (const id of RULES.keys()) {
    const n = entries.filter((e) => e.id === `M-${id}`).length;
    if (n !== 1) out.push({ rule: "proof-log", ref: id, message: `rule ${id} has ${n} 'M-${id}' entries; exactly one is required - an unproven rule does not ship` });
  }
  for (const e of entries) if (!RULES.has(e.rule)) out.push({ rule: "proof-log", ref: e.id, message: `entry ${e.id} names rule ${e.rule}, which does not exist` });
  return out;
}

const report = evaluateEnforcement(await collectInput());
const violations = [...report.violations, ...proofLogViolations()];
for (const id of [...RULES.keys(), "proof-log"])
  console.log(violations.some((x) => x.rule === id) ? `${id} FAIL` : `${id} PASS`);
for (const x of violations) console.log(`${x.rule} FAIL ${x.ref} - ${x.message}`);
process.exit(violations.length ? 1 : 0);
