import { DEMO_SURFACES } from "../src/app/demo/surface-contract";

export interface DemoScreenArtifact {
  readonly name: string;
  readonly size: number;
}

export const EXPECTED_DEMO_SCREEN_ARTIFACTS = [
  "00-launcher.png",
  ...DEMO_SURFACES.map(
    (surface) =>
      `${String(surface.number).padStart(2, "0")}-${surface.screenshotName}.png`,
  ),
] as const;

export function demoScreenArtifactProblems(
  artifacts: readonly DemoScreenArtifact[],
): string[] {
  const problems: string[] = [];
  const expected = new Set<string>(EXPECTED_DEMO_SCREEN_ARTIFACTS);
  const byName = new Map<string, DemoScreenArtifact>();
  for (const artifact of artifacts) {
    if (byName.has(artifact.name)) {
      problems.push(`duplicate screenshot artifact '${artifact.name}'`);
    }
    byName.set(artifact.name, artifact);
  }
  for (const name of expected) {
    const artifact = byName.get(name);
    if (artifact === undefined) {
      problems.push(`missing screenshot artifact '${name}'`);
    } else if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      problems.push(`empty screenshot artifact '${name}'`);
    }
  }
  return problems;
}
