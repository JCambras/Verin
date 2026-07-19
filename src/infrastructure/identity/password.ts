/**
 * Password hashing (ADR-0008, D-007). Node built-in scrypt — memory-hard, zero
 * native dependency (supply-chain minimal). Cost parameters are ENCODED in the
 * stored format (scrypt$N$r$p$<saltHex>$<hashHex>) so they can be raised later
 * without rejecting existing credentials; verification honours each hash's own
 * params. N=2^17 per OWASP (scrypt: N=131072, r=8, p=1). Verification is
 * constant-time.
 */
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const KEYLEN = 64;
const PARAMS = { N: 131072, r: 8, p: 1 };

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  // Node caps scrypt memory at 32 MiB by default; 128*N*r bytes are required.
  return scryptAsync(password, salt, KEYLEN, { ...params, maxmem: 256 * params.N * params.r });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  if (![params.N, params.r, params.p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4]!, "hex");
  const expected = Buffer.from(parts[5]!, "hex");
  const derived = await derive(password, salt, params);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
