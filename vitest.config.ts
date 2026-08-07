import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

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
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    // 20s is an ORDINARY-TEST budget, and it is left ordinary on purpose: no
    // fence gets a bespoke extension to survive a scheduler.
    testTimeout: 20000,
    // Hooks get the SAME budget as test bodies. Spinning up a PGlite instance is
    // identical work whether it happens in a `beforeEach` or inline, and the 10s
    // hook default made the store-backed integration suites time out under
    // parallel load while the same work passed in isolation - flakiness produced
    // by the config, not by the code under test.
    hookTimeout: 20000,
    // SERIAL EXECUTION IS SCOPED TO THE TREE THAT NEEDS IT, and it is held here
    // rather than in a shell string. `fitness` is the only suite whose files
    // contend: several fences each construct an INDEPENDENT full-repository
    // TypeScript program (`realSemanticProject`, `measuredCodeProject`,
    // `generatorProject`), and vitest isolates modules per file, so concurrency
    // multiplies the program, not just the work. Measured on a 12-core machine:
    // serially the whole fitness suite takes ~134s and its slowest single fence
    // ~5s; at two workers that same fence takes ~16s, at four it crosses 20s and
    // fails, and at twelve five files fail on timeouts while total CPU doubles.
    // Above one worker, fitness buys wall-clock with flakiness - so the honest
    // setting for THAT tree is serial, and the timeouts above are honest under
    // it. The unit and integration suites cause none of that contention and stay
    // parallel; serializing them would be a wall-clock tax for a problem they do
    // not have (D-142). Holding it in the config, not in two `package.json`
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
          maxWorkers: 1,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "app",
          exclude: [
            "node_modules/**",
            ".next/**",
            "e2e/**",
            "src/__tests__/fitness/**",
          ],
        },
      },
    ],
  },
});
