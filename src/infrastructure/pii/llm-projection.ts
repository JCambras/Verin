import { type Result, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import {
  parseMaskedLlmRequest,
  SLOT_ID_RE,
  type LlmPurpose,
  type MaskedLlmRequest,
  type SlotPlaceholder,
} from "@infra/llm/request-schema";
import { tokenizeText, tokenizeRecord } from "./tokenize";

declare const EntityMaskBindingBrand: unique symbol;

export interface EntityMaskBinding extends PIIBearing {
  readonly slotId: string;
  readonly slotType: "subject" | "account-ref";
  readonly rawValues: readonly string[];
  readonly [EntityMaskBindingBrand]: "EntityMaskBinding";
}

export interface EvidenceProjectionInput extends PIIBearing {
  readonly purpose: LlmPurpose;
  readonly requestText: string;
  readonly slots: readonly SlotPlaceholder[];
  readonly bindings: readonly EntityMaskBinding[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

const ENTITY_BINDING_SEAL = Symbol("verin.entity-mask-binding.seal");
const ENTITY_BINDINGS = new WeakSet<object>();

export function bindEntityMask(input: {
  readonly slotId: string;
  readonly slotType: "subject" | "account-ref";
  readonly rawValues: readonly string[];
}): EntityMaskBinding {
  const rawValues = [...new Set(input.rawValues.map((value) => value.trim()))];
  if (
    !SLOT_ID_RE.test(input.slotId) ||
    rawValues.length === 0 ||
    rawValues.some((value) => value.length < 2)
  ) {
    throw appError("PII_VIOLATION", "Trusted entity binding was invalid.");
  }
  const binding = Object.defineProperty(
    {
      slotId: input.slotId,
      slotType: input.slotType,
      rawValues: Object.freeze(rawValues),
    },
    ENTITY_BINDING_SEAL,
    { value: true, enumerable: false },
  );
  ENTITY_BINDINGS.add(binding);
  return Object.freeze(binding) as unknown as EntityMaskBinding;
}

function isEntityMaskBinding(value: unknown): value is EntityMaskBinding {
  return typeof value === "object" &&
    value !== null &&
    ENTITY_BINDINGS.has(value);
}

interface SensitiveMask extends PIIBearing {
  readonly slotId: string;
  readonly rawText: string;
}

function masksFromBindings(
  bindings: readonly EntityMaskBinding[],
): readonly SensitiveMask[] {
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
    !Array.isArray(input.bindings) ||
    !input.bindings.every(isEntityMaskBinding)
  ) {
    return false;
  }
  const slots = new Map(input.slots.map((slot) => [slot.slotId, slot.slotType]));
  const sensitiveSlots = input.slots
    .filter((slot) =>
      slot.slotType === "subject" || slot.slotType === "account-ref"
    )
    .map((slot) => slot.slotId);
  const maskedSlots = new Set(input.bindings.map((binding) => binding.slotId));
  if (
    (input.purpose === "intent-shaping" && sensitiveSlots.length === 0) ||
    maskedSlots.size !== input.bindings.length ||
    sensitiveSlots.some((slotId) => !maskedSlots.has(slotId))
  ) {
    return false;
  }
  return input.bindings.every((binding) => {
    const slotType = slots.get(binding.slotId);
    return slotType === binding.slotType &&
      binding.rawValues.some((rawText) =>
        input.requestText.toLocaleLowerCase().includes(rawText.toLocaleLowerCase()) ||
        containsText(input.evidence, rawText)
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
    const masks = orderedMasks(masksFromBindings(input.bindings));
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
