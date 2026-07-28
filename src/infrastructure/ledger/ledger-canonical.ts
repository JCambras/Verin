import { createHash } from "node:crypto";
import { appError, type AppError } from "@contracts/errors";
import { err, type Result } from "@contracts/result";
import {
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";

export function canonical(value: unknown, label: string): Result<string, AppError> {
  const serialized = canonicalJson(value as JsonValue);
  return serialized.ok
    ? serialized
    : err(appError("VALIDATION", `${label} is not canonically serializable`));
}

export function digestCanonicalBytes(bytes: string): string {
  return createHash("sha256").update(bytes, "utf8").digest("hex");
}

export function canonicalDigest(
  value: unknown,
  label: string,
): Result<string, AppError> {
  const bytes = canonical(value, label);
  return bytes.ok ? { ok: true, value: digestCanonicalBytes(bytes.value) } : bytes;
}
