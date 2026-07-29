export interface FitnessTestResult {
  name: string;
  status: string;
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function fitnessInventoryProblems(
  expectedFiles: readonly string[],
  results: readonly FitnessTestResult[],
  invocationStatus: number | null,
): string[] {
  const problems: string[] = [];
  if (expectedFiles.length === 0) {
    problems.push("fitness inventory is empty");
  }
  if (invocationStatus !== 0) {
    problems.push(
      `fitness invocation exited ${invocationStatus ?? "without a status"}`,
    );
  }

  for (const expected of expectedFiles) {
    const matches = results.filter((result) =>
      normalizedPath(result.name).endsWith(normalizedPath(expected)),
    );
    if (matches.length === 0) {
      problems.push(`${expected} produced no result`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(`${expected} produced duplicate results`);
      continue;
    }
    if (matches[0]!.status !== "passed") {
      problems.push(`${expected} ${matches[0]!.status.toUpperCase()}`);
    }
  }

  return problems;
}
