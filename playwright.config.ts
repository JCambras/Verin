// Browser proof configuration (prompt 2 5B.7): specs live in src/e2e as *.e2e.ts so the unit
// runner's default include never collects them. The webServer is the built production server; CI
// builds first under the capability-denied fixture. Screenshots are captured at 1280x800 (section 9).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "src/e2e",
  testMatch: "**/*.e2e.ts",
  // Scoped so the runner's start-up cleanup can never delete the E16 capture beside it.
  outputDir: "test-results/e2e",
  use: { baseURL: "http://localhost:3000", viewport: { width: 1280, height: 800 } },
  webServer: {
    command: "corepack pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
