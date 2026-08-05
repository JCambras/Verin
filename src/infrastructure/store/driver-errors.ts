/**
 * Driver-failure classification, shared by every write chokepoint. Mapping all
 * failures to one code destroys the diagnosis (a swallowed TypeError once surfaced as
 * a generic 409), so each chokepoint logs the real error PII-safely and only a real
 * SQLSTATE integrity violation becomes the client-resolvable conflict.
 */
import { normalizeAppError } from "@contracts/errors";
import { looksLikePIIValue, REDACTED } from "@contracts/pii";

/**
 * Driver/exception text can quote row values (a unique-violation detail may embed an
 * email); the pino redaction is field-NAME-based and cannot see into free text, so a
 * PII-shaped reason is replaced wholesale before it reaches the log.
 */
export function logSafeReason(e: unknown): string {
  const known = normalizeAppError(e, "trusted-only");
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : known ? known.message : String(e);
  return looksLikePIIValue(raw) ? REDACTED : raw;
}

/** SQLSTATE class 23 = integrity constraint violation (23502/23503/23505/23514…). */
export function isDriverConstraintError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && "code" in e &&
    typeof (e as { code: unknown }).code === "string" &&
    /^23\d{3}$/.test((e as { code: string }).code)
  );
}
