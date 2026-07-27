import { type Result, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import {
  parseMaskedLlmRequest,
  SLOT_NAME_RE,
  type LlmPurpose,
  type MaskedLlmRequest,
  type SlotPlaceholder,
} from "@infra/llm/request-schema";
import { tokenizeText, tokenizeRecord } from "./tokenize";

export interface SubjectMask extends PIIBearing {
  readonly slotName: string;
  readonly rawText: string;
}

export interface EvidenceProjectionInput extends PIIBearing {
  readonly purpose: LlmPurpose;
  readonly requestText: string;
  readonly slots: readonly SlotPlaceholder[];
  readonly masks: readonly SubjectMask[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function orderedMasks(masks: readonly SubjectMask[]): readonly SubjectMask[] {
  return [...masks].sort((a, b) => b.rawText.length - a.rawText.length);
}

function maskText(text: string, masks: readonly SubjectMask[]): string {
  let masked = text;
  for (const mask of masks) {
    masked = masked.replace(
      new RegExp(escapeRegExp(mask.rawText), "gi"),
      () => `{{${mask.slotName}}}`,
    );
  }
  return masked;
}

function maskRecord(
  value: unknown,
  masks: readonly SubjectMask[],
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

function containsText(
  value: unknown,
  needle: string,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") {
    return value.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
  }
  if (value == null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => containsText(item, needle, seen));
}

function masksAreValid(input: EvidenceProjectionInput): boolean {
  const slots = new Map(input.slots.map((slot) => [slot.slotName, slot.slotType]));
  const sensitiveSlots = input.slots
    .filter((slot) =>
      slot.slotType === "subject" || slot.slotType === "account-ref"
    )
    .map((slot) => slot.slotName);
  const maskedSlots = new Set(input.masks.map((mask) => mask.slotName));
  if (
    (input.purpose === "intent-shaping" && sensitiveSlots.length === 0) ||
    maskedSlots.size !== input.masks.length ||
    sensitiveSlots.some((slotName) => !maskedSlots.has(slotName))
  ) {
    return false;
  }
  return input.masks.every((mask) => {
    const slotType = slots.get(mask.slotName);
    return SLOT_NAME_RE.test(mask.slotName) &&
      mask.rawText.trim().length >= 2 &&
      (slotType === "subject" || slotType === "account-ref") &&
      (
        input.requestText.toLocaleLowerCase().includes(mask.rawText.toLocaleLowerCase()) ||
        containsText(input.evidence, mask.rawText)
      );
  });
}

export function projectForLlm(
  input: EvidenceProjectionInput,
): Result<MaskedLlmRequest, AppError> {
  if (!masksAreValid(input)) {
    return err(appError(
      "PII_VIOLATION",
      "LLM projection refused at the scrub boundary: invalid sensitive-value mask.",
    ));
  }
  try {
    const masks = orderedMasks(input.masks);
    const candidate: MaskedLlmRequest = {
      purpose: input.purpose,
      maskedText: tokenizeText(maskText(input.requestText, masks)),
      slots: input.slots,
      context: tokenizeRecord(
        maskRecord(input.evidence, masks) as Readonly<Record<string, unknown>>,
      ),
    };
    return parseMaskedLlmRequest(candidate);
  } catch {
    return err(appError(
      "PII_VIOLATION",
      "LLM projection refused unresolved sensitive text at the scrub boundary.",
    ));
  }
}
