import {
  isErrorCode,
  normalizeAppError,
  type AppError,
} from "@contracts/errors";
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

export interface ErrorMetadataClassification {
  readonly appError: AppError | null;
  readonly sqlState: string | null;
  readonly piiViolation: boolean;
  readonly reason: string;
}

const UNEXPECTED_ERROR_METADATA: ErrorMetadataClassification = Object.freeze({
  appError: null,
  sqlState: null,
  piiViolation: false,
  reason: "unexpected-error",
});

function readErrorProperty(
  error: object,
  property: "code" | "name" | "message" | "context",
): { readonly ok: boolean; readonly value: unknown } {
  try {
    return { ok: true, value: Reflect.get(error, property) };
  } catch {
    return { ok: false, value: undefined };
  }
}
/** Snapshot trusted application or fixed-shape driver metadata without reading error prose. */
export function classifyErrorMetadata(error: unknown): ErrorMetadataClassification {
  if (typeof error !== "object" || error === null) return UNEXPECTED_ERROR_METADATA;
  const trusted = normalizeAppError(error, "trusted-only");
  if (trusted) {
    return Object.freeze({
      appError: trusted,
      sqlState: null,
      piiViolation: false,
      reason: `app-error:${trusted.code}`,
    });
  }
  const code = readErrorProperty(error, "code");
  if (!code.ok) return UNEXPECTED_ERROR_METADATA;
  const name = readErrorProperty(error, "name");
  const appError = isErrorCode(code.value)
    ? normalizeAppError({ code: code.value })
    : null;
  const sqlState = typeof code.value === "string" && SQLSTATE_RE.test(code.value)
    ? code.value
    : null;
  return Object.freeze({
    appError,
    sqlState,
    piiViolation: name.ok && name.value === "PIIViolation",
    reason: appError
      ? `app-error:${appError.code}`
      : sqlState
      ? `driver-error:${sqlState}`
      : "unexpected-error",
  });
}
/** Closed operational reason safe for the observability vocabulary. */
export function safeReason(error: unknown): string {
  return classifyErrorMetadata(error).reason;
}
