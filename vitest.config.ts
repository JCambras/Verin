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
    testTimeout: 20000,
  },
});
