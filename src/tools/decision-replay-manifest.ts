// The replay manifest (prompt 5, PR-5b): per case, the complete resolved identity set - request
// (drq.v1), configuration (fpd.v1), evidence bundle (evb.v1), engine (den.v1), serializer
// (dov.v1), the vocabulary version, and the produced outcome digest - plus the process time zones
// that produced EXACTLY these identities: the generator runs itself under America/New_York and
// Asia/Tokyo and refuses to write unless both agree byte for byte, so a replay can PROVE the time
// zone did not matter rather than assume it. The committed copy is byte-compared in the blocking
// job through the generated-artifacts registry, and the in-suite equality test recomputes every
// row against it.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { evaluate, outcomeDigest, requestIdentity } from "../decision/outcome";
import { OBSERVATION_VOCABULARY_VERSION } from "../evidence/vocabulary";
import { engineIdentity } from "./decision-engine-identity";
import { SAMPLE_INPUTS } from "./decision-samples";
import { loadSignedCaseInputs } from "./signed-cases";

const TIME_ZONES = ["America/New_York", "Asia/Tokyo"] as const;
export function computeManifestRows() {
  const engine = engineIdentity().engine;
  const cases = [...SAMPLE_INPUTS, ...loadSignedCaseInputs().map((c) => ({ name: c.caseId, input: c.input }))];
  return cases.map(({ name, input }) => {
    const outcome = evaluate(input);
    return {
      case: name,
      request: outcome.citations.request,
      configuration: outcome.citations.policy,
      evidenceBundle: outcome.citations.evidenceBundle,
      engine,
      serializer: "dov.v1",
      vocabulary: OBSERVATION_VOCABULARY_VERSION,
      outcome: outcomeDigest(outcome),
      requestIdentityRecomputed: requestIdentity(input.request), // equals `request` by construction; recorded so a replay can cross-check without evaluating
    };
  });
}

if (process.argv[1]?.endsWith("decision-replay-manifest.ts")) {
  if (process.argv[2] === "--rows") {
    process.stdout.write(JSON.stringify(computeManifestRows(), null, 2) + "\n");
  } else {
    // The two-time-zone attestation: spawn the row computation under each zone; refuse on drift.
    const perZone = TIME_ZONES.map((tz) => execFileSync("corepack", ["pnpm", "exec", "tsx", "src/tools/decision-replay-manifest.ts", "--rows"], { encoding: "utf8", env: { ...process.env, TZ: tz } }));
    if (perZone[0] !== perZone[1]) throw new Error("the manifest rows differ between time zones; refusing to write an attestation the runs do not support");
    const bytes = JSON.stringify({ attestedTimeZones: TIME_ZONES, rows: JSON.parse(perZone[0]) }, null, 2) + "\n";
    if (process.argv[2] === "--print") process.stdout.write(bytes);
    else {
      writeFileSync("docs/evidence/decision-replay-manifest.json", bytes);
      console.log(`replay manifest written (${JSON.parse(perZone[0]).length} rows, both time zones byte-identical)`);
    }
  }
}
