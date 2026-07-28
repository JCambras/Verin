import { isAppError } from "@contracts/errors";
import { SQLSTATE_SOURCE } from "@domain/observability/safe-values";

/**
 * The SHAPE is the containment argument: a fixed-width code from a closed alphabet
 * cannot carry a row value, a table name, or any fragment of driver prose. That is
 * what lets this replace the hand-curated allowlist that preceded it, which silently
 * discarded the classes an operator most needs during a migration (42P01
 * undefined_table, 42703 undefined_column, 42P07 duplicate_table, 42501
 * insufficient_privilege, 3D000 invalid_catalog, 28P01 invalid_password) and
 * collapsed each to "unexpected-error" in the one diagnostic that names what went
 * wrong. It bought no containment, only lost signal. The raw driver MESSAGE is still
 * never surfaced - only this code. The shape is imported, never re-typed, so the
 * producer here and REASON_RE (the consumer) cannot drift apart.
 */
const SQLSTATE_RE = new RegExp(`^${SQLSTATE_SOURCE}$`);

export function safeReason(error: unknown): string {
  if (isAppError(error)) return `app-error:${error.code}`;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    SQLSTATE_RE.test((error as { code: string }).code)
  ) {
    return `driver-error:${(error as { code: string }).code}`;
  }
  return "unexpected-error";
}
