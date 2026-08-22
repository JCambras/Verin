// The den.v1 engine identity (prompt 5, PR-5b): SHA-256 over the decision closure's sorted
// canonical source bytes - the exact files DecisionPureClosure resolves, so the purity proof and
// the identity cannot disagree about what the engine IS. Regenerable by anyone; the committed copy
// (src/decision/engine-identity.json) is byte-compared in the blocking job through the
// generated-artifacts registry, and the comparison surface renders it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { CLOSURE_ALLOWLIST } from "./decision-closure-allowlist";

export function engineIdentity(): { engine: string; closure: readonly string[]; bytes: string } {
  let bytes = "";
  for (const path of [...CLOSURE_ALLOWLIST].sort()) {
    bytes += `${path}\n${readFileSync(path, "utf8")}\n`;
  }
  return { engine: `den.v1:${createHash("sha256").update(bytes).digest("hex")}`, closure: [...CLOSURE_ALLOWLIST].sort(), bytes };
}

if (process.argv[1]?.endsWith("decision-engine-identity.ts")) {
  const bytes = JSON.stringify(engineIdentity(), null, 2) + "\n";
  if (process.argv[2] === "--print") process.stdout.write(bytes);
  else {
    writeFileSync("src/decision/engine-identity.json", bytes);
    console.log("engine identity written");
  }
}
