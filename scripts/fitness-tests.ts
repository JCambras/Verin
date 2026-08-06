import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  completeTestRunArguments,
  fitnessTestFiles,
  fitnessInventoryProblems,
  type FitnessTestResult,
} from "./fitness-tests.lib";

const ROOT = resolve(import.meta.dirname, "..");
const fitnessFiles = fitnessTestFiles(ROOT);
const outputDirectory = mkdtempSync(join(tmpdir(), "verin-fitness-"));
const outputFile = join(outputDirectory, "vitest.json");
const vitestEntry = join(ROOT, "node_modules/vitest/vitest.mjs");

let results: FitnessTestResult[] = [];
let reportProblem: string | undefined;
const run = spawnSync(
  process.execPath,
  [
    vitestEntry,
    ...completeTestRunArguments(outputFile),
  ],
  {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // The whole suite's output flows through this pipe. Node's 1 MiB default
    // kills vitest mid-run with ENOBUFS, which reaches the gate as a missing
    // report rather than as the test failure (or the pass) that really happened.
    maxBuffer: Infinity,
  },
);

try {
  if (!existsSync(outputFile)) {
    reportProblem = "fitness invocation produced no JSON report";
  } else {
    const report = JSON.parse(readFileSync(outputFile, "utf8")) as {
      testResults?: FitnessTestResult[];
    };
    if (!Array.isArray(report.testResults)) {
      reportProblem = "fitness invocation produced an invalid JSON report";
    } else {
      results = report.testResults;
    }
  }
} catch {
  reportProblem = "fitness invocation produced an unreadable JSON report";
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}

const problems = [
  ...(run.error === undefined
    ? []
    : [`fitness invocation failed to start: ${run.error.message}`]),
  ...(reportProblem === undefined ? [] : [reportProblem]),
  ...fitnessInventoryProblems(fitnessFiles, results, run.status, ROOT),
];
if (problems.length > 0) {
  // A spawn-level failure leaves both streams null; reporting the problems
  // matters more than the (absent) child output.
  const stderr = (run.stderr ?? "").trim();
  const stdout = (run.stdout ?? "").trim();
  if (stderr !== "") console.error(stderr);
  if (stdout !== "") console.error(stdout);
  console.error(`fitness inventory failed:\n  - ${problems.join("\n  - ")}`);
  process.exitCode = 1;
} else {
  console.log(
    `complete test suite passed: ${fitnessFiles.length} fitness files executed`,
  );
}
