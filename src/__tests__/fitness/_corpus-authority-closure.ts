import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Project } from "ts-morph";
import ts from "typescript";
import { moduleReferences, REPO_ROOT } from "./_fence-utils";

/**
 * The executable-authority closure walk shared by the corpus fence files: it
 * resolves the runtime import graph of the declared real-derived authorities and
 * reports every file the manifest inventory misses or invents.
 */
const tsConfig = ts.readConfigFile(
  join(REPO_ROOT, "tsconfig.json"),
  ts.sys.readFile,
);
const compilerOptions = ts.parseJsonConfigFileContent(
  tsConfig.config,
  ts.sys,
  REPO_ROOT,
).options;
const authorityClosureCache = new Map<
  string,
  { closure: readonly string[]; problems: readonly string[] }
>();

export const authorityClosureProblems = (
  roots: readonly string[],
  inventory: readonly string[],
  sourceOverrides: Readonly<Record<string, string>> = {},
): string[] => {
  const cacheKey = Object.keys(sourceOverrides).length === 0
    ? JSON.stringify(roots)
    : null;
  const cached = cacheKey === null
    ? undefined
    : authorityClosureCache.get(cacheKey);
  const problems: string[] = [...(cached?.problems ?? [])];
  const closure = new Set(cached?.closure ?? []);
  const pending = cached === undefined ? [...roots] : [];
  const project = pending.length === 0
    ? null
    : new Project({
      tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (closure.has(file)) continue;
    closure.add(file);
    const absolute = join(REPO_ROOT, file);
    const bytes = sourceOverrides[file] ?? readFileSync(absolute, "utf8");
    const source = ts.createSourceFile(
      absolute,
      bytes,
      ts.ScriptTarget.Latest,
      true,
    );
    const runtimeStaticSpecifiers = new Set<string>();
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const clause = statement.importClause;
        const runtime =
          clause === undefined ||
          (
            !clause.isTypeOnly &&
            (
              clause.name !== undefined ||
              clause.namedBindings === undefined ||
              ts.isNamespaceImport(clause.namedBindings) ||
              clause.namedBindings.elements.some(
                (element) => !element.isTypeOnly,
              )
            )
          );
        if (runtime) {
          runtimeStaticSpecifiers.add(statement.moduleSpecifier.text);
        }
      }
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        !statement.isTypeOnly &&
        (
          statement.exportClause === undefined ||
          !ts.isNamedExports(statement.exportClause) ||
          statement.exportClause.elements.some(
            (element) => !element.isTypeOnly,
          )
        )
      ) {
        runtimeStaticSpecifiers.add(statement.moduleSpecifier.text);
      }
      if (
        ts.isImportEqualsDeclaration(statement) &&
        !statement.isTypeOnly &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression !== undefined &&
        ts.isStringLiteralLike(statement.moduleReference.expression)
      ) {
        runtimeStaticSpecifiers.add(
          statement.moduleReference.expression.text,
        );
      }
    }
    const sourceFile = project!.createSourceFile(
      absolute,
      bytes,
      { overwrite: true },
    );
    const runtimeReferences = moduleReferences(sourceFile).filter(
      (reference) => {
        if (
          reference.kind === "import" ||
          reference.kind === "export" ||
          reference.kind === "import-equals"
        ) {
          return (
            reference.specifier !== null &&
            runtimeStaticSpecifiers.has(reference.specifier)
          );
        }
        return ![
          "import-type",
          "reference-types",
          "reference-path",
          "reference-lib",
        ].includes(reference.kind);
      },
    );
    const runtimeSpecifiers = new Set<string>();
    for (const reference of runtimeReferences) {
      if (reference.specifier === null) {
        problems.push(
          `${file}: indirect or non-literal runtime dependency (${reference.kind})`,
        );
      } else {
        runtimeSpecifiers.add(reference.specifier);
      }
    }
    for (const specifier of runtimeSpecifiers) {
      const resolved = ts.resolveModuleName(
        specifier,
        absolute,
        compilerOptions,
        ts.sys,
      ).resolvedModule;
      if (resolved === undefined) continue;
      const target = resolve(resolved.resolvedFileName);
      const pathFromRoot = relative(REPO_ROOT, target);
      if (
        pathFromRoot === ".." ||
        pathFromRoot.startsWith(`..${sep}`) ||
        isAbsolute(pathFromRoot) ||
        pathFromRoot.split(/[\\/]/).includes("node_modules")
      ) {
        continue;
      }
      pending.push(pathFromRoot.replace(/\\/g, "/"));
    }
  }
  if (cacheKey !== null && cached === undefined) {
    authorityClosureCache.set(cacheKey, {
      closure: [...closure],
      problems: [...problems],
    });
  }
  const inventoried = new Set(inventory);
  for (const file of closure) {
    if (!inventoried.has(file)) {
      problems.push(`missing executable authority dependency ${file}`);
    }
  }
  for (const file of inventoried) {
    if (!closure.has(file)) {
      problems.push(`extraneous executable authority ${file}`);
    }
  }
  if (inventoried.size !== inventory.length) {
    problems.push("duplicate executable authority inventory entry");
  }
  return problems;
};

export const requiredGatewayRootProblems = (roots: readonly string[]): string[] =>
  ["scripts/corpus/real-derived.ts", "scripts/corpus/validate.ts"]
    .filter((file) => !roots.includes(file))
    .map((file) => `missing executable authority gateway root ${file}`);
