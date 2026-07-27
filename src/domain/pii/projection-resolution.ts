/**
 * Structural resolution for the evidence-to-LLM projection (v3 §15.1 stage 1).
 *
 * AUTHORITY (D-048): a projected value is RESOLVED when every structurally
 * sensitive span has been replaced by a factory-minted slot placeholder or the
 * redaction sentinel — never "every word appears on an enumerated English
 * list". The sensitivity predicates are contracts/pii.ts's own
 * (looksLikePIIValue / looksLikeAmbiguousSensitiveText / hasSensitiveDigitRun /
 * TITLE_CASE_WORD_SOURCE), the SAME ones that guard the audit, log, and trace
 * boundaries, so the four boundaries cannot disagree and arbitrary non-PII prose
 * passes. Candidate extraction is derived from those same predicates, so
 * anything the residual check would refuse is something the masker was already
 * required to bind to a declared slot — fail-closed by construction.
 *
 * Documented residual risk (not papered over): a capitalized word that OPENS a
 * prose string carries no information — English capitalizes sentence openers —
 * so it is not a name signal at any Verin boundary. A caller that knows a
 * leading token is a person supplies it in evidence under a name key
 * (firstName / fullName / householdName / …), which makes it a candidate
 * regardless of position and masks every case-variant of it in the text.
 * Evidence keys and values are machine data rather than sentences, so they get
 * the strict treatment: ANY title-case word there must be masked.
 */
import {
  hasSensitiveDigitRun,
  looksLikeAmbiguousSensitiveText,
  looksLikePIIValue,
  REDACTED,
  TITLE_CASE_WORD_SOURCE,
  type PIIBearing,
} from "@contracts/pii";

export interface SensitiveResolutionInput extends PIIBearing {
  readonly purpose: string;
  readonly requestText: string;
  readonly slots: readonly {
    readonly slotId: string;
    readonly slotType: string;
  }[];
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ResolvedSensitiveEntity extends PIIBearing {
  readonly slotId: string;
  readonly slotType: "subject" | "account-ref";
  readonly rawValues: readonly string[];
}

/** Field names whose VALUE is identity data whatever its shape — these only ADD candidates. */
const SUBJECT_KEYS = new Set(["firstName", "fullName", "householdName", "lastName", "name"]);
const ACCOUNT_KEYS = new Set(["accountNumber", "accountRef", "account_number", "account_ref"]);

const SLOT_PLACEHOLDER_G = /\{\{slot_\d{4}\}\}/g;
const SLOT_PLACEHOLDER_EXACT_RE = /^\{\{slot_\d{4}\}\}$/;
const TITLE_WORD_RE = new RegExp(TITLE_CASE_WORD_SOURCE, "u");
const TITLE_RUN_RE = new RegExp(
  `${TITLE_CASE_WORD_SOURCE}(?:\\s+${TITLE_CASE_WORD_SOURCE})*`,
  "gu",
);

interface Candidate extends PIIBearing {
  readonly slotType: ResolvedSensitiveEntity["slotType"];
  readonly rawText: string;
}

function addCandidate(candidates: Candidate[], slotType: Candidate["slotType"], rawText: string): void {
  const normalized = rawText.trim();
  if (normalized.length < 2 ||
    candidates.some((candidate) =>
      candidate.slotType === slotType &&
      candidate.rawText.toLocaleLowerCase() === normalized.toLocaleLowerCase()
    )) return;
  candidates.push({ slotType, rawText: normalized });
}

function titleRuns(text: string): Array<{ readonly run: string; readonly index: number }> {
  return [...text.matchAll(TITLE_RUN_RE)].map((match) => ({
    run: match[0],
    index: match.index ?? 0,
  }));
}

/** Prose (requestText): the sentence-opening word is grammar, every other run is a candidate. */
function proseSubjectCandidates(text: string): string[] {
  return titleRuns(text).flatMap(({ run, index }) => {
    const words = run.split(/\s+/);
    if (text.slice(0, index).trim().length === 0) words.shift();
    return words.length ? [words.join(" ")] : [];
  });
}

/** Machine data (evidence keys and values): every title-case run is a candidate. */
function strictSubjectCandidates(text: string): string[] {
  return titleRuns(text).map(({ run }) => run);
}

function accountCandidates(text: string): string[] {
  if (looksLikePIIValue(text)) return [];
  const withoutCurrency = text.replace(/\$\d[\d,]*(?:\.\d+)?/g, " ");
  return [...withoutCurrency.matchAll(/\b\d{3,18}\b/g)].map((match) => match[0]);
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
      for (const subject of strictSubjectCandidates(value)) addCandidate(candidates, "subject", subject);
      for (const account of accountCandidates(value)) addCandidate(candidates, "account-ref", account);
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
    for (const subject of strictSubjectCandidates(nestedKey)) addCandidate(candidates, "subject", subject);
    collectCandidates(item, candidates, nestedKey, seen);
  }
}

