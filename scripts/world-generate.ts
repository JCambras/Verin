/**
 * POPULATED-WORLD GENERATOR RUNNER (ADR-0057) - `pnpm world:generate`.
 *
 * Writes `fixtures/world/manifest.json` and `fixtures/world/households/**` from
 * the hand-owned spec. Everything it writes is generator-owned: `pnpm
 * world:validate` regenerates and byte-compares in CI, so a hand edit fails the
 * build. It never writes `spec/**`.
 *
 * `--print-digest` emits only the worldDigest, so the determinism fence can
 * compare runs under different TZ environments without diffing a hundred files.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "./error-message";
import { generateWorld } from "./world/generate";
import { HOUSEHOLDS_DIR, WORLD_DIR, WORLD_SEED, loadWorldSpec } from "./world/spec";

function main(): void {
  const spec = loadWorldSpec();
  const world = generateWorld(spec, WORLD_SEED);
  const digest = String((world.manifest.value as Record<string, unknown>).worldDigest);
  if (process.argv.includes("--print-digest")) {
    process.stdout.write(`${digest}\n`);
    return;
  }
  mkdirSync(HOUSEHOLDS_DIR, { recursive: true });
  const emitted = new Set(world.files.map((file) => file.relPath.split("/")[1]!));
  for (const stale of readdirSync(HOUSEHOLDS_DIR).filter((name) => name.endsWith(".json") && !emitted.has(name))) {
    rmSync(join(HOUSEHOLDS_DIR, stale));
    process.stdout.write(`  removed households/${stale}\n`);
  }
  for (const file of [...world.files, world.manifest]) {
    writeFileSync(join(WORLD_DIR, file.relPath), file.bytes, "utf8");
  }
  const handAuthored = world.households.filter((household) => household.authoring === "hand-authored").length;
  process.stdout.write(
    `world: wrote ${world.files.length} household(s) + manifest\n` +
    `  seed          ${WORLD_SEED}\n` +
    `  worldVersion  ${spec.roster.worldVersion}\n` +
    `  worldDigest   ${digest}\n` +
    `  authoring     ${handAuthored} hand-authored, ${world.files.length - handAuthored} derived\n\n` +
    "Every record is labeled source=fixture and can never feed a compliance decision (charter #3).\n",
  );
}

try {
  main();
} catch (e) {
  process.stderr.write(`world generate failed: ${errorMessage(e)}\n`);
  process.exit(1);
}
