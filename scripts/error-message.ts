/**
 * Operator-readable message for anything a script can catch. appError() returns
 * a PLAIN OBJECT, not an Error, so `String(e)` prints "[object Object]" — which
 * on the audit-chain-verify CI gate and the dated backup-restore drill hides the
 * one line naming the fix (e.g. "use VERIN_STORE_DRIVER=pglite for dev/CI").
 */
import { isAppError } from "@contracts/errors";

export function errorMessage(e: unknown): string {
  if (isAppError(e)) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
