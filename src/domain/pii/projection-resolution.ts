import {
  accountReferenceDigits,
  hasSensitiveAccountReference,
  looksLikeAmbiguousSensitiveText,
  looksLikePIIValue,
  sensitiveAccountReferences,
  REDACTED,
  PERSON_WORD_SOURCE,
  type PIIBearing,
} from "@contracts/pii";
import { SLOT_ID_RE } from "@contracts/tokenized";
import { appError } from "@contracts/errors";

type SensitiveSlotType = "subject" | "account-ref";
export interface TrustedProjectionValue extends PIIBearing {
  readonly slotId: string; readonly slotType: SensitiveSlotType; readonly value: string;
}
interface TrustedProjectionSpan extends PIIBearing {
  readonly slotId: string; readonly slotType: SensitiveSlotType; readonly start: number; readonly end: number;
}
export interface TrustedProjectionText extends PIIBearing {
  readonly sourceId: StaticProjectionTemplateId; readonly requestText: string; readonly maskedText: string;
  readonly sensitiveSpans: readonly TrustedProjectionSpan[];
}
export interface SensitiveResolutionInput extends PIIBearing {
  readonly request: TrustedProjectionText; readonly evidence: Readonly<Record<string, unknown>>;
  readonly slots: readonly { readonly slotId: string; readonly slotType: string }[];
}
export interface ResolvedSensitiveEntity extends PIIBearing {
  readonly slotId: string; readonly slotType: SensitiveSlotType; readonly rawValues: readonly string[];
}
const EVIDENCE_FIELDS = {
  accountNumber: "account-ref",
  accountRef: "account-ref",
  account_number: "account-ref",
  account_ref: "account-ref",
  email: "redacted",
  firstName: "subject",
  fullName: "subject",
  household: "container",
  householdName: "subject",
  lastName: "subject",
  name: "subject",
  phone: "redacted",
  plannedWithdrawals: "number",
  ssn: "redacted",
} as const;
type EvidenceField = keyof typeof EVIDENCE_FIELDS;
const SLOT_PLACEHOLDER_G = /\{\{slot_\d{4}\}\}/g;
const SLOT_PLACEHOLDER_EXACT_RE = /^\{\{slot_\d{4}\}\}$/;
const PERSON_WORD_RE = new RegExp(PERSON_WORD_SOURCE, "u");
const STATIC_PROJECTION_TEMPLATES = {
  "account-transfer-request": { parts: ["wire to ", " today"], slotTypes: ["account-ref"] },
  "review-subject-request": { parts: ["review ", ""], slotTypes: ["subject"] },
  "review-transaction-request": { parts: ["review the transaction request"], slotTypes: [] },
  "subject-account-transfer-request": { parts: ["", " requested a transfer from ", ""], slotTypes: ["subject", "account-ref"] },
  "subject-approval-request": { parts: ["", " must approve the transfer"], slotTypes: ["subject"] },
  "subject-annual-review-request": { parts: ["", " requested an annual review"], slotTypes: ["subject"] },
  "subject-transfer-request": { parts: ["", " requested a transfer"], slotTypes: ["subject"] },
} as const;
export type StaticProjectionTemplateId = keyof typeof STATIC_PROJECTION_TEMPLATES;
const TRUSTED_PROJECTION_TEXTS = new WeakSet<object>();
export function trustedStaticProjectionText(
  sourceId: StaticProjectionTemplateId,
  values: readonly TrustedProjectionValue[] = [],
): TrustedProjectionText {
  const template = STATIC_PROJECTION_TEMPLATES[sourceId];
  if (
    !template ||
    !Array.isArray(values) ||
    values.length !== template.slotTypes.length ||
    values.some((value, index) =>
      typeof value !== "object" ||
      value === null ||
      typeof value.slotId !== "string" || !SLOT_ID_RE.test(value.slotId) ||
      value.slotType !== template.slotTypes[index] ||
      typeof value.value !== "string" ||
      value.value.length === 0 ||
      (value.slotType === "account-ref" && accountReferenceDigits(value.value) === null)
    ) ||
    new Set(values.map((value) => value.slotId)).size !== values.length
  ) {
    throw appError("PII_VIOLATION", "Projection template values do not match the reviewed structure.");
  }
  let requestText = template.parts[0] as string;
  let maskedText = requestText;
  const sensitiveSpans: TrustedProjectionSpan[] = [];
  values.forEach((value, index) => {
    const start = requestText.length;
    requestText += value.value;
    sensitiveSpans.push(Object.freeze({
      slotId: value.slotId,
      slotType: value.slotType,
      start,
      end: requestText.length,
    }));
    const suffix = template.parts[index + 1] as string;
    requestText += suffix;
    maskedText += `{{${value.slotId}}}${suffix}`;
  });
  const trusted = {
    sourceId,
    requestText,
    maskedText,
    sensitiveSpans: Object.freeze(sensitiveSpans),
  };
  TRUSTED_PROJECTION_TEXTS.add(trusted);
  return Object.freeze(trusted);
}
interface Candidate extends PIIBearing {
  readonly slotType: SensitiveSlotType;
  readonly rawText: string;
  readonly trustedSpan?: TrustedProjectionSpan;
}
function addCandidate(
  candidates: Candidate[],
  slotType: SensitiveSlotType,
  rawText: string,
  trustedSpan?: TrustedProjectionSpan,
): void {
  const normalized = rawText.trim();
  if (normalized.length < 2) return;
  const accountDigits = slotType === "account-ref" ? accountReferenceDigits(normalized) : null;
  const found = candidates.findIndex((candidate) =>
    candidate.slotType === slotType &&
    (
      accountDigits !== null
        ? accountReferenceDigits(candidate.rawText) === accountDigits
        : candidate.rawText.toLocaleLowerCase() === normalized.toLocaleLowerCase()
    )
  );
  if (found < 0) {
    candidates.push(trustedSpan === undefined
      ? { slotType, rawText: normalized }
      : { slotType, rawText: normalized, trustedSpan });
  } else if (trustedSpan && !candidates[found]!.trustedSpan) {
    candidates[found] = { ...candidates[found]!, trustedSpan };
  }
}
function collectCandidates(
  value: unknown,
  candidates: Candidate[],
  key?: string,
  path: readonly object[] = [],
): boolean {
  if (typeof value === "string") {
    const kind = key ? EVIDENCE_FIELDS[key as EvidenceField] : undefined;
    if (kind === "subject" || kind === "account-ref") {
      if (kind === "account-ref" && accountReferenceDigits(value) === null) return false;
      addCandidate(candidates, kind, value);
      return true;
    }
    return kind === "redacted";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    const kind = key ? EVIDENCE_FIELDS[key as EvidenceField] : undefined;
    if (kind === "account-ref" || hasSensitiveAccountReference(value)) {
      addCandidate(candidates, "account-ref", String(value));
      return kind === "account-ref";
    }
    return kind === "number" && typeof value === "number" && Number.isFinite(value);
  }
  if (value == null || typeof value === "boolean") return true;
  if (typeof value !== "object" || path.includes(value)) return false;
  const nested = [...path, value];
  if (Array.isArray(value)) {
    return value.every((item) => collectCandidates(item, candidates, key, nested));
  }
  for (const [nestedKey, item] of Object.entries(value)) {
    const kind = EVIDENCE_FIELDS[nestedKey as EvidenceField];
    if (!kind || (kind === "container" && (item === null || typeof item !== "object"))) {
      return false;
    }
    if (!collectCandidates(item, candidates, nestedKey, nested)) return false;
  }
  return true;
}
export function resolveCompleteSensitiveEntities(input: SensitiveResolutionInput): readonly ResolvedSensitiveEntity[] | null {
  if (
    typeof input.request !== "object" ||
    input.request === null ||
    !TRUSTED_PROJECTION_TEXTS.has(input.request)
  ) return null;
  const slots = input.slots.filter((slot) =>
    slot.slotType === "subject" || slot.slotType === "account-ref"
  );
  const candidates: Candidate[] = [];
  for (const span of input.request.sensitiveSpans) {
    const rawText = input.request.requestText.slice(span.start, span.end);
    if (
      rawText.length === 0 ||
      (span.slotType === "account-ref" && accountReferenceDigits(rawText) === null)
    ) return null;
    addCandidate(candidates, span.slotType, rawText, span);
  }
  const accountReferences = sensitiveAccountReferences(input.request.requestText);
  if (
    accountReferences.some((reference) =>
      !reference.valid ||
      !input.request.sensitiveSpans.some((span) =>
        span.slotType === "account-ref" &&
        span.start === reference.start &&
        span.end === reference.end
      )
    ) ||
    !collectCandidates(input.evidence, candidates)
  ) return null;
  const bindings: ResolvedSensitiveEntity[] = [];
  const usedSpans = new Set<TrustedProjectionSpan>();
  for (const slotType of ["subject", "account-ref"] as const) {
    const typedSlots = slots.filter((slot) => slot.slotType === slotType);
    const typedCandidates = candidates.filter((candidate) => candidate.slotType === slotType);
    if (typedSlots.length !== typedCandidates.length) return null;
    const assigned = new Set<string>();
    for (const candidate of typedCandidates.filter((item) => item.trustedSpan)) {
      const span = candidate.trustedSpan!;
      if (
        usedSpans.has(span) ||
        assigned.has(span.slotId) ||
        !typedSlots.some((slot) => slot.slotId === span.slotId) ||
        input.request.requestText.slice(span.start, span.end) !== candidate.rawText
      ) return null;
      assigned.add(span.slotId);
      usedSpans.add(span);
      bindings.push(Object.freeze({
        slotId: span.slotId,
        slotType,
        rawValues: Object.freeze([candidate.rawText]),
      }));
    }
    const remainingSlots = typedSlots.filter((slot) => !assigned.has(slot.slotId));
    const remaining = typedCandidates.filter((candidate) => !candidate.trustedSpan);
    if (remainingSlots.length !== remaining.length) return null;
    remaining.forEach((candidate, index) => bindings.push(Object.freeze({
      slotId: remainingSlots[index]!.slotId,
      slotType,
      rawValues: Object.freeze([candidate.rawText]),
    })));
  }
  return usedSpans.size === input.request.sensitiveSpans.length
    ? Object.freeze(bindings)
    : null;
}
function residualOf(value: string): string {
  return value.replace(SLOT_PLACEHOLDER_G, " ").split(REDACTED).join(" ");
}
export function hasUnresolvedProjectionText(
  value: string,
  trusted?: TrustedProjectionText,
): boolean {
  if (trusted) {
    return !TRUSTED_PROJECTION_TEXTS.has(trusted) || value !== trusted.maskedText;
  }
  const residual = residualOf(value);
  return looksLikePIIValue(residual) ||
    hasSensitiveAccountReference(residual) ||
    looksLikeAmbiguousSensitiveText(residual) ||
    PERSON_WORD_RE.test(residual);
}
export function hasUnresolvedProjectionEvidence(
  value: unknown,
  path: readonly object[] = [],
): boolean {
  if (typeof value === "string") {
    const residual = residualOf(value);
    return /\p{L}/u.test(residual) || hasUnresolvedProjectionText(value);
  }
  if (typeof value === "number") {
    return !Number.isFinite(value) || hasSensitiveAccountReference(value);
  }
  if (typeof value === "bigint") return true;
  if (typeof value === "boolean" || value == null) return false;
  if (typeof value !== "object" || path.includes(value)) return true;
  const nested = [...path, value];
  if (Array.isArray(value)) {
    return value.some((item) => hasUnresolvedProjectionEvidence(item, nested));
  }
  return Object.entries(value).some(([nestedKey, item]) =>
    (!SLOT_PLACEHOLDER_EXACT_RE.test(nestedKey) &&
      !(nestedKey in EVIDENCE_FIELDS)) ||
    hasUnresolvedProjectionEvidence(item, nested)
  );
}
export function isPlainProjectionData(value: unknown, path: readonly object[] = []): boolean {
  if (value == null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || path.includes(value)) return false;
  const nested = [...path, value];
  if (Array.isArray(value)) return value.every((item) => isPlainProjectionData(item, nested));
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((item) => isPlainProjectionData(item, nested));
}
