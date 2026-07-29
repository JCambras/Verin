import { minorFromMajor } from "@contracts/money-movement";

export type UnknownRecord = Record<string, unknown>;

export const asRecord = (
  value: unknown,
  path: string,
): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as UnknownRecord;
};

export const asArray = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
};

export const asString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
};

export const asNullableString = (
  value: unknown,
  path: string,
): string | null => (value === null ? null : asString(value, path));

export const asNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
};

export const asPositiveSafeInteger = (
  value: unknown,
  path: string,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(`${path} must be a positive safe integer`);
  }
  return value;
};

export const asBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean`);
  }
  return value;
};

export const asMinor = (value: unknown, path: string): number => {
  const minor = minorFromMajor(asNumber(value, path));
  if (minor === null) {
    throw new RangeError(`${path} cannot be represented in minor units`);
  }
  return minor;
};

export const asNullableMinor = (
  value: unknown,
  path: string,
): number | null => (value === null ? null : asMinor(value, path));

export const asStringArray = (
  value: unknown,
  path: string,
): string[] =>
  asArray(value, path).map((entry, index) =>
    asString(entry, `${path}[${index}]`),
  );
