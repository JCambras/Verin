import { type Result, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import { parseMaskedLlmRequest, SLOT_ID_RE, type LlmPurpose, type MaskedLlmRequest, type SlotPlaceholder } from "@infra/llm/request-schema";
import { tokenizeText, tokenizeRecord } from "./tokenize";

export interface ResolvedSensitiveEntity extends PIIBearing {
  readonly slotId: string; readonly slotType: "subject" | "account-ref"; readonly rawValues: readonly string[];
}

export interface EvidenceProjectionInput extends PIIBearing {
  readonly purpose: LlmPurpose;
  readonly requestText: string;
  readonly slots: readonly SlotPlaceholder[];
  readonly resolvedEntities: readonly ResolvedSensitiveEntity[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

function normalizeResolvedEntities(input: EvidenceProjectionInput): readonly ResolvedSensitiveEntity[] | null {
  const slotIds = new Set<string>();
  const bindings = input.resolvedEntities.map((entity) => {
    const rawValues = [...new Set(entity.rawValues.map((value) => value.trim()))];
    const valuesMatchSlot = entity.slotType === "subject"
      ? rawValues.every((value) => /^\p{Lu}[\p{L}' -]*$/u.test(value))
      : rawValues.every((value) => /\d/.test(value));
    if (
      !SLOT_ID_RE.test(entity.slotId) ||
      slotIds.has(entity.slotId) ||
      rawValues.length === 0 ||
      rawValues.some((value) => value.length < 2) ||
      !valuesMatchSlot
    ) {
      return null;
    }
    slotIds.add(entity.slotId);
    return Object.freeze({
      slotId: entity.slotId,
      slotType: entity.slotType,
      rawValues: Object.freeze(rawValues),
    });
  });
  return bindings.some((binding) => binding === null)
    ? null
    : Object.freeze(bindings) as readonly ResolvedSensitiveEntity[];
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
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) {
    throw appError("PII_VIOLATION", "LLM projection refused cyclic evidence.");
  }
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => maskRecord(item, masks, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, maskRecord(item, masks, seen)]),
  );
}

function containsText(value: unknown, needle: string, seen = new WeakSet<object>()): boolean {
  if (typeof value === "string") {
    return value.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
  }
  if (value == null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, item]) =>
    key.toLocaleLowerCase().includes(needle.toLocaleLowerCase()) ||
    containsText(item, needle, seen)
  );
}

const SAFE_RESIDUAL_WORDS = new Set(
  "a account an at call follow for from her ira note open please reach redacted requested review s schedule transfer up wants wire with".split(" "),
);

function hasUnresolvedFreeText(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "string") {
    const residual = value.replace(/\{\{slot_\d{4}\}\}|\[REDACTED\]/g, " ");
    return [...residual.matchAll(/\p{L}+/gu)]
      .some((match) => !SAFE_RESIDUAL_WORDS.has(match[0].toLocaleLowerCase()));
  }
  if (value == null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => hasUnresolvedFreeText(item, seen));
}

function completeBindings(input: EvidenceProjectionInput): readonly ResolvedSensitiveEntity[] | null {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.requestText !== "string" ||
    !Array.isArray(input.slots) ||
    !input.slots.every((slot) =>
      typeof slot === "object" &&
      slot !== null &&
      typeof slot.slotId === "string" &&
      typeof slot.slotType === "string"
    ) ||
    !Array.isArray(input.resolvedEntities)
  ) {
    return null;
  }
  const bindings = normalizeResolvedEntities(input);
  if (!bindings) return null;
  const slots = new Map(input.slots.map((slot) => [slot.slotId, slot.slotType]));
  const sensitiveSlots = input.slots
    .filter((slot) =>
      slot.slotType === "subject" || slot.slotType === "account-ref"
    )
    .map((slot) => slot.slotId);
  const maskedSlots = new Set(bindings.map((binding) => binding.slotId));
  if (
    (input.purpose === "intent-shaping" && sensitiveSlots.length === 0) ||
    maskedSlots.size !== bindings.length ||
    maskedSlots.size !== sensitiveSlots.length ||
    sensitiveSlots.some((slotId) => !maskedSlots.has(slotId)) ||
    [...maskedSlots].some((slotId) => !sensitiveSlots.includes(slotId))
  ) {
    return null;
  }
  return bindings.every((binding) => {
    const slotType = slots.get(binding.slotId);
    return slotType === binding.slotType &&
      binding.rawValues.some((rawText) =>
        input.requestText.toLocaleLowerCase().includes(rawText.toLocaleLowerCase()) ||
        containsText(input.evidence, rawText)
      );
  })
    ? bindings
    : null;
}

export function projectForLlm(input: EvidenceProjectionInput): Result<MaskedLlmRequest, AppError> {
  try {
    const bindings = completeBindings(input);
    if (!bindings) {
      return err(appError(
        "PII_VIOLATION",
        "LLM projection refused at the scrub boundary: invalid sensitive-value mask.",
      ));
    }
    const masks = orderedMasks(masksFromBindings(bindings));
    const maskedText = maskText(input.requestText, masks);
    const maskedEvidence = maskRecord(input.evidence, masks) as Readonly<Record<string, unknown>>;
    if (masks.some((mask) =>
      containsText(maskedText, mask.rawText) ||
      containsText(maskedEvidence, mask.rawText)
    )) {
      throw appError("PII_VIOLATION", "Sensitive entity remained after masking.");
    }
    const tokenizedText = tokenizeText(maskedText);
    const tokenizedEvidence = tokenizeRecord(maskedEvidence);
    if (hasUnresolvedFreeText(tokenizedText.value) || hasUnresolvedFreeText(tokenizedEvidence.value)) {
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
