import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { join } from "node:path";
import { SRC_ROOT } from "./_fence-utils";
import { DATA_DICTIONARY } from "@domain/schema/dictionary";
import { ENTITY_NAMES } from "@domain/schema/entities";

/**
 * PROVENANCE-REQUIRED FENCE (ADR-0005, charter #2). Fails the build if any
 * modeled entity field lacks a provenance annotation in the data dictionary, or
 * if the dictionary declares a field the entity does not have (drift both ways).
 * The record-level `provenance` meta-field is excluded (it is not a data field).
 */

export function checkProvenanceCoverage(
  entityFields: Record<string, string[]>,
  dictionary: Record<string, Record<string, unknown>>,
): string[] {
  const out: string[] = [];
  for (const [entity, fields] of Object.entries(entityFields)) {
    const dictFields = dictionary[entity] ? Object.keys(dictionary[entity]!) : null;
    if (!dictFields) {
      out.push(`${entity}: entity has no dictionary entry`);
      continue;
    }
    if (!fields.includes("provenance")) out.push(`${entity}: missing record-level provenance field`);
    for (const f of fields) {
      if (f === "provenance") continue;
      if (!dictFields.includes(f)) out.push(`${entity}.${f}: no provenance annotation in the data dictionary`);
    }
    for (const f of dictFields) {
      if (!fields.includes(f)) out.push(`dictionary ${entity}.${f}: not a field on the entity (drift)`);
    }
  }
  return out;
}

function readEntityFields(): Record<string, string[]> {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  const sf = project.addSourceFileAtPath(join(SRC_ROOT, "domain/schema/entities.ts"));
  const result: Record<string, string[]> = {};
  for (const name of ENTITY_NAMES) {
    const iface = sf.getInterface(name);
    if (!iface) continue;
    result[name] = iface.getProperties().map((p) => p.getName());
  }
  return result;
}

describe("provenance-required fence", () => {
  it("enforces: every entity field has a provenance annotation; no dictionary drift", () => {
    const entityFields = readEntityFields();
    // Sanity: all declared entity names were found as interfaces.
    expect(Object.keys(entityFields).sort()).toEqual([...ENTITY_NAMES].sort());
    const violations = checkProvenanceCoverage(entityFields, DATA_DICTIONARY as Record<string, Record<string, unknown>>);
    expect(violations, `provenance coverage violations:\n${violations.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): drift is caught in both directions", () => {
    it("an entity field missing from the dictionary is caught", () => {
      const v = checkProvenanceCoverage({ Foo: ["id", "unlabeled", "provenance"] }, { Foo: { id: {} } });
      expect(v).toContain("Foo.unlabeled: no provenance annotation in the data dictionary");
    });
    it("a dictionary field not on the entity is caught (drift)", () => {
      const v = checkProvenanceCoverage({ Foo: ["id", "provenance"] }, { Foo: { id: {}, ghost: {} } });
      expect(v).toContain("dictionary Foo.ghost: not a field on the entity (drift)");
    });
    it("a missing record-level provenance field is caught", () => {
      const v = checkProvenanceCoverage({ Foo: ["id"] }, { Foo: { id: {} } });
      expect(v).toContain("Foo: missing record-level provenance field");
    });
    it("a fully-annotated entity passes", () => {
      const v = checkProvenanceCoverage({ Foo: ["id", "provenance"] }, { Foo: { id: {} } });
      expect(v).toEqual([]);
    });
  });
});
