// The capability-denied second execution (prompt 5 rule 2, M-F, the capture-off half of M-I): the
// committed samples load FIRST; then clock, randomness, network and environment become throwing
// sentinels and every case evaluates twice - if evaluate reaches any capability this process dies
// naming it, and the printed digests are what both comparisons assert byte-identical.
import { createHash } from "node:crypto";
import { evaluate, outcomeDigest, serializeOutcome } from "../decision/outcome";
import { SAMPLE_INPUTS } from "./decision-samples";
import { loadSignedCaseInputs } from "./signed-cases";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// The signed-case reads (git, the pin registry, the environment) happen HERE, before any sentinel.
const CASES = [...SAMPLE_INPUTS, ...loadSignedCaseInputs().map((c) => ({ name: c.caseId, input: c.input }))];
const deny = (name: string) => () => {
  throw new Error(`capability '${name}' is denied in the decision realm`);
};
const RealDate = Date;
const realEnv = Object.getOwnPropertyDescriptor(process, "env")!;
Date.now = deny("Date.now") as never;
Math.random = deny("Math.random") as never;
(globalThis as Record<string, unknown>)["fetch"] = deny("fetch");
(globalThis as Record<string, unknown>)["Date"] = new Proxy(RealDate, {
  construct: (target, args) => {
    if (args.length === 0) throw new Error("capability 'new Date()' is denied in the decision realm");
    return Reflect.construct(target, args);
  },
  apply: deny("Date()"),
  get: (target, p) => (p === "now" ? deny("Date.now") : Reflect.get(target, p)),
});
Object.defineProperty(process, "env", { configurable: true, get: deny("process.env") });

const lines: string[] = [];
for (const { name, input } of CASES) {
  const first = evaluate(input);
  const second = evaluate(input);
  if (serializeOutcome(first) !== serializeOutcome(second)) throw new Error(`${name}: two evaluations of the same input differ; the closure claim is false`);
  lines.push(`${name} outcome=${outcomeDigest(first)} explanations=exp:${sha256(JSON.stringify(first.explanations))} trace=trc:${sha256(JSON.stringify(first.trace))}`);
}
Object.defineProperty(process, "env", realEnv);
(globalThis as Record<string, unknown>)["Date"] = RealDate;
process.stdout.write(lines.join("\n") + "\n");
