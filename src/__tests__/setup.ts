import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Guard: the whole suite must run on a non-UTC clock (charter #8).
// If TZ was not honored, fail loudly rather than silently passing in UTC.
const offsetJan = new Date("2026-01-15T12:00:00Z").getTimezoneOffset();
const offsetJul = new Date("2026-07-15T12:00:00Z").getTimezoneOffset();
if (offsetJan === 0 && offsetJul === 0) {
  throw new Error(
    "Test clock is UTC. Tests must run on a non-UTC timezone (TZ=America/New_York). " +
      "See vitest.config.ts and CI.",
  );
}

afterEach(() => {
  cleanup();
});
