import {
  hasSensitiveDigitRun, looksLikeAmbiguousSensitiveText, looksLikePIIValue,
  redactPIIValues, REDACTED, SENSITIVE_DIGIT_RUN_SOURCE, TITLE_CASE_WORD_SOURCE,
  type PIIBearing,
} from "@contracts/pii";
export interface IdentitySpan extends PIIBearing { readonly slotId: string; readonly start: number; readonly end: number }
export interface TrustedSafeTextSpan {
  readonly source: "static-template"; readonly sourceId: StaticProjectionTemplateId;
  readonly text: string; readonly start: number; readonly end: number;
}
export interface TrustedProjectionText extends PIIBearing { readonly requestText: string; readonly trustedSafeText: readonly TrustedSafeTextSpan[] }
export interface SensitiveResolutionInput extends PIIBearing {
  readonly requestText: string; readonly evidence: Readonly<Record<string, unknown>>;
  readonly slots: readonly { readonly slotId: string; readonly slotType: string }[];
  readonly identitySpans?: readonly IdentitySpan[];
  readonly trustedSafeText?: readonly TrustedSafeTextSpan[];
}
export interface ResolvedSensitiveEntity extends PIIBearing {
  readonly slotId: string; readonly slotType: "subject" | "account-ref"; readonly rawValues: readonly string[];
}
const SUBJECT_KEYS = new Set(["firstName", "fullName", "householdName", "lastName", "name"]);
const ACCOUNT_KEYS = new Set(["accountNumber", "accountRef", "account_number", "account_ref"]);
const SLOT_PLACEHOLDER_G = /\{\{slot_\d{4}\}\}/g;
const SLOT_PLACEHOLDER_EXACT_RE = /^\{\{slot_\d{4}\}\}$/;
const TITLE_WORD_RE = new RegExp(TITLE_CASE_WORD_SOURCE, "u");
const TITLE_RUN_RE = new RegExp(`${TITLE_CASE_WORD_SOURCE}(?:\\s+${TITLE_CASE_WORD_SOURCE})*`, "gu");
const ACCOUNT_RUN_RE = new RegExp(SENSITIVE_DIGIT_RUN_SOURCE, "g");
const SIMULATED_SLOT = "{{slot_0000}}";
const STATIC_PROJECTION_TEMPLATES = {
  "review-transaction-request": { requestText: "Review the transaction request", safeSpans: [{ start: 0, end: 6 }] },
} as const;
export type StaticProjectionTemplateId = keyof typeof STATIC_PROJECTION_TEMPLATES;
const TRUSTED_SAFE_TEXT_SPANS = new WeakSet<object>();
export function trustedStaticProjectionText(sourceId: StaticProjectionTemplateId): TrustedProjectionText {
  const template = STATIC_PROJECTION_TEMPLATES[sourceId];
  const trustedSafeText = template.safeSpans.map(({ start, end }) => {
    const span: TrustedSafeTextSpan = Object.freeze({
      source: "static-template", sourceId,
      text: template.requestText.slice(start, end), start, end,
    });
    TRUSTED_SAFE_TEXT_SPANS.add(span);
    return span;
  });
  return Object.freeze({ requestText: template.requestText, trustedSafeText: Object.freeze(trustedSafeText) });
}
interface Candidate extends PIIBearing {
  readonly slotType: ResolvedSensitiveEntity["slotType"]; readonly rawText: string;
  readonly identitySpan?: Readonly<{ start: number; end: number }>;
}
function addCandidate(candidates: Candidate[], slotType: Candidate["slotType"], rawText: string,
  identitySpan?: Readonly<{ start: number; end: number }>,
): void {
  const normalized = rawText.trim();
  if (normalized.length < 2) return;
  const found = candidates.findIndex((candidate) =>
    candidate.slotType === slotType &&
    candidate.rawText.toLocaleLowerCase() === normalized.toLocaleLowerCase()
  );
  if (found < 0) {
    candidates.push(identitySpan ? { slotType, rawText: normalized, identitySpan } : { slotType, rawText: normalized });
  } else if (identitySpan && !candidates[found]!.identitySpan) {
    candidates[found] = { ...candidates[found]!, identitySpan };
  }
}
function validatedSafeText(
  requestText: string,
  spans: readonly TrustedSafeTextSpan[] | undefined,
): readonly TrustedSafeTextSpan[] | null {
  if (spans === undefined) return [];
  if (!Array.isArray(spans)) return null;
  const trustedSpans: readonly TrustedSafeTextSpan[] = spans;
  const unique = new Set<string>();
  for (const span of trustedSpans) {
    const template = STATIC_PROJECTION_TEMPLATES[span.sourceId];
    const key = `${span.start}:${span.end}`;
    if (
      !TRUSTED_SAFE_TEXT_SPANS.has(span) ||
      !template ||
      requestText !== template.requestText ||
      requestText.slice(span.start, span.end) !== span.text ||
      !template.safeSpans.some(({ start, end }) => start === span.start && end === span.end) ||
      unique.has(key)
    ) return null;
    unique.add(key);
  }
  return trustedSpans;
}
function subjectCandidates(text: string, safeText: readonly TrustedSafeTextSpan[]): Candidate[] {
  return [...text.matchAll(TITLE_RUN_RE)].flatMap((match) => {
    const rawText = match[0];
    const start = match.index ?? 0;
    const end = start + rawText.length;
    if (safeText.some((span) =>
      span.start === start && span.end === end && span.text === rawText
    )) return [];
    return [{
      slotType: "subject" as const,
      rawText,
      ...(text.slice(0, start).trim().length === 0
        ? { identitySpan: { start, end } }
        : {}),
    }];
  });
}
function strictSubjects(text: string): string[] {
  return [...text.matchAll(TITLE_RUN_RE)].map((match) => match[0]);
}
function withSubjectsMasked(text: string, subjects: readonly string[]): string {
  return [...subjects].sort((a, b) => b.length - a.length).reduce(
    (masked, subject) =>
      masked.replace(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), SIMULATED_SLOT),
    text,
  );
}
function accountCandidates(text: string, subjects: readonly string[] = []): string[] {
  return [...redactPIIValues(withSubjectsMasked(text, subjects)).matchAll(ACCOUNT_RUN_RE)]
    .map((match) => match[0]);
}
function collectCandidates(
  value: unknown,
  candidates: Candidate[],
  key?: string,
  seen = new WeakSet<object>(),
): void {
  if (typeof value === "string") {
    if (key && SUBJECT_KEYS.has(key)) addCandidate(candidates, "subject", value);
    else if (key && ACCOUNT_KEYS.has(key)) addCandidate(candidates, "account-ref", value);
    else {
      const subjects = strictSubjects(value);
      for (const subject of subjects) addCandidate(candidates, "subject", subject);
      for (const account of accountCandidates(value, subjects)) {
        addCandidate(candidates, "account-ref", account);
      }
    }
    return;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    if ((key && ACCOUNT_KEYS.has(key)) || hasSensitiveDigitRun(value)) {
      addCandidate(candidates, "account-ref", String(value));
    }
    return;
  }
  if (value == null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, candidates, key, seen);
    return;
  }
  for (const [nestedKey, item] of Object.entries(value)) {
    for (const subject of strictSubjects(nestedKey)) addCandidate(candidates, "subject", subject);
    collectCandidates(item, candidates, nestedKey, seen);
  }
}
function validatedIdentitySpans(input: SensitiveResolutionInput): ReadonlyMap<string, IdentitySpan> | null {
  const spans = input.identitySpans ?? [];
  if (!Array.isArray(spans)) return null;
  const byBounds = new Map<string, IdentitySpan>();
  for (const span of spans) {
    const key = `${span.start}:${span.end}`;
    if (
      typeof span !== "object" ||
      span === null ||
      Object.keys(span).some((field) => !["end", "slotId", "start"].includes(field)) ||
      typeof span.slotId !== "string" ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end <= span.start ||
      span.end > input.requestText.length ||
      byBounds.has(key)
    ) return null;
    byBounds.set(key, span);
  }
  return byBounds;
}
export function resolveCompleteSensitiveEntities(input: SensitiveResolutionInput): readonly ResolvedSensitiveEntity[] | null {
  const safeText = validatedSafeText(input.requestText, input.trustedSafeText);
  const identityByBounds = validatedIdentitySpans(input);
  if (!safeText || !identityByBounds) return null;
  const slots = input.slots.filter((slot) =>
    slot.slotType === "subject" || slot.slotType === "account-ref"
  );
  const candidates: Candidate[] = [];
  const subjects = subjectCandidates(input.requestText, safeText);
  for (const subject of subjects) {
    addCandidate(candidates, subject.slotType, subject.rawText, subject.identitySpan);
  }
  for (const account of accountCandidates(
    input.requestText,
    subjects.map((subject) => subject.rawText),
  )) addCandidate(candidates, "account-ref", account);
  collectCandidates(input.evidence, candidates);
  const bindings: ResolvedSensitiveEntity[] = [];
  const usedIdentity = new Set<IdentitySpan>();
  for (const slotType of ["subject", "account-ref"] as const) {
    const typedSlots = slots.filter((slot) => slot.slotType === slotType);
    const typedCandidates = candidates.filter((candidate) => candidate.slotType === slotType);
    if (typedSlots.length !== typedCandidates.length) return null;
    const assigned = new Set<string>();
    for (const candidate of typedCandidates.filter((item) => item.identitySpan)) {
      const bounds = candidate.identitySpan!;
      const span = identityByBounds.get(`${bounds.start}:${bounds.end}`);
      if (
        !span ||
        usedIdentity.has(span) ||
        assigned.has(span.slotId) ||
        !typedSlots.some((slot) => slot.slotId === span.slotId) ||
        input.requestText.slice(span.start, span.end) !== candidate.rawText
      ) return null;
      assigned.add(span.slotId);
      usedIdentity.add(span);
      bindings.push(Object.freeze({
        slotId: span.slotId,
        slotType,
        rawValues: Object.freeze([candidate.rawText]),
      }));
    }
    const remainingSlots = typedSlots.filter((slot) => !assigned.has(slot.slotId));
    const remaining = typedCandidates.filter((candidate) => !candidate.identitySpan);
    if (remainingSlots.length !== remaining.length) return null;
    remaining.forEach((candidate, index) => bindings.push(Object.freeze({
      slotId: remainingSlots[index]!.slotId,
      slotType,
      rawValues: Object.freeze([candidate.rawText]),
    })));
  }
  return usedIdentity.size === identityByBounds.size ? Object.freeze(bindings) : null;
}
function residualOf(value: string): string {
  return value.replace(SLOT_PLACEHOLDER_G, " ").split(REDACTED).join(" ");
}
function withoutSafeText(value: string, spans: readonly TrustedSafeTextSpan[] | undefined): string | null {
  const trusted = validatedSafeText(value, spans);
  if (!trusted) return null;
  return [...trusted].sort((a, b) => b.start - a.start).reduce(
    (text, span) =>
      `${text.slice(0, span.start)}${" ".repeat(span.end - span.start)}${text.slice(span.end)}`,
    value,
  );
}
export function hasUnresolvedProjectionText(value: string, safeText?: readonly TrustedSafeTextSpan[]): boolean {
  const trustedResidual = withoutSafeText(value, safeText);
  if (trustedResidual === null) return true;
  const residual = residualOf(trustedResidual);
  return looksLikePIIValue(residual) ||
    hasSensitiveDigitRun(residual) ||
    looksLikeAmbiguousSensitiveText(residual) ||
    TITLE_WORD_RE.test(residual);
}
export function hasUnresolvedProjectionEvidence(
  value: unknown,
  path: readonly object[] = [],
): boolean {
  if (typeof value === "string") return hasUnresolvedProjectionText(value);
  if (typeof value === "number") return !Number.isFinite(value) || hasSensitiveDigitRun(value);
  if (typeof value === "bigint") return true;
  if (typeof value === "boolean" || value == null) return false;
  if (typeof value !== "object" || path.includes(value)) return true;
  const nested = [...path, value];
  if (Array.isArray(value)) {
    return value.some((item) => hasUnresolvedProjectionEvidence(item, nested));
  }
  return Object.entries(value).some(([nestedKey, item]) =>
    (!SLOT_PLACEHOLDER_EXACT_RE.test(nestedKey) &&
      hasUnresolvedProjectionText(nestedKey)) ||
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
