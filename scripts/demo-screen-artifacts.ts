import { readdirSync, statSync, type Dirent } from "node:fs";
import { resolve } from "node:path";
import {
  demoScreenArtifactProblems,
  EXPECTED_DEMO_SCREEN_ARTIFACTS,
} from "./demo-screen-artifacts.lib";

const directory = resolve("demo-screens");
let entries: Dirent[] | undefined;
try {
  entries = readdirSync(directory, { withFileTypes: true });
} catch {
  console.error("demo screen artifacts: demo-screens directory is missing");
  process.exitCode = 1;
}

if (entries !== undefined) {
  const problems: string[] = [];
  const artifacts: Array<{ name: string; size: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      artifacts.push({
        name: entry.name,
        size: statSync(resolve(directory, entry.name)).size,
      });
    } catch {
      problems.push(`unreadable screenshot artifact '${entry.name}'`);
    }
  }
  problems.push(...demoScreenArtifactProblems(artifacts));
  if (problems.length > 0) {
    console.error(`demo screen artifacts:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log(
      `demo screen artifacts: ${EXPECTED_DEMO_SCREEN_ARTIFACTS.length} verified`,
    );
  }
}
