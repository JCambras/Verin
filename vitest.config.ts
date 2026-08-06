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
    // The AST fences build a TYPE-CHECKED ts-morph program over the whole repo, and
    // vitest isolates module state per test file, so each such fence pays for its own
    // program. That is minutes of legitimate work, not a hang: at 20s the fences that
    // scan the most (governed-actions, tenant-context-required, tokenized-factory-only)
    // died on the clock rather than on a finding, which reads as red for a reason
    // nobody can act on. The budget is generous ON PURPOSE - a fence must fail because
    // it found something, never because the tree grew.
    testTimeout: 300000,
    // Matches testTimeout deliberately: the store integration suites build a fresh
    // PGlite (WASM Postgres) instance, migrate it, and seed it in beforeEach, so their
    // slow path is the HOOK, not the test body. Leaving hookTimeout at its 10s default
    // would cap the setup at half the budget its own test bodies get.
    hookTimeout: 300000,
  },
});
