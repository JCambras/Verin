import { describe, it, expect } from "vitest";
import { inspect } from "node:util";
import { revealSecret, SecretValue } from "@contracts/secret";
import { REDACTED } from "@contracts/pii";
import { getConfig } from "@infra/config";

/**
 * Secret containment (v3 §15.4, charter #7): a secret can never enter config
 * dumps, the ledger, traces, or exception messages - every serialization and
 * coercion path yields the redaction sentinel; only revealSecret returns raw bytes
 * (and the secret-containment fence restricts WHERE reveal may be called).
 */
const RAW = "hunter2-hunter2-hunter2-hunter2!"; // gitleaks:allow - test fixture, not a credential
const secret = new SecretValue(RAW);

describe("SecretValue redacts on every path except revealSecret", () => {
  it("string coercion, template interpolation, and toString", () => {
    expect(String(secret)).toBe(REDACTED);
    expect(`${secret}`).toBe(REDACTED);
    expect(secret.toString()).toBe(REDACTED);
  });
  it("JSON serialization alone and nested (the ledger/config-dump path)", () => {
    expect(JSON.stringify(secret)).toBe(`"${REDACTED}"`);
    expect(JSON.stringify({ session: { secret } })).not.toContain(RAW);
  });
  it("util.inspect / console formatting", () => {
    expect(inspect(secret)).toContain(REDACTED);
    expect(inspect(secret)).not.toContain(RAW);
    expect(inspect({ deep: { secret } })).not.toContain(RAW);
  });
  it("exception messages built by interpolation cannot embed the raw value", () => {
    const e = new Error(`boot failed with secret ${secret}`);
    expect(e.message).toContain(REDACTED);
    expect(e.message).not.toContain(RAW);
  });
  it("enumeration/spread exposes no raw string property", () => {
    const entries = JSON.stringify(Object.entries({ ...secret }));
    expect(entries).not.toContain(RAW);
  });
  it("the explicit reveal function returns the raw bytes", () => {
    expect(revealSecret(secret)).toBe(RAW);
    expect("reveal" in secret).toBe(false);
  });
});

describe("config seals its secrets", () => {
  it("session + esign secrets are SecretValue and a full config dump leaks nothing", () => {
    const cfg = getConfig();
    expect(cfg.session.secret).toBeInstanceOf(SecretValue);
    expect(cfg.esign.webhookSecret).toBeInstanceOf(SecretValue);
    const dump = JSON.stringify(cfg) + inspect(cfg, { depth: 10 });
    expect(dump).not.toContain(revealSecret(cfg.session.secret));
    expect(dump).not.toContain(revealSecret(cfg.esign.webhookSecret));
    expect(dump).toContain(REDACTED);
  });
});
