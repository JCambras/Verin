/**
 * A CONFIGURATION VERSION'S CHANGE AS DATA (captain direction, 2026-08-11;
 * ADR-0057).
 *
 * A candidate version must be able to state its change against a parent version
 * as DATA, not as prose, because the planned genesis-interview onboarding
 * proposes configuration and a proposed change has to be renderable as a
 * reviewable diff. This module computes that diff from the two documents'
 * canonical bytes, section by section, and the loader compares the computed
 * result with what the document DECLARED - so a declaration cannot drift from
 * the bytes it describes.
 *
 * Granularity is the top-level section. It is deliberately coarse: a
 * field-level diff is a rendering concern that can be derived later from the
 * same canonical bytes, whereas a section-level statement is what a reviewer
 * approves ("this version changes the evidence floors and nothing else"), and
 * it is the level at which a change is either an addition, a replacement, or a
 * removal without ambiguity.
 */
import { canonicalJson, type JsonValue } from "@contracts/decision-core/serialization";
import { CONFIG_SECTIONS, type ConfigSection } from "./vocabulary";

/** The header fields a change record folds into the synthetic `header` section. */
const HEADER_FIELDS = [
  "formatVersion",
  "domainConfigId",
  "primitiveSetVersion",
  "policyGrammarVersion",
] as const;

export type SectionDiff = {
  readonly op: "add" | "replace" | "remove";
  readonly section: ConfigSection;
};

type SectionSource = Readonly<Record<string, unknown>>;

/** A section's comparable value, or `null` when the document does not carry it. */
const sectionValue = (document: SectionSource, section: ConfigSection): unknown => {
  if (section === "header") {
    const header = Object.fromEntries(
      HEADER_FIELDS.filter((field) => document[field] !== undefined).map((field) => [
        field,
        document[field],
      ]),
    );
    return Object.keys(header).length === 0 ? null : header;
  }
  const value = document[section];
  if (value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return value;
};

/**
 * Stable per-section bytes, through the repo's CANONICAL serializer rather than
 * `JSON.stringify`. The two differ on key order, and that is exactly the
 * comparison this makes: a version reserialized by the persisted registry and a
 * candidate parsed from author-ordered YAML are the same document, and a diff
 * that reported every section as `replace` would force an author to declare
 * changes that did not happen.
 *
 * A section the canonical serializer REFUSES cannot be compared byte for byte,
 * so it renders as its own refusal instead: two sides that fail identically stay
 * equal, and a serializable section never silently compares equal to one that is
 * not. `!` can never begin canonical JSON, so a refusal cannot collide with bytes.
 */
const sectionBytes = (document: SectionSource, section: ConfigSection): string | null => {
  const value = sectionValue(document, section);
  if (value === null) return null;
  const canonical = canonicalJson(value as JsonValue);
  return canonical.ok ? canonical.value : `!unserializable:${canonical.error.message}`;
};

/** THE EMPTY BASELINE: what a first published version is diffed against. */
export const EMPTY_CONFIG_BASELINE: SectionSource = Object.freeze({});

/**
 * Diff two documents section by section, in the declared section order so the
 * result is a function of content alone. `version` and `authorship` are
 * deliberately excluded: every new version changes both, so including them
 * would make every diff report the same two entries and say nothing.
 */
export const diffDomainConfigs = (
  parent: SectionSource,
  candidate: SectionSource,
): readonly SectionDiff[] => {
  const changes: SectionDiff[] = [];
  for (const section of CONFIG_SECTIONS) {
    const before = sectionBytes(parent, section);
    const after = sectionBytes(candidate, section);
    if (before === after) continue;
    if (before === null) changes.push({ op: "add", section });
    else if (after === null) changes.push({ op: "remove", section });
    else changes.push({ op: "replace", section });
  }
  return changes;
};

const changeKey = (change: { readonly op: string; readonly section: string }): string =>
  `${change.op}:${change.section}`;

/**
 * Which declared entries are unsupported by the bytes, and which real changes
 * the declaration omits. Both directions matter: an omission hides a change
 * from review, and an unsupported claim describes a change that did not happen.
 */
export const changeDeclarationMismatch = (
  declared: readonly { readonly op: string; readonly section: string }[],
  computed: readonly SectionDiff[],
): { readonly unsupported: readonly string[]; readonly undeclared: readonly string[] } => {
  const declaredKeys = new Set(declared.map(changeKey));
  const computedKeys = new Set(computed.map(changeKey));
  return {
    unsupported: [...declaredKeys].filter((key) => !computedKeys.has(key)).sort(),
    undeclared: [...computedKeys].filter((key) => !declaredKeys.has(key)).sort(),
  };
};
