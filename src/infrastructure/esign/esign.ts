/**
 * Simulated e-sign provider (sacrificial component — ADR-0020). Proves
 * suspend/resume + webhook finalize + idempotency WITHOUT a real vendor. NOT a
 * legally valid signature. The webhook callback is authenticated by an HMAC over
 * the token with ESIGN_WEBHOOK_SECRET (charter #16 / STRIDE T-S3), so a forged
 * callback is rejected.
 */
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { getConfig } from "@infra/config";
import { revealSecret } from "@contracts/secret";

export function newEsignToken(): string {
  return randomUUID();
}

export function signCallback(token: string): string {
  // revealSecret is the explicit, fence-allowlisted secret read (v3 §15.4).
  return createHmac("sha256", revealSecret(getConfig().esign.webhookSecret)).update(token).digest("hex");
}

export function verifyCallback(token: string, signature: string): boolean {
  const expected = signCallback(token);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
