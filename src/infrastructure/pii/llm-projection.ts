/**
 * The evidence-to-LLM projection (v3 §15.1 stage 1): bind the request's
 * structurally sensitive spans to declared slots, mask them, then seal the
 * result through the Tokenized factory so nothing unmasked can reach a model.
 *
 * This boundary is landed AHEAD of its first production caller by ADR-0031
 * (the model client arrives at prompt 13): v3 invariant 1 is a contract about a
 * boundary, and a boundary only exists once both sides do. That is a reviewed
 * charter #5 exception for a spec-named boundary — NOT a licence for
 * convenience code, which is why the piiSafe logger helper was deleted instead.
 *
 * Resolution is structural, never an enumerated vocabulary — see
 * domain/pii/projection-resolution.ts (D-048).
 */
import { type Result, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import { parseMaskedLlmRequest, SLOT_ID_RE, type LlmPurpose, type MaskedLlmRequest, type SlotPlaceholder } from "@infra/llm/request-schema";
import {
  hasUnresolvedProjectionEvidence,
  hasUnresolvedProjectionText,
  isPlainProjectionData,
  resolveCompleteSensitiveEntities,
  type ResolvedSensitiveEntity,
} from "@domain/pii/projection-resolution";
import { tokenizeText, tokenizeRecord } from "./tokenize";

export interface EvidenceProjectionInput extends PIIBearing {
  readonly purpose: LlmPurpose;
  readonly requestText: string;
  readonly slots: readonly SlotPlaceholder[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

interface SensitiveMask extends PIIBearing {
  readonly slotId: string;
  readonly rawText: string;
}

function masksFromBindings(bindings: readonly ResolvedSensitiveEntity[]): readonly SensitiveMask[] {
  return bindings.flatMap((binding) =>
    binding.rawValues.map((rawText) => ({ slotId: binding.slotId, rawText }))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function orderedMasks(masks: readonly SensitiveMask[]): readonly SensitiveMask[] {
  return [...masks].sort((a, b) => b.rawText.length - a.rawText.length);
}

function maskText(text: string, masks: readonly SensitiveMask[]): string {
  let masked = text;
  for (const mask of masks) {
    masked = masked.replace(
      new RegExp(escapeRegExp(mask.rawText), "gi"),
      () => `{{${mask.slotId}}}`,
    );
  }
  return masked;
}

function maskRecord(
  value: unknown,
  masks: readonly SensitiveMask[],
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return maskText(value, masks);
  if (typeof value === "number" || typeof value === "bigint") {
    const raw = String(value);
    const masked = maskText(raw, masks);
    return masked === raw ? value : masked;
  }
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) {
    throw appError("PII_VIOLATION", "LLM projection refused cyclic evidence.");
  }
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => maskRecord(item, masks, seen));
  const entries: Array<[string, unknown]> = [];
  const keys = new Set<string>();
  for (const [key, item] of Object.entries(value)) {
    const maskedKey = maskText(key, masks);
    if (keys.has(maskedKey)) {
      throw appError("PII_VIOLATION", "LLM projection refused colliding evidence keys.");
    }
    keys.add(maskedKey);
    entries.push([maskedKey, maskRecord(item, masks, seen)]);
  }
  return Object.fromEntries(entries);
}

function containsText(value: unknown, needle: string, seen = new WeakSet<object>()): boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return String(value).toLocaleLowerCase().includes(needle.toLocaleLowerCase());
  }
  if (value == null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, item]) =>
    key.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) ||
    containsText(item, needle, seen)
  );
}

function resolveCompleteBindings(input: EvidenceProjectionInput): readonly ResolvedSensitiveEntity[] | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.keys(input).some((key) =>
      !["evidence", "purpose", "requestText", "slots"].includes(key)
    ) ||
    typeof input.requestText !== "string" ||
    typeof input.evidence !== "object" ||
    input.evidence === null ||
    Array.isArray(input.evidence) ||
    !Array.isArray(input.slots) ||
    !input.slots.every((slot) =>
      typeof slot === "object" &&
      slot !== null &&
      typeof slot.slotId === "string" &&
      typeof slot.slotType === "string"
    )
  ) {
    return null;
  }
  if (input.slots.some((slot) => !SLOT_ID_RE.test(slot.slotId))) return null;
  if (new Set(input.slots.map((slot) => slot.slotId)).size !== input.slots.length) return null;
  return resolveCompleteSensitiveEntities(input);
}

export function projectForLlm(input: EvidenceProjectionInput): Result<MaskedLlmRequest, AppError> {
  try {
    const bindings = resolveCompleteBindings(input);
    if (!bindings) {
      return err(appError(
        "PII_VIOLATION",
        "LLM projection refused at the scrub boundary: invalid sensitive-value mask.",
      ));
    }
    const masks = orderedMasks(masksFromBindings(bindings));
    const maskedText = maskText(input.requestText, masks);
    const maskedEvidence = maskRecord(input.evidence, masks) as Readonly<Record<string, unknown>>;
    if (!isPlainProjectionData(maskedEvidence)) {
      throw appError("PII_VIOLATION", "LLM projection refused evidence outside its trusted shape.");
    }
    if (masks.some((mask) =>
      containsText(maskedText, mask.rawText) ||
      containsText(maskedEvidence, mask.rawText)
    )) {
      throw appError("PII_VIOLATION", "Sensitive entity remained after masking.");
    }
    const tokenizedText = tokenizeText(maskedText);
    const tokenizedEvidence = tokenizeRecord(maskedEvidence);
    if (
      hasUnresolvedProjectionText(tokenizedText.value) ||
      hasUnresolvedProjectionEvidence(tokenizedEvidence.value)
    ) {
      throw appError("PII_VIOLATION", "Unresolved sensitive entity remained after masking.");
    }
    const candidate: MaskedLlmRequest = {
      purpose: input.purpose,
      maskedText: tokenizedText,
      slots: input.slots,
      context: tokenizedEvidence,
    };
    return parseMaskedLlmRequest(candidate);
  } catch {
    return err(appError(
      "PII_VIOLATION",
      "LLM projection refused unresolved sensitive text at the scrub boundary.",
    ));
  }
}
