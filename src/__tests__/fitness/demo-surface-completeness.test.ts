import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  DEMO_SURFACES,
  type DemoSurfaceDefinition,
} from "../../app/demo/surface-contract";
import { DEMO_SEQUENCE } from "../../app/demo/model";
import { REPO_ROOT } from "./_fence-utils";

const CONTRACT_PATH = "docs/demo-contract.md";
const ROUTE_PATH = "src/app/app/demo/[station]/page.tsx";
const E2E_PATH = "e2e/demo-journey.spec.ts";
const JOURNEY_TEST = "the seven-minute journey is clickable end-to-end on labeled fakes";

function contractSurfaceNames(markdown: string): string[] {
  const section = markdown.match(
    /^## 4\. Required product surfaces\s*$([\s\S]*?)^## 5\./m,
  )?.[1];
  if (section === undefined) return [];
  return [...section.matchAll(/^(\d+)\.\s+([^\n]+)/gm)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => match[2]!.replace(/\s+\(.*$/, "").trim());
}

function switchStations(source: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/route.tsx", source);
  return file
    .getDescendantsOfKind(SyntaxKind.CaseClause)
    .map((clause) => clause.getExpression())
    .filter(Node.isStringLiteral)
    .map((literal) => literal.getLiteralText());
}

function screenshotSequence(source: string): Array<{ number: number; name: string }> {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/demo.spec.ts", source);
  const registration = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => {
      const [title] = call.getArguments();
      return (
        call.getExpression().getText() === "test" &&
        Node.isStringLiteral(title) &&
        title.getLiteralText() === JOURNEY_TEST
      );
    });
  const callback = registration
    ?.getArguments()
    .find(
      (argument) =>
        Node.isArrowFunction(argument) || Node.isFunctionExpression(argument),
    );
  if (callback === undefined) return [];
  return callback
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => call.getExpression().getText() === "snap")
    .flatMap((call) => {
      const [, number, name] = call.getArguments();
      if (
        !Node.isNumericLiteral(number) ||
        !Node.isStringLiteral(name)
      ) {
        return [];
      }
      const value = Number(number.getLiteralText());
      return value >= 1
        ? [{ number: value, name: name.getLiteralText() }]
        : [];
    });
}

function hasRealScreenshotHelper(source: string): boolean {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/demo.spec.ts", source);
  const helper = file.getFunction("snap");
  return (
    helper
      ?.getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((call) => {
        const expression = call.getExpression();
        return (
          Node.isPropertyAccessExpression(expression) &&
          expression.getName() === "screenshot"
        );
      }) ?? false
  );
}

export function surfaceCompletenessProblems(
  contract: string,
  surfaces: readonly DemoSurfaceDefinition[],
  route: string,
  e2e: string,
  exists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  const contractNames = contractSurfaceNames(contract);
  const surfaceNames = surfaces.map((surface) => surface.contractName);
  if (contractNames.length === 0) {
    problems.push(`${CONTRACT_PATH}:1 required product surface list is missing`);
  } else if (JSON.stringify(surfaceNames) !== JSON.stringify(contractNames)) {
    problems.push(
      `${CONTRACT_PATH}:1 typed demo surface manifest does not exactly match the ordered §4 surface contract`,
    );
  }

  const expectedNumbers = surfaces.map((_, index) => index + 1);
  if (
    JSON.stringify(surfaces.map((surface) => surface.number)) !==
    JSON.stringify(expectedNumbers)
  ) {
    problems.push(
      "src/app/demo/surface-contract.ts:1 surface numbers must be complete, unique, and ordered",
    );
  }
  for (const key of ["station", "componentPath", "screenshotName"] as const) {
    const values = surfaces.map((surface) => surface[key]);
    if (new Set(values).size !== values.length) {
      problems.push(
        `src/app/demo/surface-contract.ts:1 surface ${key} values must be unique`,
      );
    }
  }
  for (const surface of surfaces) {
    if (!exists(surface.componentPath)) {
      problems.push(`${surface.componentPath}:1 required surface component is missing`);
    }
  }

  const stations = surfaces.map((surface) => surface.station);
  if (JSON.stringify(stations) !== JSON.stringify(DEMO_SEQUENCE)) {
    problems.push(
      "src/app/demo/model.ts:1 demo route sequence must exactly match the typed surface manifest",
    );
  }
  if (JSON.stringify(switchStations(route)) !== JSON.stringify(stations)) {
    problems.push(
      `${ROUTE_PATH}:1 dynamic demo route must render every typed surface exactly once`,
    );
  }

  const screenshots = surfaces.map((surface) => ({
    number: surface.number,
    name: surface.screenshotName,
  }));
  if (
    !hasRealScreenshotHelper(e2e) ||
    JSON.stringify(screenshotSequence(e2e)) !== JSON.stringify(screenshots)
  ) {
    problems.push(
      `${E2E_PATH}:1 canonical clickable journey must capture every typed surface in contract order`,
    );
  }
  return problems;
}

const contract = readFileSync(join(REPO_ROOT, CONTRACT_PATH), "utf8");
const route = readFileSync(join(REPO_ROOT, ROUTE_PATH), "utf8");
const e2e = readFileSync(join(REPO_ROOT, E2E_PATH), "utf8");
const exists = (path: string) => existsSync(join(REPO_ROOT, path));

describe("demo-surface-completeness fence", () => {
  it("enforces: every demo-contract §4 surface is typed, routed, clickable, and screenshotted", () => {
    const problems = surfaceCompletenessProblems(
      contract,
      DEMO_SURFACES,
      route,
      e2e,
      exists,
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  describe("detects (companion): incomplete surface contracts cannot pass", () => {
    it("rejects a dropped contract, manifest, route, component, or screenshot", () => {
      const missingContract = contract.replace(
        "12. Printable examiner-grade decision artifact",
        "Printable examiner-grade decision artifact",
      );
      expect(
        surfaceCompletenessProblems(
          missingContract,
          DEMO_SURFACES,
          route,
          e2e,
          exists,
        ),
      ).not.toEqual([]);

      const missingSurface = DEMO_SURFACES.slice(0, -1);
      expect(
        surfaceCompletenessProblems(contract, missingSurface, route, e2e, exists),
      ).not.toEqual([]);

      const missingRoute = route.replace('    case "record":', '    case "removed":');
      expect(
        surfaceCompletenessProblems(
          contract,
          DEMO_SURFACES,
          missingRoute,
          e2e,
          exists,
        ),
      ).not.toEqual([]);

      expect(
        surfaceCompletenessProblems(
          contract,
          DEMO_SURFACES,
          route,
          e2e,
          (path) => path !== DEMO_SURFACES[0]!.componentPath && exists(path),
        ),
      ).not.toEqual([]);

      const missingScreenshot = e2e.replace(
        '  await snap(page, 12, "record");',
        "",
      );
      expect(
        surfaceCompletenessProblems(
          contract,
          DEMO_SURFACES,
          route,
          missingScreenshot,
          exists,
        ),
      ).not.toEqual([]);
    });
  });
});
