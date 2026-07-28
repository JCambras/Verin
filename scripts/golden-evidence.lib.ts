/** Captain-ratified completeness rules for signed golden evidence. */
const PROCEED_FACT_SOURCES = {
  "request-amount": "trigger",
  "source-account-balance": "account-balance",
  "planned-withdrawal-schedule": "planned-withdrawals",
  "pending-liquidity-activity": "pending-actions",
  "destination-bank-instruction": "bank-instruction",
  "destination-restriction": "household-instruction",
} as const;
const PROCEED_FACTS = Object.entries(PROCEED_FACT_SOURCES);
const REQUIRED_FACT_SOURCES_BY_CASE = {
  "GC-01-firm-a-happy-path": PROCEED_FACTS,
  "GC-02-firm-b-happy-path": PROCEED_FACTS,
  "GC-03-recent-bank-change-firm-a": PROCEED_FACTS,
  "GC-04-recent-bank-change-firm-b": [
    ["request-amount", "trigger"],
    ["destination-bank-instruction", "bank-instruction"],
    ["source-account-balance", "account-balance"],
  ],
  "GC-05-insufficient-liquidity": [
    ["request-amount", "trigger"],
    ["source-account-balance", "account-balance"],
    ["pending-liquidity-activity", "pending-actions"],
    ["planned-withdrawal-schedule", "planned-withdrawals"],
  ],
  "GC-06-household-restriction": [
    ["request-amount", "trigger"],
    ["source-account-balance", "account-balance"],
    ["destination-bank-instruction", "bank-instruction"],
    ["destination-restriction", "household-instruction"],
  ],
  "GC-07-regulatory-prohibition": [
    ["request-amount", "trigger"],
    ["source-account-balance", "account-balance"],
    ["regulatory-account-restriction", "account-restriction"],
  ],
  "GC-08-ambiguous-household": [
    ["request-amount", "trigger"],
    ["household-identity", "household-directory"],
  ],
  "GC-09-stale-evidence": [
    ["request-amount", "trigger"],
    ["source-account-balance", "account-balance"],
    ["planned-withdrawal-schedule", "planned-withdrawals"],
  ],
  "GC-10-simultaneous-distributions-first": PROCEED_FACTS,
  "GC-11-simultaneous-distributions-second": [
    ["request-amount", "trigger"],
    ["source-account-balance", "account-balance"],
    ["pending-liquidity-activity", "pending-actions"],
    ["planned-withdrawal-schedule", "planned-withdrawals"],
  ],
  "GC-12-duplicate-retry": PROCEED_FACTS,
  "GC-13-partial-salesforce-success": PROCEED_FACTS,
  "GC-14-delayed-nigo": PROCEED_FACTS,
  "GC-15-approval-invalidation": PROCEED_FACTS,
  "GC-16-specialist-review-expiration": PROCEED_FACTS,
} satisfies Record<string, readonly (readonly [string, string])[]>;

const isObj = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Every required fact names the evidence that proves it or explicitly records
 * that the source was observed and absent. Proceed cannot treat silence as safe.
 */
export function validateEvidenceCompleteness(c: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const matrix = c.evidenceCompleteness;
  const evidence = Array.isArray(c.householdEvidence)
    ? c.householdEvidence.filter(isObj)
    : [];
  const rowsByKind = new Map<string, Record<string, unknown>[]>();
  for (const row of evidence) {
    if (!nonEmpty(row.evidenceKind)) continue;
    rowsByKind.set(row.evidenceKind, [...(rowsByKind.get(row.evidenceKind) ?? []), row]);
  }

  if (!Array.isArray(matrix) || matrix.length === 0) {
    return ["evidenceCompleteness must be a non-empty explicit fact matrix"];
  }

  const seenFacts = new Set<string>();
  const referencedKinds = new Set<string>();
  const factSources = new Map<string, string[]>();
  matrix.forEach((entry, index) => {
    const at = `evidenceCompleteness[${index}]`;
    if (!isObj(entry)) {
      problems.push(`${at} is not an object`);
      return;
    }
    if (!nonEmpty(entry.fact)) problems.push(`${at}.fact missing or empty`);
    else if (seenFacts.has(entry.fact)) problems.push(`${at}.fact "${entry.fact}" is duplicated`);
    else seenFacts.add(entry.fact);

    if (entry.status !== "present" && entry.status !== "observed-absent") {
      problems.push(`${at}.status must be present|observed-absent`);
    }
    if (!Array.isArray(entry.sources) || entry.sources.length === 0 || !entry.sources.every(nonEmpty)) {
      problems.push(`${at}.sources must be a non-empty string array`);
      return;
    }
    const sources = entry.sources as string[];
    if (nonEmpty(entry.fact)) factSources.set(entry.fact, sources);
    for (const source of sources) {
      if (source === "trigger") {
        if (entry.status !== "present") problems.push(`${at}: trigger cannot be observed-absent`);
        continue;
      }
      referencedKinds.add(source);
      const rows = rowsByKind.get(source) ?? [];
      if (rows.length === 0) {
        problems.push(`${at}: source "${source}" has no householdEvidence row`);
      } else if (entry.status === "observed-absent" && !rows.some((row) => row.observedAbsent === true)) {
        problems.push(`${at}: observed-absent source "${source}" needs observedAbsent=true evidence`);
      } else if (entry.status === "present" && !rows.some((row) => row.observedAbsent !== true)) {
        problems.push(`${at}: present source "${source}" has only absent evidence`);
      }
    }
  });

  for (const kind of rowsByKind.keys()) {
    if (!referencedKinds.has(kind)) problems.push(`householdEvidence kind "${kind}" is missing from evidenceCompleteness`);
  }
  const caseId = nonEmpty(c.caseId) ? c.caseId : "(missing caseId)";
  const requiredFacts =
    REQUIRED_FACT_SOURCES_BY_CASE[
      caseId as keyof typeof REQUIRED_FACT_SOURCES_BY_CASE
    ];
  if (!requiredFacts) {
    problems.push(`${caseId}: no decisive-evidence rule classifies this signed case`);
  } else {
    const subject = c.expectedDisposition === "proceed" ? "proceed" : caseId;
    for (const [fact, source] of requiredFacts) {
      if (!factSources.get(fact)?.includes(source)) {
        problems.push(`${subject} requires evidenceCompleteness fact "${fact}" sourced by "${source}"`);
      }
    }
  }
  return problems;
}
