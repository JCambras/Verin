declare const MachineRecordIdBrand: unique symbol;
/** Record families prevent a parsed ID from crossing into a different repository API. */
export type MachineRecordIdFamily =
  | "account-opening-application"
  | "audit-outbox"
  | "execution"
  | "household";

export type MachineRecordId<F extends MachineRecordIdFamily> = string & {
  readonly [MachineRecordIdBrand]: F;
};
/** Canonical UUID shape; shape is validation, not observability trust provenance. */
export const MACHINE_RECORD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Parse one family and normalize mixed-case client input to lowercase. */
export function parseMachineRecordId<F extends MachineRecordIdFamily>(
  family: F,
  value: unknown,
): MachineRecordId<F> | null {
  void family;
  return typeof value === "string" && MACHINE_RECORD_ID_RE.test(value)
    ? value.toLowerCase() as MachineRecordId<F>
    : null;
}
/** Shape-only predicate; telemetry still requires a generated or keyed-digest factory. */
export function isMachineRecordId(value: unknown): value is MachineRecordId<MachineRecordIdFamily> {
  return typeof value === "string" && MACHINE_RECORD_ID_RE.test(value);
}
