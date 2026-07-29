/**
 * Tokenized<T> — the ratified v3 shape (docs/v3/verin-core-contracts.ts, §15.1).
 * NORMATIVE: constructible ONLY through the scrubber module's factories
 * (src/infrastructure/pii/tokenize.ts). The `piiFree` flag proves nothing by
 * itself; enforcement is structural — the tokenized-factory-only fence (and its
 * ESLint edit-time mirror) fails any object literal or cast producing Tokenized
 * outside the scrubber module, and the llm-pii-boundary fence proves no
 * PII-bearing type is reachable from llm/ (v3 invariant 1). Direct construction
 * elsewhere is an invariant violation, not a style issue.
 */
declare const TokenizedBrand: unique symbol;
export const SLOT_ID_RE = /^slot_(?!0000)\d{4}$/;

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export interface Tokenized<T> {
  readonly value: DeepReadonly<T>;
  readonly piiFree: true;
  readonly [TokenizedBrand]: "Tokenized";
}
