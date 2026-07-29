import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface FitnessTestResult {
  name: string;
  status: string;
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function fitnessTestFiles(root: string): string[] {
  const resolvedRoot = resolve(root);
  const fitnessDirectory = join(
    resolvedRoot,
    "src",
    "__tests__",
    "fitness",
  );
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return visit(path);
      return entry.isFile() && entry.name.endsWith(".test.ts")
        ? [normalizedPath(relative(resolvedRoot, path))]
        : [];
    });
  return visit(fitnessDirectory).sort();
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
