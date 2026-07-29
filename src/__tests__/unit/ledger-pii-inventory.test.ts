import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
} from "@contracts/decision-core/evidence";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import { LedgerEntrySchema } from "@contracts/decision-core/ledger";
import { unclassifiedRetainedStringPaths } from "@infra/ledger/ledger-pii";

interface SchemaDef {
  readonly type: string;
  readonly innerType?: unknown;
  readonly in?: unknown;
  readonly element?: unknown;
  readonly valueType?: unknown;
  readonly shape?: Readonly<Record<string, unknown>>;
  readonly options?: readonly unknown[];
  readonly entries?: Readonly<Record<string, unknown>>;
  readonly values?: readonly unknown[];
}

interface SchemaNode {
  readonly _zod: { readonly def: SchemaDef };
}

function definition(schema: unknown): SchemaDef | null {
  if (
    schema === null ||
    typeof schema !== "object" ||
    !("_zod" in schema)
  ) {
    return null;
  }
  return (schema as SchemaNode)._zod.def;
}

function stringPaths(
  schema: unknown,
  path: string,
  ancestors = new Set<unknown>(),
): string[] {
  const def = definition(schema);
  if (!def || ancestors.has(schema)) return [];
  const nestedAncestors = new Set(ancestors).add(schema);
  if (def.type === "string") return [path];
  if (def.type === "enum") {
    return Object.values(def.entries ?? {}).some(
      (value) => typeof value === "string",
    ) ? [path] : [];
  }
  if (def.type === "literal") {
    return (def.values ?? []).some((value) => typeof value === "string")
      ? [path]
      : [];
  }
  if (
    def.type === "readonly" ||
    def.type === "optional"
  ) {
    return stringPaths(def.innerType, path, nestedAncestors);
  }
  if (def.type === "pipe") {
    return stringPaths(def.in, path, nestedAncestors);
  }
  if (def.type === "array") {
    return stringPaths(def.element, `${path}[]`, nestedAncestors);
  }
  if (def.type === "record") {
    return stringPaths(def.valueType, `${path}.*`, nestedAncestors);
  }
  if (def.type === "object") {
    return Object.entries(def.shape ?? {}).flatMap(([key, nested]) =>
      stringPaths(nested, `${path}.${key}`, nestedAncestors));
  }
  if (def.type === "union") {
    return (def.options ?? []).flatMap((option) =>
      stringPaths(option, path, nestedAncestors));
  }
  return [];
}

function unwrap(schema: unknown): unknown {
  let current = schema;
  while (true) {
    const def = definition(current);
    if (
      !def ||
      (def.type !== "readonly" && def.type !== "optional")
    ) {
      return current;
    }
    current = def.innerType;
  }
}

function ledgerEventSchemas(): Array<{ type: string; schema: unknown }> {
  const union = definition(unwrap(LedgerEntrySchema));
  if (union?.type !== "union") throw new Error("expected ledger union");
  return (union.options ?? []).map((schema) => {
    const object = definition(unwrap(schema));
    const typeSchema = object?.shape?.type;
    const literal = definition(unwrap(typeSchema));
    const type = literal?.values?.[0];
    if (typeof type !== "string") throw new Error("expected event literal");
    return { type, schema };
  });
}

describe("immutable retained-string inventory", () => {
  it("classifies every schema-declared string path", () => {
    const paths = [
      ...stringPaths(EvidenceSnapshotRefSchema, "evidence"),
      ...stringPaths(DecisionInputBundleSchema, "bundle"),
      ...stringPaths(DecisionRecordSchema, "decision"),
      ...ledgerEventSchemas().flatMap(({ type, schema }) =>
        stringPaths(schema, `event:${type}`)),
    ];
    expect(unclassifiedRetainedStringPaths([...new Set(paths)].sort()))
      .toEqual([]);
  });

  it("detects schema growth that reuses a classified leaf name", () => {
    const schema = z.strictObject({
      futureContainer: z.strictObject({ id: z.string() }),
    });
    expect(unclassifiedRetainedStringPaths(
      stringPaths(schema, "event:DecisionRecorded"),
    )).toEqual(["event:DecisionRecorded.futureContainer.id"]);
  });
});
