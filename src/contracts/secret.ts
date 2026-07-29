/**
 * SecretValue - secret containment (charter #7/#15, v3 §15.4). The raw string is
 * held outside the object, never an own property. Serialization, interpolation,
 * logging, and inspection see the redaction sentinel; spread and enumeration see
 * no raw property. A secret therefore cannot enter config dumps,
 * the ledger, traces, or exception messages by accident. Reading the raw value
 * is an explicit, greppable act through revealSecret, restricted by the
 * secret-containment fence to exact HMAC consumers for signing, verification, or correlation.
 */
import { REDACTED } from "./pii";
import { appError } from "./errors";

const VALUES = new WeakMap<SecretValue, string>();

export class SecretValue {
  constructor(raw: string) {
    VALUES.set(this, raw);
    Object.freeze(this);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  /** Node's console.log / util.inspect path (no util import, so contracts stay dependency-free). */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

export function revealSecret(secret: SecretValue): string {
  const value = VALUES.get(secret);
  if (value === undefined) {
    throw appError("INTERNAL", "SecretValue was not created by the config boundary.");
  }
  return value;
}
