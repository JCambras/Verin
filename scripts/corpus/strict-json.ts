import { parseDocument } from "yaml";

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
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new Error(`${label}: invalid JSON`);
  }
}
