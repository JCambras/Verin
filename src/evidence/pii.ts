// PII containment (prompt 3 deliverable 3). Masked types are constructible ONLY here (the
// sealed-factory rule in src/tools/e16.test.ts fails the build on a cast, an extending interface, or
// a fill from any/unknown - a JSON.parse result cannot become one). The detector carries the SAME
// three forms as the merged E16 checker (enforcement/rules-e16.mjs:21) - a disagreement on any form
// is itself a failing test - and adopts ruling GD-003's exclusion exactly (minted ids, correlation
// keys only). DC-5: the reference forms and mask-then-refuse-residuals discipline port from
// main:src/contracts/pii.ts:55-73 and :10,21-23, and main:src/infrastructure/pii/llm-projection.ts:72-92.
declare const PIIBearingBrand: unique symbol;
export interface PIIBearing {
  readonly [PIIBearingBrand]?: "pii-bearing";
}
declare const sealed: unique symbol;
export type MaskedAccountReference = { readonly [sealed]: "MaskedAccountReference"; readonly display: string };

const MASKED_DISPLAY_RE = /^ending \d{4}$/;
const WHOLE_REFERENCE_RES = [/^\d{8,16}$/, /^\d{2,4}( \d{2,4}){2,}$/, /^\d{2,4}(-\d{2,4}){2,}$/];
// The masked display never re-enters candidacy: four digits sit below every form's floor.
export function maskAccountReference(reference: string): MaskedAccountReference {
  if (MASKED_DISPLAY_RE.test(reference)) return { display: reference } as MaskedAccountReference;
  if (!WHOLE_REFERENCE_RES.some((re) => re.test(reference))) {
    throw new Error("maskAccountReference accepts exactly one whole account reference or an already-masked display; anything else is refused");
  }
  return { display: `ending ${reference.replace(/[ -]/g, "").slice(-4)}` } as MaskedAccountReference;
}

// Byte-identical to the checker's PII_FORMS (enforcement/rules-e16.mjs:21); the agreement is asserted
// by test, so the cured ~4 percent all-digit-span-id flake cannot return on either side.
export const ACCOUNT_REFERENCE_FORMS: readonly (readonly [string, RegExp])[] = [
  ["bare-account-reference", /\b\d{8,16}\b/],
  ["spaced-account-reference", /\b\d{2,4}( \d{2,4}){2,}\b/],
  ["hyphenated-account-reference", /\b\d{2,4}(-\d{2,4}){2,}\b/],
];
const CORRELATION_KEYS = new Set(["requestId", "traceId", "spanId"]);
const MINTED_ID_SHAPE = /^[0-9a-f]{16}$|^[0-9a-f]{32}$/;
const mintedIds = (): string[] => ((globalThis as { [k: symbol]: string[] })[Symbol.for("verin.minted-ids")] ??= []);

export function accountReferenceForm(value: string): string | null {
  for (const [form, re] of ACCOUNT_REFERENCE_FORMS) if (re.test(value)) return form;
  return null;
}

export type PiiBoundary = "bundle" | "log" | "render" | "serialization";
// The product-side detector at the four boundaries: deep-scans strings and stringable primitives,
// throws naming the offending operation, the form and the boundary - never echoing the value.
export function refuseAccountReferences(value: unknown, ctx: { operation: string; boundary: PiiBoundary }, key?: string): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    const text = String(value);
    if (key !== undefined && CORRELATION_KEYS.has(key) && MINTED_ID_SHAPE.test(text) && mintedIds().includes(text)) return;
    const form = accountReferenceForm(text);
    if (form) throw new Error(`operation '${ctx.operation}' refuses a ${form} at the ${ctx.boundary} boundary${key !== undefined ? ` (field '${key}')` : ""}`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((item) => refuseAccountReferences(item, ctx));
  if (value && typeof value === "object") for (const [k, item] of Object.entries(value)) refuseAccountReferences(item, ctx, k);
}

// The outbound-projection boundary's NAMED membership (deliverable 3): today exactly the
// trusted-static-projection module, empty of LLM callers until a later slice lands one. The
// containment rule reads this declaration and fails the build on a PII-bearing import (M-B's target).
export const OUTBOUND_PROJECTION_MODULES = ["src/evidence/projection.ts"] as const;
