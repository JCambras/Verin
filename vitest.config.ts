import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Watcher globs are matched against ABSOLUTE paths, and a bare `**` refuses to
 * traverse a dot-directory - so a checkout under one (an agent worktree, a
 * `.worktrees/` sibling) silently matches nothing. Anchoring every trigger to
 * this file's own directory makes the rule hold wherever the repo lives, and
 * scopes it to THIS repository instead of any tree with the same folder names. */
const ROOT = r(".").replace(/\\/g, "/").replace(/\/$/, "");

/**
 * Test env is pinned to a NON-UTC timezone (charter #8; retro don't-again #39:
 * a suite that is only green in UTC trains everyone to ignore red). CI sets the
 * same TZ. Component tests use jsdom; everything else runs in node.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": r("./src"),
      "@contracts": r("./src/contracts"),
      "@domain": r("./src/domain"),
      "@infra": r("./src/infrastructure"),
      "@app": r("./src/app"),
    },
  },
  test: {
    globals: true,
    // Default node; component tests opt into jsdom with `// @vitest-environment jsdom`.
    environment: "node",
    env: {
      TZ: "America/New_York",
      NODE_ENV: "test",
      APP_ENV: "development",
      VERIN_STORE_DRIVER: "pglite",
      SESSION_SECRET: "test-only-session-secret-not-a-real-secret-000000",
      ESIGN_WEBHOOK_SECRET: "test-only-webhook-secret-not-a-real-secret-000000",
      FIRM_TIMEZONE: "America/New_York",
      LOG_LEVEL: "error",
    },
    setupFiles: ["./src/__tests__/setup.ts"],
    // NO ROOT `include`: `extends: true` runs vite's `mergeConfig`, which
    // CONCATENATES arrays rather than replacing them, so a root include would be
    // added to - never overridden by - each project's own. That is how every
    // unit and integration file ended up collected by BOTH projects, running
    // twice per `pnpm test` and once of those serially under the fitness
    // worker cap the comment below says they are exempt from. Each project
    // therefore declares its own scope, and only the shared exclusions live here.
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    // The budget is ORDINARY and shared - no fence gets a bespoke extension to
    // survive a scheduler - but it tracks the slowest HONEST check rather than
    // the fastest machine. The heaviest fences resolve TYPES across the whole
    // repo (dependency-rule, tokenized-factory-only, no-secret-fallback,
    // tenant-context-required) and take ~9-10s on a fast dev machine; a GitHub
    // runner is roughly twice that, so a 20s budget sat right at the edge and CI
    // timed all three out in one run while every one passed locally (D-131). A
    // timeout is a clock verdict, never a correctness one - 60s still catches a
    // hang, and shrinking a fence to fit a stopwatch is how fences get weakened.
    // The serial-execution note below is what makes even this budget honest.
    testTimeout: 60000,
    // Hooks get the SAME budget as test bodies. Spinning up a PGlite instance is
    // identical work whether it happens in a `beforeEach` or inline, and the 10s
    // hook default made the store-backed integration suites time out under
    // parallel load while the same work passed in isolation - flakiness produced
    // by the config, not by the code under test.
    hookTimeout: 60000,
    // THE CORPUS WORLD'S INPUTS ARE WATCHED, or watch mode would assert against
    // a snapshot. The fitness fences read one shared `validateCorpus()` result
    // computed in global setup, which vitest runs ONCE PER PROCESS, and they no
    // longer import the generator, so neither the module graph nor a rerun would
    // notice a corpus fixture, spec, schema or generator edit. These triggers
    // schedule the rerun; `_corpus-world-setup.ts` rebuilds the world before it
    // collects. Vitest's two defaults are restated (root-anchored) because a
    // declared value REPLACES them - only `setupFiles` is appended by vitest.
    //
    // THIS IS THE BLUNT MECHANISM, AND IT IS THE CORRECT ONE - at a cost worth
    // stating rather than discovering. A match schedules every file BOTH
    // projects have already run, so editing a corpus fixture mid-`pnpm
    // test:watch` costs a full-suite cycle: MEASURED 177s and 185s on two runs,
    // against 48s for the 18 corpus fences that actually read the world - a ~4x
    // tax on corpus iteration, most of it the serial tree below. Vitest 4's
    // targeted `watchTriggerPatterns` was weighed and refused: it runs BEFORE
    // `handleFileChanged` and SUPPRESSES it on a match, so a scoped trigger must
    // itself enumerate every test that depends on the changed input by ANY
    // route, module graph included - and these inputs are read with
    // `readFileSync`, so no compiler edge backs that list. It would already be
    // wrong today: `config/demo/scenarios.yaml` is read by
    // `src/__tests__/unit/decision-core.test.ts` in the OTHER project, which a
    // fitness-scoped list would silently stop rerunning. A hand-kept dependency
    // map whose staleness mode is a green suite is a worse trade than wall
    // clock (D-176).
    forceRerunTriggers: [
      `${ROOT}/**/package.json`,
      `${ROOT}/{vitest,vite}.config.*`,
      `${ROOT}/fixtures/corpus/**`,
      `${ROOT}/fixtures/golden/**`,
      `${ROOT}/fixtures/policy/**`,
      `${ROOT}/scripts/corpus/**`,
      `${ROOT}/scripts/golden-cases.lib.ts`,
      `${ROOT}/config/demo/scenarios.yaml`,
      `${ROOT}/docs/golden-cases.md`,
    ],
    // SERIAL EXECUTION IS SCOPED TO THE TREE THAT NEEDS IT, and it is held here
    // rather than in a shell string. `fitness` is the only suite whose files
    // contend: several fences each construct an INDEPENDENT full-repository
    // TypeScript program (`realSemanticProject`, `measuredCodeProject`,
    // `generatorProject`), and vitest isolates modules per file, so concurrency
    // multiplies the program, not just the work. Measured on a 12-core machine:
    // serially the whole fitness suite takes ~134s and its slowest single fence
    // ~5s; at two workers that same fence takes ~16s, at four it crossed the
    // then-20s budget and failed, and at twelve five files fail on timeouts
    // while total CPU doubles. Above one worker, fitness buys wall-clock with
    // flakiness - so the honest setting for THAT tree is serial, and the budget
    // above stays a clock allowance rather than a contention allowance under
    // it. The unit and integration suites cause none of that contention and stay
    // parallel; serializing them would be a wall-clock tax for a problem they do
    // not have (D-172). Holding it in the config, not in two `package.json`
    // strings, is what keeps `pnpm test:watch` and the run
    // `scripts/v3-invariants.ts` spawns from picking fitness up at default
    // parallelism - the measured twelve-worker failure case, reachable by a
    // documented command. The fitness suite is kept parallel-SAFE regardless (no
    // fixture is planted inside the repository tree, where it would race the
    // fences that walk it).
    projects: [
      {
        extends: true,
        test: {
          name: "fitness",
          include: ["src/__tests__/fitness/**/*.{test,spec}.{ts,tsx}"],
          // The committed corpus is validated ONCE per run and injected, rather
          // than re-validated by every fence file that reads it - see
          // `_corpus-world-setup.ts` for why isolation makes that the only
          // sharing seam, for the clock it pins before computing, and for how a
          // watch rerun rebuilds it against the triggers declared above.
          globalSetup: ["./src/__tests__/fitness/_corpus-world-setup.ts"],
          maxWorkers: 1,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "app",
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/__tests__/fitness/**"],
        },
      },
    ],
  },
});
