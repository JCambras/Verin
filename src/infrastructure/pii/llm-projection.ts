import { type Result, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import { parseMaskedLlmRequest, SLOT_ID_RE, type LlmPurpose, type MaskedLlmRequest, type SlotPlaceholder } from "@infra/llm/request-schema";
import {
  hasUnresolvedProjectionValue,
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

const TEXT_EVIDENCE_KEYS = new Set([
  "accountNumber", "accountRef", "account_number", "account_ref", "firstName",
  "fullName", "householdName", "lastName", "name", "note", "requestKind", "ssn",
]);

function isSensitiveLengthNumber(value: number): boolean {
  return Number.isInteger(value) && /^\d{9,18}$/.test(String(Math.abs(value)));
}

function matchesMaskedEvidenceSchema(
  value: unknown,
  key?: string,
  seen = new WeakSet<object>(),
): boolean {
  if (value == null) return true;
  if (typeof value === "string") {
    return Boolean(
      key &&
      (TEXT_EVIDENCE_KEYS.has(key) || /^\{\{slot_\d{4}\}\}$/.test(key)),
    );
  }
  if (typeof value === "number") {
    return key === "plannedWithdrawals" &&
      Number.isFinite(value) &&
      value >= 0 &&
      !isSensitiveLengthNumber(value);
  }
  if (typeof value !== "object" || seen.has(value) || Array.isArray(value)) {
    return false;
  }
  if (key && key !== "household") return false;
  seen.add(value);
  return Object.entries(value).every(([nestedKey, item]) =>
    (nestedKey === "household" ||
      nestedKey === "plannedWithdrawals" ||
      TEXT_EVIDENCE_KEYS.has(nestedKey) ||
      /^\{\{slot_\d{4}\}\}$/.test(nestedKey)) &&
    matchesMaskedEvidenceSchema(item, nestedKey, seen)
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
    if (!matchesMaskedEvidenceSchema(maskedEvidence)) {
      throw appError("PII_VIOLATION", "LLM projection refused evidence outside its trusted schema.");
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
      hasUnresolvedProjectionValue(tokenizedText.value) ||
      hasUnresolvedProjectionValue(tokenizedEvidence.value)
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