export function resolveCompleteSensitiveEntities(
  input: SensitiveResolutionInput,
): readonly ResolvedSensitiveEntity[] | null {
  const slots = input.slots.filter((slot) =>
    slot.slotType === "subject" || slot.slotType === "account-ref"
  );
  if (input.purpose === "intent-shaping" && slots.length === 0) return null;
  const candidates: Candidate[] = [];
  for (const subject of proseSubjectCandidates(input.requestText)) {
    addCandidate(candidates, "subject", subject);
  }
  for (const account of accountCandidates(input.requestText)) {
    addCandidate(candidates, "account-ref", account);
  }
  collectCandidates(input.evidence, candidates);
  const bindings: ResolvedSensitiveEntity[] = [];
  for (const slotType of ["subject", "account-ref"] as const) {
    const typedSlots = slots.filter((slot) => slot.slotType === slotType);
    const typedCandidates = candidates.filter((candidate) => candidate.slotType === slotType);
    if (typedSlots.length !== typedCandidates.length) return null;
    for (let index = 0; index < typedSlots.length; index += 1) {
      bindings.push(Object.freeze({
        slotId: typedSlots[index]!.slotId,
        slotType,
        rawValues: Object.freeze([typedCandidates[index]!.rawText]),
      }));
    }
  }
  return Object.freeze(bindings);
}

/** What survives once factory-minted tokens and the redaction sentinel are removed. */
function residualOf(value: string): string {
  return value.replace(SLOT_PLACEHOLDER_G, " ").split(REDACTED).join(" ");
}

/** Prose residual: refuse anything the platform's own detectors call sensitive. */
export function hasUnresolvedProjectionText(value: string): boolean {
  const residual = residualOf(value);
  return looksLikePIIValue(residual) ||
    hasSensitiveDigitRun(residual) ||
    looksLikeAmbiguousSensitiveText(residual);
}

/** Machine-data residual: additionally refuse ANY surviving title-case word. */
function hasUnresolvedStrictText(value: string): boolean {
  return hasUnresolvedProjectionText(value) || TITLE_WORD_RE.test(residualOf(value));
}

export function hasUnresolvedProjectionEvidence(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") return hasUnresolvedStrictText(value);
  if (typeof value === "number") return !Number.isFinite(value) || hasSensitiveDigitRun(value);
  if (typeof value === "bigint") return true;
  if (typeof value === "boolean" || value == null) return false;
  if (typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasUnresolvedProjectionEvidence(item, seen));
  }
  return Object.entries(value).some(([nestedKey, item]) =>
    (!SLOT_PLACEHOLDER_EXACT_RE.test(nestedKey) && hasUnresolvedStrictText(nestedKey)) ||
    hasUnresolvedProjectionEvidence(item, seen)
  );
}

/**
 * Structural shape gate for masked evidence: plain JSON-shaped data only. A
 * function, symbol, bigint, class instance, or cyclic graph is refused before
 * anything is sealed — shape is checked structurally, never against a closed
 * vocabulary of blessed key names.
 */
export function isPlainProjectionData(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value == null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isPlainProjectionData(item, seen));
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((item) => isPlainProjectionData(item, seen));
}
