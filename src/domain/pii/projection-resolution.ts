import {
  looksLikePIIValue,
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

const SAFE_WORDS = new Set(
  "a account an at call follow for from her note open please reach redacted requested review s schedule transfer up wants wire with".split(" "),
);
const SAFE_TITLES = new Set(["Call", "Follow", "Move", "Open", "Please", "Review", "Schedule", "Wire"]);
const SAFE_ACRONYMS = new Set(["IRA"]);
const SAFE_KEYS = new Set([
  "accountNumber", "accountRef", "account_number", "account_ref", "firstName",
  "fullName", "household", "householdName", "lastName", "name", "note",
  "plannedWithdrawals", "requestKind", "ssn",
]);
const SAFE_NUMERIC_KEYS = new Set(["plannedWithdrawals"]);
const SUBJECT_KEYS = new Set(["firstName", "fullName", "householdName", "lastName", "name"]);
const ACCOUNT_KEYS = new Set(["accountNumber", "accountRef", "account_number", "account_ref"]);
const TITLE_SEQUENCE_RE =
  /\b\p{Lu}\p{Ll}{1,}(?:[-'][\p{Lu}]?\p{Ll}+)?(?:\s+\p{Lu}\p{Ll}{1,}(?:[-'][\p{Lu}]?\p{Ll}+)?)*/gu;

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

function subjectCandidates(text: string): string[] {
  return [...text.matchAll(TITLE_SEQUENCE_RE)].flatMap((match) => {
    const words = match[0].split(/\s+/);
    while (words.length && SAFE_TITLES.has(words[0]!)) words.shift();
    while (words.length && SAFE_TITLES.has(words.at(-1)!)) words.pop();
    return words.length ? [words.join(" ")] : [];
  });
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
      for (const subject of subjectCandidates(value)) addCandidate(candidates, "subject", subject);
      for (const account of accountCandidates(value)) addCandidate(candidates, "account-ref", account);
    }
    return;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    if (key && ACCOUNT_KEYS.has(key)) addCandidate(candidates, "account-ref", String(value));
    return;
  }
  if (value == null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, candidates, key, seen);
    return;
  }
  for (const [nestedKey, item] of Object.entries(value)) {
    for (const subject of subjectCandidates(nestedKey)) addCandidate(candidates, "subject", subject);
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
  collectCandidates(input.requestText, candidates);
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

function unresolvedString(value: string): boolean {
  const residual = value
    .replace(/\{\{slot_\d{4}\}\}|\[REDACTED\]/g, " ")
    .replace(/\$\d[\d,]*(?:\.\d+)?/g, " ");
  if (/\d/.test(residual)) return true;
  return [...residual.matchAll(/\p{L}+/gu)].some((match) => {
    const word = match[0];
    return !SAFE_ACRONYMS.has(word) &&
      !SAFE_TITLES.has(word) &&
      !SAFE_WORDS.has(word.toLocaleLowerCase());
  });
}

export function hasUnresolvedProjectionValue(
  value: unknown,
  key?: string,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") return unresolvedString(value);
  if (typeof value === "number") return !Number.isFinite(value) || !key || !SAFE_NUMERIC_KEYS.has(key);
  if (typeof value === "bigint") return true;
  if (typeof value === "boolean" || value == null) return false;
  if (typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasUnresolvedProjectionValue(item, key, seen));
  }
  return Object.entries(value).some(([nestedKey, item]) =>
    (!/^\{\{slot_\d{4}\}\}$/.test(nestedKey) && !SAFE_KEYS.has(nestedKey)) ||
    hasUnresolvedProjectionValue(item, nestedKey, seen)
  );
}
