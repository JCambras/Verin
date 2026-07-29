import { isErrorCode } from "@contracts/errors";
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
  if (typeof error !== "object" || error === null) return "unexpected-error";
  let code: unknown;
  let appErrorShape: boolean;
  try {
    code = Reflect.get(error, "code");
    appErrorShape = "message" in error;
  } catch {
    return "unexpected-error";
  }
  if (appErrorShape && isErrorCode(code)) return `app-error:${code}`;
  if (typeof code === "string" && SQLSTATE_RE.test(code)) return `driver-error:${code}`;
  return "unexpected-error";
}
