// The ONE declaration of the decision closure (prompt 5 structural rule 2 and PR-5b's engine
// identity): DecisionPureClosure asserts the runtime graph equals exactly this list, and den.v1
// hashes exactly these files' bytes - one mechanism, two uses, regenerable by anyone.
export const ROOT_MODULE = "src/decision/outcome.ts";
export const ROOT_SYMBOL = "evaluate";
export const CLOSURE_ALLOWLIST = ["src/decision/outcome.ts"] as const;
