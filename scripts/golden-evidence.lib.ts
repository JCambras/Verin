/** Captain-ratified completeness rules for signed golden evidence. */
const PROCEED_FACT_SOURCES = {
  "request-amount": "trigger",
  "source-account-balance": "account-balance",
  "planned-withdrawal-schedule": "planned-withdrawals",
  "pending-liquidity-activity": "pending-actions",
  "destination-bank-instruction": "bank-instruction",
  "destination-restriction": "household-instruction",
} as const;

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
  if (c.expectedDisposition === "proceed") {
    for (const [fact, source] of Object.entries(PROCEED_FACT_SOURCES)) {
      if (!factSources.get(fact)?.includes(source)) {
        problems.push(`proceed requires evidenceCompleteness fact "${fact}" sourced by "${source}"`);
      }
    }
  }
  return problems;
}
