/**
 * CORPUS GENERATOR RUNNER (v3 prompt 11, ADR-0034) - `pnpm corpus:generate`.
 *
 * Writes `fixtures/corpus/manifest.json` and `fixtures/corpus/synthetic/**` from
 * the hand-owned spec. Everything it writes is generator-owned: `pnpm
 * corpus:validate` regenerates and byte-compares in CI, so a hand edit fails the
 * build. It NEVER writes `spec/**` (hand-owned) or `real-derived/**` (captain-
 * gated intake), and it never writes a signature.
 *
 * `--print-digest` emits only the corpusDigest, so the determinism fence can
 * compare runs under different TZ environments without diffing whole trees.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTaxonomy } from "./corpus/defects";
import { generateSyntheticCases } from "./corpus/generate";
import {
  buildInventory,
  buildManifest,
  generatedSignatureProblems,
} from "./corpus/manifest";
import { inspectRealDerivedPartition } from "./corpus/real-derived";
import { CORPUS_SEED } from "./corpus/seed";
import { CORPUS_DIR, SYNTHETIC_DIR, loadSpec } from "./corpus/world";

const printDigestOnly = process.argv.includes("--print-digest");

const spec = loadSpec();
const taxonomy = loadTaxonomy();
const files = generateSyntheticCases(spec, CORPUS_SEED);
const realDerived = inspectRealDerivedPartition(
  taxonomy,
  spec.world.corpusVersion,
);
if (realDerived.problems.length > 0) {
  throw new Error(
    `corpus generate: invalid real-derived partition\n${realDerived.problems.join("\n")}`,
  );
}
const realDerivedFiles = realDerived.inventoryFiles;
const inventory = [
  ...buildInventory(files),
  ...buildInventory(realDerivedFiles, "real-derived"),
];
const manifest = buildManifest(spec, taxonomy, files, CORPUS_SEED, inventory);
const signatureProblems = generatedSignatureProblems([...files, manifest]);
if (signatureProblems.length > 0) {
  throw new Error(
    `corpus generate: generated signature fields are forbidden\n${signatureProblems.join("\n")}`,
  );
}
const digest = String((manifest.value as Record<string, unknown>).corpusDigest);

if (printDigestOnly) {
  process.stdout.write(`${digest}\n`);
} else {
  mkdirSync(SYNTHETIC_DIR, { recursive: true });
  const emitted = new Set(files.map((file) => file.relPath.split("/")[1]!));
  for (const stale of readdirSync(SYNTHETIC_DIR).filter((name) => name.endsWith(".json") && !emitted.has(name))) {
    rmSync(join(SYNTHETIC_DIR, stale));
    process.stdout.write(`  removed synthetic/${stale}\n`);
  }
  for (const file of [...files, manifest]) {
    writeFileSync(join(CORPUS_DIR, file.relPath), file.bytes, "utf8");
  }
  process.stdout.write(
    `corpus: wrote ${files.length} synthetic case(s) + manifest\n  seed          ${CORPUS_SEED}\n  corpusVersion ${spec.world.corpusVersion}\n  corpusDigest  ${digest}\n\nRegeneration changes the digest and INVALIDATES any captain signoff bound to the previous one.\n`,
  );
}
