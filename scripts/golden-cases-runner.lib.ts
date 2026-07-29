import {
  validateGoldenCases,
  type LoadedCase,
  type ScenarioRefs,
} from "./golden-cases.lib";
import {
  validateGoldenDemoSemantics,
  type DemoSemanticSnapshot,
} from "./golden-demo-semantics.lib";

type DemoSnapshotLoader = () =>
  | DemoSemanticSnapshot
  | Promise<DemoSemanticSnapshot>;

function boundedParserMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown parser failure";
  const oneLine = [...raw]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return (oneLine || "unknown parser failure").slice(0, 320);
}

function parserProblems(
  cases: LoadedCase[],
  error: unknown,
): string[] {
  const message = boundedParserMessage(error);
  const owner = cases.find(({ data }) => {
    const record =
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
    const caseId =
      record && typeof record.caseId === "string"
        ? record.caseId
        : null;
    return caseId !== null && message.includes(caseId);
  });
  return owner
    ? [
        `${owner.rel} :: production signed-case parser rejected the validated fixture: ${message}`,
      ]
    : [
        `production signed-case parser rejected validated fixtures: ${message}`,
      ];
}

export async function validateGoldenCaseArtifacts(
  cases: LoadedCase[],
  refs: ScenarioRefs,
  docText: string,
  loadDemoSnapshot: DemoSnapshotLoader,
): Promise<string[]> {
  const rawProblems = validateGoldenCases(cases, refs, docText);
  if (rawProblems.length > 0) return rawProblems;
  let demo: DemoSemanticSnapshot;
  try {
    demo = await loadDemoSnapshot();
  } catch (error) {
    return parserProblems(cases, error);
  }
  return validateGoldenDemoSemantics(cases, refs, demo);
}
