/**
 * LLM request schemas — the ONLY shapes that may travel toward a model
 * (v3 §15.1 stage 1: intent shaping sees a masked request and typed slot
 * placeholders, never firm records). Every free-form field is a Tokenized
 * wrapper minted by the scrubber factory; everything else is a closed enum or
 * a machine-named slot. Structural guarantee: the llm-pii-boundary fence
 * proves no PII-bearing type is import-reachable from this directory
 * (invariant 1). Runtime guarantee: parseMaskedLlmRequest is the LLM adapter's
 * ingress gate — it refuses unsealed Tokenized impostors and re-scans every
 * string leaf, so PII cannot reach an LLM request even via a compiler evasion.
 * The model CLIENT deliberately does not exist yet (first LLM surface =
 * prompt 13); this schema + gate is the seam it must pass through.
 */
import { z } from "zod";
import {
  assertNoAmbiguousSensitiveText,
  assertNoPIIValues,
  looksLikeAmbiguousSensitiveText,
} from "@contracts/pii";
import type { Tokenized } from "@contracts/tokenized";
import { type Result, ok, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import { isSealedTokenized } from "@infra/pii/tokenize";

/** v3 §16: llm/ is imported only by masked intent-shaping and policy-draft paths. */
const LLM_PURPOSES = ["intent-shaping", "policy-drafting"] as const;
export type LlmPurpose = (typeof LLM_PURPOSES)[number];

const SLOT_TYPES = ["subject", "account-ref", "amount", "date", "free-text"] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

/** A typed placeholder the model reasons over; binding to real records happens outside the model. */
export interface SlotPlaceholder {
  readonly slotId: string;
  readonly slotType: SlotType;
}

export interface MaskedLlmRequest {
  readonly purpose: LlmPurpose;
  readonly maskedText: Tokenized<string>;
  readonly slots: readonly SlotPlaceholder[];
  readonly context: Tokenized<Readonly<Record<string, unknown>>>;
}

export const SLOT_ID_RE = /^slot_(?!0000)\d{4}$/;

const sealedTokenizedText = z.custom<Tokenized<string>>(
  (v) =>
    isSealedTokenized(v) &&
    typeof v.value === "string" &&
    !looksLikeAmbiguousSensitiveText(v.value),
  "must be a factory-sealed, PII-free Tokenized<string>",
);

const sealedTokenizedRecord = z.custom<Tokenized<Readonly<Record<string, unknown>>>>((v) => {
  if (!isSealedTokenized(v) || typeof v.value !== "object" || v.value === null) return false;
  try {
    assertNoPIIValues(v.value, "llm");
    assertNoAmbiguousSensitiveText(v.value, "llm");
    return true;
  } catch {
    return false;
  }
}, "must be a factory-sealed, PII-free Tokenized record");

const maskedLlmRequestSchema = z.object({
  purpose: z.enum(LLM_PURPOSES),
  maskedText: sealedTokenizedText,
  slots: z.array(
    z.object({
      slotId: z.string().regex(SLOT_ID_RE, "slot ids must use the canonical opaque format"),
      slotType: z.enum(SLOT_TYPES),
    }),
  ),
  context: sealedTokenizedRecord,
});

/**
 * The LLM adapter's ingress gate: everything bound for a model parses through
 * here first. Error messages carry only field paths and the static messages
 * above — never the offending value (an error must not leak what it refused).
 */
export function parseMaskedLlmRequest(input: unknown): Result<MaskedLlmRequest, AppError> {
  const parsed = maskedLlmRequestSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
    return err(appError("PII_VIOLATION", `LLM request refused at the scrub boundary: ${detail}`));
  }
  return ok(parsed.data as MaskedLlmRequest);
}
