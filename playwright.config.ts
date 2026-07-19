import { defineConfig, devices } from "@playwright/test";

/**
 * E2E is a CI gate from the first UI commit (charter #8) — the capability Iris
 * regressed on (0 E2E at HEAD). Specs run against a real dev server on a NON-UTC
 * machine (TZ pinned here and in CI). Every flow ships one happy-path and one
 * failure/interruption spec, green on main.
 */
const PORT = Number(process.env.VERIN_E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build once, then run the production server so specs exercise the real build.
    command: `corepack pnpm build && corepack pnpm exec next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      TZ: "America/New_York",
      NODE_ENV: "production",
      APP_ENV: "development",
      VERIN_STORE_DRIVER: "pglite",
      VERIN_DATA_DIR: ".verin-data-e2e",
      SESSION_SECRET: "e2e-only-session-secret-not-a-real-secret-000000",
      ESIGN_WEBHOOK_SECRET: "e2e-only-webhook-secret-not-a-real-secret-000000",
      APP_URL: BASE_URL,
      FIRM_TIMEZONE: "America/New_York",
      LOG_LEVEL: "error",
    },
  },
});
