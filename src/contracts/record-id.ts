declare const MachineRecordIdBrand: unique symbol;

export type MachineRecordIdFamily =
  | "account-opening-application"
  | "audit-outbox"
  | "execution"
  | "household";

export type MachineRecordId<F extends MachineRecordIdFamily> = string & {
  readonly [MachineRecordIdBrand]: F;
};

export const MACHINE_RECORD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMachineRecordId<F extends MachineRecordIdFamily>(
  family: F,
  value: unknown,
): MachineRecordId<F> | null {
  void family;
  return typeof value === "string" && MACHINE_RECORD_ID_RE.test(value)
    ? value.toLowerCase() as MachineRecordId<F>
    : null;
}

export function isMachineRecordId(value: unknown): value is MachineRecordId<MachineRecordIdFamily> {
  return typeof value === "string" && MACHINE_RECORD_ID_RE.test(value);
}
