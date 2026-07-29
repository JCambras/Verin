import { appError } from "@contracts/errors";

const sourceWriteBrand: unique symbol = Symbol("validated-ledger-source-write");

export interface ValidatedLedgerSourceWrite {
  readonly [sourceWriteBrand]: true;
}

const issued = new WeakSet<object>();

export function issueValidatedLedgerSourceWrite(): ValidatedLedgerSourceWrite {
  const capability = { [sourceWriteBrand]: true } as const;
  issued.add(capability);
  return capability;
}

export function assertValidatedLedgerSourceWrite(
  capability: ValidatedLedgerSourceWrite,
): void {
  if (!issued.has(capability)) {
    throw appError(
      "VALIDATION",
      "immutable replay source write capability is invalid",
    );
  }
}
