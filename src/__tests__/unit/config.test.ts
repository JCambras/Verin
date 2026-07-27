import { describe, it, expect, afterEach } from "vitest";
import { getConfig, resetConfigForTests } from "@infra/config";

/**
 * Verifies the config module's fail-closed production guards (ADR-0003). Reads
 * process.env in the test (allowed — the no-process-env fence scans src/, not
 * tests) and resets the cache between cases.
 */
const KEYS = [
  "APP_ENV",
  "FIRM_TIMEZONE",
  "VERIN_STORE_DRIVER",
  "DATABASE_URL",
  "SESSION_SECRET",
  "ESIGN_WEBHOOK_SECRET",
] as const;
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

  it.each(["America/Chicago", "Europe/London", "Etc/UTC"])(
    "accepts canonical IANA firm time zone %s",
    (firmTimezone) => {
      withEnv({
        APP_ENV: "development",
        FIRM_TIMEZONE: firmTimezone,
        VERIN_STORE_DRIVER: "pglite",
        SESSION_SECRET: goodSecret,
        ESIGN_WEBHOOK_SECRET: goodWebhook,
      });
      expect(getConfig().firmTimezone).toBe(firmTimezone);
    },
  );

  const bootWithTimezone = (firmTimezone: string) => {
    withEnv({
      APP_ENV: "development",
      FIRM_TIMEZONE: firmTimezone,
      VERIN_STORE_DRIVER: "pglite",
      SESSION_SECRET: goodSecret,
      ESIGN_WEBHOOK_SECRET: goodWebhook,
    });
    return getConfig().firmTimezone;
  };

  it("canonicalizes case and resolves pinned Link aliases to their canonical Zone", () => {
    // A Link alias has always been a legal IANA identifier, so an operator running
    // FIRM_TIMEZONE=UTC must still boot. Only the canonical Zone is kept, so nothing
    // downstream ever persists or hashes two spellings of one zone.
    expect(bootWithTimezone("america/new_york")).toBe("America/New_York");
    expect(bootWithTimezone("UTC")).toBe("Etc/UTC");
    expect(bootWithTimezone("US/Eastern")).toBe("America/New_York");
    expect(bootWithTimezone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(bootWithTimezone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(bootWithTimezone("Africa/Accra")).toBe("Africa/Abidjan");
  });

  it("still refuses an identifier that is neither a pinned Zone nor a pinned Link", () => {
    expect(() => bootWithTimezone("Not/AZone")).toThrow(/firmTimezone/);
    expect(() => bootWithTimezone("America/New_York_2")).toThrow(/firmTimezone/);
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

  it("refuses to boot when NODE_ENV=production and APP_ENV is unset (no silent development default)", () => {
    // NODE_ENV is typed read-only; mutate through an indexable view (test-only).
    const env = process.env as Record<string, string | undefined>;
    const savedNodeEnv = env.NODE_ENV;
    try {
      withEnv({ VERIN_STORE_DRIVER: "pglite", SESSION_SECRET: goodSecret, ESIGN_WEBHOOK_SECRET: goodWebhook });
      env.NODE_ENV = "production";
      expect(() => getConfig()).toThrow(/APP_ENV must be set explicitly/);
    } finally {
      env.NODE_ENV = savedNodeEnv;
      resetConfigForTests();
    }
  });
});
