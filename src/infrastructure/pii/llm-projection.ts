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
 * domain/pii/projection-resolution.ts (D-070).
 */
import { type Result, err } from "@contracts/result";
import { appError, type AppError } from "@contracts/errors";
import {
  accountReferenceDigits,
  sensitiveAccountReferences,
  type PIIBearing,
} from "@contracts/pii";
import { SLOT_ID_RE } from "@contracts/tokenized";
import { parseMaskedLlmRequest, type LlmPurpose, type MaskedLlmRequest, type SlotPlaceholder } from "@infra/llm/request-schema";
import {
  hasUnresolvedProjectionEvidence,
  hasUnresolvedProjectionText,
  isPlainProjectionData,
  resolveCompleteSensitiveEntities,
  type ResolvedSensitiveEntity,
  type TrustedProjectionText,
} from "@domain/pii/projection-resolution";
import { tokenizeText, tokenizeRecord } from "./tokenize";

export interface EvidenceProjectionInput extends PIIBearing {
  readonly purpose: LlmPurpose;
  readonly request: TrustedProjectionText;
  readonly slots: readonly SlotPlaceholder[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

interface SensitiveMask extends PIIBearing {
  readonly slotId: string;
  readonly slotType: ResolvedSensitiveEntity["slotType"];
  readonly rawText: string;
}

function masksFromBindings(bindings: readonly ResolvedSensitiveEntity[]): readonly SensitiveMask[] {
  return bindings.flatMap((binding) =>
    binding.rawValues.map((rawText) => ({
      slotId: binding.slotId,
      slotType: binding.slotType,
      rawText,
    }))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function orderedMasks(masks: readonly SensitiveMask[]): readonly SensitiveMask[] {
  return [...masks].sort((a, b) => b.rawText.length - a.rawText.length);
}

function sensitiveOccurrence(rawText: string, global: boolean): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(rawText)}(?![\\p{L}\\p{N}_])`,
    global ? "giu" : "iu",
  );
}

function maskText(text: string, masks: readonly SensitiveMask[]): string {
  let masked = text;
  for (const mask of masks) {
    const replacement = `{{${mask.slotId}}}`;
    if (mask.slotType === "subject") {
      masked = masked.replace(sensitiveOccurrence(mask.rawText, true), () => replacement);
      continue;
    }
    const digits = accountReferenceDigits(mask.rawText);
    if (!digits) continue;
    for (const reference of [...sensitiveAccountReferences(masked)].reverse()) {
      if (
        reference.valid &&
        accountReferenceDigits(masked.slice(reference.start, reference.end)) === digits
      ) {
        masked = `${masked.slice(0, reference.start)}${replacement}${masked.slice(reference.end)}`;
      }
    }
  }
  return masked;
}

// `path` is the ANCESTOR chain, not a global visited set: one object referenced by
// two sibling keys is a DAG, which JSON-shaped evidence projects fine, while an
// object reachable from itself is a true cycle and stays refused.
function maskRecord(
  value: unknown,
  masks: readonly SensitiveMask[],
  path: readonly object[] = [],
): unknown {
  if (typeof value === "string") return maskText(value, masks);
  if (typeof value === "number" || typeof value === "bigint") {
    const raw = String(value);
    const masked = maskText(raw, masks);
    return masked === raw ? value : masked;
  }
  if (value == null || typeof value !== "object") return value;
  if (path.includes(value)) {
    throw appError("PII_VIOLATION", "LLM projection refused cyclic evidence.");
  }
  const nested = [...path, value];
  if (Array.isArray(value)) return value.map((item) => maskRecord(item, masks, nested));
  const entries: Array<[string, unknown]> = [];
  const keys = new Set<string>();
  for (const [key, item] of Object.entries(value)) {
    const maskedKey = maskText(key, masks);
    if (keys.has(maskedKey)) {
      throw appError("PII_VIOLATION", "LLM projection refused colliding evidence keys.");
    }
    keys.add(maskedKey);
    entries.push([maskedKey, maskRecord(item, masks, nested)]);
  }
  return Object.fromEntries(entries);
}

function containsSensitiveOccurrence(
  value: unknown,
  mask: SensitiveMask,
  seen = new WeakSet<object>(),
): boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    const text = String(value);
    if (mask.slotType === "subject") {
      return sensitiveOccurrence(mask.rawText, false).test(text);
    }
    const digits = accountReferenceDigits(mask.rawText);
    return Boolean(digits && sensitiveAccountReferences(text).some((reference) =>
      reference.valid &&
      accountReferenceDigits(text.slice(reference.start, reference.end)) === digits
    ));
  }
  if (value == null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, item]) =>
    containsSensitiveOccurrence(key, mask, seen) ||
    containsSensitiveOccurrence(item, mask, seen)
  );
}

function resolveCompleteBindings(input: EvidenceProjectionInput): readonly ResolvedSensitiveEntity[] | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.keys(input).some((key) =>
      ![
        "evidence",
        "purpose",
        "request",
        "slots",
      ].includes(key)
    ) ||
    typeof input.request !== "object" ||
    input.request === null ||
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
    if (
      typeof input !== "object" ||
      input === null ||
      !isPlainProjectionData(input.evidence)
    ) {
      throw appError("PII_VIOLATION", "LLM projection refused evidence outside its trusted shape.");
    }
    const bindings = resolveCompleteBindings(input);
    if (!bindings) {
      return err(appError(
        "PII_VIOLATION",
        "LLM projection refused at the scrub boundary: invalid sensitive-value mask.",
      ));
    }
    const masks = orderedMasks(masksFromBindings(bindings));
    const maskedText = maskText(input.request.requestText, masks);
    const maskedEvidence = maskRecord(input.evidence, masks) as Readonly<Record<string, unknown>>;
    if (!isPlainProjectionData(maskedEvidence)) {
      throw appError("PII_VIOLATION", "LLM projection refused evidence outside its trusted shape.");
    }
    if (masks.some((mask) =>
      containsSensitiveOccurrence(maskedText, mask) ||
      containsSensitiveOccurrence(maskedEvidence, mask)
    )) {
      throw appError("PII_VIOLATION", "Sensitive entity remained after masking.");
    }
    const tokenizedText = tokenizeText(maskedText);
    const tokenizedEvidence = tokenizeRecord(maskedEvidence);
    if (
      hasUnresolvedProjectionText(tokenizedText.value, input.request) ||
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
