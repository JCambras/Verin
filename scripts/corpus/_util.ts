/**
 * CORPUS PRIMITIVES, DEFINED ONCE (v3 prompt 11, ADR-0039).
 *
 * These four decide bytes, not convenience: `sortedBy` fixes emission order and
 * therefore case bytes and `corpusDigest`, `nfc` decides whether two spellings
 * of one name are one subject, and `sha256` is the digest every binding is taken
 * with. A second copy of any of them is a second place for the corpus to become
 * non-deterministic while every gate still reports green, so they live here and
 * nowhere else.
 */
import { createHash } from "node:crypto";

/** NFC everywhere: two spellings of one name must not be two subjects. */
export const nfc = (value: string): string => value.normalize("NFC");

export const sha256 = (bytes: string): string =>
  createHash("sha256").update(bytes, "utf8").digest("hex");

export const byKey = <T extends { key: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.key, row]));

export const sortedBy = <T>(rows: readonly T[], key: (row: T) => string): T[] =>
  [...rows].sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));

export const duplicates = (values: readonly string[]): string[] => [
  ...new Set(
    values.filter((value, index) => values.indexOf(value) !== index),
  ),
];
