import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { demoScreenArtifactProblems } from "./demo-screen-artifacts.lib";

const directory = resolve("demo-screens");
let artifacts: Array<{ name: string; size: number }> = [];
try {
  artifacts = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      size: statSync(resolve(directory, entry.name)).size,
    }));
} catch {
  console.error("demo screen artifacts: demo-screens directory is missing");
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  const problems = demoScreenArtifactProblems(artifacts);
  if (problems.length > 0) {
    console.error(`demo screen artifacts:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log(`demo screen artifacts: ${artifacts.length} verified`);
  }
}
