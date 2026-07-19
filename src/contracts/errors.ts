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

export function appError(
  code: ErrorCode,
  message: string,
  context?: AppError["context"],
): AppError {
  return context ? { code, message, context } : { code, message };
}

export function validationError(message: string, context?: AppError["context"]): AppError {
  return appError("VALIDATION", message, context);
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as { code: unknown }).code === "string" &&
    (value as { code: string }).code in ERROR_MAP
  );
}

export function statusFor(code: ErrorCode): number {
  return ERROR_MAP[code].status;
}

export function logLevelFor(code: ErrorCode): CodeMeta["logLevel"] {
  return ERROR_MAP[code].logLevel;
}

export function isRetryable(error: AppError): boolean {
  return ERROR_MAP[error.code].retryable;
}

/** Client-safe HTTP response body — no stack traces, no internal context. */
export function toResponse(error: AppError): { status: number; body: { error: { code: ErrorCode; message: string } } } {
  return {
    status: ERROR_MAP[error.code].status,
    body: { error: { code: error.code, message: error.message } },
  };
}
