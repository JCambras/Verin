import { parseDocument } from "yaml";

/**
 * JSON with DUPLICATE OBJECT KEYS REFUSED. `JSON.parse` resolves a repeated key
 * last-wins, so it is the wrong authority on its own: the YAML 1.2 strict pass
 * is what sees the second key at all.
 *
 * The strict pass therefore has to COMPLETE. Any input it cannot fully parse is
 * refused rather than handed to `JSON.parse`, because "the strict pass gave up
 * but JSON accepts it" is precisely the shape that carries an unseen duplicate
 * key through - a composer that abandons a deeply nested document never reaches
 * the repeated key it would have reported. This is the only duplicate-key guard
 * the hand-owned spec files get, so it fails closed on every diagnostic rather
 * than on the one it recognises.
 */
export function parseStrictJson(
  bytes: string,
  label: string,
): unknown {
  const document = parseDocument(bytes, {
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.some((error) => error.code === "DUPLICATE_KEY")) {
    throw new Error(`${label}: duplicate object key`);
  }
  if (document.errors.length > 0) {
    throw new Error(`${label}: invalid JSON`);
  }
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new Error(`${label}: invalid JSON`);
  }
}
