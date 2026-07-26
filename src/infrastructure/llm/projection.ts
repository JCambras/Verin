/**
 * Evidence-to-LLM projection (v3 §15.1) — the ONE path evidence may take
 * toward a model. It accepts an UNTYPED payload on purpose: raw entity types
 * (PIIBearing) are structurally unreachable from llm/ (invariant 1 fence), so
 * a caller must hand over plain data, and THIS boundary scrubs it before it
 * becomes a MaskedLlmRequest:
 *   1. deterministic entity masking — every known entity string (client names
 *      come from firm records the TRUSTED runtime resolved, never the model)
 *      is replaced with its typed slot placeholder;
 *   2. pattern scrubbing via the Tokenized factory (SSN/email/phone shapes);
 *   3. the adapter ingress gate re-parses the result, so an incomplete scrub
 *      fails closed rather than reaching a model.
 */
import { type Result } from "@contracts/result";
import type { AppError } from "@contracts/errors";
import { tokenizeText, tokenizeRecord } from "@infra/pii/tokenize";
import { parseMaskedLlmRequest, type LlmPurpose, type MaskedLlmRequest, type SlotPlaceholder } from "./request-schema";

/** A known entity string to mask out of the request text, and the slot that replaces it. */
export interface SubjectMask {
  readonly slotName: string;
  readonly rawText: string;
}

export interface EvidenceProjectionInput {
  readonly purpose: LlmPurpose;
  /** The human request text, RAW — masked + scrubbed here, at the boundary. */
  readonly requestText: string;
  readonly slots: readonly SlotPlaceholder[];
  /** Known entities (resolved by the trusted runtime) replaced with slot placeholders. */
  readonly masks: readonly SubjectMask[];
  /** The evidence payload, RAW — deep-scrubbed here, at the boundary. */
  readonly evidence: Readonly<Record<string, unknown>>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskKnownEntities(text: string, masks: readonly SubjectMask[]): string {
  let out = text;
  for (const m of masks) {
    if (!m.rawText) continue;
    out = out.replace(new RegExp(escapeRegExp(m.rawText), "gi"), `{{${m.slotName}}}`);
  }
  return out;
}

export function projectForLlm(input: EvidenceProjectionInput): Result<MaskedLlmRequest, AppError> {
  const candidate: MaskedLlmRequest = {
    purpose: input.purpose,
    maskedText: tokenizeText(maskKnownEntities(input.requestText, input.masks)),
    slots: input.slots,
    context: tokenizeRecord(input.evidence),
  };
  return parseMaskedLlmRequest(candidate);
}
