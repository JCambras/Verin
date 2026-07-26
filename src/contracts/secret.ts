/**
 * SecretValue — secret containment (charter #7/#15, v3 §15.4). The raw string is
 * closure-held, never an own property, so JSON serialization, object spread,
 * Object.entries, structured logging, template interpolation, and util.inspect
 * can only ever see the redaction sentinel — a secret cannot enter config dumps,
 * the ledger, traces, or exception messages by accident. Reading the raw value
 * is an explicit, greppable act — reveal() — restricted by the
 * secret-containment fence to the modules that genuinely sign or verify.
 */
import { REDACTED } from "./pii";

export class SecretValue {
  /** The one way to the raw value; call sites are fence-allowlisted. */
  readonly reveal: () => string;

  constructor(raw: string) {
    this.reveal = () => raw;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  /** Node's console.log / util.inspect path (no util import — contracts stay dependency-free). */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
