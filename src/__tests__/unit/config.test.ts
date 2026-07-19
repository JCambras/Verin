import { describe, it, expect, afterEach } from "vitest";
import { getConfig, resetConfigForTests } from "@infra/config";

/**
 * Verifies the config module's fail-closed production guards (ADR-0003). Reads
 * process.env in the test (allowed — the no-process-env fence scans src/, not
 * tests) and resets the cache between cases.
 */
const KEYS = ["APP_ENV", "VERIN_STORE_DRIVER", "DATABASE_URL", "SESSION_SECRET", "ESIGN_WEBHOOK_SECRET"] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function withEnv(overrides: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const k of KEYS) {
    if (k in overrides && overrides[k] !== undefined) process.env[k] = overrides[k];
    else delete process.env[k];
  }
  resetConfigForTests();
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
});

describe("config fail-closed guards", () => {
  const goodSecret = "a".repeat(40);
  const goodWebhook = "b".repeat(40);

  it("parses a valid development config", () => {
    withEnv({ APP_ENV: "development", VERIN_STORE_DRIVER: "pglite", SESSION_SECRET: goodSecret, ESIGN_WEBHOOK_SECRET: goodWebhook });
    expect(getConfig().store.driver).toBe("pglite");
  });

  it("refuses to boot in production without the postgres driver", () => {
    withEnv({ APP_ENV: "production", VERIN_STORE_DRIVER: "pglite", DATABASE_URL: "postgres://u:p@h:5432/d", SESSION_SECRET: goodSecret, ESIGN_WEBHOOK_SECRET: goodWebhook });
    expect(() => getConfig()).toThrow(/PROD_REQUIRES_POSTGRES/);
  });

  it("refuses a placeholder session secret in production", () => {
    withEnv({ APP_ENV: "production", VERIN_STORE_DRIVER: "postgres", DATABASE_URL: "postgres://u:p@h:5432/d", SESSION_SECRET: `ci-only-${"a".repeat(32)}`, ESIGN_WEBHOOK_SECRET: goodWebhook });
    expect(() => getConfig()).toThrow(/PROD_PLACEHOLDER_SESSION_SECRET/);
  });

  it("rejects a too-short session secret", () => {
    withEnv({ APP_ENV: "development", VERIN_STORE_DRIVER: "pglite", SESSION_SECRET: "short", ESIGN_WEBHOOK_SECRET: goodWebhook });
    expect(() => getConfig()).toThrow(/at least 32/);
  });
});
