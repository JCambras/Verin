import { isAppError } from "@contracts/errors";

const SAFE_DRIVER_ERROR_CODES = new Set([
  "08006",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "53300",
  "57014",
  "57P01",
]);

export function safeReason(error: unknown): string {
  if (isAppError(error)) return `app-error:${error.code}`;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    SAFE_DRIVER_ERROR_CODES.has((error as { code: string }).code)
  ) {
    return `driver-error:${(error as { code: string }).code}`;
  }
  return "unexpected-error";
}
