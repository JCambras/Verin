/**
 * AppError — the typed error taxonomy. Business logic returns these inside a
 * Result instead of throwing (Iris ADR-0003). Adapter boundaries may THROW a
 * typed AppError (never a bare Error — enforced by the no-bare-throw fence).
 *
 * Each code maps to an HTTP status, a log level, a category, and whether it is
 * safe to retry. toResponse() produces a client-safe body with no stack traces
 * or internal detail (defense against error-message info leaks — retro #14).
 */
export type ErrorCode =
  | "VALIDATION"
  | "AUTH_FAILED"
  | "AUTH_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_REPLAY"
  | "STORE_UNAVAILABLE"
  | "STORE_CONSTRAINT"
  | "PII_VIOLATION"
  | "PROVENANCE_MISSING"
  | "INTEGRATION_TIMEOUT"
  | "INTEGRATION_ERROR"
  | "FLOW_SUSPENDED"
  | "INTERNAL";

export type ErrorCategory = "transient" | "permanent" | "auth" | "limit";

export interface AppError {
  readonly code: ErrorCode;
  /** Human-safe, sentence-form message. Never contains PII or secrets. */
  readonly message: string;
  /** Optional non-PII structured context for logs (never returned to clients). */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

interface CodeMeta {
  status: number;
  logLevel: "error" | "warn" | "info";
  category: ErrorCategory;
  retryable: boolean;
}

const ERROR_MAP: Record<ErrorCode, CodeMeta> = {
  VALIDATION: { status: 400, logLevel: "info", category: "permanent", retryable: false },
  AUTH_FAILED: { status: 401, logLevel: "warn", category: "auth", retryable: false },
  AUTH_EXPIRED: { status: 401, logLevel: "info", category: "auth", retryable: false },
  FORBIDDEN: { status: 403, logLevel: "warn", category: "auth", retryable: false },
  NOT_FOUND: { status: 404, logLevel: "info", category: "permanent", retryable: false },
  CONFLICT: { status: 409, logLevel: "info", category: "permanent", retryable: false },
  IDEMPOTENCY_REPLAY: { status: 200, logLevel: "info", category: "permanent", retryable: false },
  STORE_UNAVAILABLE: { status: 503, logLevel: "error", category: "transient", retryable: true },
  STORE_CONSTRAINT: { status: 409, logLevel: "warn", category: "permanent", retryable: false },
  PII_VIOLATION: { status: 500, logLevel: "error", category: "permanent", retryable: false },
  PROVENANCE_MISSING: { status: 500, logLevel: "error", category: "permanent", retryable: false },
  INTEGRATION_TIMEOUT: { status: 504, logLevel: "warn", category: "transient", retryable: true },
  INTEGRATION_ERROR: { status: 502, logLevel: "error", category: "transient", retryable: true },
  FLOW_SUSPENDED: { status: 202, logLevel: "info", category: "permanent", retryable: false },
  INTERNAL: { status: 500, logLevel: "error", category: "permanent", retryable: false },
};

const APP_ERRORS = new WeakSet<object>();
const UNTRUSTED_APP_ERROR_MESSAGE = "The request could not be completed.";

export function appError(
  code: ErrorCode,
  message: string,
  context?: AppError["context"],
): AppError {
  const error: AppError = context
    ? { code, message, context: Object.freeze({ ...context }) }
    : { code, message };
  APP_ERRORS.add(error);
  return Object.freeze(error);
}

export function validationError(message: string, context?: AppError["context"]): AppError {
  return appError("VALIDATION", message, context);
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_MAP, value);
}

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && APP_ERRORS.has(value);
}

export function normalizeAppError(value: unknown): AppError | null {
  if (isAppError(value)) return value;
  if (typeof value !== "object" || value === null) return null;
  try {
    const code = Reflect.get(value, "code");
    return isErrorCode(code)
      ? appError(code, UNTRUSTED_APP_ERROR_MESSAGE)
      : null;
  } catch {
    return null;
  }
}

export function statusFor(code: ErrorCode): number {
  return ERROR_MAP[code].status;
}

export function logLevelFor(code: ErrorCode): CodeMeta["logLevel"] {
  return ERROR_MAP[code].logLevel;
}

/** Client-safe HTTP response body — no stack traces, no internal context. */
export function toResponse(error: unknown): { status: number; body: { error: { code: ErrorCode; message: string } } } {
  const normalized = normalizeAppError(error) ??
    appError("INTERNAL", "An internal error occurred.");
  return {
    status: ERROR_MAP[normalized.code].status,
    body: { error: { code: normalized.code, message: normalized.message } },
  };
}
