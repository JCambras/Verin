import { readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const VITEST_TEST_KINDS = ["test", "spec"] as const;
const VITEST_TEST_EXTENSIONS = ["ts", "tsx"] as const;

export const VITEST_TEST_INCLUDE = `src/**/*.{${VITEST_TEST_KINDS.join(
  ",",
)}}.{${VITEST_TEST_EXTENSIONS.join(",")}}`;

export interface FitnessTestResult {
  name: string;
  status: string;
}

export function completeTestRunArguments(outputFile: string): string[] {
  return [
    "run",
    "--maxWorkers=1",
    "--fileParallelism=false",
    "--reporter=json",
    `--outputFile=${outputFile}`,
  ];
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function repositoryRelativePath(
  root: string,
  path: string,
): string | undefined {
  const resolvedRoot = resolve(root);
  const normalized = normalizedPath(path);
  const resolvedPath = isAbsolute(normalized)
    ? resolve(normalized)
    : resolve(resolvedRoot, normalized);
  const fromRoot = normalizedPath(relative(resolvedRoot, resolvedPath));
  return fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith("../") ||
    isAbsolute(fromRoot)
    ? undefined
    : fromRoot;
}

export interface IndexedFitnessResults {
  readonly fileResults: ReadonlyMap<string, boolean>;
  readonly problems: readonly string[];
}

export function indexFitnessTestResults(
  expectedFiles: readonly string[],
  results: readonly FitnessTestResult[],
  root: string,
): IndexedFitnessResults {
  const fileResults = new Map<string, boolean>();
  const problems: string[] = [];
  const resultsByPath = new Map<string, FitnessTestResult[]>();
  for (const result of results) {
    const path = repositoryRelativePath(root, result.name);
    if (path === undefined) continue;
    const matches = resultsByPath.get(path) ?? [];
    matches.push(result);
    resultsByPath.set(path, matches);
  }
  for (const expected of expectedFiles) {
    const path = repositoryRelativePath(root, expected);
    if (path === undefined) {
      problems.push(`${expected} is not inside the repository`);
      continue;
    }
    const matches = resultsByPath.get(path) ?? [];
    if (matches.length > 1) {
      problems.push(`${expected} produced duplicate results`);
    }
    if (matches.length > 0) {
      fileResults.set(expected, matches[0]!.status === "passed");
    }
  }
  return { fileResults, problems };
}

export function isVitestTestFile(path: string): boolean {
  const normalized = normalizedPath(path);
  return VITEST_TEST_KINDS.some((kind) =>
    VITEST_TEST_EXTENSIONS.some((extension) =>
      normalized.endsWith(`.${kind}.${extension}`),
    ),
  );
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
      return entry.isFile() && isVitestTestFile(entry.name)
        ? [normalizedPath(relative(resolvedRoot, path))]
        : [];
    });
  return visit(fitnessDirectory).sort();
}

export function fitnessInventoryProblems(
  expectedFiles: readonly string[],
  results: readonly FitnessTestResult[],
  invocationStatus: number | null,
  root = process.cwd(),
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

  const indexed = indexFitnessTestResults(
    expectedFiles,
    results,
    root,
  );
  problems.push(...indexed.problems);
  for (const expected of expectedFiles) {
    const passed = indexed.fileResults.get(expected);
    if (passed === undefined) {
      problems.push(`${expected} produced no result`);
      continue;
    }
    if (!passed) {
      const result = results.find(
        (candidate) =>
          repositoryRelativePath(root, candidate.name) ===
          repositoryRelativePath(root, expected),
      );
      problems.push(
        `${expected} ${result?.status.toUpperCase() ?? "FAILED"}`,
      );
    }
  }

  return problems;
}
