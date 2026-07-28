/**
 * Structural resolution for the evidence-to-LLM projection (v3 §15.1 stage 1).
 *
 * AUTHORITY (D-048): a projected value is RESOLVED when every structurally
 * sensitive span has been replaced by a factory-minted slot placeholder or the
 * redaction sentinel — never "every word appears on an enumerated English list".
 * The sensitivity predicates are contracts/pii.ts's own (looksLikePIIValue /
 * looksLikeAmbiguousSensitiveText / hasSensitiveDigitRun /
 * TITLE_CASE_WORD_SOURCE), the SAME ones guarding the audit, log, and trace
 * boundaries, so the four cannot disagree and arbitrary non-PII prose passes.
 * Candidate extraction reads those same shapes ON THE SAME BASIS the residual
 * check reads (the subject-masked text), so the set that check would refuse is
 * exactly the set the masker was told to bind — neither over-binding ordinary
 * numbers (a year is not an account) nor leaving an unsatisfiable refusal.
 *
 * Documented residual risk (not papered over): a SINGLE capitalized word that
 * OPENS a prose string is sentence grammar, so on its own it is not a name
 * signal at any Verin boundary. A MULTI-word title-case run is the person-name
 * shape wherever it sits (what TITLE_CASE_PERSON_RE keys on), so a leading run
 * is bound whole. A caller that knows a lone leading token is a person supplies
 * it in evidence under a name key, which makes it a candidate regardless of
 * position. Evidence keys/values are machine data, so they get the strict
 * treatment: ANY title-case word there must be masked.
 */
import {
  hasSensitiveDigitRun,
  looksLikeAmbiguousSensitiveText,
  looksLikePIIValue,
  redactPIIValues,
  REDACTED,
  SENSITIVE_DIGIT_RUN_SOURCE,
  TITLE_CASE_WORD_SOURCE,
  type PIIBearing,
} from "@contracts/pii";

export interface SensitiveResolutionInput extends PIIBearing {
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
const ACCOUNT_RUN_RE = new RegExp(SENSITIVE_DIGIT_RUN_SOURCE, "g");

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

/**
 * Prose (requestText): a LONE sentence-opening word is grammar; every other run
 * — including a multi-word run at position 0, which is the name shape itself —
 * is a candidate.
 */
function proseSubjectCandidates(text: string): string[] {
  return titleRuns(text).flatMap(({ run, index }) => {
    const opensTheString = text.slice(0, index).trim().length === 0;
    return opensTheString && !/\s/.test(run) ? [] : [run];
  });
}

/** Machine data (evidence keys and values): every title-case run is a candidate. */
function strictSubjectCandidates(text: string): string[] {
  return titleRuns(text).map(({ run }) => run);
}

const SIMULATED_SLOT = "{{slot_0000}}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The text as the residual guards will see it: every bound subject already
 * replaced by a slot placeholder. Extraction MUST read this basis, not the raw
 * string — masking a name changes what redaction can still match around it
 * (a labeled SSN's `\D{0,10}` label-to-digits window does not survive the
 * digits inside an inserted `{{slot_0001}}`), so extracting from the raw text
 * produced a refusal the caller could not satisfy: zero account candidates
 * pre-mask, one refusing digit run post-mask.
 */
function withSubjectsMasked(text: string, subjects: readonly string[]): string {
  return [...subjects]
    .sort((a, b) => b.length - a.length)
    .reduce(
      (masked, subject) =>
        masked.replace(new RegExp(escapeRegExp(subject), "gi"), SIMULATED_SLOT),
      text,
    );
}

/**
 * Account references: EXACTLY the runs hasSensitiveDigitRun refuses, read from
 * the subject-masked text after pattern redaction. A run the scrubber replaces
 * with the sentinel (a labeled SSN, an E.164 phone) never reaches a model, so it
 * needs no slot; a run that survives redaction on the SAME basis the residual
 * check reads is precisely what that check would refuse, so the caller is told
 * to bind it — and binding it is enough.
 */
function accountCandidates(text: string, subjects: readonly string[] = []): string[] {
  return [
    ...redactPIIValues(withSubjectsMasked(text, subjects)).matchAll(ACCOUNT_RUN_RE),
  ].map((match) => match[0]);
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
      const subjects = strictSubjectCandidates(value);
      for (const subject of subjects) addCandidate(candidates, "subject", subject);
      for (const account of accountCandidates(value, subjects)) addCandidate(candidates, "account-ref", account);
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
  // A request is resolved when every sensitive candidate is bound — NOT when the
  // caller happens to have declared a slot. Prose with nothing structurally
  // sensitive in it binds nothing and is resolved; the per-type count match below
  // is what refuses an unbound candidate.
  const slots = input.slots.filter((slot) =>
    slot.slotType === "subject" || slot.slotType === "account-ref"
  );
  const candidates: Candidate[] = [];
  const subjects = proseSubjectCandidates(input.requestText);
  for (const subject of subjects) {
    addCandidate(candidates, "subject", subject);
  }
  for (const account of accountCandidates(input.requestText, subjects)) {
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

// `path` is the ANCESTOR chain: a shared reference under two sibling keys is a DAG
// and gets checked on its own merits, while a self-reachable object is a cycle and
// stays fail-closed. A global visited set would refuse the DAG as if it were cyclic.
export function hasUnresolvedProjectionEvidence(
  value: unknown,
  path: readonly object[] = [],
): boolean {
  if (typeof value === "string") return hasUnresolvedStrictText(value);
  if (typeof value === "number") return !Number.isFinite(value) || hasSensitiveDigitRun(value);
  if (typeof value === "bigint") return true;
  if (typeof value === "boolean" || value == null) return false;
  if (typeof value !== "object" || path.includes(value)) return true;
  const nested = [...path, value];
  if (Array.isArray(value)) {
    return value.some((item) => hasUnresolvedProjectionEvidence(item, nested));
  }
  return Object.entries(value).some(([nestedKey, item]) =>
    (!SLOT_PLACEHOLDER_EXACT_RE.test(nestedKey) && hasUnresolvedStrictText(nestedKey)) ||
    hasUnresolvedProjectionEvidence(item, nested)
  );
}

/**
 * Structural shape gate for masked evidence: plain JSON-shaped data only. A
 * function, symbol, bigint, class instance, or cyclic graph is refused before
 * anything is sealed — shape is checked structurally, never against a closed
 * vocabulary of blessed key names.
 */
export function isPlainProjectionData(value: unknown, path: readonly object[] = []): boolean {
  if (value == null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (path.includes(value)) return false; // ancestor chain: a cycle, not a shared sibling
  const nested = [...path, value];
  if (Array.isArray(value)) return value.every((item) => isPlainProjectionData(item, nested));
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((item) => isPlainProjectionData(item, nested));
}
